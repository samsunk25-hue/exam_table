import { collection, onSnapshot, orderBy, query, type Timestamp } from 'firebase/firestore';
import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { Alert, Button, Card, Field, PageTitle, Spinner } from '@/components/ui';
import { callAddAdmin, callRemoveAdmin, db, errorMessage } from '@/lib/firebase';
import { AccessRequestsCard } from './AccessRequestsCard';
import { AiKeyCard } from './AiKeyCard';

interface AdminEntry {
  email: string;
  bootstrap: boolean;
  createdAt?: Timestamp;
}

function useAdmins() {
  const [state, setState] = useState<{ data: AdminEntry[]; loading: boolean; error: string | null }>({
    data: [],
    loading: true,
    error: null,
  });
  useEffect(
    () =>
      onSnapshot(
        query(collection(db, 'admins'), orderBy('createdAt')),
        (snap) => setState({ data: snap.docs.map((d) => d.data() as AdminEntry), loading: false, error: null }),
        (e) => setState({ data: [], loading: false, error: e.message }),
      ),
    [],
  );
  return state;
}

function AdminRow({ entry, isSelf }: { entry: AdminEntry; isSelf: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await callRemoveAdmin({ email: entry.email });
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const locked = entry.bootstrap || isSelf;

  return (
    <li className="flex flex-col gap-3 border-b border-line py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="truncate text-lg font-bold">{entry.email}</div>
        <div className="text-sm text-muted">
          {entry.bootstrap ? '기본 관리자 (서버 설정)' : '앱에서 추가됨'}
          {isSelf && ' · 나'}
        </div>
        {error && (
          <div className="mt-2">
            <Alert>{error}</Alert>
          </div>
        )}
      </div>
      {!locked &&
        (confirming ? (
          <div className="flex shrink-0 gap-2">
            <Button variant="danger" onClick={() => void remove()} disabled={busy}>
              {busy ? '제거 중…' : '제거 확인'}
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={busy}>
              취소
            </Button>
          </div>
        ) : (
          <Button variant="secondary" className="shrink-0" onClick={() => setConfirming(true)}>
            제거
          </Button>
        ))}
    </li>
  );
}

export function AdminsPage() {
  const { user } = useAuth();
  const { data, loading, error } = useAdmins();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'info' | 'alert'; text: string } | null>(null);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const { data: res } = await callAddAdmin({ email: email.trim() });
      setEmail('');
      setMessage({
        tone: 'info',
        text: res.applied
          ? `${res.email} 계정에 관리자 권한을 주었습니다. 다시 로그인하면 반영됩니다.`
          : `${res.email} 계정을 등록했습니다. 처음 로그인할 때 관리자 권한이 적용됩니다.`,
      });
    } catch (err) {
      setMessage({ tone: 'alert', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageTitle sub="관리자는 모든 시험 프로젝트의 설정·배정·확정을 할 수 있습니다.">관리자 관리</PageTitle>
      <AiKeyCard />
      <AccessRequestsCard />

      <Card className="mb-6">
        <form onSubmit={(e) => void add(e)} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Field
              label="관리자 추가"
              type="email"
              required
              placeholder="teacher@school.kr"
              hint="Google 로그인에 쓰는 이메일 주소를 입력하세요."
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={busy} className="sm:mb-7">
            {busy ? '추가 중…' : '추가'}
          </Button>
        </form>
        {message && (
          <div className="mt-3">
            <Alert tone={message.tone}>{message.text}</Alert>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="text-lg font-bold">현재 관리자</h2>
        {loading && <Spinner />}
        {error && <Alert>{error}</Alert>}
        <ul>
          {data.map((a) => (
            <AdminRow key={a.email} entry={a} isSelf={a.email === user?.email?.toLowerCase()} />
          ))}
        </ul>
        <p className="mt-3 text-sm text-muted">
          본인 권한은 스스로 제거할 수 없습니다. 기본 관리자는 서버 설정 파일(functions/.env)에서 관리합니다.
        </p>
      </Card>
    </>
  );
}
