import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useOutletContext, useParams } from 'react-router';
import {
  STATUS_LABEL,
  SESSION_STATUSES,
  TRANSITIONS,
  sessionTerm,
  termKey,
  type AssignmentDoc,
  type RoomDoc,
  type SessionStatus,
  type SlotDoc,
  type Transition,
} from '@sim/shared';
import { StatusBadge } from '@/components/StatusStepper';
import { useTerm } from '@/components/TermRoster';
import { BundleSection } from './BundleCard';
import { AutoPlacer } from './AutoPlacer';
import { Alert, Button, Card, PageTitle, Spinner } from '@/components/ui';
import { useCollection } from '@/lib/data';
import { callTransitionSession, errorMessage } from '@/lib/firebase';
import { sessionTitle, termWhere, useSession, useSessionTeachers, type ExamSession } from '@/lib/sessions';

/** 프로젝트 메뉴: 4단계(준비 → 배정 → 점검 → 공개·출력), 단계 안에 세부 화면 */
const STEPS: { label: string; tabs: { to: string; label: string }[] }[] = [
  {
    label: '① 준비',
    tabs: [
      { to: '', label: '개요' },
      { to: 'teachers', label: '교사 명단' },
      { to: 'rooms', label: '시험실' },
      { to: 'schedule', label: '시험 일정' },
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

/** 단계 색: ① 준비 파랑 · ② 배정 민트 · ③ 점검 보라 · ④ 공개·출력 주황 (Tailwind가 찾도록 클래스를 통째로 적는다) */
const STEP_COLORS = [
  { solid: 'bg-primary text-white', soft: 'bg-primary-soft text-primary-strong', hover: 'hover:border-primary hover:bg-primary-soft', tab: 'border-primary text-primary-strong', banner: 'border-primary bg-primary-soft/70', text: 'text-primary-strong', btn: 'bg-primary hover:bg-primary-strong' },
  { solid: 'bg-step2 text-white', soft: 'bg-step2-soft text-step2', hover: 'hover:border-step2 hover:bg-step2-soft', tab: 'border-step2 text-step2', banner: 'border-step2 bg-step2-soft/70', text: 'text-step2', btn: 'bg-step2 hover:brightness-95' },
  { solid: 'bg-step3 text-white', soft: 'bg-step3-soft text-step3', hover: 'hover:border-step3 hover:bg-step3-soft', tab: 'border-step3 text-step3', banner: 'border-step3 bg-step3-soft/70', text: 'text-step3', btn: 'bg-step3 hover:brightness-95' },
  { solid: 'bg-step4 text-white', soft: 'bg-step4-soft text-step4', hover: 'hover:border-step4 hover:bg-step4-soft', tab: 'border-step4 text-step4', banner: 'border-step4 bg-step4-soft/70', text: 'text-step4', btn: 'bg-step4 hover:brightness-95' },
] as const;

/** 진행 상태 → 단계: 초안=준비, 배정 완료=배정, 검토=점검, 공개·확정=공개·출력 */
const progressOf = (s: SessionStatus) => ({ DRAFT: 0, AUTO_ASSIGNED: 1, REVIEW: 2, PUBLISHED: 3, SWAP: 3, CONFIRMED: 3, LOCKED: 3 })[s];

/** 지금 상태에서 할 일 하나 (큰 버튼) */
function NextAction({ session }: { session: ExamSession }) {
  const slots = useCollection<SlotDoc>(`sessions/${session.id}/slots`);
  const assignments = useCollection<AssignmentDoc>(`sessions/${session.id}/assignments`);
  const teachers = useSessionTeachers(session);
  const rooms = useCollection<RoomDoc>('rooms', termWhere(session));
  if (slots.loading || assignments.loading || teachers.loading || rooms.loading) return null;
  const activeTeachers = teachers.data.filter((t) => t.active !== false && t.defaultRole !== 'EXCLUDED').length;
  const placed = slots.data.some((x) => (x.rooms ?? []).length > 0);
  // 담임(학년·반)이 있으면 학급 교실을 자동으로 만들므로 시험실 등록은 건너뛰어도 된다
  const homerooms = teachers.data.some((t) => !t.temporary && t.homeroom);
  const transition = (to: string) => TRANSITIONS[session.status].find((t) => t.to === to);
  const go = (to: string, label: string, text: string) => ({ kind: 'link' as const, to, label, text });
  const step = (to: string, label: string, text: string) => ({ kind: 'step' as const, t: transition(to)!, label, text });
  const s = session.status;
  const next =
    s === 'DRAFT' || s === 'AUTO_ASSIGNED'
      ? activeTeachers === 0
        ? go('teachers', '교사 명단 입력하기', '감독할 교사가 없습니다. 교사 명단을 넣으세요 (엑셀·지난 학기 이어받기·직접 입력).')
        : rooms.data.length === 0 && !homerooms
          ? go('rooms', '시험실 등록하기', '시험실이 없습니다. 학년별 학급 수만 넣으면 교실이 만들어집니다 (또는 교사 명단에 담임을 넣으면 자동).')
          : slots.data.length === 0
            ? go('schedule', '시험 일정 입력하기', '시험 일정을 넣으세요 (달력·표·엑셀·학교 문서 AI 읽기). 시험실은 자동으로 배치됩니다.')
            : !placed
              ? go('rooms', '시험실 확인하기', '시험에 배치할 교실이 없습니다. 시험실에서 학년별 학급 수를 넣으면 학급 교실로 자동 배치됩니다.')
              : assignments.data.length === 0
          ? go('assign', '자동 배정하기', `시험 ${slots.data.length}건이 준비되었습니다. 불가시간을 받은 뒤 자동 배정하세요.`)
          : step('PUBLISHED', '교사에게 공개하기', '배정을 마쳤습니다. ③ 점검에서 업무 점수를 확인한 뒤 교사에게 공개하세요.')
      : s === 'REVIEW'
        ? step('PUBLISHED', '교사에게 공개하기', '검토가 끝나면 교사에게 공개하세요. 공개 중에는 교사가 교환을 요청할 수 있습니다.')
        : s === 'PUBLISHED' || s === 'SWAP'
          ? step('CONFIRMED', '최종 확정하기', '교환 요청을 정리했으면 최종 확정하세요. 확정하면 업무 점수가 누적됩니다.')
          : go('print', '시간표 출력하기', s === 'LOCKED' ? '변경이 잠긴 완료 상태입니다.' : '확정되었습니다. 시간표를 출력·배포하세요.');
  if (next.kind === 'step' && !next.t) return null;
  const color = STEP_COLORS[progressOf(session.status)]!;
  return (
    <div className={`anim-fade mb-4 flex flex-wrap items-center gap-3 rounded-card border-2 px-4 py-3 shadow-[var(--shadow-card)] no-print ${color.banner}`} aria-label="다음 할 일">
      <span className={`font-bold ${color.text}`}>다음 할 일</span>
      <span className="min-w-0 flex-1 text-sm">{next.text}</span>
      {next.kind === 'link' ? (
        <Link to={next.to} className={`inline-flex min-h-12 items-center rounded-xl px-5 font-semibold text-white shadow-sm transition-all active:scale-[0.98] ${color.btn}`}>
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
  const progress = progressOf(session.status);
  const tabClass = ({ isActive }: { isActive: boolean }) =>
    `flex min-h-12 shrink-0 items-center border-b-[3px] px-4 font-semibold transition-colors ${isActive ? STEP_COLORS[current]!.tab : 'border-transparent text-muted hover:text-ink'}`;

  return (
    <>
      <Link to="/admin" className="inline-flex min-h-12 items-center text-primary-strong">
        ← 대시보드
      </Link>
      <PageTitle sub={session.schoolName}>{sessionTitle(session)}</PageTitle>
      <SyncTerm session={session} />
      <NextAction session={session} />
      <AutoPlacer session={session} />
      <nav className="flex gap-2 overflow-x-auto" aria-label="시험 프로젝트 단계">
        {STEPS.map((st, i) => {
          // 진행 상태도 이 단계 탭으로 보여 준다: 지난 단계 ✓, 지금 단계 "진행 중"
          const done = i < progress;
          return (
            <Link
              key={st.label}
              to={st.tabs[0]!.to || '.'}
              aria-current={i === current ? 'page' : undefined}
              className={`flex min-h-12 shrink-0 items-center gap-2 rounded-xl px-5 text-lg font-bold transition-all ${
                i === current ? `${STEP_COLORS[i]!.solid} shadow-sm` : `border border-line bg-surface text-ink ${STEP_COLORS[i]!.hover}`
              }`}
            >
              {done ? `✓ ${st.label.slice(2)}` : st.label}
              {i === progress && (
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${i === current ? 'bg-white/25' : STEP_COLORS[i]!.soft}`}>진행 중</span>
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

/** "다음 할 일"이 맡는 앞으로 가는 단계인지 (잠금은 여기서). 교환 기간은 공개 중 언제나 가능해서 버튼 없음 */
const isForward = (from: SessionStatus, to: SessionStatus) => to !== 'LOCKED' && SESSION_STATUSES.indexOf(to) > SESSION_STATUSES.indexOf(from);

export function useCurrentSession(): ExamSession {
  return useOutletContext<ExamSession>();
}

export function SessionOverview() {
  const session = useCurrentSession();

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
          {TRANSITIONS[session.status].filter((t) => !isForward(session.status, t.to)).map((t) => (
            // 앞으로 가는 단계(공개·확정)는 위 "다음 할 일" 버튼 한 곳에서만. 여기는 되돌리기·잠금만
            <TransitionButton key={t.to} session={session} t={t} />
          ))}
        </div>
      </Card>

      <BundleSection session={session} />
    </div>
  );
}
