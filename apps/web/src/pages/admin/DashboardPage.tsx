import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Modal } from '@/components/Modal';
import { StatusBadge } from '@/components/StatusStepper';
import { toast } from '@/components/Toast';
import { Alert, Button, Card, Field, PageTitle, Spinner, Toggle } from '@/components/ui';
import { callDeleteSession, errorMessage } from '@/lib/firebase';
import { createSession, sessionTitle, useSessions, type ExamSession } from '@/lib/sessions';
import { commitOps, useCollection } from '@/lib/data';
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
  const [useBaseTimetable, setUseBaseTimetable] = useState(true);
  // 같은 학교 지난 학기 교사·시험실을 이어받기 (기본 켜짐)
  const [carryRoster, setCarryRoster] = useState(true);
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
        settings: { useBaseTimetable },
      });
      if (carryRoster && prev) {
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
        <div className="md:col-span-2">
          <Toggle
            label="기초시간표 반영"
            hint="켜면 시험 시간에 해당 반을 원래 가르치던 교사에게 가점(+50)을 줍니다. 끄면 기초시간표 업로드가 필요 없습니다."
            checked={useBaseTimetable}
            onChange={setUseBaseTimetable}
          />
        </div>
        {prev && (
          <label className="flex min-h-12 cursor-pointer items-start gap-3 rounded-xl bg-bg p-3 md:col-span-2">
            <input type="checkbox" className="mt-1 size-5 accent-primary" checked={carryRoster} onChange={(e) => setCarryRoster(e.target.checked)} />
            <span>
              <span className="font-semibold">지난 학기 명단 이어받기 — {termLabel(prev.term)}</span>
              <span className="block text-sm text-muted">
                교사 {prevTeachers?.docs.length ?? 0}명 · 시험실 {prevRooms?.docs.length ?? 0}개를 이 학기로 가져옵니다.
                {prev.term.year === year ? ' 같은 학년도라 누적 업무점수를 이어받습니다.' : ' 새 학년도라 누적 점수는 0점, 담임은 비웁니다.'} 일부만 바꾸려면 나중에 교사 관리에서 고치세요.
              </span>
            </span>
          </label>
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

export function DashboardPage() {
  const { data: all, loading, error } = useSessions();
  const choice = useTerm();
  const [showAll, setShowAll] = useState(false);
  const sessions = showAll || !choice.key ? all : all.filter((s) => termKey(sessionTerm(s)) === choice.key);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<SessionItem | null>(null);

  return (
    <>
      <PageTitle sub={choice.current && !showAll ? `${termLabel(choice.current)} 시험 프로젝트 (학교·학기는 오른쪽 위에서 바꿉니다)` : '모든 학교·학기의 시험 프로젝트'}>대시보드</PageTitle>
      {choice.key && (
        <div className="mb-4">
          <Toggle label="모든 학교·학기 프로젝트 보기" checked={showAll} onChange={setShowAll} />
        </div>
      )}

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
          <p className="text-muted">아직 시험 프로젝트가 없습니다.</p>
        </Card>
      )}

      <ul className="grid gap-3 md:grid-cols-2">
        {sessions.map((s) => (
          <li key={s.id} className="relative">
            <button
              type="button"
              aria-label={`${sessionTitle(s)} 삭제`}
              title="프로젝트 삭제"
              onClick={() => setDeleting(s)}
              className="absolute top-3 right-3 z-10 cursor-pointer rounded-lg px-3 py-2 text-sm text-muted hover:bg-alert-soft hover:text-alert"
            >
              삭제
            </button>
            <Link
              to={`/admin/sessions/${s.id}`}
              className="block rounded-card border border-line bg-surface p-5 shadow-sm transition-colors hover:border-primary"
            >
              <div className="text-sm text-muted">{s.schoolName}</div>
              <div className="mt-1 text-lg font-bold">{sessionTitle(s)}</div>
              <div className="mt-3">
                <StatusBadge status={s.status} />
              </div>
            </Link>
          </li>
        ))}
      </ul>
      {deleting && <DeleteSessionDialog session={deleting} onClose={() => setDeleting(null)} />}
    </>
  );
}
