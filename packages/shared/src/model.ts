// Firestore 문서 구조 (PRD 6장). 웹과 Cloud Functions가 공유한다.

export type DefaultRole = 'NORMAL' | 'HALLWAY' | 'EXCLUDED';
export type SpaceType = 'CLASSROOM' | 'SEPARATE' | 'HALLWAY';
export type SlotType = 'EXAM' | 'STUDY';
export type PlacementRoomType = 'NORMAL' | 'EXTENDED' | 'SPECIAL';

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
  cumulativeLoad: number;
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
}

/** 시험 1건에 배치된 시험실 (엔진의 Group에 해당, groupId = `${slotId}__${roomId}`) */
export interface Placement {
  roomId: string;
  classNo: number | null;
  headcount: number | null;
  roomType: PlacementRoomType;
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
