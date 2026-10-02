import { useMemo, useState } from 'react';
import type { AssignmentDoc, RoomDoc, SlotDoc } from '@sim/shared';
import { FullTimetable, PersonalTimetable } from '@/components/TimetableViews';
import { toast } from '@/components/Toast';
import { Alert, Button, Card, CardTitle, DownloadButton, Select, Spinner } from '@/components/ui';
import { useCollection } from '@/lib/data';
import { errorMessage } from '@/lib/firebase';
import { sessionTitle, termWhere, updateStudentNotice, useSessionTeachers, type ExamSession } from '@/lib/sessions';
import { downloadCalendar, downloadFullTimetable, downloadPersonalTimetable, dutiesOf, type TimetableData } from '@/lib/timetable';
import { useCurrentSession } from './SessionPage';

/** 감독 10분 전 앱 알림(🔔)과 거기에 붙일 학생 안내사항 (적었을 때만 붙는다) */
function ReminderCard({ session }: { session: ExamSession }) {
  const [text, setText] = useState(session.studentNotice ?? '');
  const [busy, setBusy] = useState(false);
  const changed = text.trim() !== (session.studentNotice ?? '');
  const save = async () => {
    setBusy(true);
    try {
      await updateStudentNotice(session.id, text);
      toast(text.trim() ? '학생 안내사항을 저장했습니다. 다음 감독 알림부터 붙습니다.' : '학생 안내사항을 비웠습니다.');
    } catch (e) {
      toast(errorMessage(e), 'alert');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="no-print">
      <CardTitle icon="🔔">감독 10분 전 알림</CardTitle>
      <p className="mt-1 text-muted">
        교사에게 공개한 뒤에는 감독 시작 10분 전에 그 교사의 앱 알림(🔔)으로 교시·학년반·정감독/부감독/복도를 알려 줍니다. 아래 학생 안내사항을 적으면 알림에 함께 붙습니다.
      </p>
      <label className="mt-3 flex flex-col gap-1.5">
        <span className="font-semibold">
          학생 안내사항 <span className="font-normal text-muted">(선택)</span>
        </span>
        <textarea
          aria-label="학생 안내사항"
          rows={3}
          maxLength={500}
          className="rounded-xl border border-line p-3"
          placeholder="예) 휴대폰은 전원을 끄고 가방에 넣게 해 주세요. 답안지 마킹은 컴퓨터용 사인펜으로."
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <Button className="mt-2" onClick={() => void save()} disabled={busy || !changed}>
        {busy ? '저장 중…' : '저장'}
      </Button>
    </Card>
  );
}

/** 출력: 최종(전체) 시간표와 교사별 개인 시간표 — 엑셀·캘린더·인쇄(PDF) */
export function SessionPrintPage() {
  const session = useCurrentSession();
  const sid = session.id;
  const slots = useCollection<SlotDoc>(`sessions/${sid}/slots`);
  const rooms = useCollection<RoomDoc>('rooms', termWhere(session));
  const teachers = useSessionTeachers(session);
  const assignments = useCollection<AssignmentDoc>(`sessions/${sid}/assignments`);
  const [view, setView] = useState<'full' | 'personal'>('full');
  const [teacherId, setTeacherId] = useState('');

  const all = [slots, rooms, teachers, assignments];
  const data: TimetableData = useMemo(
    () => ({ slots: slots.data, rooms: rooms.data, teachers: teachers.data, assignments: assignments.data }),
    [slots.data, rooms.data, teachers.data, assignments.data],
  );
  if (all.some((x) => x.loading)) return <Spinner />;
  const error = all.find((x) => x.error)?.error;
  if (error) return <Alert>{error}</Alert>;

  const title = sessionTitle(session);
  const assigned = [...new Set(data.assignments.map((a) => a.teacherId))];
  const people = data.teachers.filter((t) => assigned.includes(t.id)).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const teacher = people.find((t) => t.id === teacherId) ?? people[0];
  const duties = teacher ? dutiesOf(teacher.id, data) : [];

  if (data.assignments.length === 0) {
    return (
      <Card>
        <p className="text-muted">아직 배정 결과가 없습니다. "자동 배정"에서 배정을 적용한 뒤 출력하세요.</p>
      </Card>
    );
  }

  return (
    <div className="grid gap-6">
      <ReminderCard session={session} />
      <Card className="no-print">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant={view === 'full' ? 'primary' : 'secondary'} onClick={() => setView('full')}>
            최종 시간표 (전체)
          </Button>
          <Button variant={view === 'personal' ? 'primary' : 'secondary'} onClick={() => setView('personal')}>
            개인 시간표
          </Button>
          <span className="mx-2 hidden h-8 w-px bg-line sm:block" />
          {view === 'full' ? (
            <DownloadButton onDownload={() => downloadFullTimetable(title, data)}>엑셀 (날짜별 + 교사별)</DownloadButton>
          ) : (
            teacher && (
              <>
                <DownloadButton onDownload={() => downloadPersonalTimetable(title, teacher.name, duties)}>엑셀</DownloadButton>
                <DownloadButton onDownload={() => downloadCalendar(title, teacher.name, duties)}>캘린더 (.ics)</DownloadButton>
              </>
            )
          )}
          <Button variant="secondary" onClick={() => window.print()}>
            인쇄 / PDF 저장
          </Button>
        </div>
        {view === 'personal' && (
          <div className="mt-4 max-w-sm">
            <Select
              label="교사"
              value={teacher?.id ?? ''}
              onChange={(e) => setTeacherId(e.target.value)}
              options={people.map((t) => ({ value: t.id, label: t.name }))}
            />
          </div>
        )}
        {session.status !== 'CONFIRMED' && session.status !== 'LOCKED' && (
          <p className="mt-3 text-sm text-muted">아직 최종 확정 전이라 인쇄물 제목에 "확정 전"이 붙습니다. 교사는 공개되면 앱에서 바로 보므로, 종이는 확정 후 한 번만 인쇄하면 됩니다.</p>
        )}
      </Card>

      <Card>
        <h2 className="mb-4 text-xl font-bold">
          {title} · {view === 'full' ? '시험 감독 시간표' : `${teacher?.name ?? ''} 선생님 감독 시간표`}
          {session.status !== 'CONFIRMED' && session.status !== 'LOCKED' && <span className="ml-2 rounded-full border border-alert px-2 text-base text-alert">확정 전</span>}
        </h2>
        {view === 'full' ? <FullTimetable data={data} /> : <PersonalTimetable duties={duties} />}
      </Card>
    </div>
  );
}
