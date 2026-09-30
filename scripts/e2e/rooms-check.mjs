// 학급 수로 교실 만들기 점검: node scripts/e2e/rooms-check.mjs (빈 에뮬레이터에서)
import { mkdirSync } from 'node:fs';
import { go, openApp } from './session.mjs';

const OUT = 'scripts/e2e/out';
mkdirSync(OUT, { recursive: true });
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const { browser, page, errors } = await openApp();
await go(page, '/admin/rooms');
const card = page.locator('section', { hasText: '학급 교실 한 번에 만들기' }).first();
await card.waitFor();
if (!(await card.getByRole('button', { name: /적용/ }).count())) await card.getByRole('button', { name: '학급 수·교실 설정' }).click();

// 1학년 3반, 2학년 2반, 3학년 0반, 1-2는 시험 안 침
await card.getByLabel('1학년', { exact: true }).fill('3');
await card.getByLabel('2학년', { exact: true }).fill('2');
await card.getByLabel('3학년', { exact: true }).fill('0');
await card.getByRole('button', { name: '1-2', exact: true }).click();
check('1-2 체크 해제 표시', (await card.getByRole('button', { name: '1-2', exact: true }).getAttribute('aria-pressed')) === 'false');
await page.screenshot({ path: `${OUT}/rooms-setup.png`, fullPage: true });
await card.getByRole('button', { name: /적용/ }).click();
// 기존 시험실이 있으면 삭제 확인을 한 번 더 누른다
if (await card.getByRole('button', { name: '삭제하고 적용' }).count()) await card.getByRole('button', { name: '삭제하고 적용' }).click();
await page.getByRole('status').filter({ hasText: '시험실을 설정했습니다' }).waitFor();

const table = page.locator('table');
await table.getByText('2-2', { exact: true }).waitFor();
const names = (await table.locator('tbody tr td:first-child').allInnerTexts()).map((s) => s.trim());
check('교실·복도 생성', ['1-1', '1-3', '1학년 복도', '2-1', '2-2', '2학년 복도'].every((n) => names.includes(n)) && !names.includes('1-2'), names.join(','));

// 특별실 수동 추가
await page.getByRole('button', { name: '+ 특별실 추가' }).click();
const dialog = page.getByRole('dialog', { name: '특별실 추가' });
check('특별실 기본 유형은 별도실', (await dialog.getByLabel('공간유형').inputValue()) === 'SEPARATE');
await dialog.getByLabel('실명').fill('별도시험장');
await dialog.getByRole('button', { name: '저장' }).click();
await table.getByText('별도시험장', { exact: true }).waitFor();
check('특별실 추가', true);

// 학급 수를 줄이면 삭제 확인 후 특별실은 남는다
await card.getByRole('button', { name: '학급 수·교실 설정' }).click();
await card.getByLabel('2학년', { exact: true }).fill('1');
await card.getByRole('button', { name: /적용/ }).click();
check('삭제 확인 안내', await card.getByText(/시험실 1개\(2-2\)를 삭제합니다/).isVisible());
await card.getByRole('button', { name: '삭제하고 적용' }).click();
await table.getByText('2-2', { exact: true }).waitFor({ state: 'detached' });
const after = (await table.locator('tbody tr td:first-child').allInnerTexts()).map((s) => s.trim());
check('2-2 삭제, 특별실 유지', !after.includes('2-2') && after.includes('별도시험장'), after.join(','));
await page.screenshot({ path: `${OUT}/rooms-after.png`, fullPage: true });

check('콘솔 오류 없음', errors.length === 0, errors.join(' / '));
await browser.close();
process.exit(failures ? 1 : 0);
