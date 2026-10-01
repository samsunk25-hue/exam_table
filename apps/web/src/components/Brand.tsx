import { useState } from 'react';

export const APP_NAME = '쌤밸런스';
export const APP_SUBTITLE = '시험 감독 매니저';
export const APP_TITLE = `${APP_NAME}: ${APP_SUBTITLE}`;

/** 필기체 앱 제목. size: 머리글(md) / 로그인 화면(lg) */
export function AppTitle({ size = 'md', as: Tag = 'div' }: { size?: 'md' | 'lg'; as?: 'div' | 'h1' }) {
  return (
    <Tag className={`font-hand leading-none ${size === 'lg' ? 'text-[2.3rem] sm:text-[2.8rem]' : 'text-[1.55rem] sm:text-[2.1rem]'}`}>
      <span className="text-primary-strong">{APP_NAME}</span>
      <span className="text-ink">: {APP_SUBTITLE}</span>
    </Tag>
  );
}

/** 대문 그림 (public/hero.jpg). 파일이 없으면 아무것도 그리지 않는다. */
export function HeroImage({ className = '', src = '/hero.jpg' }: { className?: string; src?: string }) {
  const [missing, setMissing] = useState(false);
  if (missing) return null;
  return (
    <img
      src={src}
      alt="시험 감독 시간표를 태블릿으로 확인하는 선생님"
      className={className}
      onError={() => setMissing(true)}
    />
  );
}
