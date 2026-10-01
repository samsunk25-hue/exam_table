// 시험일정 관리 점검: 시계로 교시 시간 설정 → 달력 날짜 선택 → 여러 학년 시험 추가
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

const SID = 'E2E_SCHED';
await db.recursiveDelete(db.doc(`sessions/${SID}`));
await db.doc(`sessions/${SID}`).set({
  schoolName: '점검중학교', year: 2026, semester: 2, examName: '일정 점검', status: 'DRAFT',
  settings: { useBaseTimetable: false }, createdAt: new Date(Date.now() + 60_000), updatedBy: 'seed',
});
for (const g of [1, 2]) {
  await db.doc(`rooms/SC${g}`).set({ name: `S${g}-1`, spaceType: 'CLASSROOM', grade: g, classNo: 1, chiefCount: 1, assistantCount: 0, updatedBy: 'seed' });
}

const { browser, page, errors } = await openApp();
await go(page, '/admin/schedule');
await page.getByRole('button', { name: /일정 점검/ }).click();

// 1. 교시별 기본 시간 (1교시 09:00~09:45)
const row1 = page.locator('div.grid', { hasText: '1교시' }).filter({ has: page.getByText('시작', { exact: true }) }).first();
await row1.locator('button[aria-haspopup]').first().click();
await page.getByRole('dialog', { name: '시작 선택' }).getByRole('button', { name: '9', exact: true }).click();
await page.getByRole('dialog', { name: '시작 선택' }).getByRole('button', { name: '00', exact: true }).click();
await row1.locator('button[aria-haspopup]').nth(1).click();
await page.getByRole('dialog', { name: '종료 선택' }).getByRole('button', { name: '9', exact: true }).click();
await page.getByRole('dialog', { name: '종료 선택' }).getByRole('button', { name: '45', exact: true }).click();
check('시계로 시간 선택', (await row1.innerText()).includes('09:00') && (await row1.innerText()).includes('09:45'));
await page.getByRole('button', { name: '저장', exact: true }).click();
await page.getByRole('status').filter({ hasText: '교시별 기본 시간을 저장했습니다' }).waitFor();
check('교시별 기본 시간 저장', true);

// 2. 달력에서 10월 12일 선택 → 시험 추가
await page.getByRole('button', { name: /^10월 12일/ }).click();
await page.getByRole('heading', { name: /10월 12일/ }).waitFor();
await page.getByRole('button', { name: '+ 시험 추가' }).click();
const form = page.getByRole('dialog', { name: /시험 추가/ });
check('교시 기본 시간 자동 입력', (await form.innerText()).includes('09:00') && (await form.innerText()).includes('09:45'));
await form.getByLabel('1학년 과목').fill('국어');
await form.getByLabel('2학년 과목').fill('수학');
await form.getByRole('checkbox', { name: '3학년' }).uncheck();
await page.screenshot({ path: `${OUT}/schedule-form.png`, fullPage: true });
await form.getByRole('button', { name: '저장' }).click();
await page.getByRole('status').filter({ hasText: '시험 2건을 추가했습니다' }).waitFor();
await page.getByText('1교시 · 1학년 국어').waitFor();
check('달력 표시', await page.getByRole('button', { name: /10월 12일 시험 2건/ }).isVisible());
await page.screenshot({ path: `${OUT}/schedule-after.png`, fullPage: true });

const slots = await db.collection(`sessions/${SID}/slots`).get();
const s1 = slots.docs.find((d) => d.id === '2026-10-12_1_1');
check('저장된 시험 (시간·자동 배치)', slots.size === 2 && s1?.get('startTime') === '09:00' && s1?.get('rooms').some((p) => p.roomId === 'SC1'), slots.docs.map((d) => `${d.id}:${d.get('subject')}`).join(', '));
check('콘솔 오류 없음', errors.length === 0, errors.join(' / '));
await browser.close();
process.exit(failures ? 1 : 0);
