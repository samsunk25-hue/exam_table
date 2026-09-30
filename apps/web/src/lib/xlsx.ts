import * as XLSX from 'xlsx';
import type { Cell, FieldDef } from '@sim/shared';
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
}

/** 엑셀 파일을 만들어 브라우저 다운로드 폴더에 저장하고, 저장 사실을 화면에 알린다. */
export function downloadWorkbook(fileName: string, sheets: OutSheet[]): boolean {
  try {
    const wb = XLSX.utils.book_new();
    for (const s of sheets) {
      const ws = XLSX.utils.aoa_to_sheet(s.rows);
      const widths = s.widths ?? s.rows[0]?.map((_, i) => Math.max(8, ...s.rows.map((r) => String(r[i] ?? '').length * 1.6 + 2)));
      if (widths) ws['!cols'] = widths.map((wch) => ({ wch: Math.min(wch, 60) }));
      XLSX.utils.book_append_sheet(wb, ws, s.name);
    }
    XLSX.writeFile(wb, fileName);
    toast(`"${fileName}" 파일을 다운로드 폴더에 저장했습니다.`);
    return true;
  } catch (e) {
    toast(`파일을 만들지 못했습니다: ${e instanceof Error ? e.message : String(e)}`, 'alert');
    return false;
  }
}

/** 표 형식 시트: 첫 행은 제목(필수 열은 * 표시) */
export function tableSheet(name: string, fields: FieldDef[], rows: OutCell[][]): OutSheet {
  return { name, rows: [fields.map((f) => (f.required ? `${f.label}*` : f.label)), ...rows] };
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
