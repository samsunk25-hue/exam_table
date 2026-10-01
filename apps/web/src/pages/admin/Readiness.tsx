import { checkSchedule, type BaseTimetableDoc, type RoomDoc, type SetupIssue, type SlotDoc, type TeacherDoc, type WithId } from '@sim/shared';
import { Alert, Card } from '@/components/ui';
import type { ExamSession } from '@/lib/sessions';

type Slot = WithId<SlotDoc>;
type Room = WithId<RoomDoc>;
type Teacher = WithId<TeacherDoc>;

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
  if (active.length === 0) issues.unshift({ level: 'error', message: '감독 가능한 교사가 없습니다 (교사 관리).' });
  if (rooms.length === 0) issues.unshift({ level: 'error', message: '등록된 시험실이 없습니다 (시험실 관리).' });
  if (session.settings.useBaseTimetable && timetable.length === 0) {
    issues.push({ level: 'warning', message: '기초시간표 반영이 켜져 있지만 기초시간표가 없습니다.' });
  }

  // 교시별 필요 감독 수 vs 가용 교사 수 (불가시간 반영 전 개략치)
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const need = new Map<string, number>();
  for (const s of slots) {
    const key = `${s.date} ${s.period}교시`;
    const n = s.rooms.reduce((sum, p) => {
      const r = roomById.get(p.roomId);
      return sum + (r ? r.chiefCount + r.assistantCount : 0);
    }, 0);
    need.set(key, (need.get(key) ?? 0) + n);
  }
  const peak = [...need.entries()].sort((a, b) => b[1] - a[1])[0];
  if (peak && peak[1] > active.length) {
    issues.push({ level: 'error', message: `${peak[0]}에 감독 ${peak[1]}명이 필요하지만 감독 가능한 교사는 ${active.length}명입니다.` });
  }

  const errors = issues.filter((i) => i.level === 'error');
  const placements = slots.reduce((n, s) => n + s.rooms.length, 0);

  return (
    <Card>
      <h2 className="text-lg font-bold">기초 자료 점검</h2>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ['감독 가능 교사', `${active.length}명`],
          ['시험실', `${rooms.length}개`],
          ['시험', `${slots.length}건`],
          ['시험실 배치', `${placements}건`],
          ['최대 동시 감독', peak ? `${peak[1]}명` : '-'],
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
              {issues.slice(0, 12).map((i) => (
                <li key={i.message}>
                  {i.level === 'warning' && '(주의) '}
                  {i.message}
                </li>
              ))}
              {issues.length > 12 && <li>외 {issues.length - 12}건</li>}
            </ul>
            {errors.length > 0 && (
              <p className="mt-2 font-semibold">
                → 아래 "통합 양식 다운로드"로 현재 자료를 내려받아 고친 뒤 "통합 양식 업로드"로 다시 올리세요. 몇 건만 고칠 때는 "기본 설정" 탭에서 직접
                수정해도 됩니다.
              </p>
            )}
          </Alert>
        )}
      </div>
    </Card>
  );
}

