import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Modal } from '@/components/Modal';
import { StatusBadge } from '@/components/StatusStepper';
import { toast } from '@/components/Toast';
import { Alert, Button, Card, Field, PageTitle, Spinner, Toggle, Empty } from '@/components/ui';
import { callDeleteSession, errorMessage } from '@/lib/firebase';
import { createSession, sessionTitle, useSessions, type ExamSession } from '@/lib/sessions';
import { commitOps, ref, useCollection } from '@/lib/data';
import { latestRoster, rememberTerm, rosterCopyOps, useTerm } from '@/components/TermRoster';
import { sessionTerm, termKey, termLabel, type RoomDoc, type TeacherDoc } from '@sim/shared';

type SessionItem = ExamSession;

/** 프로젝트 삭제 확인: 이름을 직접 입력해야 지운다. */
function DeleteSessionDialog({ session, onClose }: { session: SessionItem; onClose: () => void }) {
  const title = sessionTitle(session);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const confirmed = session.status === 'CONFIRMED' || session.status === 'LOCKED';

  const remove = async () => {
    setBusy(true);
    try {
      await callDeleteSession({ sessionId: session.id });
      toast(`"${title}" 프로젝트를 삭제했습니다.`);
      onClose();
    } catch (err) {
      toast(errorMessage(err), 'alert');
      setBusy(false);
    }
  };

  return (
    <Modal title="시험 프로젝트 삭제" onClose={() => !busy && onClose()}>
      <div className="grid gap-4">
        <p>
          <b>{title}</b> ({session.schoolName}) 프로젝트와 그 안의 시험 일정·감독 배정·불가시간·변경 이력을 모두 지웁니다.
          되돌릴 수 없습니다. 교사 명단과 시험실은 그대로 남습니다.
        </p>
        {confirmed && <Alert>최종 확정된 프로젝트입니다. 지우면 교사 누적 업무점수에서 이 시험의 점수도 빠집니다.</Alert>}
        <Field label={`확인을 위해 시험명 "${session.examName}"을(를) 입력하세요`} value={typed} onChange={(e) => setTyped(e.target.value)} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            취소
          </Button>
          <Button variant="danger" onClick={() => void remove()} disabled={busy || typed.trim() !== session.examName}>
            {busy ? '삭제 중…' : '삭제'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function currentSchoolYear(): number {
  const now = new Date();
  return now.getMonth() < 2 ? now.getFullYear() - 1 : now.getFullYear();
}

function CreateSessionForm({ onDone }: { onDone: () => void }) {
  const navigate = useNavigate();
  const term = useTerm();
  // 머리글에서 고른 학교로 미리 채운다
  const [schoolName, setSchoolName] = useState(term.current?.school ?? '');
  const [year, setYear] = useState(currentSchoolYear());
  const [semester, setSemester] = useState(new Date().getMonth() >= 7 ? 2 : 1);
  const [examName, setExamName] = useState('');
  // 같은 학교 지난 학기 교사·시험실은 자동으로 이어받는다 (예외는 개요의 "다른 학기에서 불러오기")
  const allTeachers = useCollection<TeacherDoc>('teachers');
  const allRooms = useCollection<RoomDoc>('rooms');
  const target = { school: schoolName.trim(), year, semester };
  const prevTeachers = schoolName.trim() ? latestRoster(allTeachers.data, target) : null;
  const prevRooms = schoolName.trim() ? latestRoster(allRooms.data, target) : null;
  const prev = prevTeachers ?? prevRooms;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const ref = await createSession({
        schoolName: schoolName.trim(),
        year,
        semester,
        examName: examName.trim(),
        // 기초시간표는 올리면 반영, 출제 교사는 자기 과목 시험 시간에 복도 대기 우선
        settings: { useBaseTimetable: true, examWriter: 'PREFER_HALLWAY' },
      });
      if (prev) {
        const copy = (kind: 'teachers' | 'rooms', p: typeof prevTeachers, all: typeof allTeachers.data | typeof allRooms.data) =>
          p
            ? rosterCopyOps({
                kind,
                all,
                chosen: p.docs,
                legacy: false,
                target,
                sameYear: p.term.year === year,
                clearHomeroom: p.term.year !== year,
              })
            : [];
        const ops = [...copy('teachers', prevTeachers, allTeachers.data), ...copy('rooms', prevRooms, allRooms.data)];
        await commitOps(ops, '새 프로젝트: 지난 학기 명단 이어받기');
        rememberTerm(termKey(target));
      }
      term.choose(termKey(target));
      onDone();
      void navigate(`/admin/sessions/${ref.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Card>
      <form onSubmit={(e) => void submit(e)} className="grid gap-4 md:grid-cols-2">
        <h2 className="text-lg font-bold md:col-span-2">새 시험 프로젝트</h2>
        <Field label="학교명" required value={schoolName} onChange={(e) => setSchoolName(e.target.value)} />
        <Field
          label="시험명"
          required
          placeholder="예: 2학기 기말고사"
          value={examName}
          onChange={(e) => setExamName(e.target.value)}
        />
        <Field label="학년도" type="number" required value={year} onChange={(e) => setYear(Number(e.target.value))} />
        <Field
          label="학기"
          type="number"
          min={1}
          max={2}
          required
          value={semester}
          onChange={(e) => setSemester(Number(e.target.value))}
        />
        {prev && (
          <p className="rounded-xl bg-bg p-3 md:col-span-2">
            <span className="font-semibold">지난 학기 명단을 자동으로 이어받습니다 — {termLabel(prev.term)}</span>
            <span className="block text-sm text-muted">
              교사 {prevTeachers?.docs.length ?? 0}명 · 시험실 {prevRooms?.docs.length ?? 0}개.
              {prev.term.year === year ? ' 같은 학년도라 누적 업무점수를 이어받습니다.' : ' 새 학년도라 누적 점수는 0점, 담임은 비웁니다.'} 바뀐 것만 교사 명단·시험실에서 고치세요.
            </span>
          </p>
        )}
        {error && (
          <div className="md:col-span-2">
            <Alert>{error}</Alert>
          </div>
        )}
        <div className="flex gap-2 md:col-span-2">
          <Button type="submit" disabled={busy}>
            {busy ? '만드는 중…' : '만들기'}
          </Button>
          <Button type="button" variant="secondary" onClick={onDone}>
            취소
          </Button>
        </div>
      </form>
    </Card>
  );
}

const FOLD_KEY = 'dashboard-folded-terms';

export function DashboardPage() {
  const { data: all, loading, error } = useSessions();
  const [showHidden, setShowHidden] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<SessionItem | null>(null);
  // 학교·학기 묶음 접기/펼치기 (이 브라우저에 기억)
  const [folded, setFolded] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(FOLD_KEY) ?? '[]') as string[];
    } catch {
      return [];
    }
  });
  const toggleFold = (k: string) => {
    const next = folded.includes(k) ? folded.filter((x) => x !== k) : [...folded, k];
    setFolded(next);
    try {
      localStorage.setItem(FOLD_KEY, JSON.stringify(next));
    } catch {
      /* 저장 안 돼도 화면은 그대로 */
    }
  };
  const hiddenCount = all.filter((s) => s.hidden).length;
  const sessions = showHidden ? all : all.filter((s) => !s.hidden);
  // 학교·학기별로 묶기 (최근 학기 먼저, 프로젝트는 만든 순서 최신 먼저)
  const groups = [...new Set(sessions.map((s) => termKey(sessionTerm(s))))].map((k) => ({
    key: k,
    label: termLabel(sessionTerm(sessions.find((s) => termKey(sessionTerm(s)) === k)!)),
    list: sessions.filter((s) => termKey(sessionTerm(s)) === k),
  }));
  const hide = async (s: SessionItem, hidden: boolean) => {
    try {
      await commitOps([{ type: 'set', ref: ref('sessions', s.id), data: { hidden }, merge: true }], hidden ? '프로젝트 숨기기' : '프로젝트 다시 보이기');
      toast(hidden ? `"${sessionTitle(s)}"을(를) 숨겼습니다. 아래 "숨긴 프로젝트 보기"에서 다시 볼 수 있습니다.` : `"${sessionTitle(s)}"을(를) 다시 보이게 했습니다.`);
    } catch (e) {
      toast(errorMessage(e), 'alert');
    }
  };

  return (
    <>
      <PageTitle>대시보드</PageTitle>

      <div className="mb-6">
        {creating ? (
          <CreateSessionForm onDone={() => setCreating(false)} />
        ) : (
          <Button onClick={() => setCreating(true)}>+ 새 시험 프로젝트</Button>
        )}
      </div>

      {loading && <Spinner />}
      {error && <Alert>{error}</Alert>}
      {!loading && !error && sessions.length === 0 && (
        <Card>
          <Empty icon="📝" title={hiddenCount ? '보이는 시험 프로젝트가 없습니다' : '아직 시험 프로젝트가 없습니다'}>
            {hiddenCount ? '아래 "숨긴 프로젝트 보기"로 숨긴 프로젝트를 볼 수 있습니다.' : '위의 "+ 새 시험 프로젝트"로 이번 시험을 시작하세요. 지난 학기 명단은 자동으로 이어받습니다.'}
          </Empty>
        </Card>
      )}

      {groups.map((g) => {
        const open = !folded.includes(g.key);
        return (
        <section key={g.key} className="mb-6" aria-label={g.label}>
          <h2 className="mb-2">
            <button
              type="button"
              aria-expanded={open}
              onClick={() => toggleFold(g.key)}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-2 text-lg font-bold text-muted hover:bg-bg hover:text-ink"
            >
              <span aria-hidden>{open ? '📂' : '📁'}</span>
              {g.label}
              <span className="text-sm font-normal">({g.list.length}개)</span>
              <span aria-hidden className={`text-sm transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
            </button>
          </h2>
          {open && (
          <ul className="grid gap-3 md:grid-cols-2">
            {g.list.map((s) => (
              <li key={s.id} className="relative">
                <div className="absolute top-3 right-3 z-10 flex gap-1">
                  <button
                    type="button"
                    aria-label={`${sessionTitle(s)} ${s.hidden ? '다시 보이기' : '숨기기'}`}
                    onClick={() => void hide(s, !s.hidden)}
                    className="cursor-pointer rounded-lg px-3 py-2 text-sm text-muted hover:bg-bg hover:text-ink"
                  >
                    {s.hidden ? '다시 보이기' : '숨기기'}
                  </button>
                  <button
                    type="button"
                    aria-label={`${sessionTitle(s)} 삭제`}
                    title="프로젝트 삭제"
                    onClick={() => setDeleting(s)}
                    className="cursor-pointer rounded-lg px-3 py-2 text-sm text-muted hover:bg-alert-soft hover:text-alert"
                  >
                    삭제
                  </button>
                </div>
                <Link
                  to={`/admin/sessions/${s.id}`}
                  className={`lift block rounded-card border border-line/60 bg-surface p-5 shadow-[var(--shadow-card)] hover:border-primary ${s.hidden ? 'opacity-60' : ''}`}
                >
                  <div className="text-sm text-muted">{s.schoolName}</div>
                  <div className="mt-1 pr-28 text-lg font-bold">{sessionTitle(s)}</div>
                  <div className="mt-3">
                    <StatusBadge status={s.status} />
                    {s.hidden && <span className="ml-2 text-sm text-muted">숨김</span>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          )}
        </section>
        );
      })}

      {hiddenCount > 0 && (
        <Toggle label={`숨긴 프로젝트 보기 (${hiddenCount}개)`} checked={showHidden} onChange={setShowHidden} />
      )}
      {deleting && <DeleteSessionDialog session={deleting} onClose={() => setDeleting(null)} />}
    </>
  );
}
