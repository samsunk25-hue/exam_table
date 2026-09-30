import { getAuth, type UserRecord } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { applyClaims, lookupRole } from './auth';
import { db, requireAdmin } from './common';
import { normalizeEmail } from './roles';

async function findUser(email: string): Promise<UserRecord | null> {
  try {
    return await getAuth().getUserByEmail(email);
  } catch (e) {
    if ((e as { code?: string }).code === 'auth/user-not-found') return null;
    throw e;
  }
}

/** 이미 가입한 사용자면 역할을 즉시 다시 계산한다. 아직 로그인 전이면 첫 로그인 때 반영된다. */
async function refreshUserRole(email: string): Promise<UserRecord | null> {
  const user = await findUser(email);
  if (!user) return null;
  const { role, teacherId } = await lookupRole(email);
  await applyClaims(user.uid, user.customClaims ?? {}, role, teacherId);
  await db().doc(`users/${user.uid}`).set({ role, teacherId, active: role !== 'NONE' }, { merge: true });
  return user;
}

function emailArg(data: unknown): string {
  const email = normalizeEmail((data as { email?: unknown } | null)?.email);
  if (!email) throw new HttpsError('invalid-argument', '올바른 이메일 주소를 입력해 주세요.');
  return email;
}

export const addAdmin = onCall(async (req) => {
  const uid = requireAdmin(req);
  const email = emailArg(req.data);
  const ref = db().doc(`admins/${email}`);

  await db().runTransaction(async (tx) => {
    if ((await tx.get(ref)).exists) throw new HttpsError('already-exists', '이미 관리자입니다.');
    tx.set(ref, { email, bootstrap: false, updatedBy: uid, createdAt: FieldValue.serverTimestamp() });
  });

  const user = await refreshUserRole(email);
  return { email, applied: user !== null };
});

export const removeAdmin = onCall(async (req) => {
  const uid = requireAdmin(req);
  const email = emailArg(req.data);
  if (email === (req.auth?.token.email ?? '').toLowerCase()) {
    throw new HttpsError('failed-precondition', '본인의 관리자 권한은 제거할 수 없습니다. 다른 관리자에게 요청하세요.');
  }

  const ref = db().doc(`admins/${email}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', '관리자 목록에 없는 이메일입니다.');
  if (snap.get('bootstrap') === true) {
    throw new HttpsError('failed-precondition', '기본 관리자는 서버 설정(ADMIN_EMAILS)에서만 제거할 수 있습니다.');
  }

  // 삭제 직전에 행위자를 남겨 감사 로그의 lastEditor로 기록되게 한다.
  await ref.update({ updatedBy: uid, updatedAt: FieldValue.serverTimestamp() });
  await ref.delete();

  const user = await refreshUserRole(email);
  // 기존 로그인 세션을 끊어 권한 회수를 앞당긴다 (이미 발급된 토큰은 최대 1시간 유효).
  if (user) await getAuth().revokeRefreshTokens(user.uid);
  return { email };
});
