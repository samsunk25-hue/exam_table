// 배정 엔진 입출력 타입. Firestore 문서 구조(PRD 6장)를 엔진에 필요한 필드만으로 정규화한 형태.

export type Role = 'CHIEF' | 'ASSISTANT' | 'STUDY' | 'EXTENDED' | 'HALLWAY';
export type DefaultRole = 'NORMAL' | 'HALLWAY' | 'EXCLUDED';
export type SpaceType = 'CLASSROOM' | 'SEPARATE' | 'HALLWAY';
export type SlotType = 'EXAM' | 'STUDY';
export type GroupRoomType = 'NORMAL' | 'EXTENDED' | 'SPECIAL';
export type AvailabilityStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type ConstraintType = 'HOMEROOM_EXCLUDE' | 'SLOT_EXCLUDE' | 'SUBJECT_EXCLUDE';
export type ConstraintPriority = 'HARD' | 'SOFT';

export interface Homeroom {
  grade: number;
  classNo: number;
}

export interface Teacher {
  id: string;
  name: string;
  subject?: string;
  homeroom: Homeroom | null;
  defaultRole: DefaultRole;
  active: boolean;
  /** 과거 세션에서 적립된 누적 업무점수 (Load_Ledger 합계) */
  priorLoad: number;
}

export interface Room {
  id: string;
  name: string;
  chiefCount: number;
  assistantCount: number;
  spaceType: SpaceType;
}

export interface Slot {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  period: number;
  grade: number;
  subject: string;
  type: SlotType;
}

export interface Group {
  id: string;
  slotId: string;
  roomId: string;
  grade: number;
  /** null이면 혼합/별도 시험실 */
  classNo: number | null;
  roomType: GroupRoomType;
}

export interface Availability {
  teacherId: string;
  date: string;
  period: number;
  status: AvailabilityStatus;
  reason?: string;
}

export interface Constraint {
  teacherId: string;
  type: ConstraintType;
  /** SLOT_EXCLUDE: slotId, SUBJECT_EXCLUDE: 과목명, HOMEROOM_EXCLUDE: 미사용 */
  target?: string;
  priority: ConstraintPriority;
  /** SOFT 규칙 감점 (기본 weights.softConstraint) */
  penalty?: number;
}

export interface BaseTimetableEntry {
  teacherId: string;
  /** 1=월 ... 5=금 (6=토, 7=일) */
  weekday: number;
  period: number;
  grade: number;
  classNo: number;
  subject?: string;
}

export interface Weights {
  baseMatch: number;
  lowLoad: number;
  highLoad: number;
  notHomeroomGrade: number;
  consecutive: number;
  softConstraint: number;
  /** 복도전담 교사가 복도 자리를 맡을 때 가점 */
  hallwayMatch: number;
  /** 시험 과목 담당(출제) 교사가 그 시험의 복도 자리를 맡을 때 가점 (기본 0) */
  examSubjectHallway: number;
  /** 시험 과목 담당(출제) 교사가 그 시험의 교실 감독을 맡을 때 가감점 (기본 0) */
  examSubjectRoom: number;
  lowLoadRatio: number;
  highLoadRatio: number;
}

export type RoleWeights = Record<Role, number>;

export interface Settings {
  useBaseTimetable: boolean;
  weights?: Partial<Weights>;
  roleWeights?: Partial<RoleWeights>;
  /** 형평성 재배치 시 허용하는 소프트 점수 하락폭 */
  equityScoreTolerance?: number;
  /** 형평성 재배치 최대 반복 횟수 */
  maxEquityMoves?: number;
}

/** 수동 배정 등 엔진이 변경하지 않고 먼저 반영할 배정 */
export interface PinnedAssignment {
  seatId: string;
  teacherId: string;
}

export interface EngineInput {
  teachers: Teacher[];
  rooms: Room[];
  slots: Slot[];
  groups: Group[];
  availability: Availability[];
  constraints: Constraint[];
  baseTimetable: BaseTimetableEntry[];
  settings: Settings;
  pinned?: PinnedAssignment[];
}

export interface Seat {
  /** `${groupId}_${role}_${seatNo}` — Firestore assignments 문서 ID와 동일 */
  id: string;
  groupId: string;
  slotId: string;
  roomId: string;
  roomName: string;
  role: Role;
  seatNo: number;
  weight: number;
  date: string;
  period: number;
  grade: number;
  classNo: number | null;
  subject: string;
}

export interface Assignment {
  seatId: string;
  groupId: string;
  slotId: string;
  roomId: string;
  role: Role;
  weight: number;
  teacherId: string;
  score: number;
  reason: string;
  source: 'AUTO' | 'MANUAL';
}

export type ExclusionReason =
  | 'INACTIVE'
  | 'ROLE_MISMATCH'
  | 'UNAVAILABLE'
  | 'CONSTRAINT'
  | 'BUSY'
  | 'AFTER_EXTENDED';

export interface UnassignedSeat {
  seat: Seat;
  counts: Partial<Record<ExclusionReason, number>>;
  message: string;
}

export interface Metrics {
  seatCount: number;
  assignedCount: number;
  successRate: number;
  /** 교사별 누적 부담 (과거 적립 + 이번 세션) */
  loads: Record<string, number>;
  /** 교사별 이번 세션 부담 */
  sessionLoads: Record<string, number>;
  stdDev: number;
  maxMinGap: number;
  /** 같은 날 연속 교시 배정 쌍의 수 */
  consecutiveCount: number;
  /** 과목 담당(출제) 교사가 자기 과목 시험 교실 감독을 맡은 수 */
  subjectInRoom: number;
}

export interface EngineResult {
  seats: Seat[];
  assignments: Assignment[];
  unassigned: UnassignedSeat[];
  metrics: Metrics;
  /** 하드 조건 위반으로 반영하지 못한 고정 배정 */
  rejectedPinned: Violation[];
}

export interface Violation {
  seatId: string;
  teacherId: string;
  reason: ExclusionReason | 'UNKNOWN_SEAT' | 'UNKNOWN_TEACHER' | 'DUPLICATE_SEAT';
  message: string;
}
