import { Navigate, Outlet, RouterProvider, createBrowserRouter } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { Spinner } from '@/components/ui';
import { AppShell, type NavItem } from '@/layouts/AppShell';
import type { Role } from '@/lib/firebase';
import { LoginPage } from '@/pages/LoginPage';
import { NoAccessPage } from '@/pages/NoAccessPage';
import { AdminsPage } from '@/pages/admin/AdminsPage';
import { DashboardPage } from '@/pages/admin/DashboardPage';
import { ExamSchedulePage } from '@/pages/admin/ExamSchedulePage';
import { RoomsPage } from '@/pages/admin/RoomsPage';
import { SessionAssignPage } from '@/pages/admin/SessionAssignPage';
import { SessionAvailabilityPage } from '@/pages/admin/SessionAvailabilityPage';
import { SessionEditorPage } from '@/pages/admin/SessionEditorPage';
import { SessionLayout, SessionOverview } from '@/pages/admin/SessionPage';
import { MyAvailabilityPage } from '@/pages/teacher/MyAvailabilityPage';
import { MySchedulePage } from '@/pages/teacher/MySchedulePage';
import { SessionPrintPage } from '@/pages/admin/SessionPrintPage';
import { SessionHistoryPage } from '@/pages/admin/SessionHistoryPage';
import { SessionSetupPage } from '@/pages/admin/SessionSetupPage';
import { TeachersPage } from '@/pages/admin/TeachersPage';

const ADMIN_NAV: NavItem[] = [
  { to: '/admin', label: '대시보드', end: true },
  { to: '/admin/schedule', label: '시험일정 관리' },
  { to: '/admin/teachers', label: '교사 관리' },
  { to: '/admin/rooms', label: '시험실 관리' },
  { to: '/admin/admins', label: '관리자 관리' },
];

const TEACHER_NAV: NavItem[] = [
  { to: '/me', label: '내 감독 시간표', end: true },
  { to: '/me/availability', label: '불가 시간 관리' },
];

function homeFor(role: Role): string {
  return role === 'ADMIN' ? '/admin' : role === 'TEACHER' ? '/me' : '/no-access';
}

/** 로그인과 역할을 확인하고, 맞지 않으면 알맞은 첫 화면으로 보낸다. */
function RequireRole({ role }: { role?: Role }) {
  const { loading, user, role: current } = useAuth();
  if (loading) return <Spinner label="계정 확인 중…" />;
  if (!user) return <Navigate to="/login" replace />;
  if (role && current !== role) return <Navigate to={homeFor(current)} replace />;
  return <Outlet />;
}

function Home() {
  const { loading, user, role } = useAuth();
  if (loading) return <Spinner label="계정 확인 중…" />;
  return <Navigate to={user ? homeFor(role) : '/login'} replace />;
}

function LoginRoute() {
  const { loading, user, role } = useAuth();
  if (loading && user) return <Spinner label="계정 확인 중…" />;
  return user && !loading ? <Navigate to={homeFor(role)} replace /> : <LoginPage />;
}

const router = createBrowserRouter([
  { path: '/', element: <Home /> },
  { path: '/login', element: <LoginRoute /> },
  {
    element: <RequireRole />,
    children: [{ path: '/no-access', element: <NoAccessPage /> }],
  },
  {
    element: <RequireRole role="ADMIN" />,
    children: [
      {
        path: '/admin',
        element: <AppShell nav={ADMIN_NAV} modeLabel="관리자" />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: 'admins', element: <AdminsPage /> },
          { path: 'schedule', element: <ExamSchedulePage /> },
          { path: 'teachers', element: <TeachersPage /> },
          { path: 'rooms', element: <RoomsPage /> },
          {
            path: 'sessions/:sid',
            element: <SessionLayout />,
            children: [
              { index: true, element: <SessionOverview /> },
              { path: 'setup', element: <SessionSetupPage /> },
              {
                path: 'availability',
                element: <SessionAvailabilityPage />,
              },
              {
                path: 'assign',
                element: <SessionAssignPage />,
              },
              {
                path: 'editor',
                element: <SessionEditorPage />,
              },
              {
                path: 'print',
                element: <SessionPrintPage />,
              },
              {
                path: 'history',
                element: <SessionHistoryPage />,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    element: <RequireRole role="TEACHER" />,
    children: [
      {
        path: '/me',
        element: <AppShell nav={TEACHER_NAV} modeLabel="교사" />,
        children: [
          {
            index: true,
            element: <MySchedulePage />,
          },
          { path: 'availability', element: <MyAvailabilityPage /> },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);

export function App() {
  return <RouterProvider router={router} />;
}
