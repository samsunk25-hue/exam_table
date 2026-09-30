import type {
  Constraint,
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
  notHomeroomGrade: 10,
  consecutive: -30,
  softConstraint: -50,
  hallwayMatch: 20,
  lowLoadRatio: 0.2,
  highLoadRatio: 0.1,
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

    const push = (role: Role, count: number) => {
      for (let i = 1; i <= count; i++) {
        seats.push({
          id: `${group.id}_${role}_${i}`,
          groupId: group.id,
          slotId: slot.id,
          roomId: room.id,
          roomName: room.name,
          role,
          seatNo: i,
          weight: roleWeights[role],
          date: slot.date,
          period: slot.period,
          grade: group.grade,
          classNo: group.classNo,
          subject: slot.subject,
        });
      }
    };

    if (room.spaceType === 'HALLWAY') {
      push('HALLWAY', room.chiefCount + room.assistantCount);
    } else if (slot.type === 'STUDY') {
      push('STUDY', room.chiefCount + room.assistantCount);
    } else {
      push(group.roomType === 'EXTENDED' ? 'EXTENDED' : 'CHIEF', room.chiefCount);
      push('ASSISTANT', room.assistantCount);
    }
  }

  return seats;
}

export function buildContext(input: EngineInput): Context {
  const weights = { ...DEFAULT_WEIGHTS, ...input.settings.weights };
  const roleWeights = { ...DEFAULT_ROLE_WEIGHTS, ...input.settings.roleWeights };
  const seats = buildSeats(input, roleWeights);

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
  };
}

function constraintApplies(c: Constraint, teacher: Teacher, seat: Seat): boolean {
  switch (c.type) {
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
  if (ctx.unavailable.has(`${teacher.id}|${seat.date}|${seat.period}`)) return 'UNAVAILABLE';
  const cs = ctx.constraintsByTeacher.get(teacher.id);
  if (cs?.some((c) => c.priority === 'HARD' && constraintApplies(c, teacher, seat))) {
    return 'CONSTRAINT';
  }
  return null;
}

/** 배정 가능한 교사인지 (부담 대상) */
export function isEligibleTeacher(t: Teacher): boolean {
  return t.active && t.defaultRole !== 'EXCLUDED';
}

export function softConstraintPenalty(ctx: Context, teacher: Teacher, seat: Seat): number {
  const cs = ctx.constraintsByTeacher.get(teacher.id);
  if (!cs) return 0;
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
