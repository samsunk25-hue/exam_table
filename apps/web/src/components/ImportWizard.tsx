import { useMemo, useState, type ReactNode } from 'react';
import {
  autoMap,
  cellText,
  isBlankRow,
  missingRequired,
  type Cell,
  type ColumnMapping,
  type FieldDef,
  type ImportResult,
} from '@sim/shared';
import { Modal } from '@/components/Modal';
import { Alert, Button } from '@/components/ui';
import { errorMessage } from '@/lib/firebase';
import { readWorkbook, type SheetData } from '@/lib/xlsx';

export interface ImportWizardProps<T> {
  title: string;
  fields: FieldDef[];
  analyze: (dataRows: Cell[][], mapping: ColumnMapping) => ImportResult<T>;
  /** 파일 전체를 먼저 살펴 특수 형식(예: 교사별 시간표 격자)이면 결과를, 아니면 null을 돌려준다 */
  analyzeWorkbook?: (sheets: SheetData[]) => ImportResult<T> | null;
  /** 미리보기 표의 열 */
  previewHead: string[];
  previewRow: (value: T) => ReactNode[];
  /** 저장 전 요약 (예: 신규 3명, 수정 10명) */
  summary?: (values: T[]) => ReactNode;
  /** 저장 방식 안내 (예: 파일에 없는 시험은 삭제됩니다) */
  notice?: ReactNode;
  onSave: (values: T[]) => Promise<string>;
  onClose: () => void;
}

/** 파일 선택 → 시트 선택 → 열 매핑 → 검증 미리보기 → 저장 */
export function ImportWizard<T>(props: ImportWizardProps<T>) {
  const { title, fields, analyze, analyzeWorkbook, previewHead, previewRow, summary, notice, onSave, onClose } = props;
  const [sheets, setSheets] = useState<SheetData[] | null>(null);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const sheet = sheets?.[sheetIdx];
  const headerIdx = sheet ? sheet.rows.findIndex((r) => !isBlankRow(r)) : -1;
  const header = useMemo(() => (sheet && headerIdx >= 0 ? sheet.rows[headerIdx]! : []), [sheet, headerIdx]);
  const dataRows = useMemo(() => (sheet && headerIdx >= 0 ? sheet.rows.slice(headerIdx + 1) : []), [sheet, headerIdx]);
  const missing = missingRequired(mapping, fields);

  const workbookResult = useMemo(() => (sheets && analyzeWorkbook ? analyzeWorkbook(sheets) : null), [sheets, analyzeWorkbook]);
  const tableResult = useMemo(
    () => (!workbookResult && sheet && missing.length === 0 ? analyze(dataRows, mapping) : null),
    [workbookResult, sheet, dataRows, mapping, missing.length, analyze],
  );
  const result = workbookResult ?? tableResult;
  const values = result?.rows.flatMap((r) => (r.value ? [r.value] : [])) ?? [];

  const selectSheet = (list: SheetData[], idx: number) => {
    setSheetIdx(idx);
    const s = list[idx]!;
    const hi = s.rows.findIndex((r) => !isBlankRow(r));
    setMapping(autoMap(hi >= 0 ? s.rows[hi]! : [], fields));
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const list = await readWorkbook(file);
      if (list.length === 0) throw new Error('시트가 없는 파일입니다.');
      setSheets(list);
      // '데이터' 시트가 있으면 우선 선택 (표준 양식)
      const idx = Math.max(0, list.findIndex((s) => s.name === '데이터'));
      selectSheet(list, idx);
    } catch (e) {
      setError(`파일을 읽을 수 없습니다: ${errorMessage(e)}`);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      setDone(await onSave(values));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const shownRows = (result?.rows ?? []).filter((r) => !onlyErrors || r.errors.length > 0);

  return (
    <Modal title={title} onClose={onClose} wide>
      {done ? (
        <div className="grid gap-4">
          <Alert tone="info">{done}</Alert>
          <Button onClick={onClose}>닫기</Button>
        </div>
      ) : (
        <div className="grid gap-5">
          {notice && <Alert tone="info">{notice}</Alert>}

          <label className="flex flex-col gap-1.5">
            <span className="font-semibold">1. 파일 선택 (.xlsx, .xls, .csv)</span>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="min-h-12 rounded-xl border border-dashed border-line bg-bg p-3 file:mr-3 file:min-h-10 file:rounded-lg file:border-0 file:bg-primary file:px-4 file:font-semibold file:text-white"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
          </label>

          {workbookResult && <Alert tone="info">교사별 시간표 양식(시트 {sheets?.length}장)으로 읽었습니다.</Alert>}

          {!workbookResult && sheets && sheets.length > 1 && (
            <label className="flex flex-col gap-1.5">
              <span className="font-semibold">시트</span>
              <select
                className="min-h-12 rounded-xl border border-line px-3"
                value={sheetIdx}
                onChange={(e) => selectSheet(sheets, Number(e.target.value))}
              >
                {sheets.map((s, i) => (
                  <option key={s.name} value={i}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {!workbookResult && sheet && (
            <section>
              <h3 className="mb-2 font-semibold">2. 열 연결 확인</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {fields.map((f) => (
                  <label key={f.key} className="flex flex-col gap-1">
                    <span className="text-sm font-semibold">
                      {f.label}
                      {f.required && <span className="text-alert"> *</span>}
                    </span>
                    <select
                      className={`min-h-12 rounded-xl border px-3 ${
                        f.required && (mapping[f.key] ?? null) === null ? 'border-alert' : 'border-line'
                      }`}
                      value={mapping[f.key] ?? ''}
                      onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value === '' ? null : Number(e.target.value) })}
                    >
                      <option value="">(사용 안 함)</option>
                      {header.map((h, i) => (
                        <option key={i} value={i}>
                          {cellText(h) || `${i + 1}번째 열`}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              {missing.length > 0 && (
                <div className="mt-3">
                  <Alert>필수 항목을 연결해 주세요: {missing.join(', ')}</Alert>
                </div>
              )}
            </section>
          )}

          {result && (
            <section>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">
                  {workbookResult ? '2' : '3'}. 검증 결과 — 전체 {result.rows.length}건 ·{' '}
                  <span className={result.errorCount ? 'text-alert' : 'text-ink'}>오류 {result.errorCount}건</span>
                </h3>
                {result.errorCount > 0 && (
                  <label className="flex min-h-12 items-center gap-2">
                    <input type="checkbox" className="size-5" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} />
                    오류만 보기
                  </label>
                )}
              </div>
              {result.fileErrors.length > 0 && (
                <div className="mb-2">
                  <Alert>{result.fileErrors.join(' ')}</Alert>
                </div>
              )}
              <div className="max-h-96 overflow-auto rounded-xl border border-line">
                <table className="w-full min-w-max border-collapse text-left text-sm">
                  <thead className="sticky top-0 bg-bg">
                    <tr>
                      <th className="px-3 py-2">위치</th>
                      {previewHead.map((h) => (
                        <th key={h} className="px-3 py-2">
                          {h}
                        </th>
                      ))}
                      <th className="px-3 py-2">확인</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownRows.slice(0, 500).map((r, i) => (
                      <tr key={i} className={r.errors.length ? 'bg-alert-soft' : ''}>
                        <td className="border-t border-line px-3 py-2 whitespace-nowrap text-muted">{r.label ?? `${r.rowNumber}행`}</td>
                        {r.value
                          ? previewRow(r.value).map((c, i) => (
                              <td key={i} className="border-t border-line px-3 py-2">
                                {c}
                              </td>
                            ))
                          : previewHead.map((h) => <td key={h} className="border-t border-line px-3 py-2" />)}
                        <td className="border-t border-line px-3 py-2">
                          {r.errors.length ? (
                            <ul className="font-semibold text-[#c0392b]">
                              {r.errors.map((e) => (
                                <li key={e}>{e}</li>
                              ))}
                            </ul>
                          ) : (
                            '✓'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {summary && values.length > 0 && result.errorCount === 0 && <div className="mt-3">{summary(values)}</div>}
            </section>
          )}

          {error && <Alert>{error}</Alert>}

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void save()} disabled={busy || !result || result.errorCount > 0 || result.fileErrors.length > 0 || values.length === 0}>
              {busy ? '저장 중…' : result?.errorCount ? '오류를 고친 뒤 다시 올려 주세요' : '저장'}
            </Button>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              취소
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
