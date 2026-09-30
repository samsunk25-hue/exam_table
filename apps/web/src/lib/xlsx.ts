import * as XLSX from 'xlsx';
import { injectListValidations, type Cell, type FieldDef, type ListValidation } from '@sim/shared';
import { toast } from '@/components/Toast';

export interface SheetData {
  name: string;
  rows: Cell[][];
}

/** 엑셀(.xlsx/.xls)·CSV 파일을 시트별 2차원 배열로 읽는다. 날짜 셀은 Date로 받는다. */
export async function readWorkbook(file: File): Promise<SheetData[]> {
  const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
  return wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json<Cell[]>(wb.Sheets[name]!, { header: 1, raw: true, defval: null, blankrows: true }),
  }));
}

export type OutCell = string | number | null;

export interface OutSheet {
  name: string;
  rows: OutCell[][];
  widths?: number[];
  /** 목록(콤보)에서 고르는 열 */
  validations?: ListValidation[];
}

/** 시트 목록 → xlsx 바이트. 목록 선택이 있는 시트는 시트 XML에 유효성 검사를 넣는다. */
export function buildWorkbook(sheets: OutSheet[]): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows);
    const widths = s.widths ?? s.rows[0]?.map((_, i) => Math.max(8, ...s.rows.map((r) => String(r[i] ?? '').length * 1.6 + 2)));
    if (widths) ws['!cols'] = widths.map((wch) => ({ wch: Math.min(wch, 60) }));
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  }
  const data = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
  if (!sheets.some((s) => s.validations?.length)) return data;

  // SheetJS는 시트를 추가한 순서대로 xl/worksheets/sheet1.xml, sheet2.xml … 로 저장한다
  const zip = XLSX.CFB.read(data, { type: 'array' });
  sheets.forEach((s, i) => {
    if (!s.validations?.length) return;
    const entry = XLSX.CFB.find(zip, `/xl/worksheets/sheet${i + 1}.xml`);
    if (!entry?.content) return;
    const xml = new TextDecoder().decode(entry.content as Uint8Array);
    entry.content = new TextEncoder().encode(injectListValidations(xml, s.validations, Math.max(1000, s.rows.length + 200)));
    entry.size = entry.content.length;
  });
  return new Uint8Array(XLSX.CFB.write(zip, { fileType: 'zip', type: 'array' }) as ArrayLike<number>);
}

function saveFile(fileName: string, data: Uint8Array) {
  const blob = new Blob([data as Uint8Array<ArrayBuffer>], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** 엑셀 파일을 만들어 브라우저 다운로드 폴더에 저장하고, 저장 사실을 화면에 알린다. */
export function downloadWorkbook(fileName: string, sheets: OutSheet[]): boolean {
  try {
    saveFile(fileName, buildWorkbook(sheets));
    toast(`"${fileName}" 파일을 다운로드 폴더에 저장했습니다.`);
    return true;
  } catch (e) {
    toast(`파일을 만들지 못했습니다: ${e instanceof Error ? e.message : String(e)}`, 'alert');
    return false;
  }
}

/** 표 형식 시트: 첫 행은 제목(필수 열은 * 표시) */
export function tableSheet(name: string, fields: FieldDef[], rows: OutCell[][]): OutSheet {
  return {
    name,
    rows: [fields.map((f) => (f.required ? `${f.label}*` : f.label)), ...rows],
    validations: fields.flatMap((f, col) => (f.options ? [{ col, options: f.options }] : [])),
  };
}

/** 항목 설명 + 안내 문장 시트 */
export function guideSheet(name: string, sections: { title?: string; fields?: FieldDef[]; lines?: string[] }[]): OutSheet {
  const rows: OutCell[][] = [];
  for (const s of sections) {
    if (s.title) rows.push([`■ ${s.title}`]);
    if (s.fields) {
      rows.push(['항목', '필수', '설명']);
      rows.push(...s.fields.map((f) => [f.label, f.required ? '필수' : '', f.note ?? '']));
    }
    for (const line of s.lines ?? []) rows.push([line]);
    rows.push([]);
  }
  return { name, rows, widths: [16, 6, 80] };
}

/** 표준 양식: 데이터 시트 + 안내 시트 */
export function downloadTemplate(fileName: string, fields: FieldDef[], rows: OutCell[][], guide: string[] = []): boolean {
  return downloadWorkbook(fileName, [
    tableSheet('데이터', fields, rows),
    guideSheet('안내', [
      { fields, lines: [...guide, '* 첫 번째 시트의 첫 행을 제목 행으로 읽습니다. 열 순서는 바꿔도 됩니다.'] },
    ]),
  ]);
}
