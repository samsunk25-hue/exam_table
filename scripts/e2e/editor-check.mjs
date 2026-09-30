// 시간표 편집 점검: 셀 → 교사 바꾸기, 연쇄 교환 찾기 → 적용 (assign-check.mjs 실행 후)
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

const SID = 'E2E_ASSIGN';
const snapshot = async () => new Map((await db.collection(`sessions/${SID}/assignments`).get()).docs.map((d) => [d.id, d.data()]));
const perTeacher = (m) => {
  const c = {};
  for (const a of m.values()) c[a.teacherId] = (c[a.teacherId] ?? 0) + 1;
  return Object.fromEntries(Object.entries(c).sort(([a], [b]) => a.localeCompare(b)));
};

const { browser, page, errors } = await openApp();
await go(page, `/admin/sessions/${SID}/editor`);
await page.getByText('시간표 편집', { exact: true }).first().waitFor();
const firstRow = page.locator('tr', { hasText: 'E1-1' }).first();
await firstRow.waitFor();

// 1. 교사 바꾸기
const before = await snapshot();
await firstRow.locator('button').first().click();
const dialog = page.getByRole('dialog', { name: '감독 배정 편집' });
await dialog.waitFor();
await dialog.getByRole('button', { name: '배정', exact: true }).first().click();
await page.getByRole('status').filter({ hasText: '바꿨습니다' }).waitFor({ timeout: 30000 });
const after1 = await snapshot();
const changed1 = [...after1].filter(([id, a]) => before.get(id)?.teacherId !== a.teacherId);
check('교사 바꾸기 (수동 배정 저장)', changed1.length === 1 && changed1[0][1].source === 'MANUAL', changed1.map(([id, a]) => `${id}→${a.teacherId}`).join(','));

// 2. 연쇄 교환 찾기 → 적용
await page.locator('tr', { hasText: 'E2-1' }).first().locator('button').first().click();
await dialog.waitFor();
await dialog.getByRole('button', { name: '연쇄 교환 찾기' }).click();
await dialog.getByRole('button', { name: '경로 찾기' }).click();
await dialog.getByRole('button', { name: '이 경로 적용' }).first().waitFor({ timeout: 30000 });
const routeText = await dialog.locator('p', { hasText: '교환: ' }).first().innerText();
await page.screenshot({ path: `${OUT}/editor-swap.png`, fullPage: true });
await dialog.getByRole('button', { name: '이 경로 적용' }).first().click();
await page.getByRole('status').filter({ hasText: '교환을 적용했습니다' }).waitFor({ timeout: 30000 });
const after2 = await snapshot();
const changed2 = [...after2].filter(([id, a]) => after1.get(id)?.teacherId !== a.teacherId);
check('연쇄 교환 적용', changed2.length >= 2, `${routeText} (${changed2.length}건 변경)`);
check('교환 후 교사별 감독 수 그대로', JSON.stringify(perTeacher(after1)) === JSON.stringify(perTeacher(after2)));
check('콘솔 오류 없음', errors.length === 0, errors.join(' / '));
await browser.close();
process.exit(failures ? 1 : 0);
