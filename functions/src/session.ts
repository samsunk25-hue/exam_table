import type { Transaction } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { classLoadOf, classTimes } from '@sim/engine';
import { findTransition, isSessionStatus, sumLoads, type SessionStatus } from '@sim/shared';
import { db, increment, requireAdmin, serverTimestamp } from './common';
import { notifyTeachers } from './notify';
import { recordOp } from './undo';

/**
 * 세션 업무점수를 loadLedger에 기록하고 교사 누적 점수를 증감한다.
 * 같은 세션을 다시 기록하면(잠금 시 재계산) 이전 기록과의 차이만 반영된다.
 */
/** 시험 기간 수업 업무 점수 (시험 없는 학년 수업, 기본 켜짐·기초시간표가 있을 때) */
async function classLoadFor(sessionId: string): Promise<Map<string, number>> {
  const firestore = db();
  const session = await firestore.doc(`sessions/${sessionId}`).get();
  if (session.get('settings.classDuringExam') === false) return new Map();
  const [slots, timetable] = await Promise.all([
    firestore.collection(`sessions/${sessionId}/slots`).get(),
    firestore.collection(`sessions/${sessionId}/baseTimetable`).get(),
  ]);
  const entries = timetable.docs.flatMap((d) =>
    ((d.get('entries') as { weekday: number; period: number; grade: number }[] | undefined) ?? []).map((e) => ({ ...e, teacherId: d.id })),
  );
  if (!entries.length) return new Map();
  return classLoadOf(
    classTimes(
      slots.docs.map((d) => ({ date: d.get('date') as string, period: d.get('period') as number, grade: d.get('grade') as number })),
      entries,
    ),
  );
}

async function writeLedger(tx: Transaction, sessionId: string, classLoad: Map<string, number>): Promise<void> {
  const firestore = db();
  const [assignSnap, ledgerSnap] = await Promise.all([
    tx.get(firestore.collection(`sessions/${sessionId}/assignments`)),
    tx.get(firestore.collection('loadLedger').where('sessionId', '==', sessionId)),
  ]);

  const next = sumLoads(
    assignSnap.docs.map((d) => ({ teacherId: d.get('teacherId') as string, weight: d.get('weight') as number })),
  );
  // 시험 없는 학년 수업 시간도 이번 시험 업무 점수에 더한다
  for (const [t, load] of classLoad) next.set(t, Math.round(((next.get(t) ?? 0) + load) * 1000) / 1000);
  const prev = new Map<string, number>(
    ledgerSnap.docs.map((d) => [d.get('teacherId') as string, d.get('load') as number]),
  );

  for (const teacherId of new Set([...next.keys(), ...prev.keys()])) {
    const load = next.get(teacherId) ?? 0;
    const delta = Math.round((load - (prev.get(teacherId) ?? 0)) * 1000) / 1000;
    const ledgerRef = firestore.doc(`loadLedger/${sessionId}_${teacherId}`);
    if (load === 0) tx.delete(ledgerRef);
    else tx.set(ledgerRef, { sessionId, teacherId, load, confirmedAt: serverTimestamp() });
    if (delta !== 0) {
      tx.update(firestore.doc(`teachers/${teacherId}`), { cumulativeLoad: increment(delta) });
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

  // 되돌리기 기록: 세션 상태 + (확정·잠금이면) 누적 점수 원장과 교사 점수
  const before = await ref.get();
  const classLoad = await classLoadFor(sessionId);
  const from0 = before.get('status') as SessionStatus | undefined;
  const t0 = from0 ? findTransition(from0, to) : undefined;
  if (t0) {
    const refs = [ref];
    if ((to === 'CONFIRMED' && from0 !== 'LOCKED') || to === 'LOCKED') {
      const [assignSnap, ledgerSnap] = await Promise.all([
        db().collection(`sessions/${sessionId}/assignments`).get(),
        db().collection('loadLedger').where('sessionId', '==', sessionId).get(),
      ]);
      const teacherIds = new Set([
        ...assignSnap.docs.map((d) => d.get('teacherId') as string),
        ...ledgerSnap.docs.map((d) => d.get('teacherId') as string),
        ...classLoad.keys(),
      ]);
      for (const id of teacherIds) refs.push(db().doc(`teachers/${id}`), db().doc(`loadLedger/${sessionId}_${id}`));
    }
    await recordOp({
      label: `단계 변경: ${t0.label}`,
      kind: 'STATUS',
      sessionId,
      uid,
      email: (req.auth?.token.email as string | undefined) ?? null,
      refs,
    });
  }

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
      await writeLedger(tx, sessionId, classLoad);
    }

    tx.update(ref, {
      status: to,
      updatedBy: uid,
      updatedAt: serverTimestamp(),
      lastChangeReason: reasonText || null,
    });
  });

  await notifyStatus(sessionId, before.get('status') as SessionStatus, to);
  return { status: to };
});

/** 공개·교환 기간·확정·공개 취소를 배정된 교사들에게 알린다 */
async function notifyStatus(sessionId: string, from: SessionStatus, to: SessionStatus) {
  const MESSAGES: Partial<Record<SessionStatus, [string, string]>> = {
    PUBLISHED: ['감독 시간표 공개', '감독 시간표가 공개되었습니다. 내 감독을 확인하세요.'],
    SWAP: ['교환 기간 시작', '감독 교환 기간이 시작되었습니다. 필요하면 교환을 요청하세요.'],
    CONFIRMED: ['감독 시간표 최종 확정', '감독 시간표가 최종 확정되었습니다.'],
  };
  let msg = MESSAGES[to];
  if (to === 'CONFIRMED' && from === 'LOCKED') msg = undefined; // 잠금 해제는 알리지 않음
  if (to === 'REVIEW' && from === 'PUBLISHED') msg = ['시간표 공개 취소', '공개된 감독 시간표가 다시 검토 중입니다. 다시 공개되면 알려 드립니다.'];
  if (!msg) return;
  const [session, assigns] = await Promise.all([
    db().doc(`sessions/${sessionId}`).get(),
    db().collection(`sessions/${sessionId}/assignments`).get(),
  ]);
  const count = new Map<string, number>();
  for (const d of assigns.docs) count.set(d.get('teacherId') as string, (count.get(d.get('teacherId') as string) ?? 0) + 1);
  const exam = session.get('examName') as string;
  await notifyTeachers(count.keys(), (t) => ({
    sessionId,
    title: msg![0],
    body: `${exam}: ${msg![1]}${to === 'PUBLISHED' || to === 'CONFIRMED' ? ` (감독 ${count.get(t)}회)` : ''}`,
    link: '/me',
  }));
}

/**
 * 시험 프로젝트 삭제: 하위 자료(일정·배정·불가시간·이력 등)를 모두 지운다.
 * 확정되어 누적 업무점수에 반영된 프로젝트면 그 점수를 되돌린다.
 */
export const deleteSession = onCall({ timeoutSeconds: 300 }, async (req) => {
  const uid = requireAdmin(req);
  const { sessionId } = (req.data ?? {}) as { sessionId?: unknown };
  if (typeof sessionId !== 'string' || !sessionId) throw new HttpsError('invalid-argument', '세션 ID를 확인해 주세요.');
  return { revertedTeachers: await deleteSessionData(sessionId, uid) };
});

/** 시험 프로젝트와 하위 자료를 지우고 누적 점수를 되돌린다 (학기 삭제에서도 쓴다). 되돌린 교사 수 */
export async function deleteSessionData(sessionId: string, uid: string): Promise<number> {
  const firestore = db();
  const ref = firestore.doc(`sessions/${sessionId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', '세션을 찾을 수 없습니다.');

  // 감사 트리거가 지우는 동안 이력을 다시 만들지 않도록 표시
  await ref.update({ deleting: true, updatedBy: uid, updatedAt: serverTimestamp() });

  const ledger = await firestore.collection('loadLedger').where('sessionId', '==', sessionId).get();
  for (let i = 0; i < ledger.docs.length; i += 200) {
    const batch = firestore.batch();
    for (const d of ledger.docs.slice(i, i + 200)) {
      batch.update(firestore.doc(`teachers/${d.get('teacherId') as string}`), { cumulativeLoad: increment(-(d.get('load') as number)) });
      batch.delete(d.ref);
    }
    await batch.commit();
  }

  await firestore.recursiveDelete(ref);
  // 이 프로젝트의 되돌리기 기록도 지운다
  const ops = await firestore.collection('undoOps').where('sessionId', '==', sessionId).get();
  for (const d of ops.docs) await firestore.recursiveDelete(d.ref);
  return ledger.size;
}
