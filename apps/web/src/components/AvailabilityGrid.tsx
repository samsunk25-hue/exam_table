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
 * 시험 날짜·교시 칸. 빈 칸을 눌러 선택하고, 이미 제출된 칸은 상태를 보여준다.
 * onEntryClick이 있으면 제출된 칸을 눌렀을 때 호출한다 (예: 대기 중 제출 취소).
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
  return (
    <div className="grid gap-4">
      {groupByDate(times).map(([date, list]) => (
        <section key={date}>
          <h3 className="mb-2 font-bold">{dateLabel(date)}</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {list.map((t) => {
              const key = cellKey(t);
              const entry = entries.get(key);
              const isSelected = selected.has(key);
              const cls = entry
                ? STATUS_STYLE[entry.status]
                : isSelected
                  ? 'border-2 border-primary bg-primary text-white'
                  : 'border border-line bg-surface hover:border-primary';
              return (
                <button
                  key={key}
                  type="button"
                  disabled={disabled || (Boolean(entry) && !onEntryClick)}
                  aria-pressed={isSelected}
                  onClick={() => (entry ? onEntryClick?.(entry) : onToggle(key))}
                  className={`flex min-h-16 flex-col items-center justify-center rounded-xl px-2 py-2 text-center transition-colors disabled:cursor-default ${cls}`}
                >
                  <span className="text-lg font-bold">{t.period}교시</span>
                  <span className="text-xs">
                    {entry
                      ? `${AVAILABILITY_STATUS_LABEL[entry.status]} · ${entry.reason}`
                      : isSelected
                        ? '선택됨'
                        : t.startTime
                          ? `${t.startTime}${t.endTime ? `~${t.endTime}` : ''}`
                          : '가능'}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
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
