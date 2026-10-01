import { useState } from 'react';

export const APP_NAME = '쌤밸런스';
export const APP_SUBTITLE = '시험 감독 매니저';
export const APP_TITLE = `${APP_NAME}: ${APP_SUBTITLE}`;

/** 대문 그림 (public/hero.jpg). 파일이 없으면 아무것도 그리지 않는다. */
export function HeroImage({ className = '' }: { className?: string }) {
  const [missing, setMissing] = useState(false);
  if (missing) return null;
  return (
    <img
      src="/hero.jpg"
      alt="시험 감독 시간표를 태블릿으로 확인하는 선생님"
      className={className}
      onError={() => setMissing(true)}
    />
  );
}
