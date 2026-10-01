// 교사 교환 요청: 교사가 방법을 찾아 요청 → 관련 교사 수락 → 관리자 승인 시 반영
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { DEFAULT_ROLE_WEIGHTS, buildEngineInput, buildSeats, findSwapChains, seatCandidates, validateAssignments, type Seat } from '@sim/engine';
import {
  OPEN_SWAP_STATUSES,
  SEAT_ROLE_LABEL,
  type AssignmentDoc,
  type SessionStatus,
  type SwapKind,
  type SwapMoveDoc,
  type SwapRequestDoc,
  type SwapStatus,
} from '@sim/shared';
import { db, serverTimestamp } from './common';
import { loadData } from './runs';
import { recordOp } from './undo';

/** 교환은 교사 공개 이후 확정 전까지만 */
const SWAP_OPEN = new Set<SessionStatus>(['PUBLISHED', 'SWAP']);

interface Caller {
  uid: string;
  admin: boolean;
  teacherId: string | null;
  email: string | null;
}

function caller(req: CallableRequest): Caller {
  if (!req.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  const t = req.auth.token;
  const admin = t.role === 'ADMIN';
  const teacherId = (t.teacherId as string | undefined) ?? null;
  if (!admin && t.role !== 'TEACHER') throw new HttpsError('permission-denied', '교사 또는 관리자만 사용할 수 있습니다.');
  return { uid: req.auth.uid, admin, teacherId, email: (t.email as string | undefined) ?? null };
}

const seatLabel = (s: Seat) => `${Number(s.date.slice(5, 7))}/${Number(s.date.slice(8, 10))} ${s.period}교시 ${s.roomName} ${SEAT_ROLE_LABEL[s.role]}`;

/** 세션·배정·엔진 입력을 읽는다. 교사는 자기 학교·학기 세션만. */
async function load(sessionId: string, who: Caller, req: CallableRequest) {
  const ref = db().doc(`sessions/${sessionId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', '시험 프로젝트를 찾을 수 없습니다.');
  if (!who.admin) {
    const t = req.auth!.token;
    if (snap.get('schoolName') !== t.school || snap.get('year') !== t.year || snap.get('semester') !== t.semester) {
      throw new HttpsError('permission-denied', '다른 학교·학기 시험입니다.');
    }
  }
  const status = snap.get('status') as SessionStatus;
  const { data, current } = await loadData(sessionId, snap.get('settings.useBaseTimetable') === true);
  const input = buildEngineInput(data);
  const seats = new Map(buildSeats(input, DEFAULT_ROLE_WEIGHTS).map((s) => [s.id, s]));
  const names = new Map(data.teachers.map((t) => [t.id, t.name]));
  const plain = current.map((a) => ({ seatId: a.id, teacherId: a.teacherId }));
  return { ref, status, input, seats, names, current, plain };
}
type Loaded = Awaited<ReturnType<typeof load>>;

function describe(L: Loaded, moves: { seatId: string; from: string; to: string }[]): { moves: SwapMoveDoc[]; summary: string[] } {
  const name = (id: string) => L.names.get(id) ?? id;
  const out = moves.map((m) => ({ ...m, label: seatLabel(L.seats.get(m.seatId)!) }));
  return { moves: out, summary: out.map((m) => `${name(m.to)} ← ${m.label} (${name(m.from)} 대신)`) };
}

/** moves를 적용한 배정이 지금 배정 기준으로 유효한지. 문제가 있으면 메시지 */
function checkMoves(L: Loaded, moves: { seatId: string; from: string; to: string }[]): string | null {
  const now = new Map(L.plain.map((a) => [a.seatId, a.teacherId]));
  for (const m of moves) {
    if (!L.seats.has(m.seatId)) return `존재하지 않는 감독 자리입니다: ${m.seatId}`;
    if (now.get(m.seatId) !== m.from) return `${seatLabel(L.seats.get(m.seatId)!)}의 담당 교사가 이미 바뀌었습니다.`;
    if (!L.names.has(m.to)) return '교사 명단에 없는 교사가 포함되어 있습니다.';
  }
  for (const m of moves) now.set(m.seatId, m.to);
  const v = validateAssignments(L.input, [...now].map(([seatId, teacherId]) => ({ seatId, teacherId })));
  return v.length ? v.slice(0, 2).map((x) => x.message).join(' / ') : null;
}

/** 교환 방법 찾기: 맞바꾸기(연쇄 포함)와 넘기기 후보 */
export const suggestSwaps = onCall({ timeoutSeconds: 60 }, async (req) => {
  const who = caller(req);
  const { sessionId, seatId, partnerId } = (req.data ?? {}) as { sessionId?: unknown; seatId?: unknown; partnerId?: unknown };
  if (typeof sessionId !== 'string' || typeof seatId !== 'string') throw new HttpsError('invalid-argument', '감독 자리를 골라 주세요.');
  const L = await load(sessionId, who, req);
  if (!SWAP_OPEN.has(L.status)) throw new HttpsError('failed-precondition', '교사 공개 또는 교환 기간에만 교환을 요청할 수 있습니다.');
  const owner = L.plain.find((a) => a.seatId === seatId)?.teacherId;
  if (!owner) throw new HttpsError('not-found', '배정되지 않은 자리입니다.');
  if (!who.admin && owner !== who.teacherId) throw new HttpsError('permission-denied', '본인 감독만 교환을 요청할 수 있습니다.');
  const partner = typeof partnerId === 'string' && partnerId ? partnerId : undefined;

  const chains = findSwapChains(L.input, L.plain, { teacherId: owner, seatId, partnerId: partner }, { maxTeachers: 3, limit: 5 });
  const options: { kind: SwapKind; moves: SwapMoveDoc[]; summary: string[] }[] = chains.map((c) => ({ kind: 'SWAP', ...describe(L, c.moves) }));
  if (!partner) {
    // 넘기기: 이 시간에 감독이 없고 조건을 지키는 교사 (부담이 적은 순)
    for (const c of seatCandidates(L.input, L.plain, seatId).filter((x) => !x.blockedBy && x.teacherId !== owner).slice(0, 3)) {
      options.push({ kind: 'HANDOVER', ...describe(L, [{ seatId, from: owner, to: c.teacherId }]) });
    }
  }
  return { options };
});

/** 교환 요청 만들기 */
export const createSwapRequest = onCall({ timeoutSeconds: 60 }, async (req) => {
  const who = caller(req);
  const { sessionId, kind, moves, reason } = (req.data ?? {}) as { sessionId?: unknown; kind?: unknown; moves?: unknown; reason?: unknown };
  if (typeof sessionId !== 'string' || (kind !== 'SWAP' && kind !== 'HANDOVER') || !Array.isArray(moves) || moves.length === 0 || moves.length > 8) {
    throw new HttpsError('invalid-argument', '요청 내용을 확인해 주세요.');
  }
  const list = (moves as { seatId?: unknown; from?: unknown; to?: unknown }[]).map((m) => ({ seatId: String(m.seatId), from: String(m.from), to: String(m.to) }));
  const L = await load(sessionId, who, req);
  if (!SWAP_OPEN.has(L.status)) throw new HttpsError('failed-precondition', '교사 공개 또는 교환 기간에만 교환을 요청할 수 있습니다.');
  const requesterId = who.admin && !who.teacherId ? list[0]!.from : who.teacherId!;
  if (!list.some((m) => m.from === requesterId)) throw new HttpsError('permission-denied', '본인 감독이 포함된 교환만 요청할 수 있습니다.');
  const problem = checkMoves(L, list);
  if (problem) throw new HttpsError('failed-precondition', `이 교환은 할 수 없습니다: ${problem}`);

  // 같은 자리를 다루는 진행 중인 요청이 있으면 막는다
  const col = L.ref.collection('swapRequests');
  const open = await col.where('status', 'in', OPEN_SWAP_STATUSES).get();
  const seatIds = new Set(list.map((m) => m.seatId));
  if (open.docs.some((d) => (d.get('moves') as SwapMoveDoc[]).some((m) => seatIds.has(m.seatId)))) {
    throw new HttpsError('failed-precondition', '이 감독에 대해 진행 중인 교환 요청이 이미 있습니다.');
  }

  const parties = [...new Set(list.flatMap((m) => [m.from, m.to]))];
  const others = parties.filter((p) => p !== requesterId);
  const { moves: described, summary } = describe(L, list);
  const doc: SwapRequestDoc = {
    requesterId,
    kind,
    moves: described,
    parties,
    responses: Object.fromEntries(others.map((p) => [p, 'PENDING'])),
    status: others.length ? 'PENDING_PEERS' : 'PENDING_ADMIN',
    reason: typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 200) : null,
    note: null,
    summary,
  };
  const ref = await col.add({ ...doc, createdBy: who.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  return { requestId: ref.id, status: doc.status };
});

type Action = 'accept' | 'decline' | 'cancel' | 'approve' | 'reject';

/** 수락·거절(관련 교사), 취소(요청자·관리자), 승인·반려(관리자) */
export const actSwapRequest = onCall({ timeoutSeconds: 60 }, async (req) => {
  const who = caller(req);
  const { sessionId, requestId, action, note } = (req.data ?? {}) as { sessionId?: unknown; requestId?: unknown; action?: unknown; note?: unknown };
  if (typeof sessionId !== 'string' || typeof requestId !== 'string' || !['accept', 'decline', 'cancel', 'approve', 'reject'].includes(action as string)) {
    throw new HttpsError('invalid-argument', '요청을 확인해 주세요.');
  }
  const act = action as Action;
  const noteText = typeof note === 'string' && note.trim() ? note.trim().slice(0, 200) : null;
  const ref = db().doc(`sessions/${sessionId}/swapRequests/${requestId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', '교환 요청을 찾을 수 없습니다.');
  const r = snap.data() as SwapRequestDoc;
  if (!OPEN_SWAP_STATUSES.includes(r.status)) throw new HttpsError('failed-precondition', '이미 처리된 요청입니다.');
  const update = (status: SwapStatus, extra: Record<string, unknown> = {}) =>
    ref.update({ status, ...extra, updatedAt: serverTimestamp(), updatedBy: who.uid });

  if (act === 'accept' || act === 'decline') {
    if (r.status !== 'PENDING_PEERS' || !who.teacherId || r.responses[who.teacherId] !== 'PENDING') {
      throw new HttpsError('permission-denied', '응답할 수 있는 요청이 아닙니다.');
    }
    const responses = { ...r.responses, [who.teacherId]: act === 'accept' ? 'ACCEPTED' : 'DECLINED' };
    const status: SwapStatus = act === 'decline' ? 'DECLINED' : Object.values(responses).every((v) => v === 'ACCEPTED') ? 'PENDING_ADMIN' : 'PENDING_PEERS';
    await update(status, { responses, ...(act === 'decline' ? { note: noteText } : {}) });
    return { status };
  }
  if (act === 'cancel') {
    if (!who.admin && who.teacherId !== r.requesterId) throw new HttpsError('permission-denied', '요청한 교사만 취소할 수 있습니다.');
    await update('CANCELLED');
    return { status: 'CANCELLED' };
  }
  if (!who.admin) throw new HttpsError('permission-denied', '관리자만 승인·반려할 수 있습니다.');
  if (act === 'reject') {
    await update('REJECTED', { note: noteText });
    return { status: 'REJECTED' };
  }

  // 승인: 지금 배정으로 다시 검증하고 반영
  if (r.status !== 'PENDING_ADMIN') throw new HttpsError('failed-precondition', '관련 교사가 모두 수락한 뒤에 승인할 수 있습니다.');
  const L = await load(sessionId, who, req);
  const problem = !SWAP_OPEN.has(L.status) ? '교사 공개 또는 교환 기간이 아닙니다.' : checkMoves(L, r.moves);
  if (problem) {
    await update('FAILED', { note: problem });
    throw new HttpsError('failed-precondition', `반영할 수 없어 요청을 실패로 표시했습니다: ${problem}`);
  }
  const col = L.ref.collection('assignments');
  const requester = L.names.get(r.requesterId) ?? r.requesterId;
  await recordOp({
    label: `교환 승인: ${requester}${r.reason ? ` (${r.reason})` : ''}`,
    sessionId,
    uid: who.uid,
    email: who.email,
    refs: r.moves.map((m) => col.doc(m.seatId)),
  });
  const batch = db().batch();
  for (const m of r.moves) {
    const seat = L.seats.get(m.seatId)!;
    const doc: AssignmentDoc = {
      slotId: seat.slotId,
      groupId: seat.groupId,
      roomId: seat.roomId,
      role: seat.role,
      weight: seat.weight,
      teacherId: m.to,
      score: 0,
      reason: `교사 교환${r.reason ? `: ${r.reason}` : ''}`,
      source: 'MANUAL',
      date: seat.date,
      period: seat.period,
      runId: null,
    };
    batch.set(col.doc(m.seatId), { ...doc, updatedBy: who.uid, updatedAt: serverTimestamp(), lastChangeReason: `교사 교환 (${requester})` });
  }
  batch.update(ref, { status: 'APPROVED', note: noteText, updatedAt: serverTimestamp(), updatedBy: who.uid });
  await batch.commit();
  return { status: 'APPROVED' };
});
