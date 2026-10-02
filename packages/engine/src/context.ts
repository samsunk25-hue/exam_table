import type {
  Constraint,
  RuleWhen,
  EngineInput,
  ExclusionReason,
  Role,
  RoleWeights,
  Seat,
  Teacher,
  Weights,
} from './types';

export const DEFAULT_WEIGHTS: Weights = {
  baseMatch: 50,
  lowLoad: 30,
  highLoad: -40,
  // 담임은 자기 반만 피하면 되므로 학년 단위 가점은 쓰지 않는다 (자기 반은 하드 조건 OWN_CLASS)
  notHomeroomGrade: 0,
  consecutive: -30,
  softConstraint: -50,
  hallwayMatch: 20,
  examSubjectHallway: 0,
  examSubjectRoom: 0,
  lowLoadRatio: 0.2,
  highLoadRatio: 0.1,
  countBalance: -50,
};

export const DEFAULT_ROLE_WEIGHTS: RoleWeights = {
  CHIEF: 1.0,
  ASSISTANT: 0.8,
  STUDY: 0.6,
  EXTENDED: 1.5,
  HALLWAY: 0.5,
};

export const ROLE_LABEL: Record<Role, string> = {
  CHIEF: '정감독',
  ASSISTANT: '부감독',
  STUDY: '자습감독',
  EXTENDED: '연장감독',
  HALLWAY: '복도대기',
};

export const EXCLUSION_LABEL: Record<ExclusionReason, string> = {
  INACTIVE: '배정 제외 교사',
  ROLE_MISMATCH: '역할 불일치',
  UNAVAILABLE: '불가시간',
  CONSTRAINT: '예외 규칙',
  BUSY: '동시간 타 감독',
  AFTER_EXTENDED: '연장 감독 인접',
  EXAM_WRITER: '출제 과목 시험',
  IN_CLASS: '수업 중',
  THREE_IN_ROW: '수업 포함 3연속',
  OWN_CLASS: '자기 반(담임)',
};

/** YYYY-MM-DD → 1=월 ... 7=일 */
export function weekdayOf(date: string): number {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

export function timeKey(date: string, period: number): string {
  return `${date}|${period}`;
}

export interface Context {
  input: EngineInput;
  weights: Weights;
  roleWeights: RoleWeights;
  teachers: Teacher[];
  teacherById: Map<string, Teacher>;
  seats: Seat[];
  seatById: Map<string, Seat>;
  /** `${teacherId}|${date}|${period}` */
  unavailable: Set<string>;
  constraintsByTeacher: Map<string, Constraint[]>;
  /** `${teacherId}|${weekday}|${period}|${grade}|${classNo}` */
  baseMatch: Set<string>;
  /** 시험 없는 학년 수업 중: `${teacherId}|${date}|${period}` */
  inClass: Set<string>;
  /** 교사별 이번 시험 기간 수업 업무 점수 (수업 시간 × classWeight) */
  classLoad: Map<string, number>;
  /** 일부 시간만 배정 금지(불가시간·금지 규칙)인 교사: 남은 시간에는 연속 감독도 감점하지 않는다 */
  partlyBlocked: Set<string>;
  /** 별도시험장 감독 우선 교사 (정감독 자리 / 부감독 자리) */
  extendedPrefer: { chief: Set<string>; assistant: Set<string> };
}

/** 이 교사가 이 별도시험장 자리(정감독=연장 / 부감독)의 우선 교사인지 */
export function prefersSeat(ctx: Context, teacherId: string, seat: Seat): boolean {
  if (!seat.extended) return false;
  return (seat.role === 'ASSISTANT' ? ctx.extendedPrefer.assistant : ctx.extendedPrefer.chief).has(teacherId);
}

export const DEFAULT_CLASS_WEIGHT = 0.8;

/**
 * 시험 없는 학년은 수업할 때, 교사별로 그 수업 시간을 센다 (`${teacherId}|${date}|${period}` 집합).
 * 같은 날짜·교시에 시험(자습 포함)이 있는 학년은 수업하지 않는다고 본다.
 */
export function classTimes(
  slots: { date: string; period: number; grade: number }[],
  baseTimetable: { teacherId: string; weekday: number; period: number; grade: number }[],
): Set<string> {
  const out = new Set<string>();
  const examGrades = new Map<string, Set<number>>();
  for (const s of slots) {
    const k = timeKey(s.date, s.period);
    examGrades.set(k, new Set([...(examGrades.get(k) ?? []), s.grade]));
  }
  for (const [k, grades] of examGrades) {
    const [date, p] = k.split('|');
    const weekday = weekdayOf(date!);
    for (const b of baseTimetable) {
      if (b.weekday === weekday && b.period === Number(p) && !grades.has(b.grade)) out.add(`${b.teacherId}|${k}`);
    }
  }
  return out;
}

/** 교사별 수업 업무 점수 */
export function classLoadOf(times: Set<string>, weight = DEFAULT_CLASS_WEIGHT): Map<string, number> {
  const m = new Map<string, number>();
  for (const k of times) {
    const t = k.split('|')[0]!;
    m.set(t, Math.round(((m.get(t) ?? 0) + weight) * 1000) / 1000);
  }
  return m;
}

export function buildSeats(input: EngineInput, roleWeights: RoleWeights): Seat[] {
  const slotById = new Map(input.slots.map((s) => [s.id, s]));
  const roomById = new Map(input.rooms.map((r) => [r.id, r]));
  const seats: Seat[] = [];

  for (const group of input.groups) {
    const slot = slotById.get(group.slotId);
    const room = roomById.get(group.roomId);
    if (!slot || !room) {
      throw new Error(`그룹 ${group.id}: 슬롯 또는 시험실을 찾을 수 없습니다.`);
    }

    // period를 주면 그 교시만 맡는 자리 (별도시험장 교시별 감독). 첫 교시는 예전과 같은 ID
    const push = (role: Role, count: number, period?: number) => {
      for (let i = 1; i <= count; i++) {
        seats.push({
          id: period === undefined || period === slot.period ? `${group.id}_${role}_${i}` : `${group.id}_P${period}_${role}_${i}`,
          groupId: group.id,
          slotId: slot.id,
          roomId: room.id,
          roomName: room.name,
          role,
          seatNo: i,
          weight: roleWeights[role],
          date: slot.date,
          period: period ?? slot.period,
          periods: period !== undefined ? [period] : [...new Set([slot.period, ...(group.alsoPeriods ?? [])])].sort((a, b) => a - b),
          grade: group.grade,
          classNo: group.classNo,
          subject: slot.subject,
          extended: group.roomType === 'EXTENDED',
        });
      }
    };

    if (room.spaceType === 'HALLWAY') {
      push('HALLWAY', room.chiefCount + room.assistantCount);
    } else if (slot.type === 'STUDY') {
      // 자습 교시는 시험실마다 감독 1명이면 된다 (시험실의 정·부감독 수와 상관없이)
      push('STUDY', Math.min(1, room.chiefCount + room.assistantCount));
    } else if (group.roomType === 'EXTENDED') {
      // 별도시험장: 연장 시간이 다음 교시에 걸쳐도 교시마다 정·부감독을 따로 둔다
      for (const p of [...new Set([slot.period, ...(group.alsoPeriods ?? [])])].sort((a, b) => a - b)) {
        push('CHIEF', room.chiefCount, p);
        push('ASSISTANT', room.assistantCount, p);
      }
    } else {
      push('CHIEF', room.chiefCount);
      push('ASSISTANT', room.assistantCount);
    }
  }

  return seats;
}

export function buildContext(input: EngineInput): Context {
  // 출제 교사 규칙이 있으면 복도 가점·교실 감점을 기본으로 (시나리오가 직접 정한 가중치가 우선)
  const writer = input.settings.examWriterRule ?? 'NONE';
  const writerWeights = writer === 'NONE' ? {} : { examSubjectHallway: 60, examSubjectRoom: -60 };
  const weights = { ...DEFAULT_WEIGHTS, ...writerWeights, ...input.settings.weights };
  const roleWeights = { ...DEFAULT_ROLE_WEIGHTS, ...input.settings.roleWeights };
  // 감독 없음으로 정한 자리는 배정 대상에서 뺀다
  const skip = new Set(input.settings.skipSeats ?? []);
  const seats = buildSeats(input, roleWeights).filter((s) => !skip.has(s.id));

  // 시험 없는 학년은 수업: 그 시간 수업하는 교사는 감독에서 빼고, 수업 시간도 업무 점수로 센다
  const inClass = input.settings.classDuringExam ? classTimes(input.slots, input.baseTimetable) : new Set<string>();
  const classLoad = classLoadOf(inClass, input.settings.classWeight ?? DEFAULT_CLASS_WEIGHT);

  const unavailable = new Set<string>();
  for (const a of input.availability) {
    if (a.status !== 'REJECTED') unavailable.add(`${a.teacherId}|${a.date}|${a.period}`);
  }

  const constraintsByTeacher = new Map<string, Constraint[]>();
  for (const c of input.constraints) {
    const list = constraintsByTeacher.get(c.teacherId) ?? [];
    list.push(c);
    constraintsByTeacher.set(c.teacherId, list);
  }

  const baseMatch = new Set<string>();
  if (input.settings.useBaseTimetable) {
    for (const b of input.baseTimetable) {
      baseMatch.add(`${b.teacherId}|${b.weekday}|${b.period}|${b.grade}|${b.classNo}`);
    }
  }

  const teachers = [...input.teachers].sort((a, b) => a.id.localeCompare(b.id));

  return {
    input,
    weights,
    roleWeights,
    teachers,
    teacherById: new Map(teachers.map((t) => [t.id, t])),
    seats,
    seatById: new Map(seats.map((s) => [s.id, s])),
    unavailable,
    constraintsByTeacher,
    baseMatch,
    inClass,
    classLoad,
    partlyBlocked: new Set([
      ...input.availability.filter((a) => a.status !== 'REJECTED').map((a) => a.teacherId),
      ...input.constraints.filter((c) => c.priority === 'HARD' && c.teacherId !== '*').map((c) => c.teacherId),
    ]),
    extendedPrefer: {
      chief: new Set([...(input.settings.extendedPreferred ?? []), ...(input.settings.extendedChief ?? [])]),
      assistant: new Set([...(input.settings.extendedPreferred ?? []), ...(input.settings.extendedAssistant ?? [])]),
    },
  };
}

const hit = <T>(list: T[] | undefined, v: T) => !list?.length || list.includes(v);

/** 일반 규칙(RULE)의 조건이 이 자리에 맞는지 */
export function ruleWhenMatches(w: RuleWhen | undefined, teacher: Teacher, seat: Seat): boolean {
  if (!w) return true;
  return (
    hit(w.dates, seat.date) &&
    (!w.periods?.length || seat.periods.some((p) => w.periods!.includes(p))) &&
    hit(w.grades, seat.grade) &&
    hit(w.roles, seat.role) &&
    hit(w.subjects, seat.subject) &&
    hit(w.roomIds, seat.roomId) &&
    (!w.ownHomeroom || (teacher.homeroom !== null && teacher.homeroom.grade === seat.grade && teacher.homeroom.classNo === seat.classNo))
  );
}

function constraintApplies(c: Constraint, teacher: Teacher, seat: Seat): boolean {
  switch (c.type) {
    case 'RULE':
      return ruleWhenMatches(c.when, teacher, seat);
    case 'HOMEROOM_EXCLUDE':
      return (
        teacher.homeroom !== null &&
        teacher.homeroom.grade === seat.grade &&
        teacher.homeroom.classNo === seat.classNo
      );
    case 'SLOT_EXCLUDE':
      return c.target === seat.slotId;
    case 'SUBJECT_EXCLUDE':
      return c.target === seat.subject;
  }
}

/** 교사가 담당 가능한 좌석인지 (다른 배정과 무관한 정적 조건만) */
export function staticHardReason(ctx: Context, teacher: Teacher, seat: Seat): ExclusionReason | null {
  if (!teacher.active || teacher.defaultRole === 'EXCLUDED') return 'INACTIVE';
  // 일반 교사는 교실·복도 모두 가능, 복도전담 교사는 복도만
  if (teacher.defaultRole === 'HALLWAY' && seat.role !== 'HALLWAY') return 'ROLE_MISMATCH';
  if (seat.periods.some((p) => ctx.unavailable.has(`${teacher.id}|${seat.date}|${p}`))) return 'UNAVAILABLE';
  // 담임은 자기 반 시험 감독(정·부)을 맡지 않는다. 자기 반 자습 감독·같은 학년 다른 반·복도는 괜찮다
  if (teacher.homeroom && (seat.role === 'CHIEF' || seat.role === 'ASSISTANT') && seat.classNo !== null && seat.grade === teacher.homeroom.grade && seat.classNo === teacher.homeroom.classNo) {
    return 'OWN_CLASS';
  }
  if (seat.periods.some((p) => ctx.inClass.has(`${teacher.id}|${seat.date}|${p}`))) return 'IN_CLASS';
  // 출제 교사는 자기 과목 시험 시간에 교실 감독 불가 (복도 대기는 가능)
  if (ctx.input.settings.examWriterRule === 'NO_ROOM' && teacher.subject && teacher.subject === seat.subject && seat.role !== 'HALLWAY') {
    return 'EXAM_WRITER';
  }
  const cs = constraintsFor(ctx, teacher.id);
  if (cs.some((c) => c.priority === 'HARD' && constraintApplies(c, teacher, seat))) {
    return 'CONSTRAINT';
  }
  return null;
}

/**
 * 배정할 수 없는 구체적 사유 (있을 때만): 불가시간은 신청 사유(출장 등), 예외 규칙은 그 규칙 설명.
 * 감독 배정 편집의 후보 목록에서 "불가시간 (출장)"처럼 보인다.
 */
export function blockDetail(ctx: Context, teacher: Teacher, seat: Seat, reason: ExclusionReason | null): string | null {
  if (reason === 'UNAVAILABLE') {
    const why = ctx.input.availability
      .filter((a) => a.teacherId === teacher.id && a.date === seat.date && seat.periods.includes(a.period) && a.status !== 'REJECTED')
      .map((a) => a.reason?.trim())
      .filter((r): r is string => !!r);
    return why.length ? [...new Set(why)].join(', ') : null;
  }
  if (reason === 'CONSTRAINT') {
    const labels = constraintsFor(ctx, teacher.id)
      .filter((c) => c.priority === 'HARD' && constraintApplies(c, teacher, seat))
      .map((c) =>
        c.label ??
        (c.type === 'HOMEROOM_EXCLUDE' ? '자기 반 감독 제외' : c.type === 'SUBJECT_EXCLUDE' ? `${c.target} 시험 감독 제외` : c.type === 'SLOT_EXCLUDE' ? '이 시험 감독 제외' : '배정 금지 규칙'),
      );
    return labels.length ? [...new Set(labels)].join(', ') : null;
  }
  return null;
}

/** 그 교사 규칙 + 모든 교사('*') 규칙 */
function constraintsFor(ctx: Context, teacherId: string): Constraint[] {
  const own = ctx.constraintsByTeacher.get(teacherId) ?? [];
  const all = ctx.constraintsByTeacher.get('*');
  return all ? [...own, ...all] : own;
}

/** 배정 가능한 교사인지 (부담 대상) */
export function isEligibleTeacher(t: Teacher): boolean {
  return t.active && t.defaultRole !== 'EXCLUDED';
}

export function softConstraintPenalty(ctx: Context, teacher: Teacher, seat: Seat): number {
  const cs = constraintsFor(ctx, teacher.id);
  let total = 0;
  for (const c of cs) {
    if (c.priority === 'SOFT' && constraintApplies(c, teacher, seat)) {
      total += c.penalty ?? ctx.weights.softConstraint;
    }
  }
  return total;
}

export function isBaseMatch(ctx: Context, teacher: Teacher, seat: Seat): boolean {
  if (!ctx.input.settings.useBaseTimetable || seat.classNo === null) return false;
  return ctx.baseMatch.has(
    `${teacher.id}|${weekdayOf(seat.date)}|${seat.period}|${seat.grade}|${seat.classNo}`,
  );
}
