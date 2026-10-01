import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { DEFAULT_ROLE_WEIGHTS, buildEngineInput, buildSeats, validateAssignments } from '@sim/engine';
import type { AssignmentDoc, SessionStatus } from '@sim/shared';
import { db, requireAdmin, serverTimestamp } from './common';
import { loadData } from './runs';
import { recordOp } from './undo';

interface Change {
  seatId: string;
  /** null이면 좌석을 비운다 */
  teacherId: string | null;
}

/**
 * 수동 배정 변경·연쇄 교환 적용. 변경 후 전체 배정이 하드 조건을 지킬 때만 저장한다.
 * 변경 잠금(LOCKED) 중에는 막고, 최종 확정(CONFIRMED) 이후에는 사유가 필요하다.
 */
export const applyAssignmentChanges = onCall({ timeoutSeconds: 60 }, async (req) => {
  const uid = requireAdmin(req);
  const { sessionId, changes, reason, label } = (req.data ?? {}) as { sessionId?: unknown; changes?: unknown; reason?: unknown; label?: unknown };
  if (typeof sessionId !== 'string' || !Array.isArray(changes) || changes.length === 0 || changes.length > 50) {
    throw new HttpsError('invalid-argument', '변경 내용을 확인해 주세요.');
  }
  const list = changes as Change[];
  if (list.some((c) => typeof c?.seatId !== 'string' || (c.teacherId !== null && typeof c.teacherId !== 'string'))) {
    throw new HttpsError('invalid-argument', '변경 내용 형식이 올바르지 않습니다.');
  }
  const reasonText = typeof reason === 'string' ? reason.trim() : '';
  const kind = typeof label === 'string' && label ? label : '수동 변경';

  const sessionRef = db().doc(`sessions/${sessionId}`);
  const sessionSnap = await sessionRef.get();
  if (!sessionSnap.exists) throw new HttpsError('not-found', '시험 프로젝트를 찾을 수 없습니다.');
  const status = sessionSnap.get('status') as SessionStatus;
  if (status === 'LOCKED') throw new HttpsError('failed-precondition', '변경 잠금 상태입니다. 개요에서 잠금을 해제한 뒤 수정하세요.');
  if (status === 'CONFIRMED' && !reasonText) throw new HttpsError('invalid-argument', '최종 확정 이후 변경에는 사유가 필요합니다.');

  const { data, current } = await loadData(sessionId, sessionSnap.get('settings.useBaseTimetable') === true);
  const input = buildEngineInput(data);
  const seatById = new Map(buildSeats(input, DEFAULT_ROLE_WEIGHTS).map((s) => [s.id, s]));
  for (const c of list) if (!seatById.has(c.seatId)) throw new HttpsError('invalid-argument', `존재하지 않는 좌석입니다: ${c.seatId}`);

  const next = new Map(current.map((a) => [a.id, a.teacherId]));
  for (const c of list) {
    if (c.teacherId) next.set(c.seatId, c.teacherId);
    else next.delete(c.seatId);
  }
  const violations = validateAssignments(input, [...next].map(([seatId, teacherId]) => ({ seatId, teacherId })));
  if (violations.length > 0) {
    throw new HttpsError('failed-precondition', `하드 조건 위반으로 저장하지 않았습니다: ${violations.slice(0, 3).map((v) => v.message).join(' / ')}`);
  }

  const col = db().collection(`sessions/${sessionId}/assignments`);
  await recordOp({
    label: kind,
    sessionId,
    uid,
    email: (req.auth?.token.email as string | undefined) ?? null,
    refs: list.map((c) => col.doc(c.seatId)),
  });
  const batch = db().batch();
  for (const c of list) {
    if (!c.teacherId) {
      batch.delete(col.doc(c.seatId));
      continue;
    }
    const seat = seatById.get(c.seatId)!;
    const doc: AssignmentDoc = {
      slotId: seat.slotId,
      groupId: seat.groupId,
      roomId: seat.roomId,
      role: seat.role,
      weight: seat.weight,
      teacherId: c.teacherId,
      score: 0,
      reason: reasonText ? `${kind}: ${reasonText}` : kind,
      source: 'MANUAL',
      date: seat.date,
      period: seat.period,
      runId: null,
    };
    batch.set(col.doc(c.seatId), { ...doc, updatedBy: uid, updatedAt: serverTimestamp(), lastChangeReason: reasonText || null });
  }
  await batch.commit();
  return { changed: list.length };
});
