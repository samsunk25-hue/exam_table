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
        <div className="bg-mint-soft px-4 py-1 text-center text-sm">로컬 에뮬레이터 연결 중 (실제 데이터 아님)</div>
      )}
      <header className="sticky top-0 z-10 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <AppTitle />
            <div className="mt-1 truncate text-sm text-muted">
              {modeLabel} · {user?.email}
            </div>
          </div>
          {/* 오른쪽 빈 공간에 대문 그림 (좁은 화면에서는 숨김) */}
          <div className="flex shrink-0 items-center gap-4">
            <HeroImage className="hidden h-20 w-[152px] rounded-xl object-cover shadow-sm md:block" />
            <Button variant="secondary" onClick={() => void signOut()}>
              로그아웃
            </Button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-2 pb-2" aria-label="주 메뉴">
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
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
