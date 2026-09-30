import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';

export const db = () => getFirestore();

export function requireAdmin(req: CallableRequest): string {
  if (!req.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  if (req.auth.token.role !== 'ADMIN') throw new HttpsError('permission-denied', '관리자만 사용할 수 있습니다.');
  return req.auth.uid;
}
