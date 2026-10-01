import { useMemo, useState, type FormEvent } from 'react';
import {
  PLACEMENT_ROOM_TYPE_LABEL,
  SLOT_TYPE_LABEL,
  autoPlacements,
  isSetupEditable,
  slotIdOf,
  type BaseTimetableDoc,
  type Placement,
  type PlacementRoomType,
  type RoomDoc,
  type SlotDoc,
  type SlotType,
  type TeacherDoc,
  type WithId,
} from '@sim/shared';
import { ExamGridEditor } from '@/components/ExamGridEditor';
import { ScheduleImportDialog } from '@/components/ScheduleImportDialog';
import { Modal } from '@/components/Modal';
import { Alert, Button, Card, Field, Select, Spinner, Table, Td } from '@/components/ui';
import { commitOps, ref, useCollection, type BatchOp } from '@/lib/data';
import { errorMessage } from '@/lib/firebase';
import { termWhere, type ExamSession } from '@/lib/sessions';
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
      await commitOps(ops, slot ? '시험 수정' : '시험 추가');
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
      await commitOps([{ type: 'set', ref: ref(`sessions/${sid}/slots`, slot.id), data: { rooms: ordered }, merge: true }], '시험실 배치 변경');
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

function ScheduleCard({ session, editable, slots, rooms }: { session: ExamSession; editable: boolean; slots: Slot[]; rooms: Room[] }) {
  const sid = session.id;
  const [modal, setModal] = useState<{ kind: 'slot'; slot: Slot | null } | { kind: 'placement'; slot: Slot } | { kind: 'grid' } | { kind: 'import' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'info' | 'alert'; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const roomName = useMemo(() => new Map(rooms.map((r) => [r.id, r.name])), [rooms]);
  const sorted = sortSlots(slots);
  const unplaced = slots.filter((s) => s.rooms.length === 0);
  const byDate = new Map<string, Slot[]>();
  for (const s of sorted) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);

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
      await commitOps(ops, '기본 배치 자동 생성');
      return `시험 ${ops.length}건에 시험실 ${count}개를 배치했습니다. 별도시험장은 "배치" 버튼으로 추가하세요.`;
    });

  const deleteSlot = (s: Slot) =>
    run(async () => {
      await commitOps([{ type: 'delete', ref: ref(`sessions/${sid}/slots`, s.id) }], '시험 삭제');
      setConfirmDelete(null);
      return `${slotLabel(s)} 시험을 삭제했습니다.`;
    });

  return (
    <Card>
      <h2 className="text-lg font-bold">시험 일정과 시험실 배치</h2>
      {editable ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => setModal({ kind: 'grid' })}>시험 시간표 표로 입력</Button>
          <Button variant="secondary" onClick={() => setModal({ kind: 'import' })}>
            다른 프로젝트에서 불러오기
          </Button>
          <Button variant="secondary" onClick={() => setModal({ kind: 'slot', slot: null })}>
            + 시험 1건 추가
          </Button>
          <Button variant="secondary" onClick={() => void autoPlace()} disabled={busy || unplaced.length === 0}>
            기본 배치 자동 생성{unplaced.length ? ` (${unplaced.length}건)` : ''}
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
      {modal?.kind === 'import' && <ScheduleImportDialog session={session} slots={slots} rooms={rooms} onClose={() => setModal(null)} />}
      {modal?.kind === 'grid' && <ExamGridEditor session={session} slots={slots} rooms={rooms} onClose={() => setModal(null)} />}
      {modal?.kind === 'placement' && (
        <PlacementEditor sid={sid} slot={modal.slot} slots={slots} rooms={rooms} onClose={() => setModal(null)} />
      )}
    </Card>
  );
}

// ───────────────────────── 기초시간표 카드 ─────────────────────────

function TimetableCard({ session, teachers, timetable }: {
  session: ExamSession;
  teachers: Teacher[];
  timetable: WithId<BaseTimetableDoc>[];
}) {
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

  return (
    <Card>
      <h2 className="text-lg font-bold">기초시간표</h2>
      <p className="mt-1 text-muted">
        시험 시간에 해당 반을 원래 가르치던 교사에게 가점(+50)을 줍니다. 현재 교사 {timetable.length}명, 수업 {total}건. 시간표는 개요의 통합 양식(교사별
        시간표 시트)으로 올립니다.
      </p>
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
    </Card>
  );
}

// ───────────────────────── 페이지 ─────────────────────────

export function SessionSetupPage() {
  const session = useCurrentSession();
  const sid = session.id;
  const slots = useCollection<SlotDoc>(`sessions/${sid}/slots`);
  const rooms = useCollection<RoomDoc>('rooms', termWhere(session));
  const teachers = useCollection<TeacherDoc>('teachers', termWhere(session));
  const timetable = useCollection<BaseTimetableDoc>(`sessions/${sid}/baseTimetable`);
  const editable = isSetupEditable(session.status);

  const loading = slots.loading || rooms.loading || teachers.loading || timetable.loading;
  const error = slots.error ?? rooms.error ?? teachers.error ?? timetable.error;
  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;

  return (
    <div className="grid gap-6">
      <ScheduleCard session={session} editable={editable} slots={slots.data} rooms={rooms.data} />
      <TimetableCard session={session} teachers={teachers.data} timetable={timetable.data} />
    </div>
  );
}
