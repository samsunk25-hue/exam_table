import { NavLink, Outlet } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { AnimalParade } from '@/components/AnimalParade';
import { AppFooter, AppTitle, HeroImage } from '@/components/Brand';
import { NotificationBell } from '@/components/NotificationBell';
import { HeaderTermPicker, TermProvider } from '@/components/TermRoster';
import { Button } from '@/components/ui';
import { usingEmulators } from '@/lib/firebase';

export interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}

export function AppShell({ nav, modeLabel, termPicker = false }: { nav: NavItem[]; modeLabel: string; /** 관리자: 머리글에서 학교·학기 선택 */ termPicker?: boolean }) {
  return termPicker ? (
    <TermProvider>
      <Shell nav={nav} modeLabel={modeLabel} termPicker />
    </TermProvider>
  ) : (
    <Shell nav={nav} modeLabel={modeLabel} termPicker={false} />
  );
}

function Shell({ nav, modeLabel, termPicker }: { nav: NavItem[]; modeLabel: string; termPicker: boolean }) {
  const { signOut } = useAuth();

  return (
    <div className="min-h-dvh">
      {usingEmulators && (
        <div className="no-print bg-mint-soft px-4 py-1 text-center text-sm">로컬 에뮬레이터 연결 중 (실제 데이터 아님)</div>
      )}
      <header aria-label={`${modeLabel} 화면`} className="sticky top-0 z-10 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] items-center gap-4 px-4 py-3 lg:px-8">
          <div className="min-w-0 md:shrink-0">
            {/* 제목만 크게 (역할·이메일 표시는 뺐다) */}
            <AppTitle size="xl" />
          </div>
          {/* 제목 오른쪽 빈 공간에 대문 그림 (시간표 + 태블릿 든 선생님, 비율 유지, 휴대폰에서는 숨김) */}
          <div className="hidden min-w-0 flex-1 justify-end md:flex">
            <HeroImage src="/hero.jpg" className="h-28 w-auto max-w-full rounded-xl object-contain shadow-sm" />
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2 md:ml-0">
            {termPicker && <HeaderTermPicker />}
            <NotificationBell />
            <Button variant="secondary" className="shrink-0" onClick={() => void signOut()}>
              로그아웃
            </Button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-[1440px] gap-1 overflow-x-auto px-2 pb-2 lg:px-6" aria-label="주 메뉴">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex min-h-12 shrink-0 items-center rounded-xl px-4 font-semibold ${
                  isActive ? 'bg-primary-soft text-primary-strong' : 'text-ink hover:bg-bg'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
          <AnimalParade />
        </nav>
      </header>
      <main className="mx-auto max-w-[1440px] px-4 py-6 lg:px-8">
        <Outlet />
      </main>
      <AppFooter />
    </div>
  );
}
