import { useEffect, useState } from 'react';

type Tone = 'info' | 'alert';
interface ToastItem {
  id: number;
  text: string;
  tone: Tone;
}

// 어디서든 호출할 수 있는 간단한 알림. <Toaster />가 화면 하단에 표시한다.
const listeners = new Set<(t: ToastItem) => void>();
let seq = 0;

export function toast(text: string, tone: Tone = 'info'): void {
  const item = { id: ++seq, text, tone };
  listeners.forEach((l) => l(item));
}

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const onToast = (t: ToastItem) => {
      setItems((list) => [...list, t]);
      setTimeout(() => setItems((list) => list.filter((x) => x.id !== t.id)), 5000);
    };
    listeners.add(onToast);
    return () => void listeners.delete(onToast);
  }, []);

  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-6 sm:items-end">
      {items.map((t) => (
        <div
          key={t.id}
          role="status"
          // 오른쪽 아래에서 미끄러져 나온다. 성공은 민트 띠, 오류는 빨간 띠
          className={`anim-slide pointer-events-auto max-w-lg rounded-xl border border-line border-l-[6px] bg-surface px-5 py-3 font-semibold text-ink shadow-[var(--shadow-lift)] ${
            t.tone === 'alert' ? 'border-l-alert' : 'border-l-mint'
          }`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
