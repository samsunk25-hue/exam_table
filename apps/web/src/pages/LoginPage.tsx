import { useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { AppTitle } from '@/components/Brand';
import { Alert, Button, Card } from '@/components/ui';
import { errorMessage, usingEmulators } from '@/lib/firebase';

export function LoginPage() {
  const { signIn } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reduceMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

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
      <Card className="w-full max-w-2xl overflow-hidden p-0">
        {/* 대문 영상 (소리 없이 반복). 불러오는 동안·움직임 줄이기 설정에서는 대문 그림 */}
        <video
          className="block aspect-video w-full bg-bg object-cover"
          src="/login.mp4"
          poster="/hero.jpg"
          autoPlay={!reduceMotion}
          muted
          loop
          playsInline
          preload="auto"
          aria-label="쌤밸런스 소개 영상: 시험 감독 시간표를 태블릿으로 확인하는 선생님"
        />
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
