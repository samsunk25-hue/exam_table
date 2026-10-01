import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { AppTitle } from '@/components/Brand';
import { Alert, Button, Card } from '@/components/ui';
import { errorMessage, usingEmulators } from '@/lib/firebase';

/** 대문 영상: 소리 없이 자동 반복 재생, 일시정지/재생 버튼 (움직임이 불편하면 멈출 수 있게) */
function IntroVideo() {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    // autoPlay 속성이 막혀도(브라우저 설정 등) 소리 없는 재생을 한 번 더 시도한다
    v.muted = true;
    void v.play().catch(() => setPlaying(false));
  }, []);

  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
  };

  return (
    <div className="relative">
      <video
        ref={ref}
        className="block aspect-video w-full bg-bg object-cover"
        src="/login.mp4"
        poster="/hero.jpg"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        aria-label="쌤밸런스 소개 영상: 시험 감독 시간표를 태블릿으로 확인하는 선생님"
      />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? '영상 일시정지' : '영상 재생'}
        className="absolute right-3 bottom-3 flex size-11 cursor-pointer items-center justify-center rounded-full bg-black/45 text-lg text-white backdrop-blur hover:bg-black/65"
      >
        <span aria-hidden>{playing ? '❚❚' : '▶'}</span>
      </button>
    </div>
  );
}

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
      <Card className="w-full max-w-2xl overflow-hidden p-0">
        <IntroVideo />
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
