// Firestore 문서 구조 (PRD 6장). 웹과 Cloud Functions가 공유한다.

export type DefaultRole = 'NORMAL' | 'HALLWAY' | 'EXCLUDED';
export type SpaceType = 'CLASSROOM' | 'SEPARATE' | 'HALLWAY';
export type SlotType = 'EXAM' | 'STUDY';
export type PlacementRoomType = 'NORMAL' | 'EXTENDED' | 'SPECIAL';

/**
 * 학교·학기 구분 (교사·시험실 명단은 학기마다 따로 저장한다).
 * term = `${school}|${year}|${semester}` — 같은 학기 명단을 조회할 때 쓴다.
 */
export interface TermFields {
  term: string;
  school: string;
  year: number;
  semester: number;
}

export interface TermRef {
  school: string;
  year: number;
  semester: number;
}

export const termKey = (t: TermRef) => `${t.school.trim()}|${t.year}|${t.semester}`;
export const termFields = (t: TermRef): TermFields => ({ term: termKey(t), school: t.school.trim(), year: t.year, semester: t.semester });
export const termLabel = (t: TermRef) => `${t.school} · ${t.year}학년도 ${t.semester}학기`;
/** 세션(학교명·학년도·학기) → 학기 */
export const sessionTerm = (s: { schoolName: string; year: number; semester: number }): TermRef => ({ school: s.schoolName, year: s.year, semester: s.semester });
export function parseTermKey(key: string): TermRef | null {
  const [school, year, semester] = key.split('|');
  return school && Number(year) && Number(semester) ? { school, year: Number(year), semester: Number(semester) } : null;
}

/** 출제 교사(시험 과목 담당 교사)를 자기 과목 시험 시간에 어떻게 배정할지 */
export type ExamWriterRule = 'NONE' | 'PREFER_HALLWAY' | 'NO_ROOM';
export const EXAM_WRITER_RULE_LABEL: Record<ExamWriterRule, string> = {
  NONE: '상관없음',
  PREFER_HALLWAY: '복도 대기 우선 (가능하면 교실 감독 피함)',
  NO_ROOM: '교실 감독 제외 (복도 대기만 가능)',
};

export interface Homeroom {
  grade: number;
  classNo: number;
}

/** teachers/{teacherId} */
export interface TeacherDoc {
  name: string;
  /** 소문자. 로그인 계정 연결용 */
  email: string | null;
  subject: string | null;
  homeroom: Homeroom | null;
  defaultRole: DefaultRole;
  active: boolean;
  /** 같은 학년도 안의 누적 업무점수 (같은 학년도 학기에서 명단을 불러오면 이어받는다) */
  cumulativeLoad: number;
  /** 임시 감독자 (교사 명단에 없는 사람, 이 시험 프로젝트에서만) */
  temporary?: boolean;
  /** 임시 감독자가 쓰이는 시험 프로젝트 ID */
  onlySession?: string;
  /** 임시 감독자 메모 (예: 학부모, 강사) */
  note?: string | null;
  /** 소속 학교·학기. 없으면 예전(학기 미지정) 자료 */
  term?: string;
  school?: string;
  year?: number;
  semester?: number;
}

/** rooms/{roomId} */
export interface RoomDoc {
  name: string;
  spaceType: SpaceType;
  /** 담당 학년 (교실·복도 기본 배치에 사용) */
  grade: number | null;
  /** 교실의 반 번호 */
  classNo: number | null;
  chiefCount: number;
  assistantCount: number;
  term?: string;
  school?: string;
  year?: number;
  semester?: number;
}

/** 시험 1건에 배치된 시험실 (엔진의 Group에 해당, groupId = `${slotId}__${roomId}`) */
export interface Placement {
  roomId: string;
  classNo: number | null;
  headcount: number | null;
  roomType: PlacementRoomType;
  /** 특별실 등에서 시험 시간과 다르게 운영할 때 (없으면 시험 시간과 같음) */
  startTime?: string | null;
  endTime?: string | null;
}

/** sessions/{sid}/slots/{slotId} — slotId = `${date}_${period}_${grade}` */
export interface SlotDoc {
  date: string;
  period: number;
  startTime: string | null;
  endTime: string | null;
  grade: number;
  subject: string;
  type: SlotType;
  rooms: Placement[];
}

export interface TimetableEntry {
  weekday: number;
  period: number;
  grade: number;
  classNo: number;
  subject: string | null;
}

/** sessions/{sid}/baseTimetable/{teacherId} */
export interface BaseTimetableDoc {
  teacherId: string;
  entries: TimetableEntry[];
}

export type AvailabilityStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

/** sessions/{sid}/availability/{teacherId}_{date}_{period} — 근무 불가 시간 1칸 */
export interface AvailabilityDoc {
  teacherId: string;
  date: string;
  period: number;
  available: false;
  reason: string;
  source: 'TEACHER' | 'ADMIN';
  status: AvailabilityStatus;
  /** 반려 사유 등 관리자 메모 */
  adminNote?: string | null;
}

/** 일반 규칙(RULE)의 "언제·어느 자리" 조건. 적힌 항목만 보고, 여러 값은 그중 하나면 해당 */
export interface RuleWhenDoc {
  dates?: string[];
  periods?: number[];
  grades?: number[];
  roles?: ('CHIEF' | 'ASSISTANT' | 'STUDY' | 'EXTENDED' | 'HALLWAY')[];
  subjects?: string[];
  roomIds?: string[];
  ownHomeroom?: boolean;
}

/** sessions/{sid}/constraints/{id} — 배정 예외 규칙 */
export interface ConstraintDoc {
  /** '*' = 모든 교사 */
  teacherId: string;
  type: 'HOMEROOM_EXCLUDE' | 'SLOT_EXCLUDE' | 'SUBJECT_EXCLUDE' | 'RULE';
  target?: string;
  when?: RuleWhenDoc;
  /** HARD = 금지, SOFT = 점수 가감 (penalty 음수 = 피하기, 양수 = 우선) */
  priority: 'HARD' | 'SOFT';
  penalty?: number;
  /** 사람이 읽는 설명 (예: "김국어: 11/3 1교시 감독 금지") */
  label?: string;
  /** 관리자가 쓴 원래 문장 (AI로 만든 규칙) */
  sourceText?: string;
}

export type SeatRole = 'CHIEF' | 'ASSISTANT' | 'STUDY' | 'EXTENDED' | 'HALLWAY';

export const SEAT_ROLE_LABEL: Record<SeatRole, string> = {
  CHIEF: '정감독',
  ASSISTANT: '부감독',
  STUDY: '자습감독',
  EXTENDED: '연장감독',
  HALLWAY: '복도',
};

/** sessions/{sid}/assignments/{seatId} — 좌석 1개 = 교사 1명 */
export interface AssignmentDoc {
  slotId: string;
  groupId: string;
  roomId: string;
  role: SeatRole;
  weight: number;
  teacherId: string;
  score: number;
  reason: string;
  source: 'AUTO' | 'MANUAL';
  date: string;
  period: number;
  runId: string | null;
}

export interface RunMetrics {
  seatCount: number;
  assignedCount: number;
  successRate: number;
  stdDev: number;
  maxMinGap: number;
  /** 같은 날 연속 교시 배정 쌍 수 */
  consecutiveCount: number;
  /** 과목 담당(출제) 교사가 자기 과목 시험 교실 감독을 맡은 수 */
  subjectInRoom: number;
  /** 이번 시험 감독 횟수 최다-최소 차 (예전 실행 기록에는 없음) */
  countGap?: number;
}

export interface RunAssignment extends Omit<AssignmentDoc, 'runId'> {
  seatId: string;
}

export interface RunUnassigned {
  seatId: string;
  slotId: string;
  roomId: string;
  role: SeatRole;
  date: string;
  period: number;
  message: string;
}

/** sessions/{sid}/runs/{runId} — 자동 배정 실행 결과 (적용 전 미리보기) */
export interface RunDoc {
  createdBy: string;
  /** 다중 시나리오: 같은 실행에서 만든 안들은 batchId가 같다 */
  batchId: string;
  scenario: string;
  scenarioLabel: string;
  scenarioDescription: string;
  settings: { useBaseTimetable: boolean; keepManual: boolean };
  metrics: RunMetrics;
  /** 교사별 [이번 세션 부담, 누적 부담] */
  loads: Record<string, [number, number]>;
  assignments: RunAssignment[];
  unassigned: RunUnassigned[];
  rejectedPinned: string[];
  applied: boolean;
  elapsedMs: number;
}

export type AccessKind = 'TEACHER' | 'ADMIN';
export type AccessStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

/** accessRequests/{uid} — 가입(교사) 또는 관리자 권한 신청. 승인·반려는 서버 함수만 */
export interface AccessRequestDoc {
  uid: string;
  /** 로그인한 Google 계정 이메일 (소문자) — 승인 후 이 계정으로 로그인 */
  email: string;
  name: string;
  subject: string | null;
  kind: AccessKind;
  status: AccessStatus;
  note: string | null;
  /** 교사 가입: 소속 학교·학년도·학기 (승인하면 이 학교·학기 명단에 등록) */
  school?: string | null;
  year?: number | null;
  semester?: number | null;
}

export const ACCESS_KIND_LABEL: Record<AccessKind, string> = { TEACHER: '교사(사용자)', ADMIN: '관리자' };

export type WithId<T> = T & { id: string };

export function slotIdOf(date: string, period: number, grade: number): string {
  return `${date}_${period}_${grade}`;
}

export function groupIdOf(slotId: string, roomId: string): string {
  return `${slotId}__${roomId}`;
}

/**
 * 감독구분: 배정 전에 정하는 감독 가능 자리 (정·부감독 역할은 배정 엔진이 정한다).
 * EXCLUDED는 예전 데이터 호환용이며, 새로 입력할 때는 사용여부 N을 쓴다.
 */
export const DEFAULT_ROLE_LABEL: Record<DefaultRole, string> = {
  NORMAL: '일반',
  HALLWAY: '복도전담',
  EXCLUDED: '감독제외',
};

/** 양식·화면에서 고를 수 있는 감독구분 */
export const SELECTABLE_ROLES: DefaultRole[] = ['NORMAL', 'HALLWAY'];

/** 양식에 내보낼 감독구분·사용여부 (예전 EXCLUDED는 일반 + N) */
export function teacherRoleCells(t: Pick<TeacherDoc, 'defaultRole' | 'active'>): [string, 'Y' | 'N'] {
  const excluded = t.defaultRole === 'EXCLUDED';
  return [DEFAULT_ROLE_LABEL[excluded ? 'NORMAL' : t.defaultRole], t.active && !excluded ? 'Y' : 'N'];
}

export const SPACE_TYPE_LABEL: Record<SpaceType, string> = {
  CLASSROOM: '교실',
  SEPARATE: '별도실',
  HALLWAY: '복도',
};

export const SLOT_TYPE_LABEL: Record<SlotType, string> = {
  EXAM: '시험',
  STUDY: '자습',
};

export const PLACEMENT_ROOM_TYPE_LABEL: Record<PlacementRoomType, string> = {
  NORMAL: '일반',
  EXTENDED: '연장',
  SPECIAL: '특수',
};

export const AVAILABILITY_STATUS_LABEL: Record<AvailabilityStatus, string> = {
  PENDING: '승인 대기',
  APPROVED: '승인',
  REJECTED: '반려',
};

export const AVAILABILITY_REASONS = ['출장', '연수', '병가', '공가', '기타'] as const;

export const WEEKDAY_LABEL =['', '월', '화', '수', '목', '금', '토', '일'] as const;

/** 교사 ID 자동 생성: 기존 최대 번호 + 1 (T001, T002 …) */
export function nextId(prefix: string, existing: string[], count = 1): string[] {
  const re = new RegExp(`^${prefix}(\\d+)$`);
  let max = 0;
  for (const id of existing) {
    const m = id.match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return Array.from({ length: count }, (_, i) => `${prefix}${String(max + i + 1).padStart(3, '0')}`);
}

// ───────── 교사 교환 요청: sessions/{sid}/swapRequests/{id} (함수만 쓴다) ─────────

export type SwapKind = 'SWAP' | 'HANDOVER';
export type SwapStatus = 'PENDING_PEERS' | 'PENDING_ADMIN' | 'APPROVED' | 'REJECTED' | 'DECLINED' | 'CANCELLED' | 'FAILED';
export type SwapResponse = 'PENDING' | 'ACCEPTED' | 'DECLINED';

export interface SwapMoveDoc {
  seatId: string;
  /** 지금 맡은 교사 */
  from: string;
  /** 새로 맡을 교사 */
  to: string;
  /** "10/12 1교시 1-1 정감독" */
  label: string;
}

export interface SwapRequestDoc {
  requesterId: string;
  kind: SwapKind;
  moves: SwapMoveDoc[];
  /** 관련 교사 전체 (요청자 포함) — 교사는 자기가 들어 있는 요청만 읽는다 */
  parties: string[];
  /** 요청자를 뺀 교사들의 수락 여부 */
  responses: Record<string, SwapResponse>;
  status: SwapStatus;
  reason: string | null;
  /** 반려 사유·실패 사유 */
  note: string | null;
  /** 사람이 읽는 설명 ("김국어 ← 10/12 1교시 1-1 정감독 (이수학 대신)") */
  summary: string[];
}

export const SWAP_STATUS_LABEL: Record<SwapStatus, string> = {
  PENDING_PEERS: '동료 교사 수락 대기',
  PENDING_ADMIN: '관리자 승인 대기',
  APPROVED: '승인·반영됨',
  REJECTED: '관리자 반려',
  DECLINED: '동료 교사 거절',
  CANCELLED: '요청 취소',
  FAILED: '반영 실패',
};

export const OPEN_SWAP_STATUSES: SwapStatus[] = ['PENDING_PEERS', 'PENDING_ADMIN'];
