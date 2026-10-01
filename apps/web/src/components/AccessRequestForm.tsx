import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ACCESS_KIND_LABEL, type AccessKind, type AccessRequestDoc } from '@sim/shared';
import { useAuth } from '@/auth/AuthProvider';
import { toast } from '@/components/Toast';
import { Alert, Button, Field } from '@/components/ui';
import { db, errorMessage } from '@/lib/firebase';

/**
 * 가입(교사) / 관리자 권한 신청 폼. 내 신청 문서를 실시간으로 보고, 승인되면 역할을 다시 받아 바로 앱으로 들어간다.
 * kinds: 고를 수 있는 신청 유형 (교사 화면에서는 관리자만)
 */
export function AccessRequestForm({ kinds = ['TEACHER', 'ADMIN'] }: { kinds?: AccessKind[] }) {
  const { user, refresh } = useAuth();
  const [request, setRequest] = useState<AccessRequestDoc | null | undefined>(undefined);
  const [name, setName] = useState(user?.displayName ?? '');
  const [subject, setSubject] = useState('');
  // 소속 학교·학기: 학년도는 3월 시작, 학기는 8월부터 2학기
  const now = new Date();
  const [school, setSchool] = useState('');
  const [year, setYear] = useState(now.getMonth() < 2 ? now.getFullYear() - 1 : now.getFullYear());
  const [semester, setSemester] = useState(now.getMonth() >= 7 || now.getMonth() < 2 ? 2 : 1);
  const [kind, setKind] = useState<AccessKind>(kinds[0]!);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshed = useRef(false);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      doc(db, 'accessRequests', user.uid),
      (snap) => setRequest(snap.exists() ? (snap.data() as AccessRequestDoc) : null),
      () => setRequest(null),
    );
  }, [user]);

  // 승인되면 역할을 다시 받아온다 (화면이 자동으로 바뀜)
  useEffect(() => {
    if (request?.status === 'APPROVED' && kinds.includes(request.kind) && !refreshed.current) {
      refreshed.current = true;
      toast(`${ACCESS_KIND_LABEL[request.kind]} 신청이 승인되었습니다.`);
      void refresh();
    }
  }, [request, kinds, refresh]);

  if (!user || request === undefined) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError('이름을 입력해 주세요.');
    if (kind === 'TEACHER' && !school.trim()) return setError('학교명을 입력해 주세요.');
    setBusy(true);
    setError(null);
    try {
      const data: AccessRequestDoc = {
        uid: user.uid,
        email: (user.email ?? '').toLowerCase(),
        name: name.trim(),
        subject: subject.trim() || null,
        kind,
        status: 'PENDING',
        note: null,
        ...(kind === 'TEACHER' ? { school: school.trim(), year, semester } : {}),
      };
      await setDoc(doc(db, 'accessRequests', user.uid), { ...data, createdAt: serverTimestamp() });
      toast('신청했습니다. 관리자가 승인하면 바로 사용할 수 있습니다.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (request?.status === 'PENDING' && kinds.includes(request.kind)) {
    return (
      <Alert tone="info">
        <p className="text-lg font-bold">승인을 기다리는 중입니다.</p>
        <p className="mt-1">{ACCESS_KIND_LABEL[request.kind]} 신청</p>
        <p className="mt-1">
          {request.name}
          {request.subject ? ` · ${request.subject}` : ''} · {request.email}
          {request.school ? ` · ${request.school} ${request.year}학년도 ${request.semester}학기` : ''}
        </p>
        <p className="mt-1 text-sm">관리자가 승인하면 이 화면이 자동으로 바뀝니다. 다음부터는 이 Google 계정으로 로그인하면 됩니다.</p>
      </Alert>
    );
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="grid gap-4">
      {request?.status === 'REJECTED' && kinds.includes(request.kind) && (
        <Alert>
          이전 {ACCESS_KIND_LABEL[request.kind]} 신청이 반려되었습니다{request.note ? `: ${request.note}` : '.'} 내용을 고쳐 다시 신청할 수 있습니다.
        </Alert>
      )}
      {kinds.length > 1 && (
        <fieldset>
          <legend className="mb-2 font-semibold">신청 유형</legend>
          <div className="flex flex-wrap gap-2">
            {kinds.map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
                className={`min-h-12 cursor-pointer rounded-xl px-4 font-semibold ${kind === k ? 'bg-primary text-white' : 'border border-line hover:border-primary'}`}
              >
                {ACCESS_KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <Field label="이름" required value={name} onChange={(e) => setName(e.target.value)} />
      <Field label="담당 과목" placeholder="예: 국어" value={subject} onChange={(e) => setSubject(e.target.value)} />
      {kind === 'TEACHER' && (
        <fieldset className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
          <legend className="mb-2 font-semibold">소속 (승인되면 이 학교·학기 교사 명단에 들어갑니다)</legend>
          <Field label="학교명" required placeholder="예: 부여여자중학교" value={school} onChange={(e) => setSchool(e.target.value)} hint="시험 프로젝트의 학교명과 똑같이 적어 주세요." />
          <Field label="학년도" type="number" required min={2020} max={2100} value={year} onChange={(e) => setYear(Number(e.target.value))} />
          <label className="grid gap-1">
            <span className="font-semibold">학기</span>
            <select aria-label="학기" className="min-h-12 rounded-xl border border-line px-3" value={semester} onChange={(e) => setSemester(Number(e.target.value))}>
              <option value={1}>1학기</option>
              <option value={2}>2학기</option>
            </select>
          </label>
        </fieldset>
      )}
      <Field label="이메일 (로그인 계정)" value={user.email ?? ''} readOnly hint="승인되면 다음부터 이 Google 계정으로 로그인합니다." />
      {error && <Alert>{error}</Alert>}
      <Button type="submit" disabled={busy}>
        {busy ? '신청 중…' : `${ACCESS_KIND_LABEL[kind]} 승인 신청`}
      </Button>
    </form>
  );
}
