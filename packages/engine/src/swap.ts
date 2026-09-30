// N각 연쇄 교환: 교사 A의 감독 1건을 내보내고, 교사들이 한 건씩 넘겨받아 A가 다른 1건을 받는 순환 경로를 찾는다.
//   A의 좌석 → T1, T1의 좌석 → T2, …, Tk의 좌석 → A   (모두 1건 주고 1건 받으므로 감독 수는 그대로)
// 짧은 경로부터(직접 1:1 → 3각 → 4각) 찾고, 결과마다 전체 하드 조건을 다시 검증한다.
import { buildContext } from './context';
import { State } from './state';
import type { Assignment, EngineInput, Seat, Teacher } from './types';
import { validateAssignments } from './validate';

export interface SwapMove {
  seatId: string;
  from: string;
  to: string;
}

export interface SwapChain {
  /** [A, T1, …, Tk] — A의 좌석을 T1이 받고 … Tk의 좌석을 A가 받는다 */
  teachers: string[];
  moves: SwapMove[];
  /** 교환 후 좌석을 새로 맡는 교사들의 적합도 점수 합 (클수록 좋음) */
  scoreDelta: number;
}

export interface SwapRequest {
  teacherId: string;
  /** A가 내보내려는 좌석 */
  seatId: string;
  /** 이 교사의 감독과 바꾸고 싶을 때 (경로의 마지막 교사가 된다) */
  partnerId?: string;
}

export interface SwapOptions {
  /** 경로에 들어가는 교사 수 (A 포함). 2 = 1:1 교환 */
  maxTeachers?: number;
  limit?: number;
  /** 탐색 상한 (노드 수) */
  budget?: number;
}

type AssignmentLike = Pick<Assignment, 'seatId' | 'teacherId'>;

export function findSwapChains(input: EngineInput, assignments: AssignmentLike[], req: SwapRequest, opts: SwapOptions = {}): SwapChain[] {
  const maxTeachers = opts.maxTeachers ?? 4;
  const limit = opts.limit ?? 5;
  let budget = opts.budget ?? 200_000;

  const ctx = buildContext(input);
  const state = new State(ctx);
  const add = (seatId: string, teacherId: string) => {
    const seat = ctx.seatById.get(seatId)!;
    state.add({
      seatId,
      groupId: seat.groupId,
      slotId: seat.slotId,
      roomId: seat.roomId,
      role: seat.role,
      weight: seat.weight,
      teacherId,
      score: 0,
      reason: '',
      source: 'MANUAL',
    });
  };
  for (const a of assignments) if (ctx.seatById.has(a.seatId) && ctx.teacherById.has(a.teacherId)) add(a.seatId, a.teacherId);

  const A = ctx.teacherById.get(req.teacherId);
  const startSeat = ctx.seatById.get(req.seatId);
  if (!A || !startSeat || state.bySeat.get(req.seatId)?.teacherId !== A.id) return [];

  const bands = state.loadBands();
  const scoreOf = (t: Teacher, s: Seat) => state.score(t, s, bands, s.id).score;
  const found: SwapChain[] = [];
  const seen = new Set<string>();

  state.remove(startSeat.id);

  // give: 지금 넘겨받을 사람을 찾는 좌석, chain: 지금까지 좌석을 넘겨받은 교사들, moves: 이동 목록
  const dfs = (give: Seat, chain: Teacher[], moves: SwapMove[], depthLimit: number) => {
    if (found.length >= limit * 4 || budget <= 0) return;
    for (const t of ctx.teachers) {
      if (budget-- <= 0) return;
      if (t.id === A.id || chain.some((c) => c.id === t.id)) continue;
      if (state.hardReason(t, give) === 'INACTIVE') continue;
      const isLast = chain.length + 2 === depthLimit;
      if (isLast && req.partnerId && t.id !== req.partnerId) continue;

      for (const own of state.assignmentsOf(t.id)) {
        const ownSeat = ctx.seatById.get(own.seatId)!;
        state.remove(ownSeat.id);
        if (state.hardReason(t, give) === null) {
          add(give.id, t.id);
          const step: SwapMove = { seatId: give.id, from: moves.length ? moves[moves.length - 1]!.to : A.id, to: t.id };
          const nextMoves = [...moves, step];
          if (isLast) {
            // 마지막 교사의 좌석을 A가 받는다
            if (state.hardReason(A, ownSeat) === null) {
              const close: SwapMove = { seatId: ownSeat.id, from: t.id, to: A.id };
              const all = [...nextMoves, close];
              const key = all.map((m) => `${m.seatId}>${m.to}`).join('|');
              if (!seen.has(key)) {
                seen.add(key);
                add(ownSeat.id, A.id);
                const scoreDelta = all.reduce((sum, m) => {
                  const seat = ctx.seatById.get(m.seatId)!;
                  return sum + scoreOf(ctx.teacherById.get(m.to)!, seat);
                }, 0);
                state.remove(ownSeat.id);
                found.push({ teachers: [A.id, ...chain.map((c) => c.id), t.id], moves: all, scoreDelta });
              }
            }
          } else {
            dfs(ownSeat, [...chain, t], nextMoves, depthLimit);
          }
          state.remove(give.id);
        }
        add(ownSeat.id, t.id);
        if (found.length >= limit * 4 || budget <= 0) break;
      }
    }
  };

  // 짧은 경로 우선: 2명(1:1) → 3명 → … → maxTeachers
  for (let n = 2; n <= maxTeachers && found.length < limit; n++) dfs(startSeat, [], [], n);

  // 결과마다 전체 하드 조건을 다시 검증한다
  const verified = found.filter((chain) => {
    const moved = new Map(chain.moves.map((m) => [m.seatId, m.to]));
    const next = assignments.map((a) => ({ seatId: a.seatId, teacherId: moved.get(a.seatId) ?? a.teacherId }));
    return validateAssignments(input, next).length === 0;
  });

  return verified
    .sort((a, b) => a.teachers.length - b.teachers.length || b.scoreDelta - a.scoreDelta)
    .slice(0, limit);
}
