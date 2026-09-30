import type * as AdminAuth from 'firebase-admin/auth';
import type * as AdminFirestore from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';

// firebase-admin의 Firestore·Auth 모듈은 불러오는 데 수 초가 걸린다.
// 함수 정의를 읽는 단계(배포·에뮬레이터 분석, 10초 제한)를 빠르게 하려고 처음 쓸 때 불러온다.
let firestoreModule: typeof AdminFirestore | undefined;
let authModule: typeof AdminAuth | undefined;

export function firestore(): typeof AdminFirestore {
  return (firestoreModule ??= require('firebase-admin/firestore') as typeof AdminFirestore);
}

export function adminAuth(): AdminAuth.Auth {
  return (authModule ??= require('firebase-admin/auth') as typeof AdminAuth).getAuth();
}

export const db = () => firestore().getFirestore();
export const serverTimestamp = () => firestore().FieldValue.serverTimestamp();
export const increment = (n: number) => firestore().FieldValue.increment(n);

export function requireAdmin(req: CallableRequest): string {
  if (!req.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  if (req.auth.token.role !== 'ADMIN') throw new HttpsError('permission-denied', '관리자만 사용할 수 있습니다.');
  return req.auth.uid;
}
