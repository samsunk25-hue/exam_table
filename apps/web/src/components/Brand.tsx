import { useState, type ReactNode } from 'react';

export const APP_NAME = '쌤밸런스';
export const APP_SUBTITLE = '시험 감독 매니저';
export const APP_TITLE = `${APP_NAME}: ${APP_SUBTITLE}`;

const TITLE_SIZE = {
  md: 'text-[1.55rem] sm:text-[2.1rem]',
  lg: 'text-[2.3rem] sm:text-[2.8rem]',
  /** 머리글: 크게 */
  xl: 'text-[2rem] max-[374px]:text-[1.75rem] sm:text-[2.8rem] lg:text-[3.3rem]',
};

/**
 * 필기체 앱 제목. size: 작게(md) / 로그인 화면(lg) / 머리글(xl)
 * 휴대폰에서는 "쌤밸런스"(+ 옆 장식) 첫 줄, "시험 감독 매니저" 둘째 줄로 나눈다.
 */
export function AppTitle({ size = 'md', as: Tag = 'div', beside }: { size?: keyof typeof TITLE_SIZE; as?: 'div' | 'h1'; /** 휴대폰 첫 줄 제목 옆 장식 */ beside?: ReactNode }) {
  return (
    <Tag className={`font-hand leading-none ${TITLE_SIZE[size]}`}>
      <span className="whitespace-nowrap">
        <span className="text-primary-strong">{APP_NAME}</span>
        {beside}
      </span>
      <span className="block whitespace-nowrap text-ink md:inline">
        <span className="hidden md:inline">: </span>
        {APP_SUBTITLE}
      </span>
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

/** 모든 화면 맨 아래 제작자 표시 */
export function AppFooter() {
  return (
    <footer className="no-print px-4 py-6 text-center text-sm text-muted">
      {APP_NAME} · by <span className="font-hand text-base text-ink">물리여신</span>
    </footer>
  );
}
