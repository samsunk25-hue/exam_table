import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { isPublished, isSetupEditable, type AssignmentDoc, type RoomDoc, type SlotDoc } from '@sim/shared';
import { useAuth } from '@/auth/AuthProvider';
import { FullTimetable, PersonalTimetable } from '@/components/TimetableViews';
import { Alert, Button, Card, DownloadButton, PageTitle, Spinner } from '@/components/ui';
import { ExplainDutiesCard } from '@/components/AiCards';
import { TeacherSwapPanel } from '@/components/SwapRequests';
import { useCollection } from '@/lib/data';
import { sessionTitle, useMySessions, type ExamSession, termWhere, useSessionTeachers } from '@/lib/sessions';
import { downloadCalendar, downloadFullTimetable, downloadPersonalTimetable, dutiesOf, type TimetableData } from '@/lib/timetable';

/** 시험 일정이 나왔으면 불가 시간 제출로 안내 */
function AvailabilityCallout({ session }: { session: ExamSession }) {
  const slots = useCollection<SlotDoc>(`sessions/${session.id}/slots`);
  if (slots.loading || slots.data.length === 0) return null;
  const dates = [...new Set(slots.data.map((s) => s.date))].sort();
  return (
    <div className="no-print mb-6 rounded-card border-2 border-primary bg-primary-soft p-5">
      <p className="text-lg font-bold">{sessionTitle(session)} 시험 일정이 나왔습니다.</p>
      <p className="mt-1">
        시험 기간 {dates[0]} ~ {dates[dates.length - 1]} 중 출장·연수 등으로 감독할 수 없는 시간이 있으면 제출해 주세요.
      </p>
      <Link
        to="/me/availability"
        className="mt-3 inline-flex min-h-12 items-center rounded-xl bg-primary px-5 font-semibold text-white hover:bg-primary-strong"
      >
        불가 시간 제출하기
      </Link>
    </div>
  );
}

function PublishedSchedule({ session, teacherId }: { session: ExamSession; teacherId: string }) {
  const sid = session.id;
  const slots = useCollection<SlotDoc>(`sessions/${sid}/slots`);
  const rooms = useCollection<RoomDoc>('rooms', termWhere(session));
  const teachers = useSessionTeachers(session);
  const assignments = useCollection<AssignmentDoc>(`sessions/${sid}/assignments`);
  const [view, setView] = useState<'mine' | 'full'>('mine');

  const all = [slots, rooms, teachers, assignments];
  const data: TimetableData = useMemo(
    () => ({ slots: slots.data, rooms: rooms.data, teachers: teachers.data, assignments: assignments.data }),
    [slots.data, rooms.data, teachers.data, assignments.data],
  );
  if (all.some((x) => x.loading)) return <Spinner />;
  const error = all.find((x) => x.error)?.error;
  if (error) return <Alert>{error}</Alert>;

  const me = data.teachers.find((t) => t.id === teacherId);
  const duties = dutiesOf(teacherId, data);
  const title = sessionTitle(session);
  const confirmed = session.status === 'CONFIRMED' || session.status === 'LOCKED';

  return (
    <div className="grid gap-4">
      <Card className="no-print">
        <p className="text-lg font-bold">
          {title} · 감독 {duties.length}회
          <span className={`ml-2 rounded-full px-3 py-1 text-sm ${confirmed ? 'bg-mint-soft' : 'bg-primary-soft text-primary-strong'}`}>
            {confirmed ? '최종 확정' : '초안 공개 (바뀔 수 있음)'}
          </span>
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant={view === 'mine' ? 'primary' : 'secondary'} onClick={() => setView('mine')}>
            내 시간표
          </Button>
          <Button variant={view === 'full' ? 'primary' : 'secondary'} onClick={() => setView('full')}>
            전체 시간표
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {view === 'mine' ? (
            <>
              <DownloadButton onDownload={() => downloadCalendar(title, me?.name ?? '나', duties)}>휴대폰 캘린더에 추가</DownloadButton>
              <DownloadButton onDownload={() => downloadPersonalTimetable(title, me?.name ?? '나', duties)}>엑셀</DownloadButton>
            </>
          ) : (
            <DownloadButton onDownload={() => downloadFullTimetable(title, data)}>엑셀</DownloadButton>
          )}
          <Button variant="secondary" onClick={() => window.print()}>
            인쇄 / PDF 저장
          </Button>
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 text-xl font-bold">
          {view === 'mine' ? `${me?.name ?? ''} 선생님 감독 시간표` : `${title} 감독 시간표`}
        </h2>
        {view === 'mine' ? (
          <PersonalTimetable duties={duties} />
        ) : (
          <>
            <p className="no-print mb-3 text-sm text-muted">파란색이 내 감독입니다.</p>
            <FullTimetable data={data} highlight={teacherId} />
          </>
        )}
      </Card>

      <ExplainDutiesCard sessionId={sid} />

      <TeacherSwapPanel
        sid={sid}
        open={session.status === 'PUBLISHED' || session.status === 'SWAP'}
        teacherId={teacherId}
        duties={duties}
        teachers={data.teachers.map((t) => ({ id: t.id, name: t.name }))}
      />
    </div>
  );
}

export function MySchedulePage() {
  const { teacherId, term } = useAuth();
  const { data: sessions, loading, error } = useMySessions(term);
  const published = sessions.filter((s) => isPublished(s.status));
  const open = sessions.filter((s) => isSetupEditable(s.status));
  const [sid, setSid] = useState<string | null>(null);
  const current = published.find((s) => s.id === sid) ?? published[0];

  return (
    <>
      <PageTitle sub="배정된 시험 감독 일정을 확인하고 휴대폰 캘린더·엑셀로 받을 수 있습니다.">내 감독 시간표</PageTitle>
      {loading && <Spinner />}
      {error && <Alert>{error}</Alert>}
      {open[0] && <AvailabilityCallout session={open[0]} />}
      {!loading && !current && (
        <Card>
          <p className="text-muted">아직 공개된 감독 시간표가 없습니다. 관리자가 시간표를 공개하면 여기에 표시됩니다.</p>
        </Card>
      )}
      {published.length > 1 && (
        <div className="no-print mb-4 flex flex-wrap gap-2">
          {published.map((s) => (
            <Button key={s.id} variant={s.id === current?.id ? 'primary' : 'secondary'} onClick={() => setSid(s.id)}>
              {sessionTitle(s)}
            </Button>
          ))}
        </div>
      )}
      {current && teacherId && <PublishedSchedule key={current.id} session={current} teacherId={teacherId} />}
    </>
  );
}
