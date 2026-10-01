import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { nextId, sessionTerm, termFields, type AccessRequestDoc } from '@sim/shared';
import { db, requireAdmin, serverTimestamp } from './common';
import { refreshUserRole } from './admins';

/**
 * 가입·관리자 권한 신청 승인/반려.
 * - 교사 신청 승인: 교사 명단에 이메일로 등록(이미 있으면 사용으로 바꿈)
 * - 관리자 신청 승인: 관리자 목록에 추가
 * 승인하면 신청자의 역할(Custom Claims)을 바로 다시 계산해, 신청 화면이 자동으로 앱으로 들어간다.
 */
export const reviewAccessRequest = onCall(async (req) => {
  const reviewer = requireAdmin(req);
  const { uid, approve, note } = (req.data ?? {}) as { uid?: unknown; approve?: unknown; note?: unknown };
  if (typeof uid !== 'string' || typeof approve !== 'boolean') throw new HttpsError('invalid-argument', '신청 ID와 승인 여부가 필요합니다.');

  const ref = db().doc(`accessRequests/${uid}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', '신청을 찾을 수 없습니다.');
  const r = snap.data() as AccessRequestDoc;
  if (r.status !== 'PENDING') throw new HttpsError('failed-precondition', '이미 처리된 신청입니다.');

  if (!approve) {
    await ref.update({ status: 'REJECTED', note: typeof note === 'string' && note.trim() ? note.trim() : null, reviewedBy: reviewer, reviewedAt: serverTimestamp() });
    return { status: 'REJECTED' };
  }

  if (r.kind === 'TEACHER') {
    // 가장 최근 시험 프로젝트의 학교·학기 명단에 넣는다
    const [teachers, latest] = await Promise.all([
      db().collection('teachers').get(),
      db().collection('sessions').orderBy('createdAt', 'desc').limit(1).get(),
    ]);
    const s = latest.docs[0];
    const term = s ? termFields(sessionTerm({ schoolName: s.get('schoolName') as string, year: s.get('year') as number, semester: s.get('semester') as number })) : {};
    const existing = teachers.docs.find((d) => d.get('email') === r.email && (!s || d.get('term') === (term as { term?: string }).term));
    if (existing) {
      await existing.ref.set({ active: true, updatedBy: reviewer, updatedAt: serverTimestamp() }, { merge: true });
    } else {
      const [id] = nextId('T', teachers.docs.map((d) => d.id));
      await db().doc(`teachers/${id}`).set({
        name: r.name,
        email: r.email,
        subject: r.subject,
        homeroom: null,
        defaultRole: 'NORMAL',
        active: true,
        cumulativeLoad: 0,
        ...term,
        updatedBy: reviewer,
        updatedAt: serverTimestamp(),
      });
    }
  } else {
    await db().doc(`admins/${r.email}`).set({ email: r.email, bootstrap: false, updatedBy: reviewer, createdAt: serverTimestamp() }, { merge: true });
  }

  await refreshUserRole(r.email);
  await ref.update({ status: 'APPROVED', note: null, reviewedBy: reviewer, reviewedAt: serverTimestamp() });
  return { status: 'APPROVED' };
});
