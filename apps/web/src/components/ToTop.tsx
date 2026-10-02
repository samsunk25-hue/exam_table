import { useEffect, useState } from 'react';

/** 모든 화면 오른쪽 아래: 조금 내려가면 나타나는 "맨 위로" 버튼 (인쇄에는 안 나옴) */
export function ToTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const on = () => setShow(window.scrollY > 400);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  if (!show) return null;
  return (
    <button
      type="button"
      aria-label="맨 위로"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      className="no-print fixed right-4 bottom-4 z-20 flex size-12 cursor-pointer items-center justify-center rounded-full border border-line bg-surface text-xl font-bold text-primary-strong shadow-lg transition-colors hover:border-primary hover:bg-primary-soft"
    >
      ↑
    </button>
  );
}
