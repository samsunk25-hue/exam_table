// 변경 이력 점검 (timetable-check.mjs 실행 후, 샘플 프로젝트가 교사 공개 상태):
// 배정 1건 수동 변경 → 변경 이력에 "교사: A → B"로 표시, 학교 공통 기록·엑셀
import { mkdirSync } from 'node:fs';
import { go, openApp } from './session.mjs';

const OUT = 'scripts/e2e/out';
mkdirSync(OUT, { recursive: true });
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const SID = 'E2E_SAMPLE';

const { browser, page, errors } = await openApp();
// 1. 시간표 편집에서 1-1 첫 칸 교사 바꾸기 (교사 공개 이후라 이력에 남는다)
await go(page, `/admin/sessions/${SID}/editor`);
const row = page.locator('tr', { hasText: '1-1' }).first();
await row.waitFor();
const before = (await row.locator('button').first().innerText()).trim();
await row.locator('button').first().click();
const dialog = page.getByRole('dialog', { name: '감독 배정 편집' });
await dialog.getByRole('button', { name: '배정', exact: true }).first().click();
await page.getByRole('status').filter({ hasText: '바꿨습니다' }).waitFor({ timeout: 30000 });
const after = (await page.getByRole('status').filter({ hasText: '바꿨습니다' }).innerText()).replace(/ 교사로 바꿨습니다\./, '').trim();
check('배정 수동 변경', true, `${before} → ${after}`);

// 2. 변경 이력 (트리거가 비동기로 기록하므로 잠시 기다림)
await go(page, `/admin/sessions/${SID}/history`);
const line = page.locator('tr', { hasText: `교사: ${before} → ${after}` });
await line.first().waitFor({ timeout: 20000 });
check('변경 이력에 "교사: A → B" 표시', true, (await line.first().innerText()).replace(/\s+/g, ' ').slice(0, 90));
check('행위자(관리자 이메일) 표시', (await line.first().innerText()).includes('samsunk25@gmail.com'));
await page.screenshot({ path: `${OUT}/history.png`, fullPage: true });

const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /엑셀로 받기/ }).click()]);
check('변경 이력 엑셀', dl.suggestedFilename().includes('변경이력'), dl.suggestedFilename());

// 3. 학교 공통 기록
await page.getByRole('button', { name: /학교 공통/ }).click();
await page.getByText('교사', { exact: true }).first().waitFor({ timeout: 10000 });
check('학교 공통(교사·시험실) 기록 표시', (await page.locator('tbody tr').count()) > 0);
check('콘솔 오류 없음', errors.length === 0, errors.join(' / '));
await browser.close();
process.exit(failures ? 1 : 0);
