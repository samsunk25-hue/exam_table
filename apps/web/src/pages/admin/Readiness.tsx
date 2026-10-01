import { checkSchedule, type BaseTimetableDoc, type RoomDoc, type SetupIssue, type SlotDoc, type TeacherDoc, type WithId } from '@sim/shared';
import { Link } from 'react-router';
import { Alert, Card, CardTitle } from '@/components/ui';
import type { ExamSession } from '@/lib/sessions';

type Slot = WithId<SlotDoc>;
type Room = WithId<RoomDoc>;
type Teacher = WithId<TeacherDoc>;

/** 문제마다 고칠 수 있는 화면 (프로젝트 안 탭) */
function fixPage(message: string): { to: string; label: string } {
  if (message.includes('기초시간표')) return { to: '', label: '배정 설정에서 올리기' };
  if (message.includes('교사')) return { to: 'teachers', label: '교사 명단에서 고치기' };
  if (message.includes('등록된 시험실') || message.includes('필요한 감독 수')) return { to: 'rooms', label: '시험실에서 고치기' };
  return { to: 'schedule', label: '시험 일정에서 고치기' };
}

/** 기초 자료 점검: 자동 배정 전에 고쳐야 할 문제와 주의 사항 (개요 탭) */
export function Readiness({ session, slots, rooms, teachers, timetable }: {
  session: ExamSession;
  slots: Slot[];
  rooms: Room[];
  teachers: Teacher[];
  timetable: WithId<BaseTimetableDoc>[];
}) {
  const issues: SetupIssue[] = [...checkSchedule(slots, rooms)];
  const active = teachers.filter((t) => t.active && t.defaultRole !== 'EXCLUDED');
  if (active.length === 0) issues.unshift({ level: 'error', message: '감독 가능한 교사가 없습니다.' });
  if (rooms.length === 0) issues.unshift({ level: 'error', message: '등록된 시험실이 없습니다.' });
  // 시간대별 감독 인원이 모자라는지는 불가시간까지 넣어 ① 불가시간 탭 "시간대별 인력 현황" 한 곳에서 본다

  const errors = issues.filter((i) => i.level === 'error');
  const placements = slots.reduce((n, s) => n + s.rooms.length, 0);

  return (
    <Card>
      <CardTitle icon="✅">기초 자료 점검</CardTitle>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['감독 가능 교사', `${active.length}명`],
          ['시험실', `${rooms.length}개`],
          ['시험', `${slots.length}건`],
          ['시험실 배치', `${placements}건`],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl bg-bg px-3 py-2">
            <dt className="text-sm text-muted">{k}</dt>
            <dd className="text-lg font-bold">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4">
        {issues.length === 0 ? (
          <Alert tone="info">✓ 자동 배정을 실행할 준비가 되었습니다.</Alert>
        ) : (
          <Alert tone={errors.length ? 'alert' : 'info'}>
            <p className="font-semibold">
              {errors.length ? `해결해야 할 문제 ${errors.length}건` : '확인이 필요한 항목'}
            </p>
            <ul className="mt-1 list-disc pl-5">
              {issues.slice(0, 12).map((i) => {
                const fix = fixPage(i.message);
                return (
                  <li key={i.message}>
                    {i.level === 'warning' && '(주의) '}
                    {i.message}{' '}
                    <Link to={`/admin/sessions/${session.id}${fix.to ? `/${fix.to}` : ''}`} className="font-semibold whitespace-nowrap text-primary-strong underline underline-offset-2">
                      {fix.label} →
                    </Link>
                  </li>
                );
              })}
              {issues.length > 12 && <li>외 {issues.length - 12}건</li>}
            </ul>
            {errors.length > 0 && (
              <p className="mt-2 font-semibold">
                → 각 항목의 링크를 누르면 고칠 화면으로 갑니다. 많이 고칠 때는 위 "통합 양식 다운로드"로 내려받아 고친 뒤 다시 올려도 됩니다.
              </p>
            )}
          </Alert>
        )}
      </div>
    </Card>
  );
}

