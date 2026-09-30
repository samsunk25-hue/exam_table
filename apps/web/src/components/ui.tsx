import { useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-strong',
  secondary: 'bg-surface text-ink border border-line hover:border-primary hover:bg-primary-soft hover:text-primary-strong',
  danger: 'bg-surface text-alert border border-alert hover:bg-alert-soft',
  ghost: 'text-ink hover:bg-primary-soft',
};

/** 터치 영역 최소 48px (PRD 7.3) */
export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl px-5 font-semibold transition-all active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

/**
 * 파일 다운로드 버튼: 누르면 잠시 "✓ 다운로드 완료"로 바뀌어 저장됐음을 알린다.
 * onDownload는 파일을 만들어 저장하는 함수 (실패 시 예외).
 */
export function DownloadButton({
  children,
  onDownload,
  variant = 'secondary',
  disabled,
}: {
  children: ReactNode;
  /** false를 돌려주면 실패로 보고 완료 표시를 하지 않는다 */
  onDownload: () => boolean | void;
  variant?: Variant;
  disabled?: boolean;
}) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 2500);
    return () => clearTimeout(t);
  }, [done]);

  return (
    <Button
      variant={variant}
      disabled={disabled}
      aria-live="polite"
      className={done ? 'border-mint! bg-mint-soft! text-ink!' : ''}
      onClick={() => {
        if (onDownload() !== false) setDone(true);
      }}
    >
      {done ? (
        <>
          <span aria-hidden className="text-mint">✓</span> 다운로드 완료
        </>
      ) : (
        <>
          <svg aria-hidden viewBox="0 0 20 20" className="size-5 fill-none stroke-current stroke-2">
            <path d="M10 3v10m0 0-4-4m4 4 4-4M4 15v2h12v-2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {children}
        </>
      )}
    </Button>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-card border border-line bg-surface p-5 shadow-sm ${className}`}>{children}</section>;
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <header className="mb-6">
      <h1 className="text-[1.4rem] font-bold leading-tight md:text-[1.6rem]">{children}</h1>
      {sub && <p className="mt-1 text-muted">{sub}</p>}
    </header>
  );
}

export function Field({
  label,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-semibold">{label}</span>
      <input
        className="min-h-12 rounded-xl border border-line bg-surface px-4 outline-none focus:border-primary focus:ring-2 focus:ring-primary-soft"
        {...props}
      />
      {hint && <span className="text-sm text-muted">{hint}</span>}
    </label>
  );
}

export function Select({
  label,
  options,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; options: { value: string; label: string }[] }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-semibold">{label}</span>
      <select
        className="min-h-12 rounded-xl border border-line bg-surface px-3 outline-none focus:border-primary focus:ring-2 focus:ring-primary-soft"
        {...props}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** 데이터 표. 좁은 화면에서는 가로 스크롤 */
export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <table className="w-full min-w-max border-collapse text-left">
        <thead>
          <tr className="border-b-2 border-line text-sm text-muted">
            {head.map((h, i) => (
              <th key={i} className="px-3 py-2 font-semibold whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <td className={`border-b border-line px-3 py-3 align-top ${className}`}>{children}</td>;
}

export function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`flex min-h-12 items-start gap-3 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        className="mt-1 size-5 accent-primary"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="font-semibold">{label}</span>
        {hint && <span className="block text-sm text-muted">{hint}</span>}
      </span>
    </label>
  );
}

export function Alert({ children, tone = 'alert' }: { children: ReactNode; tone?: 'alert' | 'info' }) {
  const cls = tone === 'alert' ? 'border-alert bg-alert-soft' : 'border-primary bg-primary-soft';
  return <div className={`rounded-xl border px-4 py-3 ${cls}`}>{children}</div>;
}

export function Spinner({ label = '불러오는 중…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 py-10 text-muted" role="status">
      <span className="size-5 animate-spin rounded-full border-2 border-line border-t-primary" />
      {label}
    </div>
  );
}
