// 엑셀 업로드 공통: 셀 값 해석, 헤더 자동 매핑, 행 단위 검증 결과.
// SheetJS 등 파일 라이브러리에 의존하지 않고 2차원 배열만 다룬다.

export type Cell = string | number | boolean | Date | null | undefined;

export interface FieldDef {
  key: string;
  label: string;
  required: boolean;
  /** 헤더 자동 매핑에 쓰는 다른 이름들 */
  synonyms?: string[];
  /** 양식 안내 시트에 표시 */
  note?: string;
}

/** 필드 key → 열 번호 (없으면 null) */
export type ColumnMapping = Record<string, number | null>;

export interface RowResult<T> {
  /** 엑셀 기준 행 번호 (헤더 다음 행이 2) */
  rowNumber: number;
  value: T | null;
  errors: string[];
}

export interface ImportResult<T> {
  rows: RowResult<T>[];
  errorCount: number;
  /** 파일 전체에 대한 오류 (예: 필수 열 누락) */
  fileErrors: string[];
}

function normalizeHeader(s: string): string {
  return s.replace(/[\s_()*·./-]/g, '').toLowerCase();
}

export function cellText(c: Cell): string {
  if (c === null || c === undefined) return '';
  if (c instanceof Date) return c.toISOString();
  return String(c).trim();
}

export function isBlankRow(row: Cell[]): boolean {
  return row.every((c) => cellText(c) === '');
}

/** 헤더 이름으로 필드와 열을 자동 연결한다. 못 찾은 필드는 null. */
export function autoMap(headers: Cell[], fields: FieldDef[]): ColumnMapping {
  const normalized = headers.map((h) => normalizeHeader(cellText(h)));
  const mapping: ColumnMapping = {};
  const used = new Set<number>();
  for (const f of fields) {
    const names = [f.label, f.key, ...(f.synonyms ?? [])].map(normalizeHeader);
    const idx = normalized.findIndex((h, i) => !used.has(i) && h !== '' && names.includes(h));
    mapping[f.key] = idx >= 0 ? idx : null;
    if (idx >= 0) used.add(idx);
  }
  return mapping;
}

export function missingRequired(mapping: ColumnMapping, fields: FieldDef[]): string[] {
  return fields.filter((f) => f.required && (mapping[f.key] ?? null) === null).map((f) => f.label);
}

/** 한 행을 필드 key → 셀 값으로 */
export function pick(row: Cell[], mapping: ColumnMapping): Record<string, Cell> {
  const out: Record<string, Cell> = {};
  for (const [key, idx] of Object.entries(mapping)) out[key] = idx === null ? null : row[idx];
  return out;
}

/** 행 검증 도우미: 파서 호출 결과를 모으고 오류를 기록한다. */
export class RowReader {
  readonly errors: string[] = [];
  constructor(private readonly cells: Record<string, Cell>, private readonly fields: FieldDef[]) {}

  private label(key: string): string {
    return this.fields.find((f) => f.key === key)?.label ?? key;
  }

  raw(key: string): Cell {
    return this.cells[key];
  }

  text(key: string, required = false): string | null {
    const t = cellText(this.cells[key]);
    if (!t) {
      if (required) this.errors.push(`${this.label(key)}: 값이 비어 있습니다.`);
      return null;
    }
    return t;
  }

  int(key: string, opts: { required?: boolean; min?: number; max?: number } = {}): number | null {
    const t = this.text(key, opts.required);
    if (t === null) return null;
    const n = Number(t.replace(/[^\d.-]/g, ''));
    if (!Number.isInteger(n) || t.replace(/[^\d.-]/g, '') === '') {
      this.errors.push(`${this.label(key)}: 정수가 아닙니다 ("${t}").`);
      return null;
    }
    if ((opts.min !== undefined && n < opts.min) || (opts.max !== undefined && n > opts.max)) {
      this.errors.push(`${this.label(key)}: ${opts.min ?? ''}~${opts.max ?? ''} 범위를 벗어났습니다 (${n}).`);
      return null;
    }
    return n;
  }

  choice<T extends string>(key: string, options: Record<string, T>, opts: { required?: boolean; fallback?: T } = {}): T | null {
    const t = this.text(key, opts.required && opts.fallback === undefined);
    if (t === null) return opts.fallback ?? null;
    const found = Object.entries(options).find(([label]) => normalizeHeader(label) === normalizeHeader(t));
    if (!found) {
      this.errors.push(`${this.label(key)}: "${t}"은(는) 허용되지 않습니다 (${Object.keys(options).join('/')}).`);
      return null;
    }
    return found[1];
  }

  email(key: string): string | null {
    const t = this.text(key);
    if (t === null) return null;
    const e = t.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      this.errors.push(`${this.label(key)}: 이메일 형식이 아닙니다 ("${t}").`);
      return null;
    }
    return e;
  }

  date(key: string, required = false): string | null {
    const c = this.cells[key];
    const parsed = parseDate(c);
    if (parsed) return parsed;
    if (cellText(c) === '') {
      if (required) this.errors.push(`${this.label(key)}: 값이 비어 있습니다.`);
    } else {
      this.errors.push(`${this.label(key)}: 날짜 형식이 아닙니다 ("${cellText(c)}"). 예: 2026-10-12`);
    }
    return null;
  }

  time(key: string, required = false): string | null {
    const c = this.cells[key];
    const parsed = parseTime(c);
    if (parsed) return parsed;
    if (cellText(c) === '') {
      if (required) this.errors.push(`${this.label(key)}: 값이 비어 있습니다.`);
    } else {
      this.errors.push(`${this.label(key)}: 시각 형식이 아닙니다 ("${cellText(c)}"). 예: 09:00`);
    }
    return null;
  }

  weekday(key: string, required = false): number | null {
    const t = this.text(key, required);
    if (t === null) return null;
    const idx = '월화수목금토일'.indexOf(t.charAt(0));
    if (idx >= 0) return idx + 1;
    const n = Number(t);
    if (Number.isInteger(n) && n >= 1 && n <= 7) return n;
    this.errors.push(`${this.label(key)}: 요일 형식이 아닙니다 ("${t}"). 예: 월`);
    return null;
  }
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Date, 엑셀 일련번호, "2026-10-12", "2026.10.12", "2026/10/12" → YYYY-MM-DD */
export function parseDate(c: Cell): string | null {
  if (c instanceof Date && !Number.isNaN(c.getTime())) {
    return `${c.getFullYear()}-${pad(c.getMonth() + 1)}-${pad(c.getDate())}`;
  }
  if (typeof c === 'number' && c > 20000 && c < 80000) {
    // 엑셀 일련번호 (1900 날짜 체계)
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(c) * 86400000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const m = cellText(c).match(/^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?$/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

/** Date, 엑셀 시각(하루의 비율), "9:00", "09:00:00" → HH:MM */
export function parseTime(c: Cell): string | null {
  if (c instanceof Date && !Number.isNaN(c.getTime())) return `${pad(c.getHours())}:${pad(c.getMinutes())}`;
  if (typeof c === 'number' && c >= 0 && c < 1) {
    const minutes = Math.round(c * 24 * 60);
    return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
  }
  const m = cellText(c).match(/^(\d{1,2})\s*[:시]\s*(\d{2})/);
  if (!m) return null;
  const [h, mi] = [Number(m[1]), Number(m[2])];
  if (h > 23 || mi > 59) return null;
  return `${pad(h)}:${pad(mi)}`;
}

/** 데이터 행(헤더 제외)을 순회하며 파서를 적용한다. 빈 행은 건너뛴다. */
export function readRows<T>(
  dataRows: Cell[][],
  mapping: ColumnMapping,
  fields: FieldDef[],
  parse: (r: RowReader, rowNumber: number) => T | null,
): RowResult<T>[] {
  const out: RowResult<T>[] = [];
  dataRows.forEach((row, i) => {
    if (isBlankRow(row)) return;
    const reader = new RowReader(pick(row, mapping), fields);
    const value = parse(reader, i + 2);
    out.push({ rowNumber: i + 2, value: reader.errors.length ? null : value, errors: reader.errors });
  });
  return out;
}

/** 같은 키를 가진 행이 여러 개면 두 번째부터 오류를 붙인다. */
export function flagDuplicates<T>(rows: RowResult<T>[], keyOf: (v: T) => string | null, message: (key: string, first: number) => string) {
  const seen = new Map<string, number>();
  for (const r of rows) {
    if (!r.value) continue;
    const key = keyOf(r.value);
    if (key === null) continue;
    const first = seen.get(key);
    if (first !== undefined) {
      r.errors.push(message(key, first));
      r.value = null;
    } else {
      seen.set(key, r.rowNumber);
    }
  }
}

export function finish<T>(rows: RowResult<T>[], fileErrors: string[] = []): ImportResult<T> {
  return { rows, fileErrors, errorCount: rows.filter((r) => r.errors.length > 0).length };
}
