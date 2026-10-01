// 앱 알림: notifications/{id}. 교사 알림은 교사마다 한 건(read), 관리자 알림은 관리자 공용(readBy).
// 알림은 함수만 만들고, 사용자는 읽음 표시만 바꿀 수 있다.
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { db, serverTimestamp } from './common';

export interface Note {
  sessionId?: string | null;
  title: string;
  body: string;
  /** 누르면 이동할 앱 주소 */
  link: string;
}

/** 교사들에게 알림 (같은 교사 중복 제거) */
export async function notifyTeachers(teacherIds: Iterable<string>, note: Note | ((teacherId: string) => Note)) {
  const ids = [...new Set(teacherIds)].filter(Boolean);
  for (let i = 0; i < ids.length; i += 400) {
    const batch = db().batch();
    for (const teacherId of ids.slice(i, i + 400)) {
      const n = typeof note === 'function' ? note(teacherId) : note;
      batch.set(db().collection('notifications').doc(), {
        audience: 'TEACHER',
        teacherId,
        sessionId: n.sessionId ?? null,
        title: n.title,
        body: n.body,
        link: n.link,
        read: false,
        createdAt: serverTimestamp(),
      });
    }
    await batch.commit();
  }
}

/** 관리자 알림. key를 주면 같은 key의 알림 하나에 모아 건수를 올린다 (예: 같은 교사의 불가시간 신청) */
export async function notifyAdmins(note: Note & { key?: string; countLabel?: (n: number) => string }) {
  const col = db().collection('notifications');
  const base = { audience: 'ADMIN', teacherId: null, sessionId: note.sessionId ?? null, title: note.title, link: note.link, readBy: [], createdAt: serverTimestamp() };
  if (!note.key) {
    await col.add({ ...base, body: note.body });
    return;
  }
  const ref = col.doc(`admin_${note.key}`.replace(/\//g, '_'));
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    // 아직 아무도 안 읽었으면 건수만 올리고, 읽은 뒤라면 1부터 다시
    const fresh = !snap.exists || ((snap.get('readBy') as string[] | undefined)?.length ?? 0) > 0;
    const count = fresh ? 1 : ((snap.get('count') as number | undefined) ?? 1) + 1;
    tx.set(ref, { ...base, count, body: note.countLabel ? note.countLabel(count) : note.body });
  });
}

/**
 * 불가시간: 교사가 신청하면 관리자에게(교사별로 모아서), 관리자가 승인·반려하면 그 교사에게.
 * 화면은 클라이언트가 직접 쓰므로 문서 변경을 보고 알린다.
 */
export const notifyAvailability = onDocumentWritten('sessions/{sid}/availability/{id}', async (event) => {
  const sid = event.params.sid;
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!after) return;
  const session = await db().doc(`sessions/${sid}`).get();
  if (!session.exists || session.get('deleting')) return;
  const exam = session.get('examName') as string;
  const when = `${Number(String(after.date).slice(5, 7))}/${Number(String(after.date).slice(8, 10))} ${after.period}교시`;

  if (!before && after.source === 'TEACHER' && after.status === 'PENDING') {
    const t = await db().doc(`teachers/${after.teacherId as string}`).get();
    const name = (t.get('name') as string | undefined) ?? '교사';
    await notifyAdmins({
      key: `avail_${sid}_${after.teacherId as string}`,
      sessionId: sid,
      title: '불가시간 신청',
      body: `${name} 선생님이 불가시간을 신청했습니다.`,
      countLabel: (n) => `${name} 선생님이 불가시간 ${n}건을 신청했습니다 (${exam}).`,
      link: `/admin/sessions/${sid}/availability`,
    });
    return;
  }
  if (before && before.status !== after.status && after.source === 'TEACHER' && (after.status === 'APPROVED' || after.status === 'REJECTED')) {
    await notifyTeachers([after.teacherId as string], {
      sessionId: sid,
      title: after.status === 'APPROVED' ? '불가시간 승인' : '불가시간 반려',
      body: `${exam} ${when} 불가시간이 ${after.status === 'APPROVED' ? '승인' : '반려'}되었습니다.${after.adminNote ? ` (${after.adminNote as string})` : ''}`,
      link: '/me/availability',
    });
  }
});

/** 가입·관리자 권한 신청 → 관리자에게 */
export const notifyAccessRequest = onDocumentWritten('accessRequests/{uid}', async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!after || after.status !== 'PENDING' || before?.status === 'PENDING') return;
  await notifyAdmins({
    title: after.kind === 'ADMIN' ? '관리자 권한 신청' : '가입 신청',
    body: `${after.name as string} (${after.email as string}) 님이 ${after.kind === 'ADMIN' ? '관리자 권한' : '교사 가입'}을 신청했습니다.`,
    link: '/admin/admins',
  });
});
