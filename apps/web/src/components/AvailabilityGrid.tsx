import { useState } from 'react';
import { AVAILABILITY_REASONS, AVAILABILITY_STATUS_LABEL, groupByDate, type ExamTime } from '@sim/shared';
import { cellKey, type Availability } from '@/lib/availability';

export function dateLabel(date: string) {
  const d = new Date(`${date}T00:00:00`);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${'일월화수목금토'[d.getDay()]})`;
}

const STATUS_STYLE: Record<Availability['status'], string> = {
  PENDING: 'border-2 border-dashed border-primary bg-primary-soft text-primary-strong',
  APPROVED: 'border-2 border-alert bg-alert-soft text-ink',
  REJECTED: 'border border-line bg-bg text-muted line-through',
};

/**
 * 시험 시간표 표: 행 = 날짜, 열 = 교시. 빈 칸을 눌러 불가 시간으로 선택하고, 제출된 칸은 상태를 보여준다.
 * 날짜를 누르면 그날 남은 칸을 한꺼번에 선택/해제한다.
 * onEntryClick이 있으면 제출된 칸을 눌렀을 때 호출한다 (예: 제출 취소).
 */
export function AvailabilityGrid({
  times,
  entries,
  selected,
  onToggle,
  onEntryClick,
  disabled = false,
}: {
  times: ExamTime[];
  entries: Map<string, Availability>;
  selected: Set<string>;
  onToggle: (key: string) => void;
  onEntryClick?: (entry: Availability) => void;
  disabled?: boolean;
}) {
  const periods = [...new Set(times.map((t) => t.period))].sort((a, b) => a - b);
  // 교시 머리글에 시간 표시 (날짜마다 다르면 첫 날짜 기준)
  const timeOf = new Map<number, string>();
  for (const t of times) if (!timeOf.has(t.period) && t.startTime) timeOf.set(t.period, `${t.startTime}${t.endTime ? `~${t.endTime}` : ''}`);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max border-separate border-spacing-1.5">
        <thead>
          <tr>
            <th className="w-32 px-2 text-left text-sm text-muted">날짜</th>
            {periods.map((p) => (
              <th key={p} className="min-w-24 px-2 text-center">
                <div className="font-bold">{p}교시</div>
                {timeOf.get(p) && <div className="text-xs font-normal text-muted">{timeOf.get(p)}</div>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groupByDate(times).map(([date, list]) => {
            const free = list.map(cellKey).filter((k) => !entries.has(k));
            const allSelected = free.length > 0 && free.every((k) => selected.has(k));
            return (
              <tr key={date}>
                <th className="px-1 text-left">
                  <button
                    type="button"
                    disabled={disabled || free.length === 0}
                    title="그날 남은 칸 모두 선택/해제"
                    onClick={() => free.filter((k) => selected.has(k) === allSelected).forEach(onToggle)}
                    className="min-h-14 w-full cursor-pointer rounded-xl px-2 text-left font-bold hover:bg-primary-soft disabled:cursor-default disabled:hover:bg-transparent"
                  >
                    {dateLabel(date)}
                  </button>
                </th>
                {periods.map((p) => {
                  const t = list.find((x) => x.period === p);
                  if (!t) return <td key={p} className="rounded-xl bg-bg text-center text-sm text-muted">시험 없음</td>;
                  const key = cellKey(t);
                  const entry = entries.get(key);
                  const isSelected = selected.has(key);
                  const state = entry ? `${AVAILABILITY_STATUS_LABEL[entry.status]} · ${entry.reason}` : isSelected ? '선택됨' : '가능';
                  const cls = entry
                    ? STATUS_STYLE[entry.status]
                    : isSelected
                      ? 'border-2 border-primary bg-primary text-white'
                      : 'border border-line bg-surface hover:border-primary hover:bg-primary-soft';
                  return (
                    <td key={p} className="p-0">
                      <button
                        type="button"
                        disabled={disabled || (Boolean(entry) && !onEntryClick)}
                        aria-pressed={isSelected}
                        aria-label={`${p}교시 ${state} · ${dateLabel(date)}`}
                        onClick={() => (entry ? onEntryClick?.(entry) : onToggle(key))}
                        className={`flex min-h-14 w-full cursor-pointer flex-col items-center justify-center rounded-xl px-2 text-center text-sm font-semibold transition-colors disabled:cursor-default ${cls}`}
                      >
                        {isSelected && !entry ? '✓ 선택' : entry ? AVAILABILITY_STATUS_LABEL[entry.status] : ''}
                        {entry && <span className="text-xs font-normal">{entry.reason}</span>}
                      </button>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function GridLegend() {
  return (
    <div className="flex flex-wrap gap-3 text-sm">
      <span className="flex items-center gap-1">
        <span className="size-4 rounded border border-line bg-surface" /> 가능
      </span>
      <span className="flex items-center gap-1">
        <span className="size-4 rounded bg-primary" /> 선택됨
      </span>
      <span className="flex items-center gap-1">
        <span className="size-4 rounded border-2 border-dashed border-primary bg-primary-soft" /> 승인 대기
      </span>
      <span className="flex items-center gap-1">
        <span className="size-4 rounded border-2 border-alert bg-alert-soft" /> 불가(승인)
      </span>
      <span className="flex items-center gap-1">
        <span className="size-4 rounded border border-line bg-bg" /> 반려
      </span>
    </div>
  );
}

/** 사유 선택: 자주 쓰는 사유 버튼 + 직접 입력 */
export function ReasonPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [custom, setCustom] = useState(!AVAILABILITY_REASONS.includes(value as never) && value !== '');
  return (
    <fieldset>
      <legend className="mb-2 font-semibold">사유</legend>
      <div className="flex flex-wrap gap-2">
        {AVAILABILITY_REASONS.map((r) => {
          const active = r === '기타' ? custom : !custom && value === r;
          return (
            <button
              key={r}
              type="button"
              aria-pressed={active}
              onClick={() => {
                if (r === '기타') {
                  setCustom(true);
                  onChange('');
                } else {
                  setCustom(false);
                  onChange(r);
                }
              }}
              className={`min-h-12 rounded-xl px-4 font-semibold ${active ? 'bg-ink text-white' : 'border border-line bg-surface'}`}
            >
              {r}
            </button>
          );
        })}
      </div>
      {custom && (
        <input
          className="mt-2 min-h-12 w-full rounded-xl border border-line px-4 outline-none focus:border-primary"
          placeholder="사유를 입력하세요 (예: 학부모 상담)"
          value={value}
          maxLength={40}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </fieldset>
  );
}
