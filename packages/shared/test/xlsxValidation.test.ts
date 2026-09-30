import { describe, expect, it } from 'vitest';
import { TEACHER_FIELDS, columnLetter, injectListValidations } from '../src';

describe('엑셀 목록 선택', () => {
  it('열 번호를 엑셀 열 이름으로', () => {
    expect([0, 6, 25, 26, 27, 51].map(columnLetter)).toEqual(['A', 'G', 'Z', 'AA', 'AB', 'AZ']);
  });

  it('규격 순서에 맞게 sheetData 뒤, ignoredErrors 앞에 넣는다', () => {
    const xml = '<worksheet><sheetData><row r="1"/></sheetData><ignoredErrors><ignoredError sqref="A1"/></ignoredErrors></worksheet>';
    const out = injectListValidations(xml, [{ col: 6, options: ['일반', '복도전담', '감독제외'] }], 500);
    expect(out).toBe(
      '<worksheet><sheetData><row r="1"/></sheetData>' +
        '<dataValidations count="1"><dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" errorStyle="warning" errorTitle="목록에서 선택" error="일반 / 복도전담 / 감독제외 중에서 고르세요." sqref="G2:G500"><formula1>&quot;일반,복도전담,감독제외&quot;</formula1></dataValidation></dataValidations>' +
        '<ignoredErrors><ignoredError sqref="A1"/></ignoredErrors></worksheet>',
    );
  });

  it('뒤따르는 요소가 없으면 닫는 태그 앞에 넣고, 목록이 없으면 그대로', () => {
    expect(injectListValidations('<worksheet><sheetData/></worksheet>', [{ col: 0, options: ['Y', 'N'] }])).toContain(
      '<sheetData/><dataValidations count="1">',
    );
    expect(injectListValidations('<worksheet/>', [])).toBe('<worksheet/>');
  });

  it('교사 양식의 감독구분 선택지', () => {
    expect(TEACHER_FIELDS.find((f) => f.key === 'defaultRole')).toMatchObject({ label: '감독구분', options: ['일반', '복도전담'] });
  });
});
