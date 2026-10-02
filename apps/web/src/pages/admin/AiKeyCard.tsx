import { doc, onSnapshot, type Timestamp } from 'firebase/firestore';
import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { toast } from '@/components/Toast';
import { Alert, Button, Card, CardTitle } from '@/components/ui';
import { callClearMyAiKey, callSetMyAiKey, db, errorMessage } from '@/lib/firebase';

/** 붙여 넣은 키의 흔한 실수를 서버에 보내기 전에 알려 준다 (없으면 null) */
function keyProblem(k: string): string | null {
  if (/\.\.\.|…|\*/.test(k)) return '가려진 키(… 또는 *가 들어간 것)를 복사하셨습니다. 키 전체는 만들 때 한 번만 보이므로, 콘솔에서 키를 새로 만들어 바로 복사해 주세요.';
  if (!k.startsWith('sk-ant-')) return `sk-ant-로 시작하는 키 전체를 붙여 넣어 주세요. (지금 붙여 넣은 글은 "${k.slice(0, 8)}…"로 시작합니다)`;
  if (k.length < 60) return `키 전체가 아닌 것 같습니다. 지금 ${k.length}자인데 Claude 키는 보통 100자 정도입니다. 콘솔에서 키를 새로 만들어 복사 버튼으로 복사해 주세요.`;
  return null;
}

/**
 * 관리자 본인의 Claude API 키. 서버의 비공개 저장소에만 두고(브라우저로는 다시 읽을 수 없음) 끝 4자리만 보여 준다.
 * 관리자마다 자기 키를 넣고, 교사용 설명은 그 시험 프로젝트를 만든 관리자의 키를 쓴다.
 */
export function AiKeyCard() {
  const { user } = useAuth();
  const [status, setStatus] = useState<{ last4: string; updatedAt?: Timestamp } | null | undefined>(undefined);
  const [key, setKey] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => setStatus((snap.get('ai') as { last4: string; updatedAt?: Timestamp } | null | undefined) ?? null),
      () => setStatus(null),
    );
  }, [user]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const problem = keyProblem(key.trim());
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data } = await callSetMyAiKey({ key: key.trim() });
      toast(`AI 키를 등록했습니다 (끝 ${data.last4}).`);
      setKey('');
      setEditing(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const clear = async () => {
    setBusy(true);
    try {
      await callClearMyAiKey();
      toast('AI 키를 삭제했습니다.');
    } catch (err) {
      toast(errorMessage(err), 'alert');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mb-6">
      <CardTitle icon="🔑">내 AI 키 (Claude)</CardTitle>
      <p className="mt-1 text-muted">
        AI 기능(학교 문서 읽기, 글로 쓴 고려사항 → 규칙, 교사용 배정 설명)에 쓰는 내 Claude API 키입니다. 키는 서버의 비공개 저장소에만 저장되어 앱·코드·다른 관리자·교사에게
        보이지 않으며, 관리자마다 자기 키를 넣습니다. 교사용 설명은 그 시험 프로젝트를 만든 관리자의 키로 처리됩니다.
      </p>
      <div className="mt-3">
        {status === undefined ? null : status && !editing ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full bg-mint-soft px-3 py-1 font-semibold">등록됨 · sk-ant-…{status.last4}</span>
            {status.updatedAt && <span className="text-sm text-muted">{status.updatedAt.toDate().toLocaleDateString('ko-KR')} 등록</span>}
            <Button variant="secondary" onClick={() => setEditing(true)} disabled={busy}>
              키 바꾸기
            </Button>
            <Button variant="ghost" onClick={() => void clear()} disabled={busy}>
              삭제
            </Button>
          </div>
        ) : (
          <form onSubmit={(e) => void save(e)} className="grid max-w-xl gap-2">
            <label className="grid gap-1">
              <span className="font-semibold">Claude API 키</span>
              <input
                type="password"
                autoComplete="off"
                aria-label="Claude API 키"
                placeholder="sk-ant-로 시작하는 키를 붙여 넣으세요"
                className="min-h-12 rounded-xl border border-line px-4 font-mono"
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
              <span className="text-sm text-muted">platform.claude.com → API 키 받기에서 만든 키 (sk-ant-로 시작, 100자 정도). 크레딧이 충전되어 있어야 하고, 등록할 때 실제로 쓸 수 있는 키인지 확인합니다.</span>
            </label>
            {error && <Alert>{error}</Alert>}
            <div className="flex gap-2">
              <Button type="submit" disabled={busy || !key.trim()}>
                {busy ? '확인 중…' : '등록'}
              </Button>
              {status && (
                <Button type="button" variant="secondary" onClick={() => setEditing(false)} disabled={busy}>
                  취소
                </Button>
              )}
            </div>
          </form>
        )}
      </div>
    </Card>
  );
}
