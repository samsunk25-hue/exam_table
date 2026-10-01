// 시험 시간표 표 입력 점검: 날짜 2일 추가 → 1교시 시간(시계) → 과목·자습 입력 → 저장
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { go, openApp } from './session.mjs';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
const require = createRequire(import.meta.url);
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
initializeApp({ projectId: 'smart-invigilation' });
const db = getFirestore();

const OUT = 'scripts/e2e/out';
mkdirSync(OUT, { recursive: true });
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const SID = 'E2E_GRID';
await db.recursiveDelete(db.doc(`sessions/${SID}`));
await db.doc(`sessions/${SID}`).set({
  schoolName: '점검중학교', year: 2026, semester: 2, examName: '표 입력 점검', status: 'DRAFT',
  settings: { useBaseTimetable: false }, createdAt: new Date(), updatedBy: 'seed',
});

const { browser, page, errors } = await openApp();
await page.setViewportSize({ width: 1440, height: 1000 });
await go(page, `/admin/sessions/${SID}/setup`);
await page.getByRole('button', { name: '시험 시간표 표로 입력' }).click();
const dlg = page.getByRole('dialog', { name: '시험 시간표 표로 입력' });

for (const d of ['2026-11-02', '2026-11-03']) {
  await dlg.locator('input[type=date]').fill(d);
  await dlg.getByRole('button', { name: '+ 추가' }).click();
}
// 1교시 09:00~09:45 (시계)
const p1 = dlg.locator('div.grid', { hasText: '1교시' }).filter({ has: page.getByText('시작', { exact: true }) }).first();
await p1.locator('button[aria-haspopup]').first().click();
await page.getByRole('dialog', { name: '시작 선택' }).getByRole('button', { name: '9', exact: true }).click();
await page.getByRole('dialog', { name: '시작 선택' }).getByRole('button', { name: '00', exact: true }).click();
await p1.locator('button[aria-haspopup]').nth(1).click();
await page.getByRole('dialog', { name: '종료 선택' }).getByRole('button', { name: '9', exact: true }).click();
await page.getByRole('dialog', { name: '종료 선택' }).getByRole('button', { name: '45', exact: true }).click();

await dlg.getByLabel('2026-11-02 1교시 1학년 과목').fill('국어');
await dlg.getByLabel('2026-11-02 1교시 2학년 과목').fill('수학');
await dlg.getByLabel('2026-11-02 1교시 3학년 과목').fill('영어');
await dlg.getByLabel('2026-11-03 2교시 1학년 과목').fill('과학');
await dlg.locator('tr', { hasText: '11월 2일' }).first().waitFor();
// 11/2 3교시 전체 자습
await dlg.locator('tr').filter({ has: page.getByLabel('2026-11-02 3교시 1학년 과목') }).getByRole('button', { name: '전체 자습' }).click();
await page.screenshot({ path: `${OUT}/grid-editor.png`, fullPage: true });
await dlg.getByRole('button', { name: /저장 \(시험 7건\)/ }).click();
await page.getByRole('status').filter({ hasText: '시험 7건을 저장했습니다' }).waitFor();

const slots = await db.collection(`sessions/${SID}/slots`).get();
const byId = Object.fromEntries(slots.docs.map((d) => [d.id, d.data()]));
check('시험 7건 저장 (시험 4 + 자습 3)', slots.size === 7 && slots.docs.filter((d) => d.get('type') === 'STUDY').length === 3);
check('1교시 시간 반영', byId['2026-11-02_1_1']?.startTime === '09:00' && byId['2026-11-02_1_1']?.endTime === '09:45');
check('시험실 자동 배치 (자습은 교실만)', (byId['2026-11-02_1_1']?.rooms ?? []).length > 0 && (byId['2026-11-02_3_1']?.rooms ?? []).every((p) => !String(p.roomId).includes('H')), `${(byId['2026-11-02_1_1']?.rooms ?? []).length}실`);

// 다시 열면 입력값이 그대로 보이고, 칸을 비우면 삭제 안내
await page.getByRole('button', { name: '시험 시간표 표로 입력' }).click();
await dlg.getByLabel('2026-11-03 2교시 1학년 과목').fill('');
check('다시 열면 입력값 유지 + 비운 칸 삭제 안내', (await dlg.getByLabel('2026-11-02 1교시 2학년 과목').inputValue()) === '수학' && (await dlg.getByText(/기존 시험 1건이 삭제됩니다/).isVisible()));
check('콘솔 오류 없음', errors.length === 0, errors.join(' / '));
await browser.close();
process.exit(failures ? 1 : 0);
