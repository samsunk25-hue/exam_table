import { FieldValue, type Transaction } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { findTransition, isSessionStatus, sumLoads, type SessionStatus } from '@sim/shared';
import { db, requireAdmin } from './common';

/**
 * 세션 업무점수를 loadLedger에 기록하고 교사 누적 점수를 증감한다.
 * 같은 세션을 다시 기록하면(잠금 시 재계산) 이전 기록과의 차이만 반영된다.
 */
async function writeLedger(tx: Transaction, sessionId: string): Promise<void> {
  const firestore = db();
  const [assignSnap, ledgerSnap] = await Promise.all([
    tx.get(firestore.collection(`sessions/${sessionId}/assignments`)),
    tx.get(firestore.collection('loadLedger').where('sessionId', '==', sessionId)),
  ]);

  const next = sumLoads(
    assignSnap.docs.map((d) => ({ teacherId: d.get('teacherId') as string, weight: d.get('weight') as number })),
  );
  const prev = new Map<string, number>(
    ledgerSnap.docs.map((d) => [d.get('teacherId') as string, d.get('load') as number]),
  );

  for (const teacherId of new Set([...next.keys(), ...prev.keys()])) {
    const load = next.get(teacherId) ?? 0;
    const delta = Math.round((load - (prev.get(teacherId) ?? 0)) * 1000) / 1000;
    const ledgerRef = firestore.doc(`loadLedger/${sessionId}_${teacherId}`);
    if (load === 0) tx.delete(ledgerRef);
    else tx.set(ledgerRef, { sessionId, teacherId, load, confirmedAt: FieldValue.serverTimestamp() });
    if (delta !== 0) {
      tx.update(firestore.doc(`teachers/${teacherId}`), { cumulativeLoad: FieldValue.increment(delta) });
    }
  }
}

/** 세션 상태 전환 (PRD 4장). 상태 필드는 이 함수로만 바뀐다. */
export const transitionSession = onCall(async (req) => {
  const uid = requireAdmin(req);
  const { sessionId, to, reason } = (req.data ?? {}) as { sessionId?: unknown; to?: unknown; reason?: unknown };
  if (typeof sessionId !== 'string' || !isSessionStatus(to)) {
    throw new HttpsError('invalid-argument', '세션 ID와 상태를 확인해 주세요.');
  }
  const reasonText = typeof reason === 'string' ? reason.trim() : '';

  const ref = db().doc(`sessions/${sessionId}`);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', '세션을 찾을 수 없습니다.');
    const from = snap.get('status') as SessionStatus;
    const transition = findTransition(from, to);
    if (!transition) throw new HttpsError('failed-precondition', `${from}에서 ${to}(으)로 바꿀 수 없습니다.`);
    if (transition.requiresReason && !reasonText) {
      throw new HttpsError('invalid-argument', '이 단계 전환에는 사유가 필요합니다.');
    }

    // 최초 확정과 잠금 시 누적 점수 반영 (잠금 해제로 CONFIRMED가 될 때는 제외)
    if ((to === 'CONFIRMED' && from !== 'LOCKED') || to === 'LOCKED') {
      await writeLedger(tx, sessionId);
    }

    tx.update(ref, {
      status: to,
      updatedBy: uid,
      updatedAt: FieldValue.serverTimestamp(),
      lastChangeReason: reasonText || null,
    });
  });

  return { status: to };
});
