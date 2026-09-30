import { defineString } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { adminAuth, db, serverTimestamp } from './common';
import { claimsFor, parseEmails, resolveRole, type UserRole } from './roles';

// 최초(기본) 관리자. 앱에서 추가한 관리자는 admins 컬렉션에 저장된다.
const ADMIN_EMAILS = defineString('ADMIN_EMAILS', { default: '' });

export function bootstrapAdmins(): string[] {
  return parseEmails(ADMIN_EMAILS.value());
}

/** 이메일로 역할과 교사 ID를 판정한다. 기본 관리자는 admins 컬렉션에도 등록해 목록에 보이게 한다. */
export async function lookupRole(email: string): Promise<{ role: UserRole; teacherId: string | null }> {
  const firestore = db();
  const isBootstrap = bootstrapAdmins().includes(email);
  const [teacherSnap, adminSnap] = await Promise.all([
    firestore.collection('teachers').where('email', '==', email).where('active', '==', true).limit(1).get(),
    firestore.doc(`admins/${email}`).get(),
  ]);

  if (isBootstrap && !adminSnap.exists) {
    await firestore.doc(`admins/${email}`).set({
      email,
      bootstrap: true,
      updatedBy: 'system',
      createdAt: serverTimestamp(),
    });
  }

  const teacherId = teacherSnap.docs[0]?.id ?? null;
  return { role: resolveRole(isBootstrap || adminSnap.exists, teacherId), teacherId };
}

/** Custom Claims가 판정 결과와 다르면 갱신한다. 갱신했으면 true. */
export async function applyClaims(
  uid: string,
  current: Record<string, unknown>,
  role: UserRole,
  teacherId: string | null,
): Promise<boolean> {
  const changed = (current.role ?? 'NONE') !== role || (current.teacherId ?? null) !== teacherId;
  if (changed) await adminAuth().setCustomUserClaims(uid, claimsFor(role, teacherId));
  return changed;
}

/**
 * 로그인 직후 클라이언트가 호출한다. 이메일로 역할을 판정해 Custom Claims와 users 문서를 맞춘다.
 * refreshed가 true면 클라이언트는 ID 토큰을 강제로 갱신해야 새 역할이 반영된다.
 */
export const syncProfile = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  const { uid, token } = req.auth;
  const email = (token.email ?? '').toLowerCase();
  if (!email || token.email_verified !== true) {
    throw new HttpsError('permission-denied', '이메일이 확인된 Google 계정으로 로그인해 주세요.');
  }

  const { role, teacherId } = await lookupRole(email);
  const refreshed = await applyClaims(uid, token, role, teacherId);

  await db()
    .doc(`users/${uid}`)
    .set(
      {
        email,
        name: token.name ?? null,
        role,
        teacherId,
        active: role !== 'NONE',
        lastLoginAt: serverTimestamp(),
      },
      { merge: true },
    );

  return { role, teacherId, refreshed };
});
