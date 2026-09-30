import {
  EXCLUSION_LABEL,
  ROLE_LABEL,
  buildContext,
  isEligibleTeacher,
  type Context,
} from './context';
import { State } from './state';
import type {
  Assignment,
  EngineInput,
  EngineResult,
  ExclusionReason,
  Metrics,
  Seat,
  Teacher,
  UnassignedSeat,
  Violation,
} from './types';

const EPS = 1e-9;

const ROLE_ORDER: Record<Seat['role'], number> = { CHIEF: 0, EXTENDED: 0, STUDY: 0, HALLWAY: 0, ASSISTANT: 1 };

function compareSeats(a: Seat, b: Seat): number {
  return (
    a.date.localeCompare(b.date) ||
    a.period - b.period ||
    a.roomName.localeCompare(b.roomName, 'ko') ||
    a.groupId.localeCompare(b.groupId) ||
    ROLE_ORDER[a.role] - ROLE_ORDER[b.role] ||
    a.seatNo - b.seatNo
  );
}

interface Candidate {
  teacher: Teacher;
  score: number;
  reason: string;
  load: number;
}

function rankCandidates(ctx: Context, state: State, seat: Seat, exclude?: string): Candidate[] {
  const bands = state.loadBands();
  const out: Candidate[] = [];
  for (const t of ctx.teachers) {
    if (t.id === exclude || state.hardReason(t, seat) !== null) continue;
    const s = state.score(t, seat, bands);
    out.push({ teacher: t, score: s.score, reason: s.reason, load: state.totalLoadOf(t) });
  }
  // 점수 내림차순 → 누적 부담 오름차순 → 교사 ID (ctx.teachers가 ID순이므로 안정 정렬로 보장)
  return out.sort((a, b) => b.score - a.score || a.load - b.load);
}

function makeAssignment(seat: Seat, c: Candidate, source: Assignment['source']): Assignment {
  return {
    seatId: seat.id,
    groupId: seat.groupId,
    slotId: seat.slotId,
    roomId: seat.roomId,
    role: seat.role,
    weight: seat.weight,
    teacherId: c.teacher.id,
    score: c.score,
    reason: c.reason,
    source,
  };
}

function applyPinned(ctx: Context, state: State, pinnedIds: Set<string>): Violation[] {
  const rejected: Violation[] = [];
  for (const p of ctx.input.pinned ?? []) {
    const seat = ctx.seatById.get(p.seatId);
    const teacher = ctx.teacherById.get(p.teacherId);
    if (!seat) {
      rejected.push({ ...p, reason: 'UNKNOWN_SEAT', message: `존재하지 않는 좌석: ${p.seatId}` });
      continue;
    }
    if (!teacher) {
      rejected.push({ ...p, reason: 'UNKNOWN_TEACHER', message: `존재하지 않는 교사: ${p.teacherId}` });
      continue;
    }
    if (state.bySeat.has(seat.id)) {
      rejected.push({ ...p, reason: 'DUPLICATE_SEAT', message: `좌석 중복 고정: ${seat.id}` });
      continue;
    }
    const reason = state.hardReason(teacher, seat);
    if (reason) {
      rejected.push({
        ...p,
        reason,
        message: `${teacher.name} → ${seat.id}: ${EXCLUSION_LABEL[reason]}`,
      });
      continue;
    }
    const s = state.score(teacher, seat, state.loadBands());
    state.add(makeAssignment(seat, { teacher, score: s.score, reason: s.reason, load: 0 }, 'MANUAL'));
    pinnedIds.add(seat.id);
  }
  return rejected;
}

/** [3단계] 최소 후보 우선 매칭 */
function greedyMatch(ctx: Context, state: State): void {
  const seatsByDate = new Map<string, Seat[]>();
  for (const s of ctx.seats) {
    const list = seatsByDate.get(s.date) ?? [];
    list.push(s);
    seatsByDate.set(s.date, list);
  }

  const countCandidates = (seat: Seat) => {
    let n = 0;
    for (const t of ctx.teachers) if (state.hardReason(t, seat) === null) n++;
    return n;
  };

  const open = new Map<string, Seat>();
  const counts = new Map<string, number>();
  for (const s of [...ctx.seats].sort(compareSeats)) {
    if (state.bySeat.has(s.id)) continue;
    open.set(s.id, s);
    counts.set(s.id, countCandidates(s));
  }

  while (open.size > 0) {
    let pick: Seat | undefined;
    let min = Infinity;
    for (const s of open.values()) {
      const c = counts.get(s.id)!;
      if (c < min) {
        min = c;
        pick = s;
      }
    }
    const seat = pick!;
    open.delete(seat.id);
    if (min === 0) continue; // 후보 없음 — 개선 단계에서 재시도

    const best = rankCandidates(ctx, state, seat)[0];
    if (!best) continue;

    // 배정은 같은 날 인접 교시 좌석에서 "이 교사"의 가능 여부만 바꾼다
    const t = best.teacher;
    const affected = seatsByDate
      .get(seat.date)!
      .filter((s) => open.has(s.id) && Math.abs(s.period - seat.period) <= 1 && state.hardReason(t, s) === null);
    state.add(makeAssignment(seat, best, 'AUTO'));
    for (const s of affected) {
      if (state.hardReason(t, s) !== null) counts.set(s.id, counts.get(s.id)! - 1);
    }
  }
}

/** [4단계-1] 연쇄 재배치: 동시간 다른 좌석을 맡은 교사를 빈 좌석으로 옮기고 원 좌석을 다른 교사에게 */
function ejectionChain(ctx: Context, state: State, pinnedIds: Set<string>): void {
  for (const seat of [...ctx.seats].sort(compareSeats)) {
    if (state.bySeat.has(seat.id)) continue;

    for (const t of ctx.teachers) {
      if (state.hardReason(t, seat) !== 'BUSY') continue;
      const busy = state.seatsAt(t.id, seat.date, seat.period);
      if (busy.length !== 1) continue;
      const otherId = busy[0]!;
      if (pinnedIds.has(otherId)) continue;
      if (state.hardReason(t, seat, otherId) !== null) continue;

      const original = state.remove(otherId)!;
      const bands = state.loadBands();
      const s = state.score(t, seat, bands);
      state.add(makeAssignment(seat, { teacher: t, score: s.score, reason: s.reason, load: 0 }, 'AUTO'));

      const otherSeat = ctx.seatById.get(otherId)!;
      const replacement = rankCandidates(ctx, state, otherSeat, t.id)[0];
      if (replacement) {
        state.add(makeAssignment(otherSeat, replacement, 'AUTO'));
        break;
      }
      state.remove(seat.id);
      state.add(original);
    }
  }
}

/** [4단계-2] 형평성 재배치: 부담 최고 교사의 좌석을 부담 낮은 교사에게 이전 (분산이 엄격히 감소할 때만) */
function equityRebalance(ctx: Context, state: State, pinnedIds: Set<string>): void {
  const tolerance = ctx.input.settings.equityScoreTolerance ?? 10;
  const maxMoves = ctx.input.settings.maxEquityMoves ?? 2000;
  const eligible = ctx.teachers.filter(isEligibleTeacher);

  for (let moves = 0; moves < maxMoves; moves++) {
    const byLoadDesc = [...eligible].sort(
      (a, b) => state.totalLoadOf(b) - state.totalLoadOf(a) || a.id.localeCompare(b.id),
    );
    let moved = false;

    outer: for (const high of byLoadDesc) {
      const highLoad = state.totalLoadOf(high);
      const own = state
        .assignmentsOf(high.id)
        .filter((a) => !pinnedIds.has(a.seatId))
        .sort((a, b) => b.weight - a.weight || a.seatId.localeCompare(b.seatId));

      for (const a of own) {
        const seat = ctx.seatById.get(a.seatId)!;
        const bands = state.loadBands();
        const current = state.score(high, seat, bands, seat.id).score;

        let best: Candidate | undefined;
        for (const low of eligible) {
          if (low.id === high.id) continue;
          const lowLoad = state.totalLoadOf(low);
          if (lowLoad + a.weight >= highLoad - EPS) continue;
          if (state.hardReason(low, seat) !== null) continue;
          const s = state.score(low, seat, bands);
          if (s.score < current - tolerance) continue;
          if (!best || s.score > best.score || (s.score === best.score && lowLoad < best.load)) {
            best = { teacher: low, score: s.score, reason: s.reason, load: lowLoad };
          }
        }

        if (best) {
          state.remove(seat.id);
          state.add(makeAssignment(seat, best, 'AUTO'));
          moved = true;
          break outer;
        }
      }
    }

    if (!moved) return;
  }
}

function explainUnassigned(ctx: Context, state: State, seat: Seat): UnassignedSeat {
  const counts: Partial<Record<ExclusionReason, number>> = {};
  for (const t of ctx.teachers) {
    const r = state.hardReason(t, seat);
    if (r && r !== 'INACTIVE' && r !== 'ROLE_MISMATCH') counts[r] = (counts[r] ?? 0) + 1;
  }
  const where = seat.classNo !== null ? `${seat.grade}-${seat.classNo}반` : seat.roomName;
  const detail = (Object.entries(counts) as [ExclusionReason, number][])
    .sort((a, b) => b[1] - a[1])
    .map(([r, n]) => `${EXCLUSION_LABEL[r]} ${n}명`)
    .join(', ');
  return {
    seat,
    counts,
    message: `${where} ${seat.subject} ${ROLE_LABEL[seat.role]} 미배정 (가용 인력 0명${detail ? ` - ${detail}` : ''})`,
  };
}

function computeMetrics(ctx: Context, state: State): Metrics {
  const loads: Record<string, number> = {};
  const sessionLoads: Record<string, number> = {};
  const values: number[] = [];
  for (const t of ctx.teachers.filter(isEligibleTeacher)) {
    const total = round(state.totalLoadOf(t));
    loads[t.id] = total;
    sessionLoads[t.id] = round(state.sessionLoadOf(t.id));
    values.push(total);
  }
  const n = values.length;
  const mean = n ? values.reduce((s, v) => s + v, 0) / n : 0;
  const variance = n ? values.reduce((s, v) => s + (v - mean) ** 2, 0) / n : 0;
  const seatCount = ctx.seats.length;
  const assignedCount = state.bySeat.size;
  return {
    seatCount,
    assignedCount,
    successRate: seatCount ? assignedCount / seatCount : 1,
    loads,
    sessionLoads,
    stdDev: round(Math.sqrt(variance)),
    maxMinGap: n ? round(Math.max(...values) - Math.min(...values)) : 0,
  };
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** 자동 감독 배정 실행. 같은 입력에는 항상 같은 결과를 돌려준다. */
export function runAssignment(input: EngineInput): EngineResult {
  const ctx = buildContext(input);
  const state = new State(ctx);
  const pinnedIds = new Set<string>();

  const rejectedPinned = applyPinned(ctx, state, pinnedIds);
  greedyMatch(ctx, state);
  ejectionChain(ctx, state, pinnedIds);
  equityRebalance(ctx, state, pinnedIds);

  const seats = [...ctx.seats].sort(compareSeats);
  const assignments = seats.flatMap((s) => state.bySeat.get(s.id) ?? []);
  const unassigned = seats.filter((s) => !state.bySeat.has(s.id)).map((s) => explainUnassigned(ctx, state, s));

  return { seats, assignments, unassigned, metrics: computeMetrics(ctx, state), rejectedPinned };
}
