import type { TimetableEntry } from '../model';
import { finish, flagDuplicates, readRows, type Cell, type ColumnMapping, type FieldDef, type ImportResult } from './core';

export const TIMETABLE_FIELDS: FieldDef[] = [
  { key: 'teacher', label: '교사', required: true, synonyms: ['이름', '교사명', '성명', '이메일'], note: '교사 이름 (동명이인은 이메일)' },
  { key: 'weekday', label: '요일', required: true, note: '월 / 화 / 수 / 목 / 금' },
  { key: 'period', label: '교시', required: true },
  { key: 'grade', label: '학년', required: true },
  { key: 'classNo', label: '반', required: true },
  { key: 'subject', label: '과목', required: false, synonyms: ['교과'] },
];

export interface TimetableTeacher {
  id: string;
  name: string;
  email: string | null;
  active: boolean;
}

export interface TimetableImport extends TimetableEntry {
  teacherId: string;
  teacherName: string;
}

export function parseTimetable(
  dataRows: Cell[][],
  mapping: ColumnMapping,
  teachers: TimetableTeacher[],
): ImportResult<TimetableImport> {
  const active = teachers.filter((t) => t.active);

  const rows = readRows(dataRows, mapping, TIMETABLE_FIELDS, (r) => {
    const who = r.text('teacher', true);
    const weekday = r.weekday('weekday', true);
    const period = r.int('period', { required: true, min: 1, max: 10 });
    const grade = r.int('grade', { required: true, min: 1, max: 6 });
    const classNo = r.int('classNo', { required: true, min: 1, max: 30 });
    const subject = r.text('subject');

    let teacher: TimetableTeacher | undefined;
    if (who) {
      const matches = who.includes('@')
        ? active.filter((t) => t.email === who.toLowerCase())
        : active.filter((t) => t.name === who);
      if (matches.length === 0) r.errors.push(`"${who}"은(는) 교사 명단에 없습니다.`);
      else if (matches.length > 1) r.errors.push(`동명이인 "${who}"이(가) 있습니다. 이메일로 입력해 주세요.`);
      else teacher = matches[0];
    }
    if (weekday !== null && weekday > 5) r.errors.push('토·일요일 수업은 입력할 수 없습니다.');

    if (!teacher || weekday === null || period === null || grade === null || classNo === null) return null;
    return { teacherId: teacher.id, teacherName: teacher.name, weekday, period, grade, classNo, subject };
  });

  flagDuplicates(
    rows,
    (v) => `${v.teacherId}|${v.weekday}|${v.period}`,
    (_, first) => `같은 교사의 같은 요일·교시 수업이 ${first}행과 중복됩니다.`,
  );

  return finish(rows);
}

/** 교사별 문서로 묶는다 (sessions/{sid}/baseTimetable/{teacherId}) */
export function groupTimetable(values: TimetableImport[]): Map<string, TimetableEntry[]> {
  const out = new Map<string, TimetableEntry[]>();
  for (const { teacherId, teacherName: _name, ...entry } of values) {
    const list = out.get(teacherId) ?? [];
    list.push(entry);
    out.set(teacherId, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.weekday - b.weekday || a.period - b.period);
  return out;
}
