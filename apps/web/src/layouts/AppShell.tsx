import { NavLink, Outlet } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
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
            <div className="text-[1.3rem] font-bold leading-tight">시험 감독 매니저</div>
            <div className="truncate text-sm text-muted">
              {modeLabel} · {user?.email}
            </div>
          </div>
          <Button variant="secondary" onClick={() => void signOut()}>
            로그아웃
          </Button>
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
