import { NavLink, Outlet } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { AppTitle, HeroImage } from '@/components/Brand';
import { Button } from '@/components/ui';
import { usingEmulators } from '@/lib/firebase';

export interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}

export function AppShell({ nav, modeLabel }: { nav: NavItem[]; modeLabel: string }) {
  const { user, signOut } = useAuth();

  return (
    <div className="min-h-dvh">
      {usingEmulators && (
        <div className="no-print bg-mint-soft px-4 py-1 text-center text-sm">로컬 에뮬레이터 연결 중 (실제 데이터 아님)</div>
      )}
      <header className="sticky top-0 z-10 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] items-center gap-4 px-4 py-3 lg:px-8">
          <div className="min-w-0 md:shrink-0">
            <AppTitle />
            <div className="mt-1 truncate text-sm text-muted">
              {modeLabel} · {user?.email}
            </div>
          </div>
          {/* 제목 오른쪽 빈 공간에 대문 그림 (시간표 + 태블릿 든 선생님, 비율 유지, 휴대폰에서는 숨김) */}
          <div className="hidden min-w-0 flex-1 justify-end md:flex">
            <HeroImage src="/hero.jpg" className="h-28 w-auto max-w-full rounded-xl object-contain shadow-sm" />
          </div>
          <Button variant="secondary" className="ml-auto shrink-0 md:ml-0" onClick={() => void signOut()}>
            로그아웃
          </Button>
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
        </nav>
      </header>
      <main className="mx-auto max-w-[1440px] px-4 py-6 lg:px-8">
        <Outlet />
      </main>
    </div>
  );
}
