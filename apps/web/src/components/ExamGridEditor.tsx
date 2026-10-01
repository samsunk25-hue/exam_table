import { useMemo, useState } from 'react';
import { autoPlacements, slotIdOf, type RoomDoc, type SlotDoc, type WithId } from '@sim/shared';
import { dateLabel } from '@/components/AvailabilityGrid';
import { BreakTimeBar } from '@/components/BreakTimeBar';
import { ClockTimePicker } from '@/components/ClockTimePicker';
import { Modal } from '@/components/Modal';
import { toast } from '@/components/Toast';
import { Alert, Button } from '@/components/ui';
import { commitOps, ref, type BatchOp } from '@/lib/data';
import { errorMessage } from '@/lib/firebase';
import { guessBreak, recalcPeriods, withAddedPeriod } from '@/lib/periodTimes';
import { updateSessionSettings, type ExamSession, type PeriodTime } from '@/lib/sessions';

type Slot = WithId<SlotDoc>;
const STUDY = '자습';
const SUBJECTS = ['국어', '수학', '영어', '과학', '사회', '역사', '도덕', '기술가정', '정보', '음악', '미술', '체육', STUDY];

const cellKey = (date: string, period: number, grade: number) => `${date}|${period}|${grade}`;

/**
 * 시험 시간표를 표로 입력: 날짜와 교시별 시간을 정하면 (날짜 × 교시) × 학년 표가 나오고,
 * 칸마다 과목(또는 "자습")을 적는다. 빈칸 = 시험 없음.
 */
export function ExamGridEditor({
  session,
  slots,
  rooms,
  initialDates = [],
  onClose,
}: {
  session: ExamSession;
  slots: Slot[];
  rooms: WithId<RoomDoc>[];
  /** 달력에서 고른 기간: 처음부터 날짜로 넣어 둔다 */
  initialDates?: string[];
  onClose: () => void;
}) {
  const savedTimes = session.settings.periodTimes ?? {};
  const [dates, setDates] = useState<string[]>(() => [...new Set([...slots.map((s) => s.date), ...initialDates])].sort());
  const [newDate, setNewDate] = useState('');
  const [periods, setPeriods] = useState(() => Math.max(3, ...slots.map((s) => s.period), ...Object.keys(savedTimes).map(Number)));
  const [times, setTimes] = useState<Record<string, PeriodTime>>(() => {
    const t: Record<string, PeriodTime> = { ...savedTimes };
    for (const s of slots) if (!t[s.period] && s.startTime) t[s.period] = { start: s.startTime, end: s.endTime ?? '' };
    return t;
  });
  const [breakMin, setBreakMin] = useState(() => guessBreak(times));
  const grades = useMemo(() => {
    const g = new Set<number>([1, 2, 3]);
    rooms.forEach((r) => r.grade && g.add(r.grade));
    slots.forEach((s) => g.add(s.grade));
    return [...g].sort((a, b) => a - b);
  }, [rooms, slots]);
  const [cells, setCells] = useState<Record<string, string>>(() =>
    Object.fromEntries(slots.map((s) => [cellKey(s.date, s.period, s.grade), s.type === 'STUDY' ? STUDY : s.subject])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addDate = () => {
    if (!newDate) return;
    if (!dates.includes(newDate)) setDates([...dates, newDate].sort());
    setNewDate('');
  };
  const removeDate = (d: string) => setDates(dates.filter((x) => x !== d));
  const setTime = (p: number, patch: Partial<PeriodTime>) => setTimes({ ...times, [p]: { start: '', end: '', ...times[p], ...patch } });
  // 같은 교시의 모든 학년을 한 번에 "자습"으로
  const fillStudy = (date: string, period: number) => {
    const next = { ...cells };
    for (const g of grades) next[cellKey(date, period, g)] = STUDY;
    setCells(next);
  };

  // 저장 계획: 칸 → 시험 / 기존 시험 중 비운 칸·뺀 날짜·줄인 교시는 삭제
  const plan = useMemo(() => {
    const keep = new Map<string, { date: string; period: number; grade: number; subject: string }>();
    for (const date of dates) {
      for (let p = 1; p <= periods; p++) {
        for (const g of grades) {
          const v = (cells[cellKey(date, p, g)] ?? '').trim();
          if (v) keep.set(slotIdOf(date, p, g), { date, period: p, grade: g, subject: v });
        }
      }
    }
    const removed = slots.filter((s) => !keep.has(s.id));
    return { keep, removed };
  }, [dates, periods, grades, cells, slots]);

  const save = async () => {
    const bad = Object.entries(times).find(([p, t]) => Number(p) <= periods && t.start && t.end && t.start >= t.end);
    if (bad) return setError(`${bad[0]}교시: 종료 시각이 시작보다 빠릅니다.`);
    if (plan.keep.size === 0) return setError('과목을 하나 이상 입력하세요.');
    setBusy(true);
    setError(null);
    const existing = new Map(slots.map((s) => [s.id, s]));
    const used = new Set<string>();
    const ops: BatchOp[] = [];
    for (const [id, c] of [...plan.keep].sort(([a], [b]) => a.localeCompare(b))) {
      const study = c.subject === STUDY;
      const prev = existing.get(id);
      const typeChanged = prev && (prev.type === 'STUDY') !== study;
      let placements = prev && !typeChanged ? prev.rooms : [];
      if (!placements.length) placements = autoPlacements({ grade: c.grade, type: study ? 'STUDY' : 'EXAM' }, rooms).filter((p) => !used.has(`${c.date}|${c.period}|${p.roomId}`));
      placements.forEach((p) => used.add(`${c.date}|${c.period}|${p.roomId}`));
      const t = times[c.period];
      const data: SlotDoc = {
        date: c.date,
        period: c.period,
        startTime: t?.start || null,
        endTime: t?.end || null,
        grade: c.grade,
        subject: c.subject,
        type: study ? 'STUDY' : 'EXAM',
        rooms: placements,
      };
      ops.push({ type: 'set', ref: ref(`sessions/${session.id}/slots`, id), data: { ...data } });
    }
    for (const s of plan.removed) ops.push({ type: 'delete', ref: ref(`sessions/${session.id}/slots`, s.id) });
    try {
      await commitOps(ops);
      const clean = Object.fromEntries(Object.entries(times).filter(([p, t]) => Number(p) <= periods && (t.start || t.end)));
      await updateSessionSettings(session.id, { ...session.settings, periodTimes: clean });
      toast(`시험 ${plan.keep.size}건을 저장했습니다${plan.removed.length ? ` (삭제 ${plan.removed.length}건)` : ''}. 시험실은 자동 배치했습니다.`);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Modal title="시험 시간표 표로 입력" onClose={onClose} wide>
      <div className="grid gap-6">
        <section>
          <h3 className="mb-2 font-bold">1. 시험 날짜</h3>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-sm text-muted">날짜 추가</span>
              <input type="date" className="min-h-12 rounded-xl border border-line px-3" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
            </label>
            <Button variant="secondary" onClick={addDate} disabled={!newDate}>
              + 추가
            </Button>
            {dates.map((d) => (
              <span key={d} className="inline-flex min-h-12 items-center gap-1 rounded-xl bg-primary-soft pl-3 font-semibold text-primary-strong">
                {dateLabel(d)}
                <button type="button" aria-label={`${d} 빼기`} className="size-10 cursor-pointer rounded-lg text-lg hover:bg-white/60" onClick={() => removeDate(d)}>
                  ×
                </button>
              </span>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-2 font-bold">2. 교시별 시간</h3>
          <div className="mb-3">
            <BreakTimeBar value={breakMin} onChange={setBreakMin} onRecalc={() => setTimes(recalcPeriods(times, periods, breakMin))} canRecalc={Boolean(times[1]?.start && times[1]?.end)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: periods }, (_, i) => i + 1).map((p) => (
              <div key={p} className="grid grid-cols-[3.5rem_1fr_1fr] items-end gap-2 rounded-xl border border-line p-2">
                <span className="pb-3 font-bold">{p}교시</span>
                <ClockTimePicker label="시작" value={times[p]?.start ?? ''} onChange={(v) => setTime(p, { start: v })} />
                <ClockTimePicker label="종료" value={times[p]?.end ?? ''} onChange={(v) => setTime(p, { end: v })} />
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            {periods < 8 && (
              <Button variant="ghost" onClick={() => (setTimes(withAddedPeriod(times, periods, breakMin)), setPeriods(periods + 1))}>
                + 교시 추가
              </Button>
            )}
            {periods > 1 && (
              <Button variant="ghost" onClick={() => setPeriods(periods - 1)}>
                − 마지막 교시 빼기
              </Button>
            )}
          </div>
        </section>

        <section>
          <h3 className="mb-1 font-bold">3. 과목 입력</h3>
          <p className="mb-3 text-sm text-muted">칸에 과목을 적거나 "자습"을 적으세요. 빈칸은 시험이 없는 시간입니다.</p>
          {dates.length === 0 ? (
            <Alert tone="info">먼저 시험 날짜를 추가하세요.</Alert>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-line">
              <datalist id="subject-list">
                {SUBJECTS.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
              <table className="w-full min-w-max border-collapse text-left">
                <thead className="bg-bg">
                  <tr>
                    <th className="px-3 py-2">날짜</th>
                    <th className="px-3 py-2">교시</th>
                    {grades.map((g) => (
                      <th key={g} className="px-3 py-2">
                        {g}학년
                      </th>
                    ))}
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {dates.flatMap((date) =>
                    Array.from({ length: periods }, (_, i) => i + 1).map((p) => (
                      <tr key={`${date}-${p}`} className={p === 1 ? 'border-t-2 border-line' : 'border-t border-line'}>
                        <td className="px-3 py-1.5 font-bold whitespace-nowrap">{p === 1 ? dateLabel(date) : ''}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap">
                          <span className="font-semibold">{p}교시</span>
                          {times[p]?.start && (
                            <span className="ml-1 text-sm text-muted">
                              {times[p]!.start}~{times[p]!.end}
                            </span>
                          )}
                        </td>
                        {grades.map((g) => {
                          const k = cellKey(date, p, g);
                          const v = cells[k] ?? '';
                          return (
                            <td key={g} className="px-2 py-1.5">
                              <input
                                list="subject-list"
                                aria-label={`${date} ${p}교시 ${g}학년 과목`}
                                className={`min-h-11 w-32 rounded-lg border px-2 font-semibold ${
                                  v.trim() === STUDY ? 'border-mint bg-mint-soft' : v.trim() ? 'border-primary bg-primary-soft' : 'border-line'
                                }`}
                                value={v}
                                onChange={(e) => setCells({ ...cells, [k]: e.target.value })}
                              />
                            </td>
                          );
                        })}
                        <td className="px-2 py-1.5">
                          <button type="button" className="min-h-11 cursor-pointer rounded-lg px-2 text-sm text-muted hover:bg-bg" onClick={() => fillStudy(date, p)}>
                            전체 자습
                          </button>
                        </td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {plan.removed.length > 0 && (
          <Alert>
            기존 시험 {plan.removed.length}건이 삭제됩니다 (빈칸으로 바꾸었거나 날짜·교시를 뺌): {plan.removed.slice(0, 4).map((s) => `${dateLabel(s.date)} ${s.period}교시 ${s.grade}학년`).join(', ')}
            {plan.removed.length > 4 ? ' …' : ''}
          </Alert>
        )}
        {error && <Alert>{error}</Alert>}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? '저장 중…' : `저장 (시험 ${plan.keep.size}건)`}
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            취소
          </Button>
        </div>
      </div>
    </Modal>
  );
}
