import { EXCLUSION_LABEL, buildContext } from './context';
import { State } from './state';
import type { Assignment, EngineInput, ExclusionReason, Violation } from './types';

type AssignmentLike = Pick<Assignment, 'seatId' | 'teacherId'>;

function buildState(input: EngineInput, assignments: AssignmentLike[]) {
  const ctx = buildContext(input);
  const state = new State(ctx);
  const violations: Violation[] = [];
  const seen = new Set<string>();

  for (const a of assignments) {
    const seat = ctx.seatById.get(a.seatId);
    const teacher = ctx.teacherById.get(a.teacherId);
    if (!seat) {
      violations.push({ ...a, reason: 'UNKNOWN_SEAT', message: `존재하지 않는 좌석: ${a.seatId}` });
      continue;
    }
    if (!teacher) {
      violations.push({ ...a, reason: 'UNKNOWN_TEACHER', message: `존재하지 않는 교사: ${a.teacherId}` });
      continue;
    }
    if (seen.has(a.seatId)) {
      violations.push({ ...a, reason: 'DUPLICATE_SEAT', message: `한 좌석에 2명 이상 배정: ${a.seatId}` });
      continue;
    }
    seen.add(a.seatId);
    state.add({
      seatId: seat.id,
      groupId: seat.groupId,
      slotId: seat.slotId,
      roomId: seat.roomId,
      role: seat.role,
      weight: seat.weight,
      teacherId: teacher.id,
      score: 0,
      reason: '',
      source: 'MANUAL',
    });
  }
  return { ctx, state, violations };
}

/**
 * 하드 조건 검증. 자동 배정 결과·수동 수정·교환 승인 모두 저장 직전에 호출한다.
 * 위반이 없으면 빈 배열.
 */
export function validateAssignments(input: EngineInput, assignments: AssignmentLike[]): Violation[] {
  const { ctx, state, violations } = buildState(input, assignments);
  for (const a of state.bySeat.values()) {
    const seat = ctx.seatById.get(a.seatId)!;
    const teacher = ctx.teacherById.get(a.teacherId)!;
    const reason = state.hardReason(teacher, seat, seat.id);
    if (reason) {
      violations.push({
        seatId: a.seatId,
        teacherId: a.teacherId,
        reason,
        message: `${teacher.name} (${seat.date} ${seat.period}교시 ${seat.roomName}): ${EXCLUSION_LABEL[reason]}`,
      });
    }
  }
  return violations;
}

export interface SeatCandidate {
  teacherId: string;
  name: string;
  /** null이면 배정 가능 */
  blockedBy: ExclusionReason | null;
  score: number;
  reason: string;
  load: number;
}

/**
 * 수동 편집용: 현재 배정 상태에서 특정 좌석의 후보 목록 (배정 가능 교사 점수순, 불가 교사는 사유와 함께 뒤에).
 * 좌석에 이미 배정된 교사가 있으면 그 배정은 제외하고 계산한다.
 */
export function seatCandidates(
  input: EngineInput,
  assignments: AssignmentLike[],
  seatId: string,
): SeatCandidate[] {
  const { ctx, state } = buildState(
    input,
    assignments.filter((a) => a.seatId !== seatId),
  );
  const seat = ctx.seatById.get(seatId);
  if (!seat) throw new Error(`존재하지 않는 좌석: ${seatId}`);
  const bands = state.loadBands();

  return ctx.teachers
    .map((t) => {
      const blockedBy = state.hardReason(t, seat);
      const s = state.score(t, seat, bands);
      return { teacherId: t.id, name: t.name, blockedBy, score: s.score, reason: s.reason, load: state.totalLoadOf(t) };
    })
    .filter((c) => c.blockedBy !== 'INACTIVE' && c.blockedBy !== 'ROLE_MISMATCH')
    .sort(
      (a, b) =>
        Number(a.blockedBy !== null) - Number(b.blockedBy !== null) || b.score - a.score || a.load - b.load,
    );
}

/**
 * 바꾼 뒤(after)에 새로 생긴 위반만. 바꾸기 전(before)에도 있던 위반(예: 배정 뒤에 승인된 불가시간)은
 * 이번 변경과 상관없으므로 저장을 막지 않는다.
 */
export function newViolations(input: EngineInput, before: AssignmentLike[], after: AssignmentLike[]): Violation[] {
  const key = (v: Violation) => `${v.seatId}|${v.teacherId}|${v.reason}`;
  const old = new Set(validateAssignments(input, before).map(key));
  return validateAssignments(input, after).filter((v) => !old.has(key(v)));
}
