import { useAuth } from '@/auth/AuthProvider';
import { Alert, Button, Card } from '@/components/ui';

export function NoAccessPage() {
  const { user, error, signOut } = useAuth();
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <Card className="w-full max-w-md p-8">
        <h1 className="text-[1.4rem] font-bold">접근 권한이 없습니다</h1>
        <p className="mt-3">
          <strong>{user?.email}</strong> 계정이 교사 명단에 등록되어 있지 않습니다.
        </p>
        <p className="mt-2 text-muted">관리자에게 교사 명단의 이메일 주소를 확인해 달라고 요청하세요.</p>
        {error && (
          <div className="mt-4">
            <Alert>{error}</Alert>
          </div>
        )}
        <Button variant="secondary" className="mt-6 w-full" onClick={() => void signOut()}>
          다른 계정으로 로그인
        </Button>
      </Card>
    </div>
  );
}
