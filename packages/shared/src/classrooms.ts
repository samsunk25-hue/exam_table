// 학년별 학급 수로 교실·복도 시험실을 한 번에 만든다. 특별실(별도실)은 건드리지 않는다.
import { nextId, type RoomDoc, type WithId } from './model';

export interface ClassroomConfig {
  /** 학년별 학급 수 (index 0 = 1학년) */
  classCounts: number[];
  /** 시험을 치지 않는 교실 "학년-반" */
  skipped: Set<string>;
  /** 학년별 복도 시험실 생성 여부 */
  hallways: boolean;
  chiefCount: number;
  assistantCount: number;
}

export interface ClassroomPlan {
  upsert: WithId<RoomDoc>[];
  remove: WithId<RoomDoc>[];
  created: number;
}

export const classroomName = (grade: number, classNo: number) => `${grade}-${classNo}`;
export const hallwayName = (grade: number) => `${grade}학년 복도`;

/** 자동 생성 대상(학년·반이 있는 교실, 학년이 있는 복도)인지 */
export function isGeneratedRoom(r: RoomDoc): boolean {
  return (r.spaceType === 'CLASSROOM' && r.grade !== null && r.classNo !== null) || (r.spaceType === 'HALLWAY' && r.grade !== null);
}

/** 기존 시험실에서 설정 화면의 초기값을 만든다 */
export function configFromRooms(rooms: RoomDoc[], fallbackGrades = 3): ClassroomConfig {
  const classrooms = rooms.filter((r) => r.spaceType === 'CLASSROOM' && r.grade !== null && r.classNo !== null);
  const grades = Math.max(fallbackGrades, ...classrooms.map((r) => r.grade!));
  const classCounts = Array.from({ length: grades }, (_, i) =>
    Math.max(0, ...classrooms.filter((r) => r.grade === i + 1).map((r) => r.classNo!)),
  );
  const existing = new Set(classrooms.map((r) => classroomName(r.grade!, r.classNo!)));
  const skipped = new Set<string>();
  classCounts.forEach((n, i) => {
    for (let c = 1; c <= n; c++) if (!existing.has(classroomName(i + 1, c))) skipped.add(classroomName(i + 1, c));
  });
  const sample = classrooms[0];
  return {
    classCounts,
    skipped,
    hallways: rooms.length === 0 || rooms.some((r) => r.spaceType === 'HALLWAY' && r.grade !== null),
    chiefCount: sample?.chiefCount ?? 1,
    assistantCount: sample?.assistantCount ?? 0,
  };
}

/** 설정 → 저장할 시험실(신규·수정)과 삭제할 시험실 */
/** takenIds: 새 ID가 겹치면 안 되는 전체 ID (다른 학기 시험실 포함) */
export function planClassrooms(config: ClassroomConfig, rooms: WithId<RoomDoc>[], takenIds?: string[]): ClassroomPlan {
  const wanted: RoomDoc[] = [];
  config.classCounts.forEach((count, i) => {
    const grade = i + 1;
    let any = false;
    for (let c = 1; c <= count; c++) {
      if (config.skipped.has(classroomName(grade, c))) continue;
      any = true;
      wanted.push({
        name: classroomName(grade, c),
        spaceType: 'CLASSROOM',
        grade,
        classNo: c,
        chiefCount: config.chiefCount,
        assistantCount: config.assistantCount,
      });
    }
    if (config.hallways && any) {
      wanted.push({ name: hallwayName(grade), spaceType: 'HALLWAY', grade, classNo: null, chiefCount: 1, assistantCount: 0 });
    }
  });

  const byName = new Map(rooms.map((r) => [r.name, r]));
  const newIds = nextId('R', takenIds ?? rooms.map((r) => r.id), wanted.filter((w) => !byName.has(w.name)).length);
  let n = 0;
  const upsert = wanted.map((w) => {
    const prev = byName.get(w.name);
    // 복도의 감독 수는 기존 값을 유지한다 (직접 바꿨을 수 있음)
    const keep = prev && w.spaceType === 'HALLWAY' ? { chiefCount: prev.chiefCount, assistantCount: prev.assistantCount } : {};
    return { ...w, ...keep, id: prev?.id ?? newIds[n++]! };
  });
  const keepNames = new Set(wanted.map((w) => w.name));
  const remove = rooms.filter((r) => isGeneratedRoom(r) && !keepNames.has(r.name));
  return { upsert, remove, created: n };
}
