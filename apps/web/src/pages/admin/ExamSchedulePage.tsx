import { useEffect, useMemo, useState } from 'react';
import {
  SLOT_TYPE_LABEL,
  autoPlacements,
  isSetupEditable,
  slotIdOf,
  type RoomDoc,
  type SlotDoc,
  type SlotType,
  type WithId,
} from '@sim/shared';
import { dateLabel } from '@/components/AvailabilityGrid';
import { Calendar, parseYmd } from '@/components/Calendar';
import { ClockTimePicker } from '@/components/ClockTimePicker';
import { Modal } from '@/components/Modal';
import { toast } from '@/components/Toast';
import { Alert, Button, Card, PageTitle, Spinner } from '@/components/ui';
import { commitOps, ref, useCollection, type BatchOp } from '@/lib/data';
import { errorMessage } from '@/lib/firebase';
import { sessionTitle, updateSessionSettings, useSessions, type ExamSession, type PeriodTime } from '@/lib/sessions';

type Slot = WithId<SlotDoc>;
const MAX_PERIOD = 10;

/** 교시별 기본 시간: 한 번 정하면 시험 추가 때 자동으로 채운다 */
function PeriodTimesCard({ session, editable }: { session: ExamSession; editable: boolean }) {
  const saved = session.settings.periodTimes ?? {};
  const [times, setTimes] = useState<Record<string, PeriodTime>>(saved);
  const [count, setCount] = useState(Math.max(4, ...Object.keys(saved).map(Number)));
  const [open, setOpen] = useState(Object.keys(saved).length === 0);
  const [busy, setBusy] = useState(false);
  const set = (p: number, patch: Partial<PeriodTime>) => setTimes({ ...times, [p]: { start: '', end: '', ...times[p], ...patch } });

  const save = async () => {
    const bad = Object.entries(times).find(([, t]) => t.start && t.end && t.start >= t.end);
    if (bad) return toast(`${bad[0]}교시: 종료 시각이 시작보다 빠릅니다.`, 'alert');
    setBusy(true);
    try {
      const clean = Object.fromEntries(Object.entries(times).filter(([p, t]) => Number(p) <= count && (t.start || t.end)));
      await updateSessionSettings(session.id, { ...session.settings, periodTimes: clean });
      toast('교시별 기본 시간을 저장했습니다.');
      setOpen(false);
    } catch (e) {
      toast(errorMessage(e), 'alert');
    } finally {
      setBusy(false);
    }
  };

  const summary = Object.entries(saved)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([p, t]) => `${p}교시 ${t.start}~${t.end}`)
    .join(' · ');

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">교시별 기본 시간</h2>
          <p className="text-muted">{summary || '교시마다 시작·종료 시각을 정해 두면 시험을 추가할 때 자동으로 채워집니다.'}</p>
        </div>
        {!open && editable && (
          <Button variant="secondary" onClick={() => setOpen(true)}>
            시간 설정
          </Button>
        )}
      </div>
      {open && editable && (
        <div className="mt-4 grid gap-3">
          {Array.from({ length: count }, (_, i) => i + 1).map((p) => (
            <div key={p} className="grid grid-cols-[4rem_1fr_1fr] items-end gap-3">
              <span className="pb-3 text-lg font-bold">{p}교시</span>
              <ClockTimePicker label="시작" value={times[p]?.start ?? ''} onChange={(v) => set(p, { start: v })} />
              <ClockTimePicker label="종료" value={times[p]?.end ?? ''} onChange={(v) => set(p, { end: v })} />
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            {count < MAX_PERIOD && (
              <Button variant="ghost" onClick={() => setCount(count + 1)}>
                + 교시 추가
              </Button>
            )}
            {count > 1 && (
              <Button variant="ghost" onClick={() => setCount(count - 1)}>
                − 마지막 교시 빼기
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button onClick={() => void save()} disabled={busy}>
              저장
            </Button>
            <Button variant="secondary" onClick={() => (setTimes(saved), setOpen(false))} disabled={busy}>
              취소
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

interface GradeRow {
  on: boolean;
  subject: string;
  type: SlotType;
}

/** 시험 추가(같은 날·교시에 여러 학년) / 수정(한 건) */
function ExamForm({
  session,
  date,
  slots,
  rooms,
  editing,
  grades,
  onClose,
}: {
  session: ExamSession;
  date: string;
  slots: Slot[];
  rooms: WithId<RoomDoc>[];
  editing: Slot | null;
  grades: number[];
  onClose: () => void;
}) {
  const periodTimes = session.settings.periodTimes ?? {};
  const usedPeriods = new Set(slots.filter((s) => s.date === date).map((s) => s.period));
  const firstFree = Array.from({ length: MAX_PERIOD }, (_, i) => i + 1).find((p) => !usedPeriods.has(p)) ?? 1;
  const [period, setPeriod] = useState(editing?.period ?? firstFree);
  const [start, setStart] = useState(editing?.startTime ?? periodTimes[editing?.period ?? firstFree]?.start ?? '');
  const [end, setEnd] = useState(editing?.endTime ?? periodTimes[editing?.period ?? firstFree]?.end ?? '');
  const [rows, setRows] = useState<Record<number, GradeRow>>(() =>
    Object.fromEntries(
      grades.map((g) => [g, editing ? { on: g === editing.grade, subject: g === editing.grade ? editing.subject : '', type: editing.type } : { on: true, subject: '', type: 'EXAM' as SlotType }]),
    ),
  );
  const [autoPlace, setAutoPlace] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickPeriod = (p: number) => {
    setPeriod(p);
    // 교시를 바꾸면 기본 시간으로 다시 채운다
    if (periodTimes[p]) {
      setStart(periodTimes[p]!.start);
      setEnd(periodTimes[p]!.end);
    }
  };
  const setRow = (g: number, patch: Partial<GradeRow>) => setRows({ ...rows, [g]: { ...rows[g]!, ...patch } });

  const save = async () => {
    const chosen = grades.filter((g) => rows[g]!.on);
    const problem = !chosen.length
      ? '학년을 하나 이상 고르세요.'
      : chosen.some((g) => !rows[g]!.subject.trim())
        ? '선택한 학년의 과목을 입력하세요.'
        : start && end && start >= end
          ? '종료 시각이 시작보다 빠릅니다.'
          : chosen.map((g) => slotIdOf(date, period, g)).find((id) => id !== editing?.id && slots.some((s) => s.id === id))
            ? '같은 날·교시·학년 시험이 이미 있습니다.'
            : null;
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);

    // 같은 시간에 이미 쓰는 시험실은 자동 배치에서 뺀다
    const used = new Set(
      slots.filter((s) => s.date === date && s.period === period && s.id !== editing?.id).flatMap((s) => s.rooms.map((p) => p.roomId)),
    );
    const ops: BatchOp[] = [];
    for (const g of chosen) {
      const id = slotIdOf(date, period, g);
      let placements = editing && g === editing.grade ? editing.rooms : [];
      if (!placements.length && autoPlace) {
        placements = autoPlacements({ grade: g }, rooms).filter((p) => !used.has(p.roomId));
        placements.forEach((p) => used.add(p.roomId));
      }
      const data: SlotDoc = {
        date,
        period,
        startTime: start || null,
        endTime: end || null,
        grade: g,
        subject: rows[g]!.subject.trim(),
        type: rows[g]!.type,
        rooms: placements,
      };
      ops.push({ type: 'set', ref: ref(`sessions/${session.id}/slots`, id), data: { ...data } });
    }
    if (editing && !chosen.map((g) => slotIdOf(date, period, g)).includes(editing.id)) {
      ops.push({ type: 'delete', ref: ref(`sessions/${session.id}/slots`, editing.id) });
    }
    try {
      await commitOps(ops);
      toast(editing ? '시험을 수정했습니다.' : `시험 ${chosen.length}건을 추가했습니다.`);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Modal title={`${dateLabel(date)} ${editing ? '시험 수정' : '시험 추가'}`} onClose={onClose} wide>
      <div className="grid gap-5">
        <fieldset>
          <legend className="mb-2 font-semibold">교시</legend>
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: MAX_PERIOD }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={p === period}
                onClick={() => pickPeriod(p)}
                className={`min-h-12 min-w-16 cursor-pointer rounded-xl px-3 font-bold transition-colors ${
                  p === period ? 'bg-primary text-white' : usedPeriods.has(p) ? 'border border-primary bg-primary-soft' : 'border border-line hover:border-primary'
                }`}
              >
                {p}교시
              </button>
            ))}
          </div>
          <p className="mt-1 text-sm text-muted">파란 테두리는 이미 시험이 있는 교시입니다.</p>
        </fieldset>

        <div className="grid grid-cols-2 gap-3 sm:max-w-md">
          <ClockTimePicker label="시작 시각" value={start} onChange={setStart} />
          <ClockTimePicker label="종료 시각" value={end} onChange={setEnd} />
        </div>

        <fieldset>
          <legend className="mb-2 font-semibold">{editing ? '학년·과목' : '학년별 과목 (같은 교시에 여러 학년을 한 번에)'}</legend>
          <div className="grid gap-2">
            {grades.map((g) => {
              const row = rows[g]!;
              return (
                <div key={g} className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-3">
                  <label className="flex min-h-12 cursor-pointer items-center gap-2 font-bold">
                    <input type="checkbox" className="size-5 accent-primary" checked={row.on} disabled={Boolean(editing)} onChange={(e) => setRow(g, { on: e.target.checked })} />
                    {g}학년
                  </label>
                  <input
                    aria-label={`${g}학년 과목`}
                    placeholder="과목 (예: 국어)"
                    disabled={!row.on}
                    className="min-h-12 flex-1 rounded-xl border border-line px-4 disabled:bg-bg"
                    value={row.subject}
                    onChange={(e) => setRow(g, { subject: e.target.value })}
                  />
                  <select
                    aria-label={`${g}학년 유형`}
                    disabled={!row.on}
                    className="min-h-12 rounded-xl border border-line px-3 disabled:bg-bg"
                    value={row.type}
                    onChange={(e) => setRow(g, { type: e.target.value as SlotType })}
                  >
                    {Object.entries(SLOT_TYPE_LABEL).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        </fieldset>

        {!editing && (
          <label className="flex min-h-12 cursor-pointer items-center gap-3">
            <input type="checkbox" className="size-5 accent-primary" checked={autoPlace} onChange={(e) => setAutoPlace(e.target.checked)} />
            <span>같은 학년 교실·복도를 시험실로 자동 배치 (특별실은 기본 설정에서 추가)</span>
          </label>
        )}
        {error && <Alert>{error}</Alert>}
        <div className="flex gap-2">
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? '저장 중…' : '저장'}
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            취소
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ScheduleEditor({ session }: { session: ExamSession }) {
  const slots = useCollection<SlotDoc>(`sessions/${session.id}/slots`);
  const rooms = useCollection<RoomDoc>('rooms');
  const editable = isSetupEditable(session.status);
  const [selected, setSelected] = useState<string | null>(null);
  const [month, setMonth] = useState(() => new Date());
  const [form, setForm] = useState<{ editing: Slot | null } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // 처음 열 때 첫 시험이 있는 달로 이동
  const firstDate = useMemo(() => [...slots.data].map((s) => s.date).sort()[0], [slots.data]);
  useEffect(() => {
    if (firstDate && !selected) {
      setMonth(parseYmd(firstDate));
      setSelected(firstDate);
    }
  }, [firstDate, selected]);

  const marks = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of slots.data) m.set(s.date, (m.get(s.date) ?? 0) + 1);
    return m;
  }, [slots.data]);
  const grades = useMemo(() => {
    const g = new Set<number>([1, 2, 3]);
    rooms.data.forEach((r) => r.grade && g.add(r.grade));
    slots.data.forEach((s) => g.add(s.grade));
    return [...g].sort((a, b) => a - b);
  }, [rooms.data, slots.data]);
  const roomName = new Map(rooms.data.map((r) => [r.id, r.name]));

  if (slots.loading || rooms.loading) return <Spinner />;
  if (slots.error || rooms.error) return <Alert>{slots.error ?? rooms.error}</Alert>;

  const dayExams = slots.data.filter((s) => s.date === selected).sort((a, b) => a.period - b.period || a.grade - b.grade);
  const total = slots.data.length;
  const days = marks.size;

  const remove = async (s: Slot) => {
    try {
      await commitOps([{ type: 'delete', ref: ref(`sessions/${session.id}/slots`, s.id) }]);
      toast(`${s.period}교시 ${s.grade}학년 ${s.subject} 시험을 삭제했습니다.`);
      setConfirmDelete(null);
    } catch (e) {
      toast(errorMessage(e), 'alert');
    }
  };

  return (
    <div className="grid gap-6">
      {!editable && <Alert>교사 공개 이후에는 시험 일정을 바꿀 수 없습니다 (보기만 가능).</Alert>}
      <PeriodTimesCard session={session} editable={editable} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <Card>
          <Calendar month={month} onMonthChange={setMonth} selected={selected} onSelect={setSelected} marks={marks} />
          <p className="mt-3 text-sm text-muted">
            시험일 {days}일 · 시험 {total}건. 날짜를 누르면 그날 시험을 보고 추가할 수 있습니다.
          </p>
        </Card>

        <Card>
          {!selected ? (
            <p className="text-muted">달력에서 날짜를 고르세요.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xl font-bold">{dateLabel(selected)}</h2>
                {editable && <Button onClick={() => setForm({ editing: null })}>+ 시험 추가</Button>}
              </div>
              {dayExams.length === 0 ? (
                <p className="mt-4 text-muted">이 날은 시험이 없습니다.</p>
              ) : (
                <ul className="mt-4 grid gap-2">
                  {dayExams.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3">
                      <div>
                        <div className="text-lg font-bold">
                          {s.period}교시 · {s.grade}학년 {s.subject}
                          {s.type === 'STUDY' && <span className="ml-1 text-sm font-normal text-muted">(자습)</span>}
                        </div>
                        <div className="text-sm text-muted">
                          {s.startTime ? `${s.startTime}~${s.endTime ?? ''}` : '시간 미정'} · 시험실 {s.rooms.length}개
                          {s.rooms.length > 0 && ` (${s.rooms.slice(0, 3).map((p) => roomName.get(p.roomId) ?? '?').join(', ')}${s.rooms.length > 3 ? ' …' : ''})`}
                        </div>
                      </div>
                      {editable &&
                        (confirmDelete === s.id ? (
                          <div className="flex gap-1">
                            <Button variant="danger" onClick={() => void remove(s)}>
                              삭제 확인
                            </Button>
                            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
                              취소
                            </Button>
                          </div>
                        ) : (
                          <div className="flex gap-1">
                            <Button variant="ghost" onClick={() => setForm({ editing: s })}>
                              수정
                            </Button>
                            <Button variant="ghost" onClick={() => setConfirmDelete(s.id)}>
                              삭제
                            </Button>
                          </div>
                        ))}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Card>
      </div>

      {form && selected && (
        <ExamForm session={session} date={selected} slots={slots.data} rooms={rooms.data} editing={form.editing} grades={grades} onClose={() => setForm(null)} />
      )}
    </div>
  );
}

export function ExamSchedulePage() {
  const { data: sessions, loading, error } = useSessions();
  const [sid, setSid] = useState<string | null>(null);
  const current = sessions.find((s) => s.id === sid) ?? sessions.find((s) => isSetupEditable(s.status)) ?? sessions[0];

  return (
    <>
      <PageTitle sub="달력에서 시험 날짜를 고르고, 시계로 시작·종료 시각을 정합니다.">시험일정 관리</PageTitle>
      {loading && <Spinner />}
      {error && <Alert>{error}</Alert>}
      {!loading && !current && (
        <Card>
          <p className="text-muted">시험 프로젝트가 없습니다. 대시보드에서 먼저 만드세요.</p>
        </Card>
      )}
      {sessions.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {sessions.map((s) => (
            <Button key={s.id} variant={s.id === current?.id ? 'primary' : 'secondary'} onClick={() => setSid(s.id)}>
              {sessionTitle(s)}
            </Button>
          ))}
        </div>
      )}
      {current && <ScheduleEditor key={current.id} session={current} />}
    </>
  );
}
