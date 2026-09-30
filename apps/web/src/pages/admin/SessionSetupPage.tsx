import { useCallback, useMemo, useState, type FormEvent } from 'react';
import {
  PLACEMENT_FIELDS,
  PLACEMENT_ROOM_TYPE_LABEL,
  SLOT_FIELDS,
  SLOT_TYPE_LABEL,
  TIMETABLE_FIELDS,
  WEEKDAY_LABEL,
  autoPlacements,
  checkSchedule,
  groupPlacements,
  groupTimetable,
  isGridSheet,
  isSetupEditable,
  parsePlacements,
  parseSlots,
  parseTimetable,
  parseTimetableGrid,
  slotIdOf,
  type BaseTimetableDoc,
  type Cell,
  type ColumnMapping,
  type Placement,
  type PlacementRoomType,
  type RoomDoc,
  type SetupIssue,
  type SlotDoc,
  type SlotImport,
  type SlotType,
  type TeacherDoc,
  type TimetableImport,
  type WithId,
} from '@sim/shared';
import { ImportWizard } from '@/components/ImportWizard';
import { Modal } from '@/components/Modal';
import { Alert, Button, Card, DownloadButton, Field, Select, Spinner, Table, Td } from '@/components/ui';
import { commitOps, ref, useCollection, type BatchOp } from '@/lib/data';
import { errorMessage } from '@/lib/firebase';
import type { ExamSession } from '@/lib/sessions';
import { TIMETABLE_GUIDE, timetableSheets } from '@/lib/bundle';
import { downloadTemplate, downloadWorkbook, guideSheet, type SheetData } from '@/lib/xlsx';
import { BundleCard } from './BundleCard';
import { useCurrentSession } from './SessionPage';
import { sortRooms } from './RoomsPage';

type Slot = WithId<SlotDoc>;
type Room = WithId<RoomDoc>;
type Teacher = WithId<TeacherDoc>;

function sortSlots(list: Slot[]): Slot[] {
  return [...list].sort((a, b) => a.date.localeCompare(b.date) || a.period - b.period || a.grade - b.grade);
}

function slotLabel(s: Pick<SlotDoc, 'date' | 'period' | 'grade' | 'subject'>) {
  return `${s.date} ${s.period}교시 ${s.grade}학년 ${s.subject}`;
}

function dateLabel(date: string) {
  const d = new Date(`${date}T00:00:00`);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${'일월화수목금토'[d.getDay()]})`;
}

// ───────────────────────── 준비 상태 ─────────────────────────

function Readiness({ session, slots, rooms, teachers, timetable }: {
  session: ExamSession;
  slots: Slot[];
  rooms: Room[];
  teachers: Teacher[];
  timetable: WithId<BaseTimetableDoc>[];
}) {
  const issues: SetupIssue[] = [...checkSchedule(slots, rooms)];
  const active = teachers.filter((t) => t.active && t.defaultRole !== 'EXCLUDED');
  if (active.length === 0) issues.unshift({ level: 'error', message: '감독 가능한 교사가 없습니다 (교사 관리).' });
  if (rooms.length === 0) issues.unshift({ level: 'error', message: '등록된 시험실이 없습니다 (시험실 관리).' });
  if (session.settings.useBaseTimetable && timetable.length === 0) {
    issues.push({ level: 'warning', message: '기초시간표 반영이 켜져 있지만 기초시간표가 없습니다.' });
  }

  // 교시별 필요 감독 수 vs 가용 교사 수 (불가시간 반영 전 개략치)
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const need = new Map<string, number>();
  for (const s of slots) {
    const key = `${s.date} ${s.period}교시`;
    const n = s.rooms.reduce((sum, p) => {
      const r = roomById.get(p.roomId);
      return sum + (r ? r.chiefCount + r.assistantCount : 0);
    }, 0);
    need.set(key, (need.get(key) ?? 0) + n);
  }
  const peak = [...need.entries()].sort((a, b) => b[1] - a[1])[0];
  if (peak && peak[1] > active.length) {
    issues.push({ level: 'error', message: `${peak[0]}에 감독 ${peak[1]}명이 필요하지만 감독 가능한 교사는 ${active.length}명입니다.` });
  }

  const errors = issues.filter((i) => i.level === 'error');
  const placements = slots.reduce((n, s) => n + s.rooms.length, 0);

  return (
    <Card>
      <h2 className="text-lg font-bold">준비 상태</h2>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ['감독 가능 교사', `${active.length}명`],
          ['시험실', `${rooms.length}개`],
          ['시험', `${slots.length}건`],
          ['시험실 배치', `${placements}건`],
          ['최대 동시 감독', peak ? `${peak[1]}명` : '-'],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl bg-bg px-3 py-2">
            <dt className="text-sm text-muted">{k}</dt>
            <dd className="text-lg font-bold">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4">
        {issues.length === 0 ? (
          <Alert tone="info">✓ 자동 배정을 실행할 준비가 되었습니다.</Alert>
        ) : (
          <Alert tone={errors.length ? 'alert' : 'info'}>
            <p className="font-semibold">
              {errors.length ? `해결해야 할 문제 ${errors.length}건` : '확인이 필요한 항목'}
            </p>
            <ul className="mt-1 list-disc pl-5">
              {issues.slice(0, 12).map((i) => (
                <li key={i.message}>
                  {i.level === 'warning' && '(주의) '}
                  {i.message}
                </li>
              ))}
              {issues.length > 12 && <li>외 {issues.length - 12}건</li>}
            </ul>
          </Alert>
        )}
      </div>
    </Card>
  );
}

// ───────────────────────── 시험 추가/수정 ─────────────────────────

function SlotForm({ sid, slot, slots, onClose }: { sid: string; slot: Slot | null; slots: Slot[]; onClose: () => void }) {
  const [f, setF] = useState({
    date: slot?.date ?? '',
    period: String(slot?.period ?? 1),
    startTime: slot?.startTime ?? '',
    endTime: slot?.endTime ?? '',
    grade: String(slot?.grade ?? 1),
    subject: slot?.subject ?? '',
    type: slot?.type ?? ('EXAM' as SlotType),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const id = slotIdOf(f.date, Number(f.period), Number(f.grade));
    const problem = !f.date
      ? '날짜를 입력해 주세요.'
      : !f.subject.trim()
        ? '과목을 입력해 주세요.'
        : f.startTime && f.endTime && f.startTime >= f.endTime
          ? '종료시간이 시작시간보다 빠릅니다.'
          : id !== slot?.id && slots.some((s) => s.id === id)
            ? '같은 날짜·교시·학년 시험이 이미 있습니다.'
            : null;
    if (problem) return setError(problem);

    setBusy(true);
    const data: SlotDoc = {
      date: f.date,
      period: Number(f.period),
      startTime: f.startTime || null,
      endTime: f.endTime || null,
      grade: Number(f.grade),
      subject: f.subject.trim(),
      type: f.type,
      rooms: slot?.rooms ?? [],
    };
    const ops: BatchOp[] = [{ type: 'set', ref: ref(`sessions/${sid}/slots`, id), data: { ...data } }];
    if (slot && slot.id !== id) ops.push({ type: 'delete', ref: ref(`sessions/${sid}/slots`, slot.id) });
    try {
      await commitOps(ops);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal title={slot ? '시험 수정' : '시험 추가'} onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} className="grid gap-4">
        <Field label="날짜" type="date" required value={f.date} onChange={(e) => set({ date: e.target.value })} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="교시" type="number" min={1} max={10} required value={f.period} onChange={(e) => set({ period: e.target.value })} />
          <Field label="학년" type="number" min={1} max={6} required value={f.grade} onChange={(e) => set({ grade: e.target.value })} />
          <Field label="시작시간" type="time" value={f.startTime} onChange={(e) => set({ startTime: e.target.value })} />
          <Field label="종료시간" type="time" value={f.endTime} onChange={(e) => set({ endTime: e.target.value })} />
        </div>
        <Field label="과목" required value={f.subject} onChange={(e) => set({ subject: e.target.value })} />
        <Select
          label="유형"
          value={f.type}
          onChange={(e) => set({ type: e.target.value as SlotType })}
          options={Object.entries(SLOT_TYPE_LABEL).map(([value, label]) => ({ value, label }))}
        />
        {error && <Alert>{error}</Alert>}
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            저장
          </Button>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            취소
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ───────────────────────── 시험실 배치 편집 ─────────────────────────

function PlacementEditor({ sid, slot, slots, rooms, onClose }: {
  sid: string;
  slot: Slot;
  slots: Slot[];
  rooms: Room[];
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Map<string, Placement>>(() => new Map(slot.rooms.map((p) => [p.roomId, p])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 같은 시간 다른 시험에 이미 쓰인 시험실
  const usedElsewhere = new Map<string, string>();
  for (const s of slots) {
    if (s.id === slot.id || s.date !== slot.date || s.period !== slot.period) continue;
    for (const p of s.rooms) usedElsewhere.set(p.roomId, `${s.grade}학년 ${s.subject}`);
  }

  const toggle = (r: Room, on: boolean) => {
    const next = new Map(draft);
    if (on) next.set(r.id, { roomId: r.id, classNo: r.spaceType === 'CLASSROOM' ? r.classNo : null, headcount: null, roomType: 'NORMAL' });
    else next.delete(r.id);
    setDraft(next);
  };
  const patch = (roomId: string, p: Partial<Placement>) => {
    const next = new Map(draft);
    next.set(roomId, { ...next.get(roomId)!, ...p });
    setDraft(next);
  };

  const save = async () => {
    const conflict = [...draft.keys()].find((id) => usedElsewhere.has(id));
    if (conflict) return setError(`${rooms.find((r) => r.id === conflict)?.name}은(는) 같은 시간 ${usedElsewhere.get(conflict)}에 쓰이고 있습니다.`);
    setBusy(true);
    const ordered = sortRooms(rooms).flatMap((r) => (draft.has(r.id) ? [draft.get(r.id)!] : []));
    try {
      await commitOps([{ type: 'set', ref: ref(`sessions/${sid}/slots`, slot.id), data: { rooms: ordered }, merge: true }]);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal title={`시험실 배치 — ${slotLabel(slot)}`} onClose={onClose} wide>
      <div className="grid gap-4">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => setDraft(new Map(autoPlacements(slot, rooms).filter((p) => !usedElsewhere.has(p.roomId)).map((p) => [p.roomId, p])))}
          >
            기본 배치로 채우기
          </Button>
          <Button variant="secondary" onClick={() => setDraft(new Map())}>
            모두 해제
          </Button>
        </div>
        <Table head={['사용', '시험실', '반', '시험실유형', '응시인원']}>
          {sortRooms(rooms).map((r) => {
            const p = draft.get(r.id);
            const busyElsewhere = usedElsewhere.get(r.id);
            return (
              <tr key={r.id} className={busyElsewhere && !p ? 'text-muted' : ''}>
                <Td>
                  <input
                    type="checkbox"
                    className="size-6 accent-primary"
                    aria-label={`${r.name} 사용`}
                    checked={Boolean(p)}
                    onChange={(e) => toggle(r, e.target.checked)}
                  />
                </Td>
                <Td className="font-bold">
                  {r.name}
                  {busyElsewhere && <div className="text-sm font-normal text-alert">같은 시간 {busyElsewhere}</div>}
                </Td>
                <Td>
                  {p && (
                    <input
                      type="number"
                      min={1}
                      max={30}
                      className="min-h-12 w-20 rounded-xl border border-line px-3"
                      value={p.classNo ?? ''}
                      onChange={(e) => patch(r.id, { classNo: e.target.value ? Number(e.target.value) : null })}
                    />
                  )}
                </Td>
                <Td>
                  {p && (
                    <select
                      className="min-h-12 rounded-xl border border-line px-3"
                      value={p.roomType}
                      onChange={(e) => patch(r.id, { roomType: e.target.value as PlacementRoomType })}
                    >
                      {Object.entries(PLACEMENT_ROOM_TYPE_LABEL).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  )}
                </Td>
                <Td>
                  {p && (
                    <input
                      type="number"
                      min={0}
                      className="min-h-12 w-24 rounded-xl border border-line px-3"
                      value={p.headcount ?? ''}
                      onChange={(e) => patch(r.id, { headcount: e.target.value ? Number(e.target.value) : null })}
                    />
                  )}
                </Td>
              </tr>
            );
          })}
        </Table>
        {error && <Alert>{error}</Alert>}
        <div className="flex gap-2">
          <Button onClick={() => void save()} disabled={busy}>
            저장 ({draft.size}실)
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            취소
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ───────────────────────── 시험 일정 카드 ─────────────────────────

function ScheduleCard({ sid, editable, slots, rooms }: { sid: string; editable: boolean; slots: Slot[]; rooms: Room[] }) {
  const [modal, setModal] = useState<
    | { kind: 'slot'; slot: Slot | null }
    | { kind: 'placement'; slot: Slot }
    | { kind: 'importSlots' }
    | { kind: 'importPlacements' }
    | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'info' | 'alert'; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const roomName = useMemo(() => new Map(rooms.map((r) => [r.id, r.name])), [rooms]);
  const sorted = sortSlots(slots);
  const unplaced = slots.filter((s) => s.rooms.length === 0);
  const byDate = new Map<string, Slot[]>();
  for (const s of sorted) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);

  const analyzeSlots = useCallback((rows: Cell[][], mapping: ColumnMapping) => parseSlots(rows, mapping), []);
  const analyzePlacements = useCallback(
    (rows: Cell[][], mapping: ColumnMapping) => parsePlacements(rows, mapping, slots, rooms),
    [slots, rooms],
  );

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ tone: 'info', text: await fn() });
    } catch (e) {
      setMessage({ tone: 'alert', text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const autoPlace = () =>
    run(async () => {
      // 같은 시간 다른 시험에서 이미 쓰는 시험실은 제외
      const used = new Set(slots.flatMap((s) => s.rooms.map((p) => `${s.date}|${s.period}|${p.roomId}`)));
      const ops: BatchOp[] = [];
      let count = 0;
      for (const s of sortSlots(unplaced)) {
        const rooms_ = autoPlacements(s, rooms).filter((p) => !used.has(`${s.date}|${s.period}|${p.roomId}`));
        rooms_.forEach((p) => used.add(`${s.date}|${s.period}|${p.roomId}`));
        count += rooms_.length;
        ops.push({ type: 'set', ref: ref(`sessions/${sid}/slots`, s.id), data: { rooms: rooms_ }, merge: true });
      }
      await commitOps(ops);
      return `시험 ${ops.length}건에 시험실 ${count}개를 배치했습니다. 별도시험장은 "배치" 버튼으로 추가하세요.`;
    });

  const deleteSlot = (s: Slot) =>
    run(async () => {
      await commitOps([{ type: 'delete', ref: ref(`sessions/${sid}/slots`, s.id) }]);
      setConfirmDelete(null);
      return `${slotLabel(s)} 시험을 삭제했습니다.`;
    });

  const saveSlots = async (values: SlotImport[]) => {
    const existing = new Map(slots.map((s) => [s.id, s]));
    const keep = new Set(values.map((v) => v.id));
    const ops: BatchOp[] = values.map(({ id, ...data }) => ({
      type: 'set',
      ref: ref(`sessions/${sid}/slots`, id),
      data: { ...data, rooms: existing.get(id)?.rooms ?? [] },
    }));
    const removed = slots.filter((s) => !keep.has(s.id));
    for (const s of removed) ops.push({ type: 'delete', ref: ref(`sessions/${sid}/slots`, s.id) });
    await commitOps(ops);
    return `시험 ${values.length}건을 저장했습니다${removed.length ? ` (파일에 없는 ${removed.length}건 삭제)` : ''}. 이어서 "기본 배치 자동 생성"을 눌러 시험실을 배치하세요.`;
  };

  const savePlacements = async (values: { slotId: string; placement: Placement }[]) => {
    const grouped = groupPlacements(values);
    await commitOps(
      [...grouped].map(([slotId, list]) => ({ type: 'set', ref: ref(`sessions/${sid}/slots`, slotId), data: { rooms: list }, merge: true })),
    );
    return `시험 ${grouped.size}건의 배치를 교체했습니다 (시험실 ${values.length}개).`;
  };

  const downloadSlotTemplate = () =>
    downloadTemplate(
      '시험일정_양식.xlsx',
      SLOT_FIELDS,
      sorted.length
        ? sorted.map((s) => [s.date, s.period, s.startTime ?? '', s.endTime ?? '', s.grade, s.subject, SLOT_TYPE_LABEL[s.type]])
        : [
            ['2026-10-12', 1, '09:00', '09:45', 1, '국어', '시험'],
            ['2026-10-12', 1, '09:00', '09:45', 2, '수학', '시험'],
            ['2026-10-12', 2, '10:00', '10:45', 1, '영어', '시험'],
          ],
      ['* 업로드하면 이 프로젝트의 시험 일정을 파일 내용으로 교체합니다. 파일에 없는 시험은 삭제됩니다.'],
    );

  const downloadPlacementTemplate = () =>
    downloadTemplate(
      '시험실배치_양식.xlsx',
      PLACEMENT_FIELDS,
      sorted.flatMap((s) =>
        (s.rooms.length ? s.rooms : autoPlacements(s, rooms)).map((p) => [
          s.date,
          s.period,
          s.grade,
          roomName.get(p.roomId) ?? '',
          p.classNo ?? '',
          p.headcount ?? '',
          PLACEMENT_ROOM_TYPE_LABEL[p.roomType],
        ]),
      ),
      [
        '* 현재 배치(없으면 기본 배치 제안)가 채워져 있습니다. 별도시험장 행을 추가하거나 수정해서 올리세요.',
        '* 파일에 포함된 시험만 배치를 교체합니다. 파일에 없는 시험의 배치는 그대로 둡니다.',
      ],
    );

  return (
    <Card>
      <h2 className="text-lg font-bold">시험 일정과 시험실 배치</h2>
      {editable ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => setModal({ kind: 'importSlots' })}>일정 엑셀 업로드</Button>
          <DownloadButton onDownload={downloadSlotTemplate}>일정 양식</DownloadButton>
          <Button variant="secondary" onClick={() => void autoPlace()} disabled={busy || unplaced.length === 0}>
            기본 배치 자동 생성{unplaced.length ? ` (${unplaced.length}건)` : ''}
          </Button>
          <Button variant="secondary" onClick={() => setModal({ kind: 'importPlacements' })} disabled={slots.length === 0}>
            배치 엑셀 업로드
          </Button>
          <DownloadButton onDownload={downloadPlacementTemplate} disabled={slots.length === 0}>
            배치 양식
          </DownloadButton>
          <Button variant="ghost" onClick={() => setModal({ kind: 'slot', slot: null })}>
            + 시험 추가
          </Button>
        </div>
      ) : (
        <p className="mt-2 text-muted">교사 공개 이후에는 시험 일정을 바꿀 수 없습니다.</p>
      )}
      {message && (
        <div className="mt-3">
          <Alert tone={message.tone}>{message.text}</Alert>
        </div>
      )}

      {slots.length === 0 ? (
        <p className="py-6 text-muted">시험 일정이 없습니다. 양식을 내려받아 올리거나 직접 추가하세요.</p>
      ) : (
        [...byDate].map(([date, list]) => (
          <section key={date} className="mt-5">
            <h3 className="mb-1 font-bold">{dateLabel(date)}</h3>
            <Table head={['교시', '시간', '학년', '과목', '시험실 배치', '']}>
              {list.map((s) => (
                <tr key={s.id}>
                  <Td className="font-bold">{s.period}</Td>
                  <Td className="whitespace-nowrap">{s.startTime ? `${s.startTime}~${s.endTime ?? ''}` : ''}</Td>
                  <Td>{s.grade}</Td>
                  <Td className="font-bold">
                    {s.subject}
                    {s.type === 'STUDY' && <span className="ml-1 text-sm font-normal text-muted">(자습)</span>}
                  </Td>
                  <Td>
                    {s.rooms.length === 0 ? (
                      <span className="font-semibold text-alert">배치 없음</span>
                    ) : (
                      <span title={s.rooms.map((p) => roomName.get(p.roomId) ?? '(삭제됨)').join(', ')}>
                        {s.rooms.length}실
                        <span className="ml-2 text-sm text-muted">
                          {s.rooms
                            .slice(0, 4)
                            .map((p) => `${roomName.get(p.roomId) ?? '(삭제됨)'}${p.roomType === 'EXTENDED' ? '(연장)' : ''}`)
                            .join(', ')}
                          {s.rooms.length > 4 && ' …'}
                        </span>
                      </span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap">
                    {editable &&
                      (confirmDelete === s.id ? (
                        <>
                          <Button variant="danger" onClick={() => void deleteSlot(s)} disabled={busy}>
                            삭제 확인
                          </Button>
                          <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
                            취소
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button variant="ghost" onClick={() => setModal({ kind: 'placement', slot: s })}>
                            배치
                          </Button>
                          <Button variant="ghost" onClick={() => setModal({ kind: 'slot', slot: s })}>
                            수정
                          </Button>
                          <Button variant="ghost" onClick={() => setConfirmDelete(s.id)}>
                            삭제
                          </Button>
                        </>
                      ))}
                  </Td>
                </tr>
              ))}
            </Table>
          </section>
        ))
      )}

      {modal?.kind === 'slot' && <SlotForm sid={sid} slot={modal.slot} slots={slots} onClose={() => setModal(null)} />}
      {modal?.kind === 'placement' && (
        <PlacementEditor sid={sid} slot={modal.slot} slots={slots} rooms={rooms} onClose={() => setModal(null)} />
      )}
      {modal?.kind === 'importSlots' && (
        <ImportWizard
          title="시험 일정 업로드"
          fields={SLOT_FIELDS}
          analyze={analyzeSlots}
          notice="이 프로젝트의 시험 일정을 파일 내용으로 교체합니다. 파일에 없는 시험은 삭제되고, 같은 날짜·교시·학년 시험의 시험실 배치는 유지됩니다."
          previewHead={['날짜', '교시', '시간', '학년', '과목', '유형']}
          previewRow={(v) => [v.date, v.period, v.startTime ? `${v.startTime}~${v.endTime ?? ''}` : '', v.grade, v.subject, SLOT_TYPE_LABEL[v.type]]}
          summary={(vs) => {
            const removed = slots.filter((s) => !vs.some((v) => v.id === s.id)).length;
            return (
              <Alert tone={removed ? 'alert' : 'info'}>
                시험 {vs.length}건을 저장합니다.{removed > 0 && ` 기존 시험 ${removed}건이 삭제됩니다.`}
              </Alert>
            );
          }}
          onSave={saveSlots}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === 'importPlacements' && (
        <ImportWizard
          title="시험실 배치 업로드"
          fields={PLACEMENT_FIELDS}
          analyze={analyzePlacements}
          notice="파일에 포함된 시험의 배치만 파일 내용으로 교체합니다."
          previewHead={['시험', '시험실', '반', '유형', '인원']}
          previewRow={(v) => {
            const s = slots.find((x) => x.id === v.slotId);
            return [
              s ? slotLabel(s) : v.slotId,
              roomName.get(v.placement.roomId) ?? '',
              v.placement.classNo ?? '',
              PLACEMENT_ROOM_TYPE_LABEL[v.placement.roomType],
              v.placement.headcount ?? '',
            ];
          }}
          onSave={savePlacements}
          onClose={() => setModal(null)}
        />
      )}
    </Card>
  );
}

// ───────────────────────── 기초시간표 카드 ─────────────────────────

function TimetableCard({ sid, editable, session, teachers, timetable }: {
  sid: string;
  editable: boolean;
  session: ExamSession;
  teachers: Teacher[];
  timetable: WithId<BaseTimetableDoc>[];
}) {
  const [importing, setImporting] = useState(false);
  const teacherList = useMemo(() => teachers.map((t) => ({ id: t.id, name: t.name, email: t.email, active: t.active })), [teachers]);
  const analyze = useCallback((rows: Cell[][], mapping: ColumnMapping) => parseTimetable(rows, mapping, teacherList), [teacherList]);
  // 교사별 격자 시트가 있으면 학교 양식으로, 없으면 한 줄 목록 형식으로 읽는다
  const analyzeWorkbook = useCallback(
    (sheets: SheetData[]) => (sheets.some((s) => isGridSheet(s.rows)) ? parseTimetableGrid(sheets, teacherList) : null),
    [teacherList],
  );
  const nameOf = new Map(teachers.map((t) => [t.id, t.name]));
  const total = timetable.reduce((n, d) => n + d.entries.length, 0);

  if (!session.settings.useBaseTimetable) {
    return (
      <Card>
        <h2 className="text-lg font-bold">기초시간표</h2>
        <p className="mt-2 text-muted">이 프로젝트는 기초시간표를 반영하지 않습니다. 반영하려면 "개요"에서 설정을 켜세요.</p>
      </Card>
    );
  }

  const save = async (values: TimetableImport[]) => {
    const grouped = groupTimetable(values);
    const ops: BatchOp[] = [...grouped].map(([teacherId, entries]) => ({
      type: 'set',
      ref: ref(`sessions/${sid}/baseTimetable`, teacherId),
      data: { teacherId, entries },
    }));
    for (const d of timetable) if (!grouped.has(d.id)) ops.push({ type: 'delete', ref: ref(`sessions/${sid}/baseTimetable`, d.id) });
    await commitOps(ops);
    return `교사 ${grouped.size}명의 수업 ${values.length}건을 저장했습니다.`;
  };

  // 학교 기초시간표 양식: 교사별 시트 (교시 × 요일)
  const download = () =>
    downloadWorkbook('기초시간표_양식.xlsx', [
      guideSheet('안내', [
        {
          title: '기초시간표 양식',
          lines: [...TIMETABLE_GUIDE, '* 업로드하면 이 프로젝트의 기초시간표 전체를 파일 내용으로 교체합니다.'],
        },
      ]),
      ...timetableSheets(teachers, timetable),
    ]);

  return (
    <Card>
      <h2 className="text-lg font-bold">기초시간표</h2>
      <p className="mt-1 text-muted">
        시험 시간에 해당 반을 원래 가르치던 교사에게 가점(+50)을 줍니다. 현재 교사 {timetable.length}명, 수업 {total}건.
      </p>
      {editable && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => setImporting(true)} disabled={teachers.length === 0}>
            시간표 엑셀 업로드
          </Button>
          <DownloadButton onDownload={download}>{timetable.length ? '현재 시간표 양식' : '양식 다운로드'}</DownloadButton>
        </div>
      )}
      {timetable.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {[...timetable]
            .sort((a, b) => (nameOf.get(a.id) ?? '').localeCompare(nameOf.get(b.id) ?? '', 'ko'))
            .map((d) => (
              <span key={d.id} className="rounded-full bg-bg px-3 py-1 text-sm">
                {nameOf.get(d.id) ?? `(삭제된 교사 ${d.id})`} {d.entries.length}
              </span>
            ))}
        </div>
      )}
      {importing && (
        <ImportWizard
          title="기초시간표 업로드"
          fields={TIMETABLE_FIELDS}
          analyze={analyze}
          analyzeWorkbook={analyzeWorkbook}
          notice="학교 기초시간표 양식(교사별 시트)과 한 줄 목록 형식을 모두 읽습니다. 이 프로젝트의 기초시간표 전체를 파일 내용으로 교체합니다."
          previewHead={['교사', '요일', '교시', '학년-반', '과목']}
          previewRow={(v) => [v.teacherName, WEEKDAY_LABEL[v.weekday] ?? '', v.period, `${v.grade}-${v.classNo}`, v.subject ?? '']}
          summary={(vs) => (
            <Alert tone="info">
              교사 {new Set(vs.map((v) => v.teacherId)).size}명의 수업 {vs.length}건을 저장합니다.
            </Alert>
          )}
          onSave={save}
          onClose={() => setImporting(false)}
        />
      )}
    </Card>
  );
}

// ───────────────────────── 페이지 ─────────────────────────

export function SessionSetupPage() {
  const session = useCurrentSession();
  const sid = session.id;
  const slots = useCollection<SlotDoc>(`sessions/${sid}/slots`);
  const rooms = useCollection<RoomDoc>('rooms');
  const teachers = useCollection<TeacherDoc>('teachers');
  const timetable = useCollection<BaseTimetableDoc>(`sessions/${sid}/baseTimetable`);
  const editable = isSetupEditable(session.status);

  const loading = slots.loading || rooms.loading || teachers.loading || timetable.loading;
  const error = slots.error ?? rooms.error ?? teachers.error ?? timetable.error;
  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;

  return (
    <div className="grid gap-6">
      <Readiness session={session} slots={slots.data} rooms={rooms.data} teachers={teachers.data} timetable={timetable.data} />
      <BundleCard
        session={session}
        editable={editable}
        teachers={teachers.data}
        rooms={rooms.data}
        slots={slots.data}
        timetable={timetable.data}
      />
      <ScheduleCard sid={sid} editable={editable} slots={slots.data} rooms={rooms.data} />
      <TimetableCard sid={sid} editable={editable} session={session} teachers={teachers.data} timetable={timetable.data} />
    </div>
  );
}
