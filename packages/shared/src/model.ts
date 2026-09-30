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

export type WithId<T> = T & { id: string };

export function slotIdOf(date: string, period: number, grade: number): string {
  return `${date}_${period}_${grade}`;
}

export function groupIdOf(slotId: string, roomId: string): string {
  return `${slotId}__${roomId}`;
}

export const DEFAULT_ROLE_LABEL: Record<DefaultRole, string> = {
  NORMAL: '일반',
  HALLWAY: '복도대기',
  EXCLUDED: '제외',
};

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

export const WEEKDAY_LABEL = ['', '월', '화', '수', '목', '금', '토', '일'] as const;

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
