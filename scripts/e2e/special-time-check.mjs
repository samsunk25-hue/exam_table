// 특별실 별도 시간 점검: 배치 창에서 "별도 시간"을 켜고 시계로 종료 시각을 늘리면 저장되고,
// 같은 특별실이 겹치는 교시에 쓰이면 막는다
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { go, openApp } from './session.mjs';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
const require = createRequire(import.meta.url);
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
initializeApp({ projectId: 'smart-invigilation' });
const db = getFirestore();
const TERM = { term: '점검중학교|2026|2', school: '점검중학교', year: 2026, semester: 2 };

const OUT = 'scripts/e2e/out';
mkdirSync(OUT, { recursive: true });
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const SID = 'E2E_SPECIAL';
await db.recursiveDelete(db.doc(`sessions/${SID}`));
await db.doc(`sessions/${SID}`).set({
  schoolName: '점검중학교', year: 2026, semester: 2, examName: '특별실 점검', status: 'DRAFT',
  settings: { useBaseTimetable: false }, createdAt: new Date(), updatedBy: 'seed',
});
await db.doc('rooms/SPX').set({ name: '특별실X', spaceType: 'SEPARATE', grade: null, classNo: null, chiefCount: 1, assistantCount: 0, ...TERM, updatedBy: 'seed' });
const slot = (period, grade, start, end, rooms) => ({ date: '2026-10-12', period, grade, subject: '국어', type: 'EXAM', startTime: start, endTime: end, rooms, updatedBy: 'seed' });
await db.doc(`sessions/${SID}/slots/2026-10-12_1_1`).set(slot(1, 1, '09:00', '09:45', []));
await db.doc(`sessions/${SID}/slots/2026-10-12_2_2`).set(slot(2, 2, '10:00', '10:45', []));

const { browser, page, errors } = await openApp();
await go(page, `/admin/sessions/${SID}/schedule`);

// 달력에서 10월 12일 → 그날 시험 목록의 "배치" (0 = 1교시 1학년, 1 = 2교시 2학년)
async function openPlacement(row) {
  await page.getByRole('button', { name: /^10월 12일/ }).click();
  await page.locator('li', { hasText: row === 0 ? '1교시 · 1학년' : '2교시 · 2학년' }).getByRole('button', { name: '배치', exact: true }).click();
  return page.getByRole('dialog', { name: /시험실 배치/ });
}
async function pickTime(dlg, label, hour, minute) {
  await dlg.locator('div', { has: page.getByText(label, { exact: true }) }).locator('button[aria-haspopup]').last().click();
  const clock = page.getByRole('dialog', { name: `${label} 선택` });
  await clock.getByRole('button', { name: hour, exact: true }).first().click(); // 시

  await clock.getByRole('button', { name: minute, exact: true }).last().click(); // 분
}

// 1교시 1학년: 특별실X 사용 + 별도 시간 09:00~10:10
let dlg = await openPlacement(0);
await dlg.getByRole('checkbox', { name: '특별실X 사용' }).check();
await dlg.getByRole('checkbox', { name: '특별실X 별도 시간' }).check();
await pickTime(dlg, '특별실X 종료', '10', '10');
await page.screenshot({ path: `${OUT}/special-time.png` });
await dlg.getByRole('button', { name: /^저장/ }).click();
await dlg.waitFor({ state: 'detached' });
let p = null;
for (let i = 0; i < 30 && !p?.endTime; i++) {
  p = ((await db.doc(`sessions/${SID}/slots/2026-10-12_1_1`).get()).get('rooms') ?? []).find((r) => r.roomId === 'SPX');
  if (!p?.endTime) await new Promise((r) => setTimeout(r, 300));
}
check('별도 시간 저장 (09:00~10:10)', p?.startTime === '09:00' && p?.endTime === '10:10', JSON.stringify(p));
check('목록에 별도 시간 표시', await page.getByText(/특별실X 09:00~10:10/).isVisible());

// 2교시 2학년에 같은 특별실 → 1교시 쪽 별도 시간이 겹치므로 1교시 배치를 다시 저장하면 막힌다
{
  const r2 = (await db.doc(`sessions/${SID}/slots/2026-10-12_2_2`).get()).get('rooms') ?? [];
  await db.doc(`sessions/${SID}/slots/2026-10-12_2_2`).update({ rooms: [...r2, { roomId: 'SPX', classNo: null, headcount: null, roomType: 'NORMAL' }] });
}
dlg = await openPlacement(0);
await dlg.getByRole('button', { name: /^저장/ }).click();
check('겹치는 교시에 같은 특별실이 쓰이면 저장 막음', await dlg.getByText(/2교시와 겹치는데/).isVisible({ timeout: 5000 }).catch(() => false));
check('콘솔 오류 없음', errors.length === 0, errors.join(' / '));
await browser.close();
process.exit(failures ? 1 : 0);
