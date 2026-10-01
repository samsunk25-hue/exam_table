import {
  BUNDLE_SHEETS,
  PLACEMENT_FIELDS,
  PLACEMENT_ROOM_TYPE_LABEL,
  ROOM_FIELDS,
  SLOT_FIELDS,
  SLOT_TYPE_LABEL,
  SPACE_TYPE_LABEL,
  TEACHER_FIELDS,
  autoPlacements,
  groupPlacements,
  groupTimetable,
  teacherRoleCells,
  timetableGridRows,
  timetableSheetNames,
  type BaseTimetableDoc,
  type BundlePlan,
  type RoomDoc,
  type SlotDoc,
  type TeacherDoc,
  type WithId,
} from '@sim/shared';
import { commitOps, ref, type BatchOp } from './data';
import { guideSheet, tableSheet, type OutSheet } from './xlsx';

type Teacher = WithId<TeacherDoc>;
type Room = WithId<RoomDoc>;
type Slot = WithId<SlotDoc>;

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, 'ko');

export const TIMETABLE_GUIDE = [
  '* 교사 1명당 시트 1장입니다. 시트 이름 = 교사 이름 (동명이인은 "이름(교사ID)").',
  '* 수업이 있는 칸에 학년-반을 적습니다. 예: 1-3 또는 1-3 국어 (과목은 선택).',
  '* 새 교사를 추가하려면 시트를 복사해 이름을 바꾸세요. 빈 시트는 무시합니다.',
  '* 토·일요일 칸은 비워 두세요.',
];

/** 교사별 기초시간표 시트 (학교 양식: 교시 × 요일) */
export function timetableSheets(teachers: Teacher[], timetable: WithId<BaseTimetableDoc>[]): OutSheet[] {
  const active = teachers.filter((t) => t.active).sort(byName);
  const names = timetableSheetNames(active);
  const entries = new Map(timetable.map((d) => [d.id, d.entries]));
  return active.map((t) => ({
    name: names.get(t.id)!,
    rows: timetableGridRows(entries.get(t.id) ?? []),
    widths: [8, 14, 14, 14, 14, 14, 10, 10],
  }));
}

/** 기초 자료 통합 양식: 현재 데이터가 채워진 상태로 만든다 (비어 있으면 예시 행) */
export function bundleSheets(opts: {
  teachers: Teacher[];
  rooms: Room[];
  slots: Slot[];
  timetable: WithId<BaseTimetableDoc>[];
  useBaseTimetable: boolean;
  /** 샘플처럼 아직 등록되지 않은 교사는 교사ID 칸을 비워 새로 등록되게 한다 */
  blankTeacherIds?: boolean;
}): OutSheet[] {
  const { teachers, rooms, slots, timetable, useBaseTimetable, blankTeacherIds } = opts;
  const roomName = new Map(rooms.map((r) => [r.id, r.name]));
  const sortedSlots = [...slots].sort((a, b) => a.date.localeCompare(b.date) || a.period - b.period || a.grade - b.grade);

  const teacherRows = teachers.length
    ? [...teachers].sort(byName).map((t) => [
        blankTeacherIds ? '' : t.id,
        t.name,
        t.email ?? '',
        t.subject ?? '',
        t.homeroom?.grade ?? '',
        t.homeroom?.classNo ?? '',
        ...teacherRoleCells(t),
      ])
    : [['', '김국어', 'kim@school.kr', '국어', 1, 1, '일반', 'Y']];

  const roomRows = rooms.length
    ? rooms.map((r) => [r.name, SPACE_TYPE_LABEL[r.spaceType], r.grade ?? '', r.classNo ?? '', r.chiefCount, r.assistantCount])
    : [
        ['1-1', '교실', 1, 1, 1, 0],
        ['1학년 복도', '복도', 1, '', 1, 0],
        ['별도시험장', '별도실', '', '', 1, 1],
      ];

  const slotRows = sortedSlots.length
    ? sortedSlots.map((s) => [s.date, s.period, s.startTime ?? '', s.endTime ?? '', s.grade, s.subject, SLOT_TYPE_LABEL[s.type]])
    : [['2026-10-12', 1, '09:00', '09:45', 1, '국어', '시험']];

  const placementRows = sortedSlots.flatMap((s) =>
    s.rooms.map((p) => [s.date, s.period, s.grade, roomName.get(p.roomId) ?? '', p.classNo ?? '', p.headcount ?? '', PLACEMENT_ROOM_TYPE_LABEL[p.roomType]]),
  );

  const guide = guideSheet(BUNDLE_SHEETS.guide, [
    {
      title: '기초 자료 통합 양식 사용법',
      lines: [
        '1. 각 시트를 채운 뒤 이 파일 그대로 "통합 양식 업로드"로 올립니다.',
        '2. 시트를 지우거나 제목 행만 남기면 그 항목은 바꾸지 않습니다.',
        '3. 교사·시험실: 기존 자료는 수정, 없는 자료는 새로 등록합니다 (삭제 없음).',
        '4. 시험일정: 이 프로젝트의 시험 일정 전체를 교체합니다 (파일에 없는 시험은 삭제).',
        '5. 시험실배치: 비워 두면 업로드 후 같은 학년 교실·복도를 자동 배치합니다. 별도시험장은 행을 추가하세요.',
        useBaseTimetable
          ? '6. 교사별 시간표 시트: 학교 기초시간표 양식과 같습니다. 이 프로젝트의 기초시간표 전체를 교체합니다.'
          : '6. 이 프로젝트는 기초시간표를 반영하지 않아 시간표 시트가 없습니다.',
      ],
    },
    { title: `${BUNDLE_SHEETS.teachers} 시트`, fields: TEACHER_FIELDS },
    { title: `${BUNDLE_SHEETS.rooms} 시트`, fields: ROOM_FIELDS },
    { title: `${BUNDLE_SHEETS.slots} 시트`, fields: SLOT_FIELDS },
    { title: `${BUNDLE_SHEETS.placements} 시트`, fields: PLACEMENT_FIELDS },
    ...(useBaseTimetable ? [{ title: '교사별 시간표 시트', lines: TIMETABLE_GUIDE }] : []),
  ]);

  return [
    guide,
    tableSheet(BUNDLE_SHEETS.teachers, TEACHER_FIELDS, teacherRows),
    tableSheet(BUNDLE_SHEETS.rooms, ROOM_FIELDS, roomRows),
    tableSheet(BUNDLE_SHEETS.slots, SLOT_FIELDS, slotRows),
    tableSheet(BUNDLE_SHEETS.placements, PLACEMENT_FIELDS, placementRows),
    ...(useBaseTimetable ? timetableSheets(teachers, timetable) : []),
  ];
}

/**
 * 통합 양식 저장: 교사 → 시험실 → 시험 일정 → 배치 → (배치 없는 시험 자동 배치) → 기초시간표 순서.
 * 단계마다 커밋하므로 중간에 실패하면 앞 단계까지는 저장된다.
 */
export async function saveBundle(
  sid: string,
  plan: BundlePlan,
  ctx: { rooms: Room[]; slots: Slot[]; timetable: WithId<BaseTimetableDoc>[] },
  opts: { autoPlace: boolean },
): Promise<string[]> {
  const done: string[] = [];
  const slotPath = `sessions/${sid}/slots`;

  if (plan.teachers.length) {
    await commitOps(
      plan.teachers.map(({ id, isNew, ...data }) => ({
        type: 'set',
        ref: ref('teachers', id),
        data: isNew ? { ...data, cumulativeLoad: 0 } : data,
        merge: !isNew,
      })),
    );
    done.push(`교사 ${plan.teachers.length}명 (신규 ${plan.teachers.filter((t) => t.isNew).length})`);
  }

  const roomsAfter = new Map(ctx.rooms.map((r) => [r.id, r]));
  if (plan.rooms.length) {
    await commitOps(plan.rooms.map(({ id, isNew: _n, ...data }) => ({ type: 'set', ref: ref('rooms', id), data })));
    for (const { isNew: _n, ...r } of plan.rooms) roomsAfter.set(r.id, r);
    done.push(`시험실 ${plan.rooms.length}개 (신규 ${plan.rooms.filter((r) => r.isNew).length})`);
  }

  // 저장 후 시험 상태를 추적해 자동 배치에 쓴다
  let slotsAfter: Slot[] = ctx.slots;
  if (plan.slots) {
    const existing = new Map(ctx.slots.map((s) => [s.id, s]));
    const keep = new Set(plan.slots.map((s) => s.id));
    const ops: BatchOp[] = plan.slots.map(({ id, ...data }) => ({
      type: 'set',
      ref: ref(slotPath, id),
      data: { ...data, rooms: existing.get(id)?.rooms ?? [] },
    }));
    const removed = ctx.slots.filter((s) => !keep.has(s.id));
    for (const s of removed) ops.push({ type: 'delete', ref: ref(slotPath, s.id) });
    await commitOps(ops);
    slotsAfter = plan.slots.map((s) => ({ ...s, rooms: existing.get(s.id)?.rooms ?? [] }));
    done.push(`시험 일정 ${plan.slots.length}건${removed.length ? ` (삭제 ${removed.length})` : ''}`);
  }

  if (plan.placements && plan.placements.length) {
    const grouped = groupPlacements(plan.placements);
    await commitOps([...grouped].map(([slotId, rooms]) => ({ type: 'set', ref: ref(slotPath, slotId), data: { rooms }, merge: true })));
    slotsAfter = slotsAfter.map((s) => (grouped.has(s.id) ? { ...s, rooms: grouped.get(s.id)! } : s));
    done.push(`시험실 배치 ${grouped.size}건`);
  }

  if (opts.autoPlace) {
    const roomList = [...roomsAfter.values()];
    const used = new Set(slotsAfter.flatMap((s) => s.rooms.map((p) => `${s.date}|${s.period}|${p.roomId}`)));
    const ops: BatchOp[] = [];
    for (const s of slotsAfter.filter((x) => x.rooms.length === 0)) {
      const rooms = autoPlacements(s, roomList).filter((p) => !used.has(`${s.date}|${s.period}|${p.roomId}`));
      rooms.forEach((p) => used.add(`${s.date}|${s.period}|${p.roomId}`));
      if (rooms.length) ops.push({ type: 'set', ref: ref(slotPath, s.id), data: { rooms }, merge: true });
    }
    if (ops.length) {
      await commitOps(ops);
      done.push(`기본 배치 자동 생성 ${ops.length}건`);
    }
  }

  if (plan.timetable) {
    const grouped = groupTimetable(plan.timetable);
    const ops: BatchOp[] = [...grouped].map(([teacherId, entries]) => ({
      type: 'set',
      ref: ref(`sessions/${sid}/baseTimetable`, teacherId),
      data: { teacherId, entries },
    }));
    for (const d of ctx.timetable) if (!grouped.has(d.id)) ops.push({ type: 'delete', ref: ref(`sessions/${sid}/baseTimetable`, d.id) });
    await commitOps(ops);
    done.push(`기초시간표 교사 ${grouped.size}명 · 수업 ${plan.timetable.length}건`);
  }

  return done;
}
