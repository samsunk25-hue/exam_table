import { useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { AppTitle, HeroImage } from '@/components/Brand';
import { Alert, Button, Card } from '@/components/ui';
import { errorMessage, usingEmulators } from '@/lib/firebase';

export function LoginPage() {
  const { signIn } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onClick = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn();
    } catch (e) {
      if (!(e && typeof e === 'object' && 'code' in e && e.code === 'auth/popup-closed-by-user')) {
        setError(errorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-8">
      <Card className="w-full max-w-xl overflow-hidden p-0">
        <HeroImage className="block aspect-[1200/630] w-full object-cover" />
        <div className="p-8">
          <AppTitle as="h1" size="lg" />
          <p className="mt-2 text-muted">시험 감독 배정을 공정하고 빠르게. 학교 Google 계정으로 로그인하세요.</p>
        <Button className="mt-8 w-full" onClick={() => void onClick()} disabled={busy}>
          {busy ? '로그인 중…' : 'Google 계정으로 로그인'}
        </Button>
        {usingEmulators && <p className="mt-4 text-sm text-muted">에뮬레이터 모드: 가상 계정으로 로그인됩니다.</p>}
        {error && (
          <div className="mt-4">
            <Alert>{error}</Alert>
          </div>
        )}
        </div>
      </Card>
    </div>
  );
}
