import { Navigate } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { AccessRequestForm } from '@/components/AccessRequestForm';
import { Alert, Card } from '@/components/ui';
import { BrandFrame } from '@/layouts/AppShell';

/** 등록되지 않은 계정: 가입(교사) 또는 관리자 권한을 신청하고 승인을 기다린다 */
export function NoAccessPage() {
  const { user, role, error } = useAuth();
  // 승인되어 역할이 생기면 알맞은 첫 화면으로
  if (role === 'ADMIN') return <Navigate to="/admin" replace />;
  if (role === 'TEACHER') return <Navigate to="/me" replace />;

  return (
    // 승인 전에도 앱 머리글(제목·대문 그림·동물)은 그대로 보여 준다
    <BrandFrame modeLabel="승인 대기" bell={false}>
      <Card className="mx-auto w-full max-w-lg p-8">
        <h1 className="text-xl font-bold">가입 신청</h1>
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
      </Card>
    </BrandFrame>
  );
}
