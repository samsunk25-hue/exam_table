// 전체 기초시간표 한 장: 행 = 교사, 열 = 요일·교시, 칸 = 학년-반 (과목은 선택)
//   교사   | 월1     | 월2 | … | 금7
//   김국어 | 1-3 국어 |     | …
import { WEEKDAY_LABEL } from '../model';
import { cellText, finish, flagDuplicates, isBlankRow, type Cell, type ImportResult, type RowResult } from './core';
import type { TimetableImport, TimetableTeacher } from './timetable';
import { GRID_PERIODS, parseClassCell, resolveSheetTeacher } from './timetableGrid';

/** 시트 이름 */
export const TIMETABLE_TABLE_SHEET = '기초시간표';
/** 양식에 기본으로 넣는 교시 수 (수업이 더 늦은 교시에 있으면 그만큼 늘린다) */
export const TABLE_PERIODS = 7;
const DAYS = '월화수목금';

/** 머리글 칸 "월1", "월 1", "월1교시", "월요일 1교시" → 요일(1=월)·교시 */
function parseHeader(text: string): { weekday: number; period: number } | null {
  const m = text.replace(/\s+/g, '').match(/^([월화수목금토일])(?:요일)?(\d{1,2})(?:교시)?$/);
  if (!m) return null;
  return { weekday: '월화수목금토일'.indexOf(m[1]!) + 1, period: Number(m[2]) };
}

/** 첫 행이 "교사 | 월1 | 월2 …" 형태인 시트인지 */
export function isTimetableTable(rows: Cell[][]): boolean {
  const header = rows.find((r) => !isBlankRow(r));
  if (!header) return false;
  return cellText(header[0]).replace(/\s/g, '').startsWith('교사') && header.slice(1).some((c) => parseHeader(cellText(c)) !== null);
}

/** 교사별 수업 → 전체 시간표 시트 행 (교사 이름순은 호출하는 쪽에서 정한다) */
export function timetableTableRows(
  teachers: { name: string; entries: { weekday: number; period: number; grade: number; classNo: number; subject: string | null }[] }[],
): (string | null)[][] {
  const maxPeriod = Math.max(TABLE_PERIODS, ...teachers.flatMap((t) => t.entries.map((e) => e.period)));
  const cols: { weekday: number; period: number }[] = [];
  for (let d = 1; d <= DAYS.length; d++) for (let p = 1; p <= maxPeriod; p++) cols.push({ weekday: d, period: p });
  const header = ['교사', ...cols.map((c) => `${DAYS[c.weekday - 1]}${c.period}`)];
  return [
    header,
    ...teachers.map((t) => {
      const at = new Map(t.entries.map((e) => [`${e.weekday}|${e.period}`, `${e.grade}-${e.classNo}${e.subject ? ` ${e.subject}` : ''}`]));
      return [t.name, ...cols.map((c) => at.get(`${c.weekday}|${c.period}`) ?? null)];
    }),
  ];
}

/**
 * 전체 시간표 시트를 읽는다. 결과 행 하나 = 칸 하나, label은 "교사 · 요일 교시".
 * 교사 칸은 이름, 동명이인은 "이름(교사ID)" 또는 이메일.
 */
export function parseTimetableTable(rows: Cell[][], teachers: TimetableTeacher[]): ImportResult<TimetableImport> {
  const out: RowResult<TimetableImport>[] = [];
  const headerIdx = rows.findIndex((r) => !isBlankRow(r));
  const header = rows[headerIdx] ?? [];
  const colOf = header.map((c, i) => (i === 0 ? null : parseHeader(cellText(c))));

  rows.slice(headerIdx + 1).forEach((row, i) => {
    const rowNumber = headerIdx + i + 2;
    const name = cellText(row[0]);
    const cells = row.map((c, col) => ({ col, text: cellText(c) })).filter((c) => c.col > 0 && c.text);
    if (!name && !cells.length) return;
    if (!name) {
      out.push({ rowNumber, label: `${rowNumber}행`, value: null, errors: ['교사 이름이 비어 있습니다.'] });
      return;
    }
    if (!cells.length) return; // 수업 없는 교사
    const who = resolveSheetTeacher(name, teachers);
    if ('error' in who) {
      out.push({ rowNumber, label: name, value: null, errors: [who.error.replace(/^시트 이름 /, '').replace('시트 이름을', '교사 칸을')] });
      return;
    }
    for (const { col, text } of cells) {
      const at = colOf[col];
      const label = at ? `${name} · ${WEEKDAY_LABEL[at.weekday]} ${at.period}교시` : `${name} · ${cellText(header[col])}`;
      const errors: string[] = [];
      const parsed = parseClassCell(text);
      if (!at) errors.push(`머리글 "${cellText(header[col])}"에서 요일·교시를 알 수 없습니다. 예: 월1`);
      else if (at.weekday > 5) errors.push('토·일요일 수업은 입력할 수 없습니다.');
      else if (at.period < 1 || at.period > GRID_PERIODS) errors.push(`${at.period}교시는 입력할 수 없습니다.`);
      if (!parsed) errors.push(`"${text}"에서 학년-반을 알 수 없습니다. 예: 1-3 또는 1-3 국어`);
      out.push({
        rowNumber,
        label,
        errors,
        value: errors.length || !parsed || !at ? null : { teacherId: who.teacher.id, teacherName: who.teacher.name, weekday: at.weekday, period: at.period, ...parsed },
      });
    }
  });

  flagDuplicates(
    out,
    (v) => `${v.teacherId}|${v.weekday}|${v.period}`,
    () => '같은 교사의 같은 요일·교시가 다른 행에도 있습니다.',
  );
  return finish(out);
}
