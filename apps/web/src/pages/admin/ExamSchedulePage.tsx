import { useEffect, useMemo, useState } from 'react';
import {
  autoPlacements,
  isSetupEditable,
  sessionTerm,
  slotIdOf,
  termKey,
  type RoomDoc,
  type SlotDoc,
  type WithId,
} from '@sim/shared';
import { dateLabel } from '@/components/AvailabilityGrid';
import { Calendar, parseYmd, ymd } from '@/components/Calendar';
import { BreakTimeBar } from '@/components/BreakTimeBar';
import { ClockTimePicker } from '@/components/ClockTimePicker';
import { ExamGridEditor } from '@/components/ExamGridEditor';
import { ScheduleImportDialog } from '@/components/ScheduleImportDialog';
import { TermPicker, useTermChoice } from '@/components/TermRoster';
import { Modal } from '@/components/Modal';
import { toast } from '@/components/Toast';
import { Alert, Button, Card, PageTitle, Spinner } from '@/components/ui';
import { commitOps, ref, useCollection, type BatchOp } from '@/lib/data';
import { errorMessage } from '@/lib/firebase';
import { guessBreak, recalcPeriods, withAddedPeriod } from '@/lib/periodTimes';
import { sessionTitle, updateSessionSettings, useSessions, type ExamSession, type PeriodTime, termWhere } from '@/lib/sessions';

type Slot = WithId<SlotDoc>;
const MAX_PERIOD = 10;

/** 교시별 기본 시간: 한 번 정하면 시험 추가 때 자동으로 채운다 */
function PeriodTimesCard({ session, editable }: { session: ExamSession; editable: boolean }) {
  const saved = session.settings.periodTimes ?? {};
  const [times, setTimes] = useState<Record<string, PeriodTime>>(saved);
  const [count, setCount] = useState(Math.max(4, ...Object.keys(saved).map(Number)));
  const [open, setOpen] = useState(Object.keys(saved).length === 0);
  const [busy, setBusy] = useState(false);
  const [breakMin, setBreakMin] = useState(() => guessBreak(saved));
  const set = (p: number, patch: Partial<PeriodTime>) => setTimes({ ...times, [p]: { start: '', end: '', ...times[p], ...patch } });
  const addPeriod = () => {
    setTimes(withAddedPeriod(times, count, breakMin));
    setCount(count + 1);
  };

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
          <BreakTimeBar value={breakMin} onChange={setBreakMin} onRecalc={() => setTimes(recalcPeriods(times, count, breakMin))} canRecalc={Boolean(times[1]?.start && times[1]?.end)} />
          {Array.from({ length: count }, (_, i) => i + 1).map((p) => (
            <div key={p} className="grid grid-cols-[4rem_1fr_1fr] items-end gap-3">
              <span className="pb-3 text-lg font-bold">{p}교시</span>
              <ClockTimePicker label="시작" value={times[p]?.start ?? ''} onChange={(v) => set(p, { start: v })} />
              <ClockTimePicker label="종료" value={times[p]?.end ?? ''} onChange={(v) => set(p, { end: v })} />
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            {count < MAX_PERIOD && (
              <Button variant="ghost" onClick={addPeriod}>
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
  /** 교시 → 과목 ("자습"이면 자습 시간) */
  subjects: Record<number, string>;
}

/** 시험 추가(같은 날 여러 교시·여러 학년) / 수정(한 건) */
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
  // 추가할 때는 여러 교시를 한 번에 고를 수 있다 (수정은 한 교시)
  const p0 = editing?.period ?? firstFree;
  const [periods, setPeriods] = useState<number[]>([p0]);
  const [times, setTimes] = useState<Record<number, { start: string; end: string }>>(() => ({
    [p0]: { start: editing?.startTime ?? periodTimes[p0]?.start ?? '', end: editing?.endTime ?? periodTimes[p0]?.end ?? '' },
  }));
  const [rows, setRows] = useState<Record<number, GradeRow>>(() =>
    Object.fromEntries(
      grades.map((g) => [
        g,
        editing
          ? { on: g === editing.grade, subjects: { [p0]: g !== editing.grade ? '' : editing.type === 'STUDY' ? '자습' : editing.subject } }
          : { on: true, subjects: {} },
      ]),
    ),
  );
  const [autoPlace, setAutoPlace] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickPeriod = (p: number) => {
    if (periods.includes(p)) {
      // 추가 중이면 눌러서 끈다 (최소 한 교시)
      if (!editing && periods.length > 1) setPeriods(periods.filter((x) => x !== p));
      return;
    }
    setPeriods(editing ? [p] : [...periods, p].sort((a, b) => a - b));
    // 새로 고른 교시는 기본 시간으로 채운다
    if (!times[p] && periodTimes[p]) setTimes({ ...times, [p]: { start: periodTimes[p]!.start, end: periodTimes[p]!.end } });
    // 수정 중 교시를 바꾸면 과목을 옮긴다
    if (editing) setRows(Object.fromEntries(grades.map((g) => [g, { ...rows[g]!, subjects: { [p]: rows[g]!.subjects[periods[0]!] ?? '' } }])));
  };
  const timeOf = (p: number) => times[p] ?? { start: '', end: '' };
  const setTime = (p: number, t: Partial<{ start: string; end: string }>) => setTimes({ ...times, [p]: { ...timeOf(p), ...t } });
  const subjectOf = (g: number, p: number) => rows[g]!.subjects[p] ?? '';
  const setRow = (g: number, patch: Partial<GradeRow>) => setRows({ ...rows, [g]: { ...rows[g]!, ...patch } });

  const save = async () => {
    const chosen = grades.filter((g) => rows[g]!.on);
    const ids = periods.flatMap((p) => chosen.map((g) => slotIdOf(date, p, g)));
    const problem = !chosen.length
      ? '학년을 하나 이상 고르세요.'
      : periods.some((p) => chosen.some((g) => !subjectOf(g, p).trim()))
        ? '선택한 학년·교시의 과목을 모두 입력하세요.'
        : periods.some((p) => timeOf(p).start && timeOf(p).end && timeOf(p).start >= timeOf(p).end)
          ? '종료 시각이 시작보다 빠른 교시가 있습니다.'
          : ids.find((id) => id !== editing?.id && slots.some((s) => s.id === id))
            ? '같은 날·교시·학년 시험이 이미 있습니다.'
            : null;
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);

    const ops: BatchOp[] = [];
    for (const period of periods) {
      const { start, end } = timeOf(period);
      // 같은 시간에 이미 쓰는 시험실은 자동 배치에서 뺀다
      const used = new Set(
        slots.filter((s) => s.date === date && s.period === period && s.id !== editing?.id).flatMap((s) => s.rooms.map((p) => p.roomId)),
      );
      for (const g of chosen) {
        const id = slotIdOf(date, period, g);
        let placements = editing && g === editing.grade ? editing.rooms : [];
        if (!placements.length && autoPlace) {
          placements = autoPlacements({ grade: g }, rooms).filter((p) => !used.has(p.roomId));
          placements.forEach((p) => used.add(p.roomId));
        }
        const subject = subjectOf(g, period).trim();
        const data: SlotDoc = {
          date,
          period,
          startTime: start || null,
          endTime: end || null,
          grade: g,
          subject,
          type: subject === '자습' ? 'STUDY' : 'EXAM',
          rooms: placements,
        };
        ops.push({ type: 'set', ref: ref(`sessions/${session.id}/slots`, id), data: { ...data } });
      }
    }
    if (editing && !ids.includes(editing.id)) {
      ops.push({ type: 'delete', ref: ref(`sessions/${session.id}/slots`, editing.id) });
    }
    try {
      await commitOps(ops, editing ? '시험 수정' : '시험 추가');
      toast(editing ? '시험을 수정했습니다.' : `시험 ${ids.length}건을 추가했습니다.`);
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
          <legend className="mb-2 font-semibold">교시{!editing && <span className="font-normal text-muted"> (여러 교시를 눌러 한 번에 선택)</span>}</legend>
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: MAX_PERIOD }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={periods.includes(p)}
                onClick={() => pickPeriod(p)}
                className={`min-h-12 min-w-16 cursor-pointer rounded-xl px-3 font-bold transition-colors ${
                  periods.includes(p) ? 'bg-primary text-white' : usedPeriods.has(p) ? 'border border-primary bg-primary-soft' : 'border border-line hover:border-primary'
                }`}
              >
                {p}교시
              </button>
            ))}
          </div>
          <p className="mt-1 text-sm text-muted">파란 테두리는 이미 시험이 있는 교시입니다.</p>
        </fieldset>

        <fieldset>
          <legend className="mb-2 font-semibold">
            과목 입력 <span className="font-normal text-muted">(칸에 과목 또는 "자습", 빈 학년은 체크를 끄세요)</span>
          </legend>
          <div className="overflow-x-auto">
            <table className="w-full min-w-max border-separate border-spacing-1.5">
              <thead>
                <tr>
                  <th className="w-24 px-2 text-left text-sm text-muted">학년  교시</th>
                  {periods.map((p) => (
                    <th key={p} className="min-w-56 rounded-xl bg-bg p-2 align-top">
                      <div className="mb-1 text-center font-bold">{p}교시</div>
                      <div className="grid grid-cols-2 gap-1 text-left font-normal">
                        <ClockTimePicker label="시작" value={timeOf(p).start} onChange={(v) => setTime(p, { start: v })} />
                        <ClockTimePicker label="종료" value={timeOf(p).end} onChange={(v) => setTime(p, { end: v })} />
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grades.map((g) => {
                  const row = rows[g]!;
                  return (
                    <tr key={g}>
                      <th className="px-1 text-left">
                        <label className="flex min-h-12 cursor-pointer items-center gap-2 font-bold">
                          <input type="checkbox" className="size-5 accent-primary" checked={row.on} disabled={Boolean(editing)} onChange={(e) => setRow(g, { on: e.target.checked })} />
                          {g}학년
                        </label>
                      </th>
                      {periods.map((p) => (
                        <td key={p}>
                          <input
                            list="exam-subjects"
                            aria-label={periods.length > 1 ? `${g}학년 ${p}교시 과목` : `${g}학년 과목`}
                            placeholder={row.on ? '과목 또는 자습' : '시험 없음'}
                            disabled={!row.on}
                            className={`min-h-12 w-full rounded-xl border px-3 text-center font-semibold disabled:bg-bg ${subjectOf(g, p).trim() === '자습' ? 'border-line bg-bg text-muted' : 'border-line'}`}
                            value={subjectOf(g, p)}
                            onChange={(e) => setRow(g, { subjects: { ...row.subjects, [p]: e.target.value } })}
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <datalist id="exam-subjects">
            {['국어', '수학', '영어', '과학', '사회', '역사', '도덕', '기술가정', '정보', '자습'].map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
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
  const rooms = useCollection<RoomDoc>('rooms', termWhere(session));
  const editable = isSetupEditable(session.status);
  const [selected, setSelected] = useState<string | null>(null);
  const [month, setMonth] = useState(() => new Date());
  const [form, setForm] = useState<{ editing: Slot | null } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [grid, setGrid] = useState<{ dates: string[] } | null>(null);
  const [importing, setImporting] = useState(false);
  // 기간 선택: 시작일 → 종료일 두 번 누른다
  const [rangeMode, setRangeMode] = useState(false);
  const [range, setRange] = useState<{ from: string; to: string | null } | null>(null);
  const [skipWeekend, setSkipWeekend] = useState(true);
  const rangeDates = useMemo(() => {
    if (!range) return [];
    const [a, b] = [range.from, range.to ?? range.from].sort() as [string, string];
    const out: string[] = [];
    for (let d = parseYmd(a); ymd(d) <= b; d.setDate(d.getDate() + 1)) {
      if (!skipWeekend || (d.getDay() !== 0 && d.getDay() !== 6)) out.push(ymd(d));
    }
    return out;
  }, [range, skipWeekend]);
  const pickDate = (d: string) => {
    if (!rangeMode) return setSelected(d);
    setRange(!range || range.to ? { from: d, to: null } : { from: range.from, to: d });
  };

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
      await commitOps([{ type: 'delete', ref: ref(`sessions/${session.id}/slots`, s.id) }], '시험 삭제');
      toast(`${s.period}교시 ${s.grade}학년 ${s.subject} 시험을 삭제했습니다.`);
      setConfirmDelete(null);
    } catch (e) {
      toast(errorMessage(e), 'alert');
    }
  };

  return (
    <div className="grid gap-6">
      {!editable && <Alert>교사 공개 이후에는 시험 일정을 바꿀 수 없습니다 (보기만 가능).</Alert>}
      {editable && (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => setGrid({ dates: [] })}>시험 시간표 표로 입력</Button>
          <Button variant="secondary" onClick={() => setImporting(true)}>
            다른 프로젝트에서 불러오기
          </Button>
          <span className="text-muted">날짜·교시 시간을 정하고 표에 과목(또는 "자습")을 한 번에 적습니다.</span>
        </div>
      )}
      <PeriodTimesCard session={session} editable={editable} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <Card>
          <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="선택 방식">
            <Button variant={rangeMode ? 'secondary' : 'primary'} onClick={() => setRangeMode(false)} aria-pressed={!rangeMode}>
              날짜 하나
            </Button>
            <Button variant={rangeMode ? 'primary' : 'secondary'} onClick={() => (setRangeMode(true), setRange(null))} aria-pressed={rangeMode}>
              기간 선택
            </Button>
            {rangeMode && (
              <label className="ml-1 flex min-h-12 cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" className="size-5 accent-primary" checked={skipWeekend} onChange={(e) => setSkipWeekend(e.target.checked)} />
                주말 빼기
              </label>
            )}
          </div>
          <Calendar
            month={month}
            onMonthChange={setMonth}
            selected={rangeMode ? null : selected}
            selectedSet={rangeMode ? new Set(rangeDates) : undefined}
            onSelect={pickDate}
            marks={marks}
          />
          <p className="mt-3 text-sm text-muted">
            시험일 {days}일 · 시험 {total}건.{' '}
            {rangeMode ? '시작일과 종료일을 차례로 누르면 기간이 선택됩니다.' : '날짜를 누르면 그날 시험을 보고 추가할 수 있습니다.'}
          </p>
        </Card>

        <Card>
          {rangeMode ? (
            <div className="grid gap-4">
              <h2 className="text-xl font-bold">기간 선택</h2>
              {!range ? (
                <p className="text-muted">달력에서 시작일을 누르세요.</p>
              ) : (
                <>
                  <p>
                    <b>{dateLabel(rangeDates[0] ?? range.from)}</b>
                    {range.to && rangeDates.length > 1 && (
                      <>
                        {' ~ '}
                        <b>{dateLabel(rangeDates[rangeDates.length - 1]!)}</b>
                      </>
                    )}
                    {' · '}
                    {rangeDates.length}일{skipWeekend && ' (주말 제외)'}
                    {!range.to && <span className="text-muted"> — 종료일을 누르세요.</span>}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {rangeDates.map((d) => (
                      <span key={d} className="rounded-xl bg-primary-soft px-3 py-2 text-sm font-semibold text-primary-strong">
                        {dateLabel(d)}
                        {marks.get(d) ? ` · 시험 ${marks.get(d)}` : ''}
                      </span>
                    ))}
                  </div>
                  {editable && (
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => setGrid({ dates: rangeDates })} disabled={!rangeDates.length}>
                        이 기간 시험 시간표 표로 입력
                      </Button>
                      <Button variant="secondary" onClick={() => setRange(null)}>
                        다시 선택
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : !selected ? (
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

      {importing && <ScheduleImportDialog session={session} slots={slots.data} rooms={rooms.data} onClose={() => setImporting(false)} />}
      {grid && <ExamGridEditor session={session} slots={slots.data} rooms={rooms.data} initialDates={grid.dates} onClose={() => setGrid(null)} />}
      {form && selected && (
        <ExamForm session={session} date={selected} slots={slots.data} rooms={rooms.data} editing={form.editing} grades={grades} onClose={() => setForm(null)} />
      )}
    </div>
  );
}

export function ExamSchedulePage() {
  const { data: all, loading, error } = useSessions();
  const choice = useTermChoice();
  // 선택한 학교·학기의 프로젝트만
  const sessions = all.filter((s) => termKey(sessionTerm(s)) === choice.key);
  const [sid, setSid] = useState<string | null>(null);
  const current = sessions.find((s) => s.id === sid) ?? sessions.find((s) => isSetupEditable(s.status)) ?? sessions[0];

  return (
    <>
      <PageTitle sub="달력에서 시험 날짜를 고르고, 시계로 시작·종료 시각을 정합니다.">시험일정 관리</PageTitle>
      <TermPicker terms={choice.terms} value={choice.key} onChange={choice.choose} />
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
