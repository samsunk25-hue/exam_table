import { Navigate } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { AccessRequestForm } from '@/components/AccessRequestForm';
import { AppFooter, AppTitle } from '@/components/Brand';
import { Alert, Button, Card } from '@/components/ui';

/** 등록되지 않은 계정: 가입(교사) 또는 관리자 권한을 신청하고 승인을 기다린다 */
export function NoAccessPage() {
  const { user, role, error, signOut } = useAuth();
  // 승인되어 역할이 생기면 알맞은 첫 화면으로
  if (role === 'ADMIN') return <Navigate to="/admin" replace />;
  if (role === 'TEACHER') return <Navigate to="/me" replace />;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-8">
      <Card className="w-full max-w-lg p-8">
        <AppTitle as="h1" />
        <h2 className="mt-4 text-xl font-bold">가입 신청</h2>
        <p className="mt-1 text-muted">
          <strong className="text-ink">{user?.email}</strong> 계정은 아직 등록되지 않았습니다. 이름과 과목을 적어 신청하면 관리자가 승인합니다.
        </p>
        {error && (
          <div className="mt-4">
            <Alert>{error}</Alert>
          </div>
        )}
        <div className="mt-6">
          <AccessRequestForm />
        </div>
        <Button variant="ghost" className="mt-4 w-full" onClick={() => void signOut()}>
          다른 계정으로 로그인
        </Button>
      </Card>
      <AppFooter />
    </div>
  );
}
