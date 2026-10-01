import { useMemo, useState } from 'react';
import type { AssignmentDoc, RoomDoc, SlotDoc } from '@sim/shared';
import { FullTimetable, PersonalTimetable } from '@/components/TimetableViews';
import { Alert, Button, Card, DownloadButton, Select, Spinner } from '@/components/ui';
import { useCollection } from '@/lib/data';
import { sessionTitle, termWhere, useSessionTeachers } from '@/lib/sessions';
import { downloadCalendar, downloadFullTimetable, downloadPersonalTimetable, dutiesOf, type TimetableData } from '@/lib/timetable';
import { useCurrentSession } from './SessionPage';

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
