import { Button } from '@/components/ui';

/** 쉬는 시간 입력 + "1교시 기준으로 나머지 자동 계산" */
export function BreakTimeBar({
  value,
  onChange,
  onRecalc,
  canRecalc,
}: {
  value: number;
  onChange: (min: number) => void;
  onRecalc: () => void;
  canRecalc: boolean;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl bg-bg p-3">
      <label className="grid gap-1">
        <span className="text-sm font-semibold">쉬는 시간 (분)</span>
        <input
          type="number"
          min={0}
          max={120}
          step={5}
          className="min-h-12 w-28 rounded-xl border border-line bg-surface px-4"
          value={value}
          onChange={(e) => onChange(Math.min(120, Math.max(0, Number(e.target.value) || 0)))}
        />
      </label>
      <Button variant="secondary" onClick={onRecalc} disabled={!canRecalc}>
        1교시 기준으로 나머지 자동 계산
      </Button>
      <span className="text-sm text-muted">교시를 추가하면 앞 교시 종료 + 쉬는 시간부터 같은 길이로 채웁니다.</span>
    </div>
  );
}
