import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { DEFAULT_ROLE_WEIGHTS, buildEngineInput, buildSeats, newViolations } from '@sim/engine';
import type { AssignmentDoc, SessionStatus } from '@sim/shared';
import { db, requireAdmin, serverTimestamp } from './common';
import { loadData } from './runs';
import { notifyTeachers } from './notify';
import { recordOp } from './undo';

interface Change {
  seatId: string;
  /** null이면 좌석을 비운다 */
  teacherId: string | null;
}

/**
 * 수동 배정 변경·연쇄 교환 적용. 이 변경으로 새 하드 조건 위반이 생기지 않을 때만 저장한다
 * (바꾸기 전부터 있던 위반, 예: 배정 뒤에 승인된 불가시간은 막지 않는다 — 기초 자료 점검·편집 화면에서 따로 보인다).
 * 변경 잠금(LOCKED) 중에는 막는다. 사유는 선택(적으면 변경 이력에 남는다).
 * 지금 감독 자리에 없는 배정(예: 자습 교시를 1명으로 바꾸기 전의 두 번째 자습감독)은 검사에서 빼고 이번 저장 때 함께 지운다.
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

  const { data, current } = await loadData(sessionId, true);
  const input = buildEngineInput(data);
  const seatById = new Map(buildSeats(input, DEFAULT_ROLE_WEIGHTS).map((s) => [s.id, s]));
  const orphans = current.filter((a) => !seatById.has(a.id));
  const orphanIds = new Set(orphans.map((a) => a.id));
  for (const c of list) {
    if (!seatById.has(c.seatId) && !(c.teacherId === null && orphanIds.has(c.seatId))) throw new HttpsError('invalid-argument', `존재하지 않는 좌석입니다: ${c.seatId}`);
  }

  const kept = current.filter((a) => !orphanIds.has(a.id)).map((a) => ({ seatId: a.id, teacherId: a.teacherId }));
  const next = new Map(kept.map((a) => [a.seatId, a.teacherId]));
  for (const c of list) {
    if (orphanIds.has(c.seatId)) continue;
    if (c.teacherId) next.set(c.seatId, c.teacherId);
    else next.delete(c.seatId);
  }
  const violations = newViolations(input, kept, [...next].map(([seatId, teacherId]) => ({ seatId, teacherId })));
  if (violations.length > 0) {
    throw new HttpsError('failed-precondition', `하드 조건 위반으로 저장하지 않았습니다: ${violations.slice(0, 3).map((v) => v.message).join(' / ')}`);
  }

  const col = db().collection(`sessions/${sessionId}/assignments`);
  await recordOp({
    label: kind,
    sessionId,
    uid,
    email: (req.auth?.token.email as string | undefined) ?? null,
    refs: [...new Set([...list.map((c) => c.seatId), ...orphanIds])].map((id) => col.doc(id)),
  });
  const batch = db().batch();
  for (const id of orphanIds) batch.delete(col.doc(id));
  for (const c of list) {
    if (orphanIds.has(c.seatId)) continue;
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

  if (status === 'PUBLISHED' || status === 'SWAP' || status === 'CONFIRMED') {
    const before = new Map(current.map((a) => [a.id, a.teacherId]));
    const affected = new Map<string, string[]>();
    const add = (t: string | undefined | null, line: string) => t && affected.set(t, [...(affected.get(t) ?? []), line]);
    const roomName = new Map(data.rooms.map((r) => [r.id, r.name]));
    for (const o of orphans) add(o.teacherId, `${Number(o.date.slice(5, 7))}/${Number(o.date.slice(8, 10))} ${o.period}교시 ${roomName.get(o.roomId) ?? ''} 감독에서 빠짐`);
    for (const c of list) {
      if (orphanIds.has(c.seatId)) continue;
      const seat = seatById.get(c.seatId)!;
      const where = `${Number(seat.date.slice(5, 7))}/${Number(seat.date.slice(8, 10))} ${seat.period}교시 ${seat.roomName}`;
      const prev = before.get(c.seatId);
      if (prev === c.teacherId) continue;
      add(prev, `${where} 감독에서 빠짐`);
      add(c.teacherId, `${where} 감독 배정`);
    }
    const exam = sessionSnap.get('examName') as string;
    await notifyTeachers(affected.keys(), (t) => ({
      sessionId,
      title: '감독 변경',
      body: `${exam}: ${affected.get(t)!.join(', ')}${reasonText ? ` (사유: ${reasonText})` : ''}`,
      link: '/me',
    }));
  }
  return { changed: list.length };
});
