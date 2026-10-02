import {
  EXCLUSION_LABEL,
  ROLE_LABEL,
  buildContext,
  isEligibleTeacher,
  type Context,
  prefersSeat,
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
  // 감독 횟수 차이 상한: 가장 적은 교사보다 MAX_COUNT_GAP회 이상 많은 교사는 다른 후보가 있으면 빼고 고른다
  // (별도시험장 우선 교사의 그 자리는 예외)
  const capped = out.filter(
    (c) => c.teacher.temporary || prefersSeat(ctx, c.teacher.id, seat) || state.countOf(c.teacher.id) < bands.minCount + MAX_COUNT_GAP,
  );
  // 점수 내림차순 → 누적 부담 오름차순 → 교사 ID (ctx.teachers가 ID순이므로 안정 정렬로 보장)
  return (capped.length ? capped : out).sort((a, b) => b.score - a.score || a.load - b.load);
}

/** 이번 시험 감독 횟수 차이 상한 (목표는 1, 사정이 있어도 3을 넘기지 않는다) */
const MAX_COUNT_GAP = 3;

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

  // 별도시험장 우선 교사가 있으면 별도시험장 자리를 먼저 채운다
  // (안 그러면 우선 교사가 같은 시간 일반 교실 감독을 먼저 받아 별도시험장을 못 맡는다)
  const anyPreferred = ctx.extendedPrefer.chief.size + ctx.extendedPrefer.assistant.size > 0;
  const tier = (s: Seat) => (anyPreferred && s.extended ? 0 : 1);
  while (open.size > 0) {
    let pick: Seat | undefined;
    let min = Infinity;
    let pickTier = Infinity;
    for (const s of open.values()) {
      const c = counts.get(s.id)!;
      const k = tier(s);
      if (k < pickTier || (k === pickTier && c < min)) {
        min = c;
        pickTier = k;
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
      const busy = state.busyAt(t.id, seat);
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

/** 별도시험장 우선 교사가 맡은 별도시험장 자리는 횟수·누적 맞추기에서 옮기지 않는다 */
function keepsPreferred(ctx: Context, a: Assignment): boolean {
  return prefersSeat(ctx, a.teacherId, ctx.seatById.get(a.seatId)!);
}

/**
 * [4단계-2] 감독 횟수 맞추기: 이번 시험 감독이 가장 적은 교사보다 2회 이상 많은 교사의 좌석을 적은 교사에게 넘긴다.
 * 받는 교사는 횟수가 적고 학년도 누적이 낮은 교사부터. 하드 조건을 지킬 때만 옮긴다 (임시 감독자는 제외).
 */
function countRebalance(ctx: Context, state: State, pinnedIds: Set<string>): void {
  const eligible = ctx.teachers.filter((t) => isEligibleTeacher(t) && !t.temporary);
  for (let moves = 0; moves < 2000; moves++) {
    const counts = eligible.map((t) => ({ t, c: state.countOf(t.id) }));
    if (!counts.length) return;
    const min = Math.min(...counts.map((x) => x.c));
    const givers = counts.filter((x) => x.c >= min + 2).sort((a, b) => b.c - a.c || state.totalLoadOf(b.t) - state.totalLoadOf(a.t));
    let moved = false;
    outer: for (const g of givers) {
      const own = state.assignmentsOf(g.t.id).filter((a) => !pinnedIds.has(a.seatId) && !keepsPreferred(ctx, a));
      const receivers = counts.filter((x) => x.c <= g.c - 2).sort((a, b) => a.c - b.c || state.totalLoadOf(a.t) - state.totalLoadOf(b.t));
      for (const r of receivers) {
        const bands = state.loadBands();
        let best: { seat: Seat; c: Candidate } | undefined;
        for (const a of own) {
          const seat = ctx.seatById.get(a.seatId)!;
          if (state.hardReason(r.t, seat) !== null) continue;
          const s = state.score(r.t, seat, bands);
          if (!best || s.score > best.c.score) best = { seat, c: { teacher: r.t, score: s.score, reason: s.reason, load: state.totalLoadOf(r.t) } };
        }
        if (best) {
          state.remove(best.seat.id);
          state.add(makeAssignment(best.seat, best.c, 'AUTO'));
          moved = true;
          break outer;
        }
      }
    }
    if (!moved) return;
  }
}

/**
 * [4단계-3] 형평성 재배치: 부담 최고 교사의 좌석을 부담 낮은 교사에게 이전 (분산이 엄격히 감소할 때만).
 * 받는 교사의 이번 감독 횟수가 주는 교사보다 적을 때만 옮겨 횟수 차이는 벌리지 않는다
 * → 1회 더 맡는 몫이 학년도 누적이 낮은 교사에게 가서 시험을 거듭할수록 누적 차이가 줄어든다.
 */
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
        .filter((a) => !pinnedIds.has(a.seatId) && !keepsPreferred(ctx, a))
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
          if (state.countOf(low.id) >= state.countOf(high.id)) continue;
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
    sessionLoads[t.id] = round(state.sessionLoadOf(t.id) + (ctx.classLoad.get(t.id) ?? 0));
    values.push(total);
  }
  const n = values.length;
  const mean = n ? values.reduce((s, v) => s + v, 0) / n : 0;
  const variance = n ? values.reduce((s, v) => s + (v - mean) ** 2, 0) / n : 0;
  const seatCount = ctx.seats.length;
  const assignedCount = state.bySeat.size;

  const counts = ctx.teachers.filter((t) => isEligibleTeacher(t) && !t.temporary).map((t) => state.countOf(t.id));
  let consecutiveCount = 0;
  let subjectInRoom = 0;
  for (const a of state.bySeat.values()) {
    const seat = ctx.seatById.get(a.seatId)!;
    const teacher = ctx.teacherById.get(a.teacherId)!;
    // 다음 교시와의 쌍만 세서 중복 없이 센다
    if (state.seatsAt(teacher.id, seat.date, seat.periods[seat.periods.length - 1]! + 1).length > 0) consecutiveCount++;
    if (teacher.subject && teacher.subject === seat.subject && seat.role !== 'HALLWAY') subjectInRoom++;
  }

  return {
    seatCount,
    assignedCount,
    successRate: seatCount ? assignedCount / seatCount : 1,
    loads,
    sessionLoads,
    stdDev: round(Math.sqrt(variance)),
    maxMinGap: n ? round(Math.max(...values) - Math.min(...values)) : 0,
    countGap: counts.length ? Math.max(...counts) - Math.min(...counts) : 0,
    consecutiveCount,
    subjectInRoom,
  };
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** 자동 감독 배정 실행. 같은 입력에는 항상 같은 결과를 돌려준다. */
/**
 * [4단계-4] 역할 맞추기: 같은 날·교시의 두 감독(정감독·부감독·복도)을 서로 바꿔
 * 교사마다 정감독·부감독·복도 횟수가 비슷해지게 한다. 시간과 감독 횟수는 그대로이고 하드 조건을 지킬 때만 바꾼다.
 */
const BALANCED_ROLES = ['CHIEF', 'ASSISTANT', 'HALLWAY'] as const;
function roleRebalance(ctx: Context, state: State, pinnedIds: Set<string>): void {
  const roleCount = (teacherId: string, role: string) => state.assignmentsOf(teacherId).filter((a) => a.role === role).length;
  for (let moves = 0; moves < 3000; moves++) {
    const byTime = new Map<string, Assignment[]>();
    for (const a of state.bySeat.values()) {
      if (!(BALANCED_ROLES as readonly string[]).includes(a.role) || pinnedIds.has(a.seatId) || keepsPreferred(ctx, a)) continue;
      const t = ctx.teacherById.get(a.teacherId)!;
      if (t.temporary) continue;
      const seat = ctx.seatById.get(a.seatId)!;
      const k = `${seat.date}|${seat.periods.join(',')}`;
      byTime.set(k, [...(byTime.get(k) ?? []), a]);
    }
    let swapped = false;
    outer: for (const list of byTime.values()) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i]!;
          const b = list[j]!;
          if (a.role === b.role || a.teacherId === b.teacherId) continue;
          // 제곱합이 줄어들 때만: (A의 r1 - B의 r1) + (B의 r2 - A의 r2) > 2
          const gain = roleCount(a.teacherId, a.role) - roleCount(b.teacherId, a.role) + (roleCount(b.teacherId, b.role) - roleCount(a.teacherId, b.role));
          if (gain <= 2) continue;
          const ta = ctx.teacherById.get(a.teacherId)!;
          const tb = ctx.teacherById.get(b.teacherId)!;
          const sa = ctx.seatById.get(a.seatId)!;
          const sb = ctx.seatById.get(b.seatId)!;
          state.remove(sa.id);
          state.remove(sb.id);
          if (state.hardReason(ta, sb) === null && state.hardReason(tb, sa) === null) {
            const bands = state.loadBands();
            const scA = state.score(ta, sb, bands);
            state.add(makeAssignment(sb, { teacher: ta, score: scA.score, reason: scA.reason, load: state.totalLoadOf(ta) }, 'AUTO'));
            const scB = state.score(tb, sa, bands);
            state.add(makeAssignment(sa, { teacher: tb, score: scB.score, reason: scB.reason, load: state.totalLoadOf(tb) }, 'AUTO'));
            swapped = true;
            break outer;
          }
          state.add(a);
          state.add(b);
        }
      }
    }
    if (!swapped) return;
  }
}

export function runAssignment(input: EngineInput): EngineResult {
  const ctx = buildContext(input);
  const state = new State(ctx);
  const pinnedIds = new Set<string>();

  const rejectedPinned = applyPinned(ctx, state, pinnedIds);
  greedyMatch(ctx, state);
  ejectionChain(ctx, state, pinnedIds);
  countRebalance(ctx, state, pinnedIds);
  equityRebalance(ctx, state, pinnedIds);
  roleRebalance(ctx, state, pinnedIds);

  const seats = [...ctx.seats].sort(compareSeats);
  const assignments = seats.flatMap((s) => state.bySeat.get(s.id) ?? []);
  const unassigned = seats.filter((s) => !state.bySeat.has(s.id)).map((s) => explainUnassigned(ctx, state, s));

  return { seats, assignments, unassigned, metrics: computeMetrics(ctx, state), rejectedPinned };
}
