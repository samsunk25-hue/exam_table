import { useEffect, useRef, useState } from 'react';

const pad = (n: number) => String(n).padStart(2, '0');

// 시계판 12칸: 맨 위 12시, 오른쪽 반 13~18시(오후), 왼쪽 반 7~11시(오전) → 학교 일과 시간 7~18시
const HOURS = [12, 13, 14, 15, 16, 17, 18, 7, 8, 9, 10, 11];
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

function Face({ values, active, label, onPick }: { values: number[]; active: number | null; label: (v: number) => string; onPick: (v: number) => void }) {
  const size = 232;
  const r = 90;
  return (
    <div className="relative mx-auto rounded-full bg-bg" style={{ width: size, height: size }}>
      <div className="absolute top-1/2 left-1/2 size-2 -translate-1/2 rounded-full bg-primary" />
      {values.map((v, i) => {
        const angle = (i / 12) * 2 * Math.PI - Math.PI / 2;
        const x = size / 2 + r * Math.cos(angle);
        const y = size / 2 + r * Math.sin(angle);
        const on = v === active;
        return (
          <button
            key={v}
            type="button"
            onClick={() => onPick(v)}
            style={{ left: x, top: y }}
            className={`absolute flex size-11 -translate-1/2 cursor-pointer items-center justify-center rounded-full font-bold transition-colors ${
              on ? 'bg-primary text-white' : 'hover:bg-primary-soft'
            }`}
          >
            {label(v)}
          </button>
        );
      })}
    </div>
  );
}

/** 시계 모양 시간 선택: 시 → 분 순서로 고른다. 값은 "HH:MM" 또는 빈 문자열 */
export function ClockTimePicker({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'hour' | 'minute'>('hour');
  const [hour, setHour] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [h, m] = value ? value.split(':').map(Number) : [null, null];

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative flex flex-col gap-1.5">
      <span className="font-semibold">{label}</span>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          setStep('hour');
          setHour(h ?? null);
        }}
        className="flex min-h-12 cursor-pointer items-center justify-between gap-2 rounded-xl border border-line bg-surface px-4 text-left hover:border-primary"
      >
        <span className={`whitespace-nowrap text-lg ${value ? 'font-bold' : 'text-muted'}`}>{value || '--:--'}</span>
        <svg aria-hidden viewBox="0 0 20 20" className="size-5 fill-none stroke-current stroke-2 text-muted">
          <circle cx="10" cy="10" r="7.5" />
          <path d="M10 6v4l2.5 2" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div role="dialog" aria-label={`${label} 선택`} className="absolute top-full left-0 z-30 mt-2 w-72 rounded-card border border-line bg-surface p-4 shadow-xl">
          <div className="mb-3 flex items-center justify-center gap-1 text-2xl font-bold">
            <button type="button" onClick={() => setStep('hour')} className={`cursor-pointer rounded-lg px-2 ${step === 'hour' ? 'bg-primary-soft text-primary-strong' : ''}`}>
              {hour !== null ? pad(hour) : '--'}
            </button>
            :
            <button
              type="button"
              disabled={hour === null}
              onClick={() => setStep('minute')}
              className={`cursor-pointer rounded-lg px-2 ${step === 'minute' ? 'bg-primary-soft text-primary-strong' : ''}`}
            >
              {step === 'minute' || m === null ? '--' : pad(m)}
            </button>
          </div>
          {step === 'hour' ? (
            <>
              <p className="mb-2 text-center text-sm text-muted">시를 고르세요 (왼쪽 오전 · 오른쪽 오후)</p>
              <Face
                values={HOURS}
                active={hour}
                label={(v) => String(v)}
                onPick={(v) => {
                  setHour(v);
                  setStep('minute');
                }}
              />
            </>
          ) : (
            <>
              <p className="mb-2 text-center text-sm text-muted">분을 고르세요</p>
              <Face
                values={MINUTES}
                active={h === hour ? m : null}
                label={pad}
                onPick={(v) => {
                  onChange(`${pad(hour!)}:${pad(v)}`);
                  setOpen(false);
                }}
              />
            </>
          )}
          <div className="mt-3 flex justify-between">
            <button type="button" className="min-h-10 cursor-pointer rounded-lg px-3 text-muted hover:bg-bg" onClick={() => (onChange(''), setOpen(false))}>
              지우기
            </button>
            <button type="button" className="min-h-10 cursor-pointer rounded-lg px-3 font-semibold hover:bg-bg" onClick={() => setOpen(false)}>
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
