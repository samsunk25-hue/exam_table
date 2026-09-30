// 통합 양식 점검: 세션 생성 → 통합 양식 다운로드 → 일정·시간표 채우기 → 업로드 → 저장 확인
// 실행: node scripts/e2e/bundle-check.mjs (에뮬레이터 + npm run seed 이후)
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { go, openApp } from './session.mjs';

const XLSX = createRequire(import.meta.url)('xlsx');
const OUT = 'scripts/e2e/out';
mkdirSync(OUT, { recursive: true });
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const { browser, page, errors } = await openApp();

// 1. 새 시험 프로젝트
await go(page, '/admin');
await page.getByRole('button', { name: '+ 새 시험 프로젝트' }).click();
await page.getByLabel('학교명').fill('점검중학교');
await page.getByLabel('시험명').fill(`통합양식 점검 ${Date.now() % 10000}`);
await page.getByRole('button', { name: '만들기' }).click();
await page.waitForURL(/\/admin\/sessions\/[^/]+$/);
await page.getByRole('link', { name: '기본 설정' }).click();
await page.getByText('기초 자료 한 번에 입력').waitFor();

// 2. 통합 양식 다운로드
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.getByRole('button', { name: '통합 양식 다운로드' }).click(),
]);
const file = `${OUT}/${download.suggestedFilename()}`;
await download.saveAs(file);
const wb = XLSX.readFile(file);
check('통합 양식 시트 구성', ['안내', '교사', '시험실', '시험일정', '시험실배치', '김국어'].every((n) => wb.SheetNames.includes(n)), wb.SheetNames.join(','));

// 3. 시험 일정 2건 + 김국어 시간표 채우기 (2026-10-12는 월요일)
wb.Sheets['시험일정'] = XLSX.utils.aoa_to_sheet([
  ['날짜*', '교시*', '시작시간', '종료시간', '학년*', '과목*', '유형'],
  ['2026-10-12', 1, '09:00', '09:45', 1, '국어', '시험'],
  ['2026-10-12', 2, '10:00', '10:45', 1, '수학', '시험'],
]);
const grid = XLSX.utils.sheet_to_json(wb.Sheets['김국어'], { header: 1, defval: null });
grid[1][1] = '1-1 국어'; // 월 1교시
grid[2][3] = '국어 1-2'; // 수 2교시
wb.Sheets['김국어'] = XLSX.utils.aoa_to_sheet(grid);
const filled = `${OUT}/통합양식_작성.xlsx`;
XLSX.writeFile(wb, filled);

// 4. 업로드 → 검증 → 저장
await page.getByRole('button', { name: '통합 양식 업로드' }).click();
const dialog = page.getByRole('dialog', { name: '기초 자료 통합 양식 업로드' });
await dialog.locator('input[type=file]').setInputFiles(filled);
await dialog.getByText(/검증 결과/).waitFor();
check('통합 양식 검증', (await dialog.getByText(/검증 결과/).innerText()).includes('오류 0건'));
await page.screenshot({ path: `${OUT}/bundle-preview.png`, fullPage: true });
await dialog.getByRole('button', { name: '저장', exact: true }).click();
await dialog.getByText('저장했습니다.').waitFor();
check('저장 결과', true, (await dialog.locator('ul').innerText()).replace(/\n/g, ' / '));
await dialog.getByRole('button', { name: '닫기' }).first().click();

// 5. 화면 반영 확인
await page.getByText('배치 없음').first().waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
const setupText = await page.locator('main').innerText();
check('시험 2건 표시', setupText.includes('국어') && setupText.includes('수학'));
check('시험실 자동 배치됨', !setupText.includes('배치 없음'));
check('기초시간표 반영', /김국어 2/.test(setupText));
await page.screenshot({ path: `${OUT}/bundle-after.png`, fullPage: true });

check('콘솔 오류 없음', errors.length === 0, errors.join(' / '));
await browser.close();
process.exit(failures ? 1 : 0);
