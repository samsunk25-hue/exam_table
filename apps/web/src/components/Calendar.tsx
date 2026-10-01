const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = (s: string) => new Date(`${s}T00:00:00`);

/** 월 달력: 날짜를 누르면 선택, marks에 있는 날은 시험 건수를 표시한다 */
export function Calendar({
  month,
  onMonthChange,
  selected,
  selectedSet,
  onSelect,
  marks,
}: {
  month: Date;
  onMonthChange: (d: Date) => void;
  selected: string | null;
  /** 기간 선택처럼 여러 날을 함께 표시할 때 */
  selectedSet?: Set<string>;
  onSelect: (date: string) => void;
  marks: Map<string, number>;
}) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay()); // 일요일부터
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
  const weeks = days[35]!.getMonth() !== month.getMonth() ? 5 : 6;
  const today = ymd(new Date());
  const move = (delta: number) => onMonthChange(new Date(month.getFullYear(), month.getMonth() + delta, 1));

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          aria-label="이전 달"
          onClick={() => move(-1)}
          className="size-12 cursor-pointer rounded-xl border border-line text-xl hover:border-primary hover:bg-primary-soft"
        >
          ‹
        </button>
        <div className="text-lg font-bold">
          {month.getFullYear()}년 {month.getMonth() + 1}월
        </div>
        <button
          type="button"
          aria-label="다음 달"
          onClick={() => move(1)}
          className="size-12 cursor-pointer rounded-xl border border-line text-xl hover:border-primary hover:bg-primary-soft"
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-sm font-semibold text-muted">
        {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => (
          <div key={d} className={i === 0 ? 'text-[#c0392b]' : i === 6 ? 'text-primary-strong' : ''}>
            {d}
          </div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {days.slice(0, weeks * 7).map((d) => {
          const key = ymd(d);
          const inMonth = d.getMonth() === month.getMonth();
          const count = marks.get(key) ?? 0;
          const isSel = key === selected || Boolean(selectedSet?.has(key));
          return (
            <button
              key={key}
              type="button"
              aria-pressed={isSel}
              aria-label={`${d.getMonth() + 1}월 ${d.getDate()}일${count ? ` 시험 ${count}건` : ''}`}
              onClick={() => onSelect(key)}
              className={`flex min-h-14 cursor-pointer flex-col items-center justify-start rounded-xl pt-1.5 transition-colors ${
                isSel
                  ? 'bg-primary text-white'
                  : count
                    ? 'bg-primary-soft hover:bg-primary hover:text-white'
                    : 'hover:bg-bg'
              } ${inMonth ? '' : 'opacity-35'} ${key === today && !isSel ? 'ring-2 ring-primary' : ''}`}
            >
              <span className={`font-bold ${!isSel && d.getDay() === 0 ? 'text-[#c0392b]' : ''}`}>{d.getDate()}</span>
              {count > 0 && <span className={`mt-0.5 text-xs font-semibold ${isSel ? 'text-white' : 'text-primary-strong'}`}>시험 {count}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
