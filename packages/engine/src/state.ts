import {
  isBaseMatch,
  isEligibleTeacher,
  softConstraintPenalty,
  staticHardReason,
  timeKey,
  type Context,
} from './context';
import type { Assignment, ExclusionReason, Seat, Teacher } from './types';

const EPS = 1e-9;

export interface LoadBands {
  low: number;
  high: number;
}

export interface Scored {
  score: number;
  reason: string;
}

/** 배정 진행 상태. 같은 교사·시간에 여러 좌석을 담을 수 있어 검증에도 재사용한다. */
export class State {
  readonly bySeat = new Map<string, Assignment>();
  private readonly teacherTimes = new Map<string, Map<string, Set<string>>>();
  private readonly sessionLoad = new Map<string, number>();

  constructor(private readonly ctx: Context) {}

  add(a: Assignment): void {
    this.bySeat.set(a.seatId, a);
    const seat = this.ctx.seatById.get(a.seatId)!;
    let times = this.teacherTimes.get(a.teacherId);
    if (!times) {
      times = new Map();
      this.teacherTimes.set(a.teacherId, times);
    }
    // 별도 시간으로 여러 교시를 차지하면 그 교시마다 등록한다
    for (const p of seat.periods) {
      const key = timeKey(seat.date, p);
      let set = times.get(key);
      if (!set) {
        set = new Set();
        times.set(key, set);
      }
      set.add(a.seatId);
    }
    this.sessionLoad.set(a.teacherId, (this.sessionLoad.get(a.teacherId) ?? 0) + a.weight);
  }

  remove(seatId: string): Assignment | undefined {
    const a = this.bySeat.get(seatId);
    if (!a) return undefined;
    this.bySeat.delete(seatId);
    const seat = this.ctx.seatById.get(seatId)!;
    for (const p of seat.periods) this.teacherTimes.get(a.teacherId)?.get(timeKey(seat.date, p))?.delete(seatId);
    this.sessionLoad.set(a.teacherId, (this.sessionLoad.get(a.teacherId) ?? 0) - a.weight);
    return a;
  }

  /** 이 좌석이 차지하는 교시들에 교사가 이미 맡은 좌석 (ignoreSeatId 제외) */
  busyAt(teacherId: string, seat: Seat, ignoreSeatId?: string): string[] {
    const ids = new Set<string>();
    for (const p of seat.periods) for (const id of this.seatsAt(teacherId, seat.date, p, ignoreSeatId)) ids.add(id);
    return [...ids];
  }

  /** 해당 교사가 date/period에 맡은 좌석 (ignoreSeatId 제외) */
  seatsAt(teacherId: string, date: string, period: number, ignoreSeatId?: string): string[] {
    const set = this.teacherTimes.get(teacherId)?.get(timeKey(date, period));
    if (!set) return [];
    return [...set].filter((id) => id !== ignoreSeatId);
  }

  sessionLoadOf(teacherId: string): number {
    return this.sessionLoad.get(teacherId) ?? 0;
  }

  /** 누적 + 이번 시험 감독 + 이번 시험 기간 수업 */
  totalLoadOf(teacher: Teacher): number {
    return teacher.priorLoad + this.sessionLoadOf(teacher.id) + (this.ctx.classLoad.get(teacher.id) ?? 0);
  }

  assignmentsOf(teacherId: string): Assignment[] {
    const ids = new Set<string>();
    for (const set of this.teacherTimes.get(teacherId)?.values() ?? []) for (const id of set) ids.add(id);
    return [...ids].map((id) => this.bySeat.get(id)!);
  }

  /** 다른 배정에 의해 생기는 하드 조건 */
  dynamicHardReason(teacher: Teacher, seat: Seat, ignoreSeatId?: string): ExclusionReason | null {
    if (this.busyAt(teacher.id, seat, ignoreSeatId).length > 0) return 'BUSY';
    const first = seat.periods[0]!;
    const last = seat.periods[seat.periods.length - 1]!;
    // 직전 교시 연장감독 → 이번 교시 불가
    const prev = this.seatsAt(teacher.id, seat.date, first - 1, ignoreSeatId);
    if (prev.some((id) => this.ctx.seatById.get(id)!.role === 'EXTENDED')) return 'AFTER_EXTENDED';
    // 이번 좌석이 연장감독 → 다음 교시 배정이 있으면 불가
    if (
      seat.role === 'EXTENDED' &&
      this.seatsAt(teacher.id, seat.date, last + 1, ignoreSeatId).length > 0
    ) {
      return 'AFTER_EXTENDED';
    }
    // 시험 감독과 수업(시험 없는 학년)이 함께 있는 교사: 감독·수업을 합쳐 3교시 연속 불가
    if (this.ctx.inClass.size) {
      const cls = (p: number) => this.ctx.inClass.has(`${teacher.id}|${seat.date}|${p}`);
      const busy = (p: number) => seat.periods.includes(p) || cls(p) || this.seatsAt(teacher.id, seat.date, p, ignoreSeatId).length > 0;
      let lo = first;
      let hi = last;
      while (lo > 1 && busy(lo - 1)) lo--;
      while (hi < 20 && busy(hi + 1)) hi++;
      if (hi - lo + 1 >= 3) {
        for (let p = lo; p <= hi; p++) if (cls(p)) return 'THREE_IN_ROW';
      }
    }
    return null;
  }

  hardReason(teacher: Teacher, seat: Seat, ignoreSeatId?: string): ExclusionReason | null {
    return staticHardReason(this.ctx, teacher, seat) ?? this.dynamicHardReason(teacher, seat, ignoreSeatId);
  }

  loadBands(): LoadBands {
    // 임시 감독자는 형평성 기준에서 뺀다 (누적 0점이라 늘 부담하위로 잡히지 않게)
    const loads = this.ctx.teachers
      .filter((t) => isEligibleTeacher(t) && !t.temporary)
      .map((t) => this.totalLoadOf(t))
      .sort((a, b) => a - b);
    const n = loads.length;
    if (n === 0) return { low: 0, high: Infinity };
    const { lowLoadRatio, highLoadRatio } = this.ctx.weights;
    const low = loads[Math.max(0, Math.ceil(n * lowLoadRatio) - 1)]!;
    const high = loads[Math.min(n - 1, n - Math.ceil(n * highLoadRatio))]!;
    return { low, high };
  }

  score(teacher: Teacher, seat: Seat, bands: LoadBands, ignoreSeatId?: string): Scored {
    const w = this.ctx.weights;
    const parts: string[] = [];
    let score = 0;
    const add = (value: number, label: string) => {
      if (value === 0) return;
      score += value;
      parts.push(`${value > 0 ? '+' : ''}${value}(${label})`);
    };

    if (isBaseMatch(this.ctx, teacher, seat)) add(w.baseMatch, '기초일치');
    if (seat.role === 'HALLWAY' && teacher.defaultRole === 'HALLWAY') add(w.hallwayMatch, '복도전담');
    if (teacher.subject && teacher.subject === seat.subject) {
      if (seat.role === 'HALLWAY') add(w.examSubjectHallway, '출제교사 복도');
      else add(w.examSubjectRoom, '출제과목 감독');
    }

    const load = this.totalLoadOf(teacher);
    if (teacher.temporary) add(-80, '임시 감독자');
    else if (load <= bands.low + EPS) add(w.lowLoad, '부담하위');
    else if (load >= bands.high - EPS) add(w.highLoad, '부담상위');

    if (teacher.homeroom === null || teacher.homeroom.grade !== seat.grade) {
      add(w.notHomeroomGrade, '비담임');
    }

    const adjacent =
      this.seatsAt(teacher.id, seat.date, seat.periods[0]! - 1, ignoreSeatId).length > 0 ||
      this.seatsAt(teacher.id, seat.date, seat.periods[seat.periods.length - 1]! + 1, ignoreSeatId).length > 0;
    if (adjacent) add(w.consecutive, '연속');

    add(softConstraintPenalty(this.ctx, teacher, seat), '예외규칙');

    return { score, reason: parts.length > 0 ? parts.join(', ') : '0(가감점 없음)' };
  }
}
