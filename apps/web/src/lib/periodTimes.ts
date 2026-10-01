import type { PeriodTime } from '@/lib/sessions';

// 교시 시간 자동 계산: 다음 교시 = 앞 교시 종료 + 쉬는 시간, 길이는 앞 교시와 같게

export const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
export const fromMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** 저장된 1·2교시 사이 간격, 없으면 10분 */
export function guessBreak(times: Record<string, PeriodTime>): number {
  const gap = times[1]?.end && times[2]?.start ? toMin(times[2].start) - toMin(times[1].end) : NaN;
  return gap >= 0 ? gap : 10;
}

/** p교시 시간 (앞 교시가 비어 있거나 자정을 넘으면 null) */
export function nextPeriodTime(times: Record<string, PeriodTime>, p: number, breakMin: number): PeriodTime | null {
  const prev = times[p - 1];
  if (!prev?.start || !prev.end) return null;
  const start = toMin(prev.end) + breakMin;
  const len = toMin(prev.end) - toMin(prev.start);
  if (len <= 0 || start + len >= 24 * 60) return null;
  return { start: fromMin(start), end: fromMin(start + len) };
}

/** 교시를 하나 늘리며 비어 있으면 자동으로 채운다 */
export function withAddedPeriod(times: Record<string, PeriodTime>, count: number, breakMin: number): Record<string, PeriodTime> {
  const t = nextPeriodTime(times, count + 1, breakMin);
  return t && !times[count + 1]?.start ? { ...times, [count + 1]: t } : times;
}

/** 1교시를 기준으로 2..count교시를 모두 다시 계산 */
export function recalcPeriods(times: Record<string, PeriodTime>, count: number, breakMin: number): Record<string, PeriodTime> {
  const next: Record<string, PeriodTime> = { ...times };
  for (let p = 2; p <= count; p++) {
    const t = nextPeriodTime(next, p, breakMin);
    if (!t) break;
    next[p] = t;
  }
  return next;
}

/** 저장된 1교시 길이, 없으면 45분 */
export function guessExamMinutes(times: Record<string, PeriodTime>): number {
  const t = times[1];
  const len = t?.start && t.end ? toMin(t.end) - toMin(t.start) : NaN;
  return len > 0 ? len : 45;
}

/** 1교시 시작·시험 시간·쉬는 시간으로 1..count교시 시간을 모두 만든다 (자정을 넘는 교시는 뺀다) */
export function planPeriods(start: string, examMin: number, breakMin: number, count: number): Record<string, PeriodTime> {
  const out: Record<string, PeriodTime> = {};
  let s = toMin(start);
  for (let p = 1; p <= count; p++) {
    if (s + examMin >= 24 * 60) break;
    out[p] = { start: fromMin(s), end: fromMin(s + examMin) };
    s += examMin + breakMin;
  }
  return out;
}

/** 시험 일정의 시각으로 교시별 기본 시간을 만든다 (교시마다 가장 많이 쓰인 시작·종료) */
export function periodTimesFromSlots(slots: { period: number; startTime?: string | null; endTime?: string | null }[]): Record<string, PeriodTime> {
  const counts = new Map<number, Map<string, number>>();
  for (const s of slots) {
    if (!s.startTime || !s.endTime) continue;
    const m = counts.get(s.period) ?? new Map<string, number>();
    const k = `${s.startTime}|${s.endTime}`;
    m.set(k, (m.get(k) ?? 0) + 1);
    counts.set(s.period, m);
  }
  const out: Record<string, PeriodTime> = {};
  for (const [p, m] of counts) {
    const [start, end] = [...m].sort((a, b) => b[1] - a[1])[0]![0].split('|');
    out[p] = { start: start!, end: end! };
  }
  return out;
}
