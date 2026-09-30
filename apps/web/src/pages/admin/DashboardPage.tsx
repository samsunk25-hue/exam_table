import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { StatusBadge } from '@/components/StatusStepper';
import { Alert, Button, Card, Field, PageTitle, Spinner, Toggle } from '@/components/ui';
import { errorMessage } from '@/lib/firebase';
import { createSession, sessionTitle, useSessions } from '@/lib/sessions';

function currentSchoolYear(): number {
  const now = new Date();
  return now.getMonth() < 2 ? now.getFullYear() - 1 : now.getFullYear();
}

function CreateSessionForm({ onDone }: { onDone: () => void }) {
  const navigate = useNavigate();
  const [schoolName, setSchoolName] = useState('');
  const [year, setYear] = useState(currentSchoolYear());
  const [semester, setSemester] = useState(new Date().getMonth() >= 7 ? 2 : 1);
  const [examName, setExamName] = useState('');
  const [useBaseTimetable, setUseBaseTimetable] = useState(true);
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
  const { data: sessions, loading, error } = useSessions();
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageTitle sub="진행 중인 시험 프로젝트를 선택하거나 새로 만드세요.">대시보드</PageTitle>

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
          <li key={s.id}>
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
    </>
  );
}
