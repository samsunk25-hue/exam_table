import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useOutletContext, useParams } from 'react-router';
import {
  EXAM_WRITER_RULE_LABEL,
  STATUS_LABEL,
  TRANSITIONS,
  isSetupEditable,
  sessionTerm,
  termKey,
  type AssignmentDoc,
  type ExamWriterRule,
  type SlotDoc,
  type Transition,
} from '@sim/shared';
import { StatusBadge } from '@/components/StatusStepper';
import { useTerm } from '@/components/TermRoster';
import { UndoConfirm, useUndoOps } from '@/components/UndoHistory';
import { BundleSection, TimetableUpload } from './BundleCard';
import { TempStaffCard } from './TempStaffCard';
import { Alert, Button, Card, PageTitle, Spinner, Toggle } from '@/components/ui';
import { useCollection } from '@/lib/data';
import { callTransitionSession, errorMessage } from '@/lib/firebase';
import { sessionTitle, updateSessionSettings, useSession, type ExamSession } from '@/lib/sessions';

/** 프로젝트 메뉴: 4단계(준비 → 배정 → 점검 → 공개·출력), 단계 안에 세부 화면 */
const STEPS: { label: string; tabs: { to: string; label: string }[] }[] = [
  {
    label: '① 준비',
    tabs: [
      { to: '', label: '개요' },
      { to: 'schedule', label: '시험 일정' },
      { to: 'teachers', label: '교사 명단' },
      { to: 'rooms', label: '시험실' },
      { to: 'availability', label: '불가시간' },
    ],
  },
  {
    label: '② 배정',
    tabs: [
      { to: 'assign', label: '자동 배정' },
      { to: 'editor', label: '시간표 편집' },
    ],
  },
  { label: '③ 점검', tabs: [{ to: 'equity', label: '업무 점수·AI 점검' }] },
  {
    label: '④ 공개·출력',
    tabs: [
      { to: 'print', label: '출력' },
      { to: 'history', label: '변경 이력' },
    ],
  },
];

/** 프로젝트를 열면 머리글의 학교·학기도 그 프로젝트 학기로 */
function SyncTerm({ session }: { session: ExamSession }) {
  const { key, choose } = useTerm();
  const want = termKey(sessionTerm(session));
  useEffect(() => {
    // choose는 렌더마다 새 함수라 의존성에서 뺀다
    if (key !== want) choose(want);
  }, [key, want]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** 지금 상태에서 할 일 하나 (큰 버튼) */
function NextAction({ session }: { session: ExamSession }) {
  const slots = useCollection<SlotDoc>(`sessions/${session.id}/slots`);
  const assignments = useCollection<AssignmentDoc>(`sessions/${session.id}/assignments`);
  if (slots.loading || assignments.loading) return null;
  const transition = (to: string) => TRANSITIONS[session.status].find((t) => t.to === to);
  const go = (to: string, label: string, text: string) => ({ kind: 'link' as const, to, label, text });
  const step = (to: string, label: string, text: string) => ({ kind: 'step' as const, t: transition(to)!, label, text });
  const s = session.status;
  const next =
    s === 'DRAFT' || s === 'AUTO_ASSIGNED'
      ? slots.data.length === 0
        ? go('schedule', '시험 일정 입력하기', '먼저 시험 일정을 넣으세요 (달력·표·엑셀·학교 문서 AI 읽기).')
        : assignments.data.length === 0
          ? go('assign', '자동 배정하기', `시험 ${slots.data.length}건이 준비되었습니다. 불가시간을 받은 뒤 자동 배정하세요.`)
          : s === 'DRAFT'
            ? step('AUTO_ASSIGNED', '배정 완료로 표시', '배정이 들어 있습니다. 배정을 마쳤으면 다음 단계로 넘어가세요.')
            : step('REVIEW', '검토 시작하기', '배정을 마쳤습니다. 업무 점수·AI 점검으로 확인한 뒤 검토를 시작하세요.')
      : s === 'REVIEW'
        ? step('PUBLISHED', '교사에게 공개하기', '검토가 끝나면 교사에게 공개하세요. 공개 중에는 교사가 교환을 요청할 수 있습니다.')
        : s === 'PUBLISHED' || s === 'SWAP'
          ? step('CONFIRMED', '최종 확정하기', '교환 요청을 정리했으면 최종 확정하세요. 확정하면 업무 점수가 누적됩니다.')
          : go('print', '시간표 출력하기', s === 'LOCKED' ? '변경이 잠긴 완료 상태입니다.' : '확정되었습니다. 시간표를 출력·배포하세요.');
  if (next.kind === 'step' && !next.t) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-card border-2 border-primary bg-primary-soft/60 px-4 py-3 no-print" aria-label="다음 할 일">
      <span className="font-bold text-primary-strong">다음 할 일</span>
      <span className="min-w-0 flex-1 text-sm">{next.text}</span>
      {next.kind === 'link' ? (
        <Link to={next.to} className="inline-flex min-h-12 items-center rounded-xl bg-primary px-5 font-semibold text-white hover:bg-primary-strong">
          {next.label} →
        </Link>
      ) : (
        <TransitionButton session={session} t={next.t} label={`${next.label} →`} />
      )}
    </div>
  );
}

export function SessionLayout() {
  const { sid } = useParams();
  const { data: session, loading, error } = useSession(sid);
  const { pathname } = useLocation();

  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  if (!session) return <Alert>시험 프로젝트를 찾을 수 없습니다.</Alert>;

  // 지금 화면이 속한 단계
  const sub = pathname.split(`/sessions/${session.id}`)[1]?.replace(/^\//, '').split('/')[0] ?? '';
  const current = Math.max(0, STEPS.findIndex((st) => st.tabs.some((t) => t.to === sub)));
  // 진행 상태 → 단계: 초안=준비, 배정 완료=배정, 검토=점검, 공개·확정=공개·출력
  const progress = { DRAFT: 0, AUTO_ASSIGNED: 1, REVIEW: 2, PUBLISHED: 3, SWAP: 3, CONFIRMED: 3, LOCKED: 3 }[session.status];
  const tabClass = ({ isActive }: { isActive: boolean }) =>
    `flex min-h-12 shrink-0 items-center border-b-2 px-4 font-semibold ${isActive ? 'border-primary text-primary-strong' : 'border-transparent text-muted hover:text-ink'}`;

  return (
    <>
      <Link to="/admin" className="inline-flex min-h-12 items-center text-primary-strong">
        ← 대시보드
      </Link>
      <PageTitle sub={session.schoolName}>{sessionTitle(session)}</PageTitle>
      <SyncTerm session={session} />
      <NextAction session={session} />
      <nav className="flex gap-2 overflow-x-auto" aria-label="시험 프로젝트 단계">
        {STEPS.map((st, i) => {
          // 진행 상태도 이 단계 탭으로 보여 준다: 지난 단계 ✓, 지금 단계 "진행 중"
          const done = i < progress;
          return (
            <Link
              key={st.label}
              to={st.tabs[0]!.to || '.'}
              aria-current={i === current ? 'page' : undefined}
              className={`flex min-h-12 shrink-0 items-center gap-2 rounded-xl px-5 text-lg font-bold ${
                i === current ? 'bg-primary text-white' : 'bg-surface text-ink border border-line hover:border-primary hover:bg-primary-soft'
              }`}
            >
              {done ? `✓ ${st.label.slice(2)}` : st.label}
              {i === progress && (
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${i === current ? 'bg-white/25' : 'bg-primary-soft text-primary-strong'}`}>진행 중</span>
              )}
            </Link>
          );
        })}
      </nav>
      <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-line" aria-label="시험 프로젝트 메뉴">
        {STEPS[current]!.tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.to === ''} className={tabClass}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet context={session} />
    </>
  );
}

/** 가장 최근의 (되돌리지 않은) 단계 변경을 되돌린다 = 이전 단계로 */
function PrevStepButton({ sessionId }: { sessionId: string }) {
  const ops = useUndoOps(sessionId);
  const [open, setOpen] = useState(false);
  const last = ops.data.find((o) => o.kind === 'STATUS' && !o.undone);
  if (!last) return null;
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        ↶ 이전 단계로 되돌리기
      </Button>
      {open && <UndoConfirm op={last} onClose={() => setOpen(false)} />}
    </>
  );
}

function TransitionButton({ session, t, label }: { session: ExamSession; t: Transition; /** 버튼 글자 (없으면 단계 이름) */ label?: string }) {
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
        {label ?? t.label}
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

  const saveSetting = async (patch: Partial<ExamSession['settings']>) => {
    setSaving(true);
    setError(null);
    try {
      await updateSessionSettings(session.id, { ...session.settings, ...patch });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const saveWriter = async (v: ExamWriterRule) => {
    setSaving(true);
    setError(null);
    try {
      await updateSessionSettings(session.id, { ...session.settings, examWriter: v });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-6">
      <Card>
        <h2 className="text-lg font-bold">
          현재 상태 <StatusBadge status={session.status} />
        </h2>
        {session.lastChangeReason && (
          <p className="mt-3 text-sm text-muted">최근 변경 사유: {session.lastChangeReason}</p>
        )}
        <div className="mt-5 flex flex-wrap gap-2">
          {TRANSITIONS[session.status].filter((t) => t.to !== 'SWAP').map((t) => (
            // 교환은 공개 중 언제나 가능하므로 "교환 기간 시작" 단계는 버튼으로 보이지 않는다
            <TransitionButton key={t.to} session={session} t={t} />
          ))}
          <PrevStepButton sessionId={session.id} />
          <Link to="history" className="inline-flex min-h-12 items-center px-3 font-semibold text-primary-strong underline-offset-4 hover:underline">
            작업 기록·되돌리기 →
          </Link>
        </div>
      </Card>

      <BundleSection session={session} />
      <TempStaffCard session={session} />

      <Card>
        <h2 className="mb-2 text-lg font-bold">배정 설정</h2>
        <Toggle
          label="기초시간표 반영"
          hint="켜면 시험 시간에 해당 반을 원래 가르치던 교사에게 가점(+50)을 줍니다. 켜면 아래에서 기초시간표를 올립니다."
          checked={session.settings.useBaseTimetable}
          disabled={!editable || saving}
          onChange={(v) => void toggleBase(v)}
        />
        {session.settings.useBaseTimetable && (
          <>
            <TimetableUpload session={session} />
            <div className="mt-3 ml-8">
              <Toggle
                label="시험 없는 학년은 수업 (수업 중인 교사는 감독 제외·수업 시간도 업무 점수)"
                hint="같은 시간에 시험을 보지 않는 학년은 수업한다고 보고, 그 시간 그 학년 수업이 있는 교사는 감독에서 빼고 수업 1시간을 0.8점으로 셉니다. 기본 켜짐."
                checked={session.settings.classDuringExam !== false}
                disabled={!editable || saving}
                onChange={(v) => void saveSetting({ classDuringExam: v })}
              />
            </div>
          </>
        )}
        <label className="mt-4 grid max-w-xl gap-1">
          <span className="font-semibold">출제 교사 (자기 과목 시험 시간)</span>
          <select
            aria-label="출제 교사 규칙"
            className="min-h-12 rounded-xl border border-line bg-surface px-3 disabled:bg-bg"
            value={session.settings.examWriter ?? 'NONE'}
            disabled={!editable || saving}
            onChange={(e) => void saveWriter(e.target.value as ExamWriterRule)}
          >
            {Object.entries(EXAM_WRITER_RULE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <span className="text-sm text-muted">담당 교과가 시험 과목과 같은 교사를 출제 교사로 봅니다. 시험 중 문항 질의에 대응하도록 복도 대기를 맡깁니다.</span>
        </label>
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
