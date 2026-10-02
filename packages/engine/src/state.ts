import {
  isBaseMatch,
  isEligibleTeacher,
  softConstraintPenalty,
  staticHardReason,
  timeKey,
  type Context,
  prefersSeat,
} from './context';
import type { Assignment, ExclusionReason, Seat, Teacher } from './types';

const EPS = 1e-9;

/** 별도시험장 우선 교사 가점: 연속·부담·횟수 감점을 다 합쳐도 이기도록 크게 (하드 조건은 그대로 지킨다) */
export const EXTENDED_PREFERRED = 300;

/** 감독 종류: 별도시험장 자리는 정·부와 따로 센다 */
export type SeatKind = 'CHIEF' | 'ASSISTANT' | 'HALLWAY' | 'STUDY' | 'SPECIAL';
export function seatKind(seat: Seat): SeatKind {
  if (seat.extended || seat.role === 'EXTENDED') return 'SPECIAL';
  return seat.role as Exclude<SeatKind, 'SPECIAL'>;
}

export interface LoadBands {
  low: number;
  high: number;
  /** 이번 시험 감독 횟수 최솟값 (임시 감독자 제외) */
  minCount: number;
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
  /** 교사별 이번 시험 감독 횟수 (자주 쓰므로 따로 센다) */
  private readonly sessionCount = new Map<string, number>();
  /** 교사별·감독 종류별 이번 시험 횟수 (`${teacherId}|${종류}`) */
  private readonly kindCount = new Map<string, number>();

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
    this.sessionCount.set(a.teacherId, (this.sessionCount.get(a.teacherId) ?? 0) + 1);
    const k = `${a.teacherId}|${seatKind(seat)}`;
    this.kindCount.set(k, (this.kindCount.get(k) ?? 0) + 1);
  }

  remove(seatId: string): Assignment | undefined {
    const a = this.bySeat.get(seatId);
    if (!a) return undefined;
    this.bySeat.delete(seatId);
    const seat = this.ctx.seatById.get(seatId)!;
    for (const p of seat.periods) this.teacherTimes.get(a.teacherId)?.get(timeKey(seat.date, p))?.delete(seatId);
    this.sessionLoad.set(a.teacherId, (this.sessionLoad.get(a.teacherId) ?? 0) - a.weight);
    this.sessionCount.set(a.teacherId, (this.sessionCount.get(a.teacherId) ?? 0) - 1);
    const k = `${a.teacherId}|${seatKind(seat)}`;
    this.kindCount.set(k, (this.kindCount.get(k) ?? 0) - 1);
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

  /** 이번 시험 감독 횟수 */
  countOf(teacherId: string): number {
    return this.sessionCount.get(teacherId) ?? 0;
  }

  /** 이번 시험에서 이 종류(정감독·부감독·복도·자습·특별실) 감독 횟수 */
  kindCountOf(teacherId: string, kind: SeatKind): number {
    return this.kindCount.get(`${teacherId}|${kind}`) ?? 0;
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
    if (n === 0) return { low: 0, high: Infinity, minCount: 0 };
    const minCount = Math.min(...this.ctx.teachers.filter((t) => isEligibleTeacher(t) && !t.temporary).map((t) => this.countOf(t.id)));
    const { lowLoadRatio, highLoadRatio } = this.ctx.weights;
    const low = loads[Math.max(0, Math.ceil(n * lowLoadRatio) - 1)]!;
    const high = loads[Math.min(n - 1, n - Math.ceil(n * highLoadRatio))]!;
    return { low, high, minCount };
  }

  score(teacher: Teacher, seat: Seat, bands: LoadBands, ignoreSeatId?: string): Scored {
    const w = this.ctx.weights;
    // 배정 이유는 숫자 없이 사람이 읽는 말로: 좋은 점 / 아쉬운 점
    const good: string[] = [];
    const bad: string[] = [];
    let score = 0;
    const add = (value: number, label: string) => {
      if (value === 0) return;
      score += value;
      (value > 0 ? good : bad).push(label);
    };

    if (isBaseMatch(this.ctx, teacher, seat)) add(w.baseMatch, '원래 그 반 수업 교사');
    if (seat.role === 'HALLWAY' && teacher.defaultRole === 'HALLWAY') add(w.hallwayMatch, '복도 전담 교사');
    if (teacher.subject && teacher.subject === seat.subject) {
      if (seat.role === 'HALLWAY') add(w.examSubjectHallway, '출제 과목 교사라 복도 대기');
      else add(w.examSubjectRoom, '자기 과목 시험 교실 감독');
    }

    const load = this.totalLoadOf(teacher);
    if (teacher.temporary) add(-80, '임시 감독자 (교사가 모자랄 때만)');
    else if (load <= bands.low + EPS) add(w.lowLoad, '학년도 감독 부담이 적은 편');
    else if (load >= bands.high - EPS) add(w.highLoad, '학년도 감독 부담이 많은 편');
    // 이번 시험에서 이미 많이 맡은 교사일수록 감점 (지금 맡은 좌석은 빼고 센다).
    // 별도시험장 우선 교사의 별도시험장 자리는 예외 — 횟수는 횟수 맞추기 단계가 그 교사의 일반 감독을 넘겨 맞춘다
    const preferredHere = prefersSeat(this.ctx, teacher.id, seat);
    if (!teacher.temporary && !preferredHere) {
      const mine = this.countOf(teacher.id) - (ignoreSeatId && this.bySeat.get(ignoreSeatId)?.teacherId === teacher.id ? 1 : 0);
      add(w.countBalance * Math.max(0, mine - bands.minCount), '이번 시험 감독이 이미 많음');
    }

    if (teacher.homeroom === null || teacher.homeroom.grade !== seat.grade) {
      add(w.notHomeroomGrade, '그 학년 담임이 아님');
    }

    const adjacent =
      this.seatsAt(teacher.id, seat.date, seat.periods[0]! - 1, ignoreSeatId).length > 0 ||
      this.seatsAt(teacher.id, seat.date, seat.periods[seat.periods.length - 1]! + 1, ignoreSeatId).length > 0;
    // 일부 시간만 배정 금지인 교사는 남은 시간에 몰아서 맡을 수 있게 연속 감점을 주지 않는다
    // 별도시험장 우선 교사가 그 시험장 1·2교시를 이어 맡는 것도 감점하지 않는다
    if (adjacent && !this.ctx.partlyBlocked.has(teacher.id) && !preferredHere) add(w.consecutive, '바로 앞뒤 교시에도 감독');

    add(softConstraintPenalty(this.ctx, teacher, seat), '예외 규칙');
    if (preferredHere) add(EXTENDED_PREFERRED, '별도시험장 우선 교사');

    const reason = [good.length ? `좋은 점: ${good.join(' · ')}` : '', bad.length ? `아쉬운 점: ${bad.join(' · ')}` : ''].filter(Boolean).join(' / ');
    return { score, reason: reason || '특별히 더하거나 뺄 점 없음' };
  }
}
