// 기초 자료 통합 양식: 파일 하나에 교사·시험실·시험일정·시험실배치·교사별 기초시간표를 담는다.
// 시트가 없거나 제목 행만 있으면 그 항목은 "변경 없음"으로 본다.
import { nextId, type RoomDoc, type SlotDoc, type TeacherDoc, type WithId } from '../model';
import {
  autoMap,
  finish,
  isBlankRow,
  missingRequired,
  splitHeader,
  type Cell,
  type FieldDef,
  type ImportResult,
  type SheetRows,
} from './core';
import { ROOM_FIELDS, parseRooms, type RoomImport } from './rooms';
import { PLACEMENT_FIELDS, SLOT_FIELDS, parsePlacements, parseSlots, type PlacementImport, type SlotImport } from './schedule';
import { TEACHER_FIELDS, parseTeachers, type HomeroomTakeover, type TeacherImport } from './teachers';
import type { TimetableImport, TimetableTeacher } from './timetable';
import { isGridSheet, parseTimetableGrid } from './timetableGrid';

export const BUNDLE_SHEETS = {
  guide: '안내',
  teachers: '교사',
  rooms: '시험실',
  slots: '시험일정',
  placements: '시험실배치',
} as const;

export type BundleKey = 'teachers' | 'rooms' | 'slots' | 'placements' | 'timetable';

export interface BundleSection {
  key: BundleKey;
  label: string;
  /** 파일에 해당 내용이 있는지 (없으면 변경 없음) */
  present: boolean;
  result: ImportResult<unknown> | null;
  /** 오류는 아니지만 알려야 할 내용 */
  notes: string[];
}

export interface BundlePlan {
  /** 새 교사는 id가 미리 배정되어 있다 */
  teachers: (Omit<TeacherImport, 'id'> & { id: string; isNew: boolean })[];
  /** 파일 교사에게 담임을 넘기고 담임이 풀리는 기존 교사 */
  homeroomTakeovers: HomeroomTakeover[];
  rooms: (Omit<RoomImport, 'id'> & { id: string; isNew: boolean })[];
  /** null이면 시험 일정 변경 없음 */
  slots: SlotImport[] | null;
  placements: PlacementImport[] | null;
  timetable: TimetableImport[] | null;
}

export interface BundleContext {
  teachers: WithId<TeacherDoc>[];
  rooms: WithId<RoomDoc>[];
  slots: WithId<SlotDoc>[];
  useBaseTimetable: boolean;
  /** 새 ID를 만들 때 피할 ID (다른 학기 명단 포함). 없으면 teachers/rooms의 ID */
  takenIds?: string[];
  /** 시험 일정·기초시간표를 바꿀 수 있는 단계인지 */
  scheduleEditable: boolean;
}

export interface BundleResult {
  sections: BundleSection[];
  plan: BundlePlan;
  errorCount: number;
}

function tableSheet(sheets: SheetRows[], name: string, fields: FieldDef[]) {
  const sheet = sheets.find((s) => s.name.trim() === name);
  if (!sheet) return null;
  const { header, data } = splitHeader(sheet.rows);
  if (!data.some((r) => !isBlankRow(r))) return null;
  const mapping = autoMap(header, fields);
  return { data, mapping, missing: missingRequired(mapping, fields) };
}

function values<T>(r: ImportResult<T>): T[] {
  return r.rows.flatMap((x) => (x.value ? [x.value] : []));
}

function blocked(message: string): ImportResult<never> {
  return finish([], [message]);
}

export function analyzeBundle(sheets: SheetRows[], ctx: BundleContext): BundleResult {
  const sections: BundleSection[] = [];
  const plan: BundlePlan = { teachers: [], homeroomTakeovers: [], rooms: [], slots: null, placements: null, timetable: null };
  const add = (key: BundleKey, label: string, result: ImportResult<unknown> | null, notes: string[] = []) =>
    sections.push({ key, label, present: result !== null, result, notes });

  // 1. 교사
  const tSheet = tableSheet(sheets, BUNDLE_SHEETS.teachers, TEACHER_FIELDS);
  let teacherList: TimetableTeacher[] = ctx.teachers.map((t) => ({ id: t.id, name: t.name, email: t.email, active: t.active }));
  if (tSheet) {
    const r = tSheet.missing.length
      ? blocked(`필수 열이 없습니다: ${tSheet.missing.join(', ')}`)
      : parseTeachers(tSheet.data, tSheet.mapping, ctx.teachers, { takeover: plan.homeroomTakeovers });
    const vs = values(r);
    const newIds = nextId('T', ctx.takenIds ?? ctx.teachers.map((t) => t.id), vs.filter((v) => !v.id).length);
    let n = 0;
    plan.teachers = vs.map((v) => (v.id ? { ...v, id: v.id, isNew: false } : { ...v, id: newIds[n++]!, isNew: true }));
    const byId = new Map(teacherList.map((t) => [t.id, t]));
    for (const t of plan.teachers) byId.set(t.id, { id: t.id, name: t.name, email: t.email, active: t.active });
    teacherList = [...byId.values()];
    add(
      'teachers',
      '교사',
      r,
      plan.homeroomTakeovers.map((h) => `${h.grade}-${h.classNo}반 담임: 기존 ${h.fromName} → ${h.toName} (기존 교사의 담임은 해제됩니다)`),
    );
  } else add('teachers', '교사', null);

  // 2. 시험실
  const rSheet = tableSheet(sheets, BUNDLE_SHEETS.rooms, ROOM_FIELDS);
  let roomList: WithId<Pick<RoomDoc, 'name'>>[] = ctx.rooms.map((r) => ({ id: r.id, name: r.name }));
  if (rSheet) {
    const r = rSheet.missing.length
      ? blocked(`필수 열이 없습니다: ${rSheet.missing.join(', ')}`)
      : parseRooms(rSheet.data, rSheet.mapping, roomList);
    const vs = values(r);
    const newIds = nextId('R', ctx.takenIds ?? ctx.rooms.map((x) => x.id), vs.filter((v) => !v.id).length);
    let n = 0;
    plan.rooms = vs.map((v) => (v.id ? { ...v, id: v.id, isNew: false } : { ...v, id: newIds[n++]!, isNew: true }));
    const byId = new Map(roomList.map((x) => [x.id, x]));
    for (const x of plan.rooms) byId.set(x.id, { id: x.id, name: x.name });
    roomList = [...byId.values()];
    add('rooms', '시험실', r);
  } else add('rooms', '시험실', null);

  // 3. 시험 일정 (교체)
  const sSheet = tableSheet(sheets, BUNDLE_SHEETS.slots, SLOT_FIELDS);
  let slotList: WithId<Pick<SlotDoc, 'date' | 'period' | 'grade'>>[] = ctx.slots;
  if (sSheet) {
    const r = !ctx.scheduleEditable
      ? blocked('교사 공개 이후에는 시험 일정을 바꿀 수 없습니다.')
      : sSheet.missing.length
        ? blocked(`필수 열이 없습니다: ${sSheet.missing.join(', ')}`)
        : parseSlots(sSheet.data, sSheet.mapping);
    plan.slots = values(r);
    slotList = plan.slots;
    const removed = ctx.slots.filter((s) => !plan.slots!.some((v) => v.id === s.id)).length;
    add('slots', '시험 일정', r, removed ? [`파일에 없는 기존 시험 ${removed}건은 삭제됩니다.`] : []);
  } else add('slots', '시험 일정', null);

  // 4. 시험실 배치 (파일에 있는 시험만 교체)
  const pSheet = tableSheet(sheets, BUNDLE_SHEETS.placements, PLACEMENT_FIELDS);
  if (pSheet) {
    const r = !ctx.scheduleEditable
      ? blocked('교사 공개 이후에는 시험실 배치를 바꿀 수 없습니다.')
      : pSheet.missing.length
        ? blocked(`필수 열이 없습니다: ${pSheet.missing.join(', ')}`)
        : parsePlacements(pSheet.data, pSheet.mapping, slotList, roomList);
    plan.placements = values(r);
    add('placements', '시험실 배치', r);
  } else add('placements', '시험실 배치', null);

  // 5. 기초시간표 (교사별 격자 시트, 전체 교체)
  const tableNames = new Set<string>(Object.values(BUNDLE_SHEETS));
  const gridSheets = sheets.filter((s) => !tableNames.has(s.name.trim()) && isGridSheet(s.rows));
  const hasEntries = gridSheets.some((s) => s.rows.slice(1).some((row) => row.slice(1).some((c: Cell) => c !== null && String(c).trim() !== '')));
  if (hasEntries) {
    if (!ctx.useBaseTimetable) {
      add('timetable', '기초시간표', null, ['이 프로젝트는 기초시간표를 반영하지 않으므로 시간표 시트는 무시합니다.']);
    } else {
      const r = !ctx.scheduleEditable
        ? blocked('교사 공개 이후에는 기초시간표를 바꿀 수 없습니다.')
        : parseTimetableGrid(gridSheets, teacherList);
      plan.timetable = values(r);
      add('timetable', '기초시간표', r);
    }
  } else add('timetable', '기초시간표', null);

  const errorCount = sections.reduce((n, s) => n + (s.result ? s.result.errorCount + s.result.fileErrors.length : 0), 0);
  return { sections, plan, errorCount };
}
