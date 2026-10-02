import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

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
  const listRef = useRef<HTMLUListElement>(null);
  // 목록은 화면 맨 위층(body)에 띄워 표·창의 스크롤 영역에 잘리지 않게 한다
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.max(160, Math.min(r.width, 240));
      // 아래 공간이 모자라면(목록 최대 256px) 위로 펼친다
      if (window.innerHeight - r.bottom < 270 && r.top > 270) setPos({ bottom: window.innerHeight - r.top + 4, left: r.left, width });
      else setPos({ top: r.bottom + 4, left: r.left, width });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && !listRef.current?.contains(e.target as Node) && setOpen(false);
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
        onBlur={() => {
          // 다른 칸으로 넘어가면 닫는다 (목록 항목은 mousedown을 막아 포커스가 남으므로 고를 때는 닫히지 않음)
          setQuery(null);
          setOpen(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' || e.key === 'Tab') setOpen(false);
          if (e.key === 'Enter' && open && list[0] && q) {
            e.preventDefault();
            pick(list[0]);
          }
        }}
      />
      {open &&
        pos &&
        createPortal(
        <ul
          ref={listRef}
          role="listbox"
          aria-label={`${label} 목록`}
          style={{ position: 'fixed', top: pos.top, bottom: pos.bottom, left: pos.left, width: pos.width }}
          className="z-[60] max-h-64 overflow-auto rounded-xl border border-line bg-surface py-1 shadow-xl"
        >
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
        </ul>,
          document.body,
        )}
    </div>
  );
}
