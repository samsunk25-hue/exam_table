// 엑셀 시트 XML에 목록(드롭다운) 데이터 유효성 검사를 넣는다.
// SheetJS 무료판은 유효성 검사를 쓰지 못하므로 만들어진 파일의 시트 XML을 직접 고친다.

export interface ListValidation {
  /** 0부터 시작하는 열 번호 */
  col: number;
  options: string[];
}

/** 0 → A, 25 → Z, 26 → AA */
export function columnLetter(col: number): string {
  let s = '';
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// OOXML 규격상 dataValidations 뒤에 와야 하는 요소들
const AFTER = ['<hyperlinks', '<printOptions', '<pageMargins', '<pageSetup', '<headerFooter', '<rowBreaks', '<colBreaks', '<customProperties', '<cellWatches', '<ignoredErrors', '<smartTags', '<drawing', '<legacyDrawing', '<picture', '<oleObjects', '<controls', '<webPublishItems', '<tableParts', '<extLst', '</worksheet>'];

/**
 * 2행부터 lastRow행까지 각 열에 목록 선택을 건다 (1행은 제목).
 * 목록 밖의 값을 입력하면 엑셀이 경고한다.
 */
export function injectListValidations(sheetXml: string, validations: ListValidation[], lastRow = 1000): string {
  if (validations.length === 0) return sheetXml;
  const items = validations
    .map((v) => {
      const ref = `${columnLetter(v.col)}2:${columnLetter(v.col)}${lastRow}`;
      const list = escapeXml(`"${v.options.join(',')}"`);
      return `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" errorStyle="warning" errorTitle="목록에서 선택" error="${escapeXml(v.options.join(' / '))} 중에서 고르세요." sqref="${ref}"><formula1>${list}</formula1></dataValidation>`;
    })
    .join('');
  const block = `<dataValidations count="${validations.length}">${items}</dataValidations>`;
  const at = Math.min(...AFTER.map((tag) => sheetXml.indexOf(tag)).filter((i) => i >= 0));
  return sheetXml.slice(0, at) + block + sheetXml.slice(at);
}
