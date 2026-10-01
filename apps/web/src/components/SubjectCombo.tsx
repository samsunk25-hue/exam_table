import { useEffect, useRef, useState } from 'react';

/**
 * 과목 고르기: 누를 때마다 목록이 열리고(이미 고른 칸도 다시 고를 수 있음), 같은 학년에서 이미 쓴 과목은 목록에서 뺀다.
 * 목록에 없는 과목은 직접 적을 수 있다. repeatable(자습)은 여러 번 써도 된다.
 */
export function SubjectCombo({
  label,
  value,
  options,
  used,
  repeatable,
  className,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  /** 같은 학년 다른 칸에서 이미 쓴 과목 */
  used: Set<string>;
  repeatable: string[];
  className: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const q = (query ?? '').trim();
  const list = options.filter((o) => (repeatable.includes(o) || !used.has(o)) && (!q || o.includes(q)));
  const dup = value.trim() && !repeatable.includes(value.trim()) && used.has(value.trim());
  const pick = (v: string) => {
    onChange(v);
    setQuery(null);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <input
        role="combobox"
        aria-expanded={open}
        aria-label={label}
        aria-invalid={dup ? true : undefined}
        title={dup ? '같은 학년에 이미 있는 과목입니다' : undefined}
        className={`${className} ${dup ? '!border-alert !bg-alert-soft' : ''}`}
        value={query ?? value}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          onChange(e.target.value);
          setOpen(true);
        }}
        onBlur={() => setQuery(null)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' || e.key === 'Tab') setOpen(false);
          if (e.key === 'Enter' && open && list[0] && q) {
            e.preventDefault();
            pick(list[0]);
          }
        }}
      />
      {open && (
        <ul role="listbox" aria-label={`${label} 목록`} className="absolute top-full left-0 z-30 mt-1 max-h-64 w-40 overflow-auto rounded-xl border border-line bg-surface py-1 shadow-xl">
          {list.map((o) => (
            <li
              key={o}
              role="option"
              aria-selected={o === value}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(o)}
              className={`cursor-pointer px-3 py-2 font-semibold hover:bg-primary-soft ${o === value ? 'text-primary-strong' : ''}`}
            >
              {o}
            </li>
          ))}
          {list.length === 0 && <li className="px-3 py-2 text-sm text-muted">남은 과목 없음 (직접 입력)</li>}
          {value && (
            <li role="option" aria-selected={false} onMouseDown={(e) => e.preventDefault()} onClick={() => pick('')} className="cursor-pointer border-t border-line px-3 py-2 text-sm text-muted hover:bg-bg">
              비우기
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
