import { slotIdOf, type Placement, type PlacementRoomType, type RoomDoc, type SlotDoc, type SlotType, type WithId } from '../model';
import { finish, flagDuplicates, readRows, type Cell, type ColumnMapping, type FieldDef, type ImportResult } from './core';

export const SLOT_FIELDS: FieldDef[] = [
  { key: 'date', label: '날짜', required: true, synonyms: ['일자', '시험일'], note: '예: 2026-10-12' },
  { key: 'period', label: '교시', required: true },
  { key: 'startTime', label: '시작시간', required: false, synonyms: ['시작'], note: '예: 09:00' },
  { key: 'endTime', label: '종료시간', required: false, synonyms: ['종료'], note: '예: 09:45' },
  { key: 'grade', label: '학년', required: true },
  { key: 'subject', label: '과목', required: true, synonyms: ['교과', '시험과목'] },
  { key: 'type', label: '유형', required: false, note: '시험 / 자습 (비우면 시험)', options: ['시험', '자습'] },
];

export const PLACEMENT_FIELDS: FieldDef[] = [
  { key: 'date', label: '날짜', required: true, synonyms: ['일자', '시험일'] },
  { key: 'period', label: '교시', required: true },
  { key: 'grade', label: '학년', required: true },
  { key: 'room', label: '시험실', required: true, synonyms: ['실명', '교실', '장소'], note: '시험실 관리에 등록된 실명. 특별실만 적으면 같은 학년 교실·복도 자동 배치에 더해짐' },
  { key: 'classNo', label: '반', required: false, note: '해당 시험실에서 응시하는 반 (혼합이면 비움)' },
  { key: 'headcount', label: '응시인원', required: false, synonyms: ['인원'] },
  {
    key: 'roomType',
    label: '시험실유형',
    required: false,
    synonyms: ['유형'],
    note: '일반 / 연장 / 특수 (비우면 일반)',
    options: ['일반', '연장', '특수'],
  },
  { key: 'startTime', label: '별도시작', required: false, synonyms: ['별도 시작', '별도시작시간'], note: '특별실을 시험 시간과 다르게 운영할 때만 (예: 09:00)' },
  { key: 'endTime', label: '별도종료', required: false, synonyms: ['별도 종료', '별도종료시간'], note: '예: 10:10 (비우면 시험 시간과 같음)' },
];

export interface SlotImport extends Omit<SlotDoc, 'rooms'> {
  id: string;
}

const SLOT_TYPES: Record<string, SlotType> = { 시험: 'EXAM', 자습: 'STUDY' };
const ROOM_TYPES: Record<string, PlacementRoomType> = { 일반: 'NORMAL', 연장: 'EXTENDED', 특수: 'SPECIAL' };

export function parseSlots(dataRows: Cell[][], mapping: ColumnMapping): ImportResult<SlotImport> {
  const rows = readRows(dataRows, mapping, SLOT_FIELDS, (r) => {
    const date = r.date('date', true);
    const period = r.int('period', { required: true, min: 1, max: 10 });
    const startTime = r.time('startTime');
    const endTime = r.time('endTime');
    const grade = r.int('grade', { required: true, min: 1, max: 6 });
    const subject = r.text('subject', true);
    const type = r.choice('type', SLOT_TYPES, { fallback: 'EXAM' });
    if (startTime && endTime && startTime >= endTime) r.errors.push('종료시간이 시작시간보다 빠르거나 같습니다.');

    if (!date || period === null || grade === null || !subject || !type) return null;
    return { id: slotIdOf(date, period, grade), date, period, startTime, endTime, grade, subject, type };
  });

  flagDuplicates(rows, (v) => v.id, (_, first) => `같은 날짜·교시·학년 시험이 ${first}행과 중복됩니다.`);
  return finish(rows);
}

export interface PlacementImport {
  slotId: string;
  placement: Placement;
}

export function parsePlacements(
  dataRows: Cell[][],
  mapping: ColumnMapping,
  slots: WithId<Pick<SlotDoc, 'date' | 'period' | 'grade'>>[],
  rooms: WithId<Pick<RoomDoc, 'name'>>[],
): ImportResult<PlacementImport & { date: string; period: number }> {
  const slotIds = new Set(slots.map((s) => s.id));
  const roomByName = new Map(rooms.map((r) => [r.name, r.id]));

  const rows = readRows(dataRows, mapping, PLACEMENT_FIELDS, (r) => {
    const date = r.date('date', true);
    const period = r.int('period', { required: true, min: 1, max: 10 });
    const grade = r.int('grade', { required: true, min: 1, max: 6 });
    const roomName = r.text('room', true);
    const classNo = r.int('classNo', { min: 1, max: 30 });
    const headcount = r.int('headcount', { min: 0, max: 500 });
    const roomType = r.choice('roomType', ROOM_TYPES, { fallback: 'NORMAL' });
    const startTime = r.time('startTime');
    const endTime = r.time('endTime');
    if ((startTime === null) !== (endTime === null)) r.errors.push('별도시작과 별도종료는 함께 입력하거나 함께 비워야 합니다.');
    else if (startTime && endTime && startTime >= endTime) r.errors.push('별도종료가 별도시작보다 빠릅니다.');

    const slotId = date && period !== null && grade !== null ? slotIdOf(date, period, grade) : null;
    if (slotId && !slotIds.has(slotId)) r.errors.push(`시험 일정에 ${date} ${period}교시 ${grade}학년 시험이 없습니다.`);
    const roomId = roomName ? roomByName.get(roomName) : undefined;
    if (roomName && !roomId) r.errors.push(`시험실 "${roomName}"이(가) 시험실 관리에 없습니다.`);

    if (!slotId || !roomId || !roomType || !date || period === null) return null;
    return { slotId, date, period, placement: { roomId, classNo, headcount, roomType, ...(startTime && endTime ? { startTime, endTime } : {}) } };
  });

  flagDuplicates(
    rows,
    (v) => `${v.date}|${v.period}|${v.placement.roomId}`,
    (_, first) => `같은 시간에 같은 시험실이 ${first}행에서 이미 쓰입니다.`,
  );
  return finish(rows);
}

export function groupPlacements(values: PlacementImport[]): Map<string, Placement[]> {
  const out = new Map<string, Placement[]>();
  for (const v of values) {
    const list = out.get(v.slotId) ?? [];
    list.push(v.placement);
    out.set(v.slotId, list);
  }
  return out;
}

/** 학년이 같은 교실(반 번호 있음)과 복도를 기본 배치한다. 별도실은 수동 배치. */
export function autoPlacements(slot: Pick<SlotDoc, 'grade'> & { type?: SlotType }, rooms: WithId<RoomDoc>[]): Placement[] {
  // 자습 시간에는 복도 감독이 필요 없으므로 교실만 배치한다
  const withHallway = slot.type !== 'STUDY';
  return rooms
    .filter(
      (r) =>
        r.grade === slot.grade &&
        ((r.spaceType === 'CLASSROOM' && r.classNo !== null) || (withHallway && r.spaceType === 'HALLWAY')),
    )
    .sort((a, b) => (a.classNo ?? 99) - (b.classNo ?? 99) || a.name.localeCompare(b.name, 'ko'))
    .map((r) => ({
      roomId: r.id,
      classNo: r.spaceType === 'CLASSROOM' ? r.classNo : null,
      headcount: null,
      roomType: 'NORMAL' as const,
    }));
}

/** 교실(학년·반 있음)이나 학년 복도처럼 자동 배치 대상인 시험실인지 */
function isAutoRoom(r: RoomDoc): boolean {
  return (r.spaceType === 'CLASSROOM' && r.grade !== null && r.classNo !== null) || (r.spaceType === 'HALLWAY' && r.grade !== null);
}

/**
 * 시험실배치 시트(선택 항목)의 한 시험 행들을 실제 배치로 바꾼다.
 * - 특별실(별도시험장 등)만 적었으면: 같은 학년 기본 배치(교실 + 복도)에 특별실을 더한다.
 * - 교실·복도까지 적었으면: 적은 그대로 쓴다 (합반, 일부 반 응시 등 직접 지정).
 * busy: 같은 시간 다른 시험이 이미 쓰는 시험실 (자동 배치에서 뺀다)
 */
export function mergePlacements(
  slot: Pick<SlotDoc, 'grade'> & { type?: SlotType },
  listed: Placement[],
  rooms: WithId<RoomDoc>[],
  busy: Set<string> = new Set(),
): Placement[] {
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const onlySpecial = listed.every((p) => {
    const r = roomById.get(p.roomId);
    return r ? !isAutoRoom(r) : true;
  });
  if (!onlySpecial) return listed;
  const listedIds = new Set(listed.map((p) => p.roomId));
  const auto = autoPlacements(slot, rooms).filter((p) => !busy.has(p.roomId) && !listedIds.has(p.roomId));
  return [...auto, ...listed];
}

export type IssueLevel = 'error' | 'warning';

export interface SetupIssue {
  level: IssueLevel;
  message: string;
}

/** 시험 일정·배치 전체 점검. error가 있으면 자동 배정을 실행할 수 없다. */
export function checkSchedule(slots: WithId<SlotDoc>[], rooms: WithId<RoomDoc>[]): SetupIssue[] {
  const issues: SetupIssue[] = [];
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const label = (s: SlotDoc) => `${s.date} ${s.period}교시 ${s.grade}학년 ${s.subject}`;

  if (slots.length === 0) issues.push({ level: 'error', message: '시험 일정이 없습니다.' });

  const usage = new Map<string, string>();
  for (const s of [...slots].sort((a, b) => a.id.localeCompare(b.id))) {
    if (s.rooms.length === 0) issues.push({ level: 'error', message: `${label(s)}: 배치된 시험실이 없습니다.` });
    for (const p of s.rooms) {
      const room = roomById.get(p.roomId);
      if (!room) {
        issues.push({ level: 'error', message: `${label(s)}: 삭제된 시험실이 배치되어 있습니다.` });
        continue;
      }
      const key = `${s.date}|${s.period}|${p.roomId}`;
      const other = usage.get(key);
      if (other) issues.push({ level: 'error', message: `${label(s)}: ${room.name}이(가) 같은 시간 ${other}에도 배치되어 있습니다.` });
      else usage.set(key, label(s));
      if (room.chiefCount + room.assistantCount === 0) {
        issues.push({ level: 'error', message: `${room.name}: 필요한 감독 수가 0입니다.` });
      }
    }
  }
  return issues;
}
