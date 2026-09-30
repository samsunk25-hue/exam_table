import type { SpaceType } from '../model';
import { finish, flagDuplicates, readRows, type Cell, type ColumnMapping, type FieldDef, type ImportResult } from './core';

export const ROOM_FIELDS: FieldDef[] = [
  { key: 'name', label: '실명', required: true, synonyms: ['시험실', '교실명', '이름', '장소'], note: '예: 1-1, 1학년 복도, 별도시험장' },
  {
    key: 'spaceType',
    label: '공간유형',
    required: false,
    synonyms: ['유형', '구분'],
    note: '교실 / 별도실 / 복도 (비우면 교실)',
    options: ['교실', '별도실', '복도'],
  },
  { key: 'grade', label: '학년', required: false, note: '교실·복도의 담당 학년 (기본 배치 자동 생성에 사용)' },
  { key: 'classNo', label: '반', required: false, note: '교실의 반 번호' },
  { key: 'chiefCount', label: '정감독수', required: false, synonyms: ['정감독'], note: '비우면 1' },
  { key: 'assistantCount', label: '부감독수', required: false, synonyms: ['부감독'], note: '비우면 0' },
];

export interface ExistingRoom {
  id: string;
  name: string;
}

export interface RoomImport {
  id: string | null;
  name: string;
  spaceType: SpaceType;
  grade: number | null;
  classNo: number | null;
  chiefCount: number;
  assistantCount: number;
}

const SPACE_OPTIONS: Record<string, SpaceType> = {
  교실: 'CLASSROOM',
  별도실: 'SEPARATE',
  별도시험장: 'SEPARATE',
  복도: 'HALLWAY',
};

export function parseRooms(dataRows: Cell[][], mapping: ColumnMapping, existing: ExistingRoom[]): ImportResult<RoomImport> {
  const byName = new Map(existing.map((r) => [r.name, r.id]));

  const rows = readRows(dataRows, mapping, ROOM_FIELDS, (r) => {
    const name = r.text('name', true);
    const spaceType = r.choice('spaceType', SPACE_OPTIONS, { fallback: 'CLASSROOM' });
    const grade = r.int('grade', { min: 1, max: 6 });
    const classNo = r.int('classNo', { min: 1, max: 30 });
    const chiefCount = r.int('chiefCount', { min: 0, max: 5 }) ?? (r.errors.length ? null : 1);
    const assistantCount = r.int('assistantCount', { min: 0, max: 5 }) ?? (r.errors.length ? null : 0);

    if (chiefCount !== null && assistantCount !== null && chiefCount + assistantCount === 0) {
      r.errors.push('정감독수와 부감독수가 모두 0입니다.');
    }
    if (spaceType === 'CLASSROOM' && classNo !== null && grade === null) {
      r.errors.push('반을 입력한 교실은 학년도 입력해야 합니다.');
    }
    if (spaceType !== 'CLASSROOM' && classNo !== null) {
      r.errors.push('반 번호는 교실에만 입력합니다.');
    }

    if (!name || !spaceType || chiefCount === null || assistantCount === null) return null;
    return { id: byName.get(name) ?? null, name, spaceType, grade, classNo, chiefCount, assistantCount };
  });

  flagDuplicates(rows, (v) => v.name, (key, first) => `실명 "${key}"이(가) ${first}행과 중복됩니다.`);
  flagDuplicates(
    rows,
    (v) => (v.spaceType === 'CLASSROOM' && v.grade !== null && v.classNo !== null ? `${v.grade}-${v.classNo}` : null),
    (key, first) => `${key}반 교실이 ${first}행과 중복됩니다.`,
  );

  return finish(rows);
}
