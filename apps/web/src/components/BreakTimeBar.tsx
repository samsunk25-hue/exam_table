import { useState } from 'react';
import { ClockTimePicker } from '@/components/ClockTimePicker';
import { guessBreak, guessExamMinutes, planPeriods } from '@/lib/periodTimes';
import type { PeriodTime } from '@/lib/sessions';

/**
 * 교시 시간 한 번에 정하기: 1교시 시작 · 시험 시간 · 쉬는 시간만 넣으면 모든 교시를 바로 계산한다.
 * 특정 교시만 다르면 아래 교시별 칸에서 따로 고친다.
 */
export function BreakTimeBar({ times, count, onChange }: { times: Record<string, PeriodTime>; count: number; onChange: (times: Record<string, PeriodTime>) => void }) {
  const [start, setStart] = useState(times[1]?.start ?? '');
  const [examMin, setExamMin] = useState(() => guessExamMinutes(times));
  const [breakMin, setBreakMin] = useState(() => guessBreak(times));

  const apply = (s: string, e: number, b: number) => {
    if (s) onChange({ ...times, ...planPeriods(s, e, b, count) });
  };
  const num = (v: string, max: number) => Math.min(max, Math.max(0, Number(v) || 0));

  return (
    <div className="grid gap-3 rounded-xl bg-bg p-3 sm:grid-cols-[minmax(0,12rem)_8rem_8rem_1fr] sm:items-end">
      <ClockTimePicker
        label="1교시 시작"
        value={start}
        onChange={(v) => {
          setStart(v);
          apply(v, examMin, breakMin);
        }}
      />
      <label className="grid gap-1">
        <span className="text-sm font-semibold">시험 시간 (분)</span>
        <input
          type="number"
          min={10}
          max={180}
          step={5}
          className="min-h-12 rounded-xl border border-line bg-surface px-4"
          value={examMin}
          onChange={(e) => {
            const v = num(e.target.value, 180);
            setExamMin(v);
            apply(start, v, breakMin);
          }}
        />
      </label>
      <label className="grid gap-1">
        <span className="text-sm font-semibold">쉬는 시간 (분)</span>
        <input
          type="number"
          min={0}
          max={120}
          step={5}
          className="min-h-12 rounded-xl border border-line bg-surface px-4"
          value={breakMin}
          onChange={(e) => {
            const v = num(e.target.value, 120);
            setBreakMin(v);
            apply(start, examMin, v);
          }}
        />
      </label>
      <span className="text-sm text-muted">1교시 시작만 넣으면 나머지 교시는 자동으로 채워집니다. 특정 교시만 다르면 아래에서 고치세요.</span>
    </div>
  );
}
