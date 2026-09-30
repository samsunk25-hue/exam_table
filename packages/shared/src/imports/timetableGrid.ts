// 학교 기초시간표 양식: 교사 1명 = 시트 1장, 행 = 교시, 열 = 요일, 칸 = 학년-반 (과목은 선택)
//   교시 | 월요일 | 화요일 | … | 일요일
//   1교시 | 1-3 국어 | …
import { WEEKDAY_LABEL } from '../model';
import { cellText, finish, flagDuplicates, isBlankRow, type Cell, type ImportResult, type RowResult, type SheetRows } from './core';
import type { TimetableImport, TimetableTeacher } from './timetable';

export const GRID_WEEKDAYS = ['월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일'] as const;
export const GRID_PERIODS = 12;

/** 첫 행이 "교시 | 월요일 …" 형태인 시트인지 */
export function isGridSheet(rows: Cell[][]): boolean {
  const header = rows.find((r) => !isBlankRow(r));
  if (!header) return false;
  return cellText(header[0]).replace(/\s/g, '') === '교시' && header.some((c) => cellText(c).startsWith('월'));
}

/** 칸 내용 → 학년·반·과목. "1-3", "1-3 국어", "국어 1-3", "1학년 3반", "103 국어" */
export function parseClassCell(text: string): { grade: number; classNo: number; subject: string | null } | null {
  const t = text.replace(/\s+/g, ' ').trim();
  const patterns: [RegExp, (m: RegExpMatchArray) => [string, string, string]][] = [
    [/^(\d)\s*[-–~.]\s*(\d{1,2})\s*반?\s*(.*)$/, (m) => [m[1]!, m[2]!, m[3]!]],
    [/^(\d)\s*학년\s*(\d{1,2})\s*반\s*(.*)$/, (m) => [m[1]!, m[2]!, m[3]!]],
    [/^(\d)(\d{2})(?:\s+(.*))?$/, (m) => [m[1]!, m[2]!, m[3] ?? '']],
    [/^(.+?)\s*\(?\s*(\d)\s*[-–~.]\s*(\d{1,2})\s*반?\s*\)?$/, (m) => [m[2]!, m[3]!, m[1]!]],
    [/^(.+?)\s*(\d)\s*학년\s*(\d{1,2})\s*반$/, (m) => [m[2]!, m[3]!, m[1]!]],
  ];
  for (const [re, pick] of patterns) {
    const m = t.match(re);
    if (!m) continue;
    const [g, c, s] = pick(m);
    const grade = Number(g);
    const classNo = Number(c);
    if (grade < 1 || grade > 6 || classNo < 1 || classNo > 30) return null;
    const subject = s.replace(/^[\s(]+|[\s)]+$/g, '').trim();
    return { grade, classNo, subject: subject || null };
  }
  return null;
}

/** 시트 이름 → 교사. "이름", "이름(T003)", "T003", 이메일 */
export function resolveSheetTeacher(
  sheetName: string,
  teachers: TimetableTeacher[],
): { teacher: TimetableTeacher } | { error: string } {
  const name = sheetName.trim();
  const withId = name.match(/^(.*)\((\w+)\)$/);
  const byId = teachers.find((t) => t.id === (withId ? withId[2] : name));
  if (byId) return byId.active ? { teacher: byId } : { error: `${byId.name} 교사는 사용 안 함 상태입니다.` };
  if (name.includes('@')) {
    const t = teachers.find((x) => x.active && x.email === name.toLowerCase());
    return t ? { teacher: t } : { error: `이메일 ${name}인 교사가 명단에 없습니다.` };
  }
  const matches = teachers.filter((t) => t.active && t.name === name);
  if (matches.length === 1) return { teacher: matches[0]! };
  if (matches.length > 1) return { error: `동명이인 "${name}"이(가) 있습니다. 시트 이름을 "${name}(교사ID)"로 바꿔 주세요.` };
  return { error: `시트 이름 "${name}"과(와) 같은 교사가 명단에 없습니다.` };
}

/** 시트 이름으로 쓸 수 없는 문자를 바꾸고 31자로 자른다 (엑셀 제한). */
export function safeSheetName(name: string): string {
  return name.replace(/[[\]:*?/\\]/g, '_').slice(0, 31);
}

/** 교사별 시트 이름: 동명이인은 "이름(교사ID)" */
export function timetableSheetNames(teachers: { id: string; name: string }[]): Map<string, string> {
  const count = new Map<string, number>();
  for (const t of teachers) count.set(t.name, (count.get(t.name) ?? 0) + 1);
  return new Map(teachers.map((t) => [t.id, safeSheetName(count.get(t.name)! > 1 ? `${t.name}(${t.id})` : t.name)]));
}

/**
 * 교사별 격자 시트들을 읽는다. 내용이 없는 시트(예: 빈 양식 empty0)는 건너뛴다.
 * 결과 행 하나 = 칸 하나이며 label에 "교사 · 요일 교시"를 담는다.
 */
export function parseTimetableGrid(sheets: SheetRows[], teachers: TimetableTeacher[]): ImportResult<TimetableImport> {
  const rows: RowResult<TimetableImport>[] = [];

  for (const sheet of sheets) {
    if (!isGridSheet(sheet.rows)) continue;
    const headerIdx = sheet.rows.findIndex((r) => !isBlankRow(r));
    const header = sheet.rows[headerIdx]!;
    const dayOfCol = header.map((c) => {
      const idx = '월화수목금토일'.indexOf(cellText(c).charAt(0));
      return idx >= 0 ? idx + 1 : null;
    });

    const cells: { rowNumber: number; weekday: number; period: number | null; periodText: string; text: string }[] = [];
    sheet.rows.slice(headerIdx + 1).forEach((row, i) => {
      const periodText = cellText(row[0]);
      const pm = periodText.match(/^(\d{1,2})/);
      row.forEach((c, col) => {
        const weekday = dayOfCol[col];
        const text = cellText(c);
        if (col === 0 || !weekday || !text) return;
        cells.push({ rowNumber: headerIdx + i + 2, weekday, period: pm ? Number(pm[1]) : null, periodText, text });
      });
    });
    if (cells.length === 0) continue;

    const who = resolveSheetTeacher(sheet.name, teachers);
    if ('error' in who) {
      rows.push({ rowNumber: headerIdx + 1, label: `${sheet.name} (시트)`, value: null, errors: [who.error] });
      continue;
    }

    for (const cell of cells) {
      const label = `${sheet.name} · ${WEEKDAY_LABEL[cell.weekday]} ${cell.period ?? cell.periodText}교시`;
      const errors: string[] = [];
      const parsed = parseClassCell(cell.text);
      if (cell.period === null || cell.period < 1 || cell.period > GRID_PERIODS) errors.push(`교시를 알 수 없습니다 ("${cell.periodText}").`);
      if (cell.weekday > 5) errors.push('토·일요일 수업은 입력할 수 없습니다.');
      if (!parsed) errors.push(`"${cell.text}"에서 학년-반을 알 수 없습니다. 예: 1-3 또는 1-3 국어`);
      rows.push({
        rowNumber: cell.rowNumber,
        label,
        errors,
        value:
          errors.length || !parsed
            ? null
            : {
                teacherId: who.teacher.id,
                teacherName: who.teacher.name,
                weekday: cell.weekday,
                period: cell.period!,
                ...parsed,
              },
      });
    }
  }

  flagDuplicates(
    rows,
    (v) => `${v.teacherId}|${v.weekday}|${v.period}`,
    () => '같은 교사의 같은 요일·교시가 다른 시트에도 있습니다.',
  );
  return finish(rows);
}

/** 교사 1명의 수업 목록 → 격자 시트 행 (학교 양식과 같은 모양) */
export function timetableGridRows(entries: { weekday: number; period: number; grade: number; classNo: number; subject: string | null }[]): (string | null)[][] {
  const maxPeriod = Math.max(GRID_PERIODS, ...entries.map((e) => e.period));
  const rows: (string | null)[][] = [['교시', ...GRID_WEEKDAYS]];
  for (let p = 1; p <= maxPeriod; p++) {
    const row: (string | null)[] = [`${p}교시`, ...GRID_WEEKDAYS.map(() => null)];
    for (const e of entries) {
      if (e.period === p) row[e.weekday] = `${e.grade}-${e.classNo}${e.subject ? ` ${e.subject}` : ''}`;
    }
    rows.push(row);
  }
  return rows;
}
