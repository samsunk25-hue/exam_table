// 감독 10분 전 알림: 어떤 감독에게 무엇을 보낼지 정한다 (Firestore에 의존하지 않는 순수 함수)
import { seatTimeRange } from '@sim/engine';
import { SEAT_ROLE_LABEL, type AssignmentDoc, type RoomDoc, type SlotDoc, type WithId } from '@sim/shared';

/** 시작 몇 분 전부터 보내는지 */
export const REMIND_BEFORE_MIN = 10;

export interface Reminder {
  /** 알림 문서 ID (같은 감독에 한 번만 보내도록) */
  id: string;
  teacherId: string;
  title: string;
  body: string;
}

const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

/** 한국 시간 기준 오늘 날짜(YYYY-MM-DD)와 자정부터 지난 분 */
export function kstNow(now: Date): { date: string; minute: number } {
  const k = new Date(now.getTime() + 9 * 3600_000);
  return { date: k.toISOString().slice(0, 10), minute: k.getUTCHours() * 60 + k.getUTCMinutes() };
}

/**
 * 지금부터 10분 안에 시작하는 감독. 시작 시각은 시험실 별도 시간이 있으면 그것(별도시험장은 교시별로 나뉜 시간), 없으면 시험 시각.
 * 시각이 없는 시험은 보내지 않는다. 학생 안내사항은 관리자가 적은 경우에만 붙인다.
 */
export function planReminders(opts: {
  sessionId: string;
  now: { date: string; minute: number };
  slots: WithId<SlotDoc>[];
  assignments: WithId<AssignmentDoc>[];
  rooms: Map<string, Pick<RoomDoc, 'name'>>;
  studentNotice?: string | null;
}): Reminder[] {
  const { sessionId, now, slots, assignments, rooms } = opts;
  const notice = opts.studentNotice?.trim();
  const slotById = new Map(slots.map((s) => [s.id, s]));
  const out: Reminder[] = [];
  for (const a of assignments) {
    if (a.date !== now.date) continue;
    const slot = slotById.get(a.slotId);
    if (!slot) continue;
    const place = slot.rooms.find((p) => p.roomId === a.roomId);
    const own = place ? seatTimeRange(slots, slot, place, a.period) : null;
    const start = own?.start ?? slot.startTime;
    const end = own?.end ?? slot.endTime;
    if (!start) continue;
    const left = toMin(start) - now.minute;
    if (left <= 0 || left > REMIND_BEFORE_MIN) continue;
    const room = rooms.get(a.roomId)?.name ?? '';
    const role = SEAT_ROLE_LABEL[a.role];
    const md = `${Number(a.date.slice(5, 7))}/${Number(a.date.slice(8, 10))}`;
    out.push({
      id: `remind_${sessionId}_${a.id}`.replace(/\//g, '_'),
      teacherId: a.teacherId,
      title: `${left}분 뒤 감독: ${a.period}교시 ${room} ${role}`,
      body: [
        `${md} ${start}${end ? `~${end}` : ''} · ${slot.grade}학년 ${slot.type === 'STUDY' ? '자습' : slot.subject} · ${room} ${role}`,
        ...(notice ? [`학생 안내: ${notice}`] : []),
      ].join('\n'),
    });
  }
  return out;
}
