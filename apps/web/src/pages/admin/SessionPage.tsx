import { useState } from 'react';
import { Link, NavLink, Outlet, useOutletContext, useParams } from 'react-router';
import { STATUS_LABEL, TRANSITIONS, isSetupEditable, type Transition } from '@sim/shared';
import { StatusStepper } from '@/components/StatusStepper';
import { BundleSection } from './BundleCard';
import { Alert, Button, Card, PageTitle, Spinner, Toggle } from '@/components/ui';
import { callTransitionSession, errorMessage } from '@/lib/firebase';
import { sessionTitle, updateSessionSettings, useSession, type ExamSession } from '@/lib/sessions';

const TABS = [
  { to: '', label: '개요', end: true },
  { to: 'setup', label: '기본 설정' },
  { to: 'availability', label: '불가시간' },
  { to: 'assign', label: '자동 배정' },
  { to: 'editor', label: '시간표 편집' },
  { to: 'print', label: '출력' },
  { to: 'history', label: '변경 이력' },
];

export function SessionLayout() {
  const { sid } = useParams();
  const { data: session, loading, error } = useSession(sid);

  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  if (!session) return <Alert>시험 프로젝트를 찾을 수 없습니다.</Alert>;

  return (
    <>
      <Link to="/admin" className="inline-flex min-h-12 items-center text-primary-strong">
        ← 대시보드
      </Link>
      <PageTitle sub={session.schoolName}>{sessionTitle(session)}</PageTitle>
      <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-line" aria-label="시험 프로젝트 메뉴">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              `flex min-h-12 shrink-0 items-center border-b-2 px-4 font-semibold ${
                isActive ? 'border-primary text-primary-strong' : 'border-transparent text-muted hover:text-ink'
              }`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet context={session} />
    </>
  );
}

function TransitionButton({ session, t }: { session: ExamSession; t: Transition }) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const backward =
    t.to === 'DRAFT' || t.to === 'AUTO_ASSIGNED' || t.to === 'REVIEW' || (session.status === 'LOCKED' && t.to === 'CONFIRMED');

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await callTransitionSession({ sessionId: session.id, to: t.to, reason: reason.trim() || undefined });
      setAsking(false);
      setReason('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (!asking) {
    return (
      <Button variant={backward ? 'secondary' : 'primary'} onClick={() => setAsking(true)}>
        {t.label}
      </Button>
    );
  }

  return (
    <Card className="w-full">
      <p className="font-semibold">
        "{STATUS_LABEL[session.status]}" → "{STATUS_LABEL[t.to]}"(으)로 바꿀까요?
      </p>
      {t.to === 'CONFIRMED' && session.status !== 'LOCKED' && (
        <p className="mt-1 text-muted">확정하면 이번 배정의 업무점수가 교사별 누적 점수에 반영됩니다.</p>
      )}
      <label className="mt-3 flex flex-col gap-1.5">
        <span className="font-semibold">사유 {t.requiresReason ? '(필수)' : '(선택)'}</span>
        <textarea
          className="min-h-20 rounded-xl border border-line px-4 py-3 outline-none focus:border-primary"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <Button onClick={() => void run()} disabled={busy || (t.requiresReason && !reason.trim())}>
          {busy ? '처리 중…' : '확인'}
        </Button>
        <Button variant="secondary" onClick={() => setAsking(false)} disabled={busy}>
          취소
        </Button>
      </div>
    </Card>
  );
}

export function useCurrentSession(): ExamSession {
  return useOutletContext<ExamSession>();
}

export function SessionOverview() {
  const session = useCurrentSession();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editable = isSetupEditable(session.status);

  const toggleBase = async (v: boolean) => {
    setSaving(true);
    setError(null);
    try {
      await updateSessionSettings(session.id, { ...session.settings, useBaseTimetable: v });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-6">
      <Card>
        <h2 className="mb-4 text-lg font-bold">진행 단계</h2>
        <StatusStepper status={session.status} />
        {session.lastChangeReason && (
          <p className="mt-3 text-sm text-muted">최근 변경 사유: {session.lastChangeReason}</p>
        )}
        <div className="mt-5 flex flex-wrap gap-2">
          {TRANSITIONS[session.status].map((t) => (
            <TransitionButton key={t.to} session={session} t={t} />
          ))}
        </div>
      </Card>

      <BundleSection session={session} />

      <Card>
        <h2 className="mb-2 text-lg font-bold">배정 설정</h2>
        <Toggle
          label="기초시간표 반영"
          hint="켜면 시험 시간에 해당 반을 원래 가르치던 교사에게 가점(+50)을 줍니다."
          checked={session.settings.useBaseTimetable}
          disabled={!editable || saving}
          onChange={(v) => void toggleBase(v)}
        />
        {!editable && <p className="mt-2 text-sm text-muted">교사 공개 이후에는 설정을 바꿀 수 없습니다.</p>}
        {error && (
          <div className="mt-3">
            <Alert>{error}</Alert>
          </div>
        )}
      </Card>
    </div>
  );
}
