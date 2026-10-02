// 감독 10분 전 앱 알림(🔔): 1분마다 교사 공개 이후 시험의 오늘 감독을 보고, 10분 안에 시작하는 감독에게 한 번 보낸다
import { onSchedule } from 'firebase-functions/v2/scheduler';
import type { AssignmentDoc, RoomDoc, SlotDoc, WithId } from '@sim/shared';
import { db, serverTimestamp } from './common';
import { kstNow, planReminders } from './reminderPlan';

const OPEN = ['PUBLISHED', 'SWAP', 'CONFIRMED', 'LOCKED'];
const withIds = <T>(snap: { docs: { id: string; data: () => unknown }[] }) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as T) }));

/** now 기준으로 보낼 알림을 만들고 보낸 수를 돌려준다 (에뮬레이터 점검에서도 직접 부른다) */
export async function sendDueReminders(now: Date): Promise<number> {
  const today = kstNow(now);
  const sessions = await db().collection('sessions').where('status', 'in', OPEN).get();
  let sent = 0;
  for (const s of sessions.docs) {
    const [slotSnap, assignSnap] = await Promise.all([
      db().collection(`sessions/${s.id}/slots`).where('date', '==', today.date).get(),
      db().collection(`sessions/${s.id}/assignments`).where('date', '==', today.date).get(),
    ]);
    if (slotSnap.empty || assignSnap.empty) continue;
    const slots = withIds<SlotDoc>(slotSnap);
    const assignments = withIds<AssignmentDoc>(assignSnap);
    const roomIds = [...new Set(assignments.map((a) => a.roomId))];
    const roomDocs = roomIds.length ? await db().getAll(...roomIds.map((id) => db().doc(`rooms/${id}`))) : [];
    const rooms = new Map(roomDocs.filter((d) => d.exists).map((d) => [d.id, d.data() as WithId<RoomDoc>]));
    const due = planReminders({ sessionId: s.id, now: today, slots, assignments, rooms, studentNotice: s.get('studentNotice') as string | undefined });
    for (const r of due) {
      try {
        // 같은 감독에는 한 번만 (문서가 이미 있으면 건너뜀)
        await db().doc(`notifications/${r.id}`).create({
          audience: 'TEACHER',
          teacherId: r.teacherId,
          sessionId: s.id,
          title: r.title,
          body: r.body,
          link: '/me',
          read: false,
          createdAt: serverTimestamp(),
        });
        sent++;
      } catch (e) {
        if ((e as { code?: number }).code !== 6) throw e; // 6 = ALREADY_EXISTS
      }
    }
  }
  return sent;
}

export const remindDuties = onSchedule({ schedule: 'every 1 minutes', timeZone: 'Asia/Seoul', timeoutSeconds: 120 }, async () => {
  await sendDueReminders(new Date());
});
