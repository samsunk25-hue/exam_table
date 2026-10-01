// 되돌리기 점검:
// 1) 교사 수정 → 작업 기록에서 되돌리기 → 원래 값
// 2) 같은 교사를 두 번 수정 → 첫 작업을 되돌리면 뒤 작업도 함께 되돌려짐 (미리 보기 안내)
// 3) 진행 단계: 자동배정 완료 → 검토 → "이전 단계로" 두 번 → 초안, 되돌리기를 다시 되돌리면 복구
// 4) 통합 양식 업로드 한 번 = 작업 하나 → 되돌리면 올린 자료가 모두 사라짐
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
const until = async (fn, ms = 15000) => {
  for (let t = 0; t < ms; t += 300) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
};

const SID = 'E2E_UNDO';
await db.recursiveDelete(db.doc(`sessions/${SID}`));
await db.recursiveDelete(db.collection('undoOps'));
await db.doc(`sessions/${SID}`).set({
  schoolName: '점검중학교', year: 2026, semester: 2, examName: '되돌리기 점검', status: 'DRAFT',
  settings: { useBaseTimetable: false }, createdAt: new Date(Date.now() + 120_000), updatedBy: 'seed',
});
await db.doc('teachers/T001').set({ name: '김국어', email: 'kim@test.kr', subject: '국어', homeroom: { grade: 1, classNo: 1 }, defaultRole: 'NORMAL', active: true, cumulativeLoad: 0, ...TERM, updatedBy: 'seed' });
const subject = async () => (await db.doc('teachers/T001').get()).get('subject');

const { browser, page, errors } = await openApp();
await page.evaluate((k) => localStorage.setItem('sim.term', k), TERM.term);

async function editSubject(v) {
  await go(page, '/admin/teachers');
  await page.locator('tr', { hasText: '김국어' }).getByRole('button', { name: '수정' }).click();
  await page.getByLabel('담당교과').fill(v);
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await until(async () => (await subject()) === v);
}
async function openSchoolHistory() {
  await page.getByRole('button', { name: '↶ 작업 기록·되돌리기' }).click();
  return page.getByRole('dialog', { name: '작업 기록·되돌리기' });
}

// 1. 교사 수정 → 되돌리기
await editSubject('국어A');
let hist = await openSchoolHistory();
await hist.getByRole('button', { name: '교사 수정 전으로 되돌리기', exact: true }).first().click();
let confirm = page.getByRole('dialog', { name: '작업 되돌리기' });
await confirm.getByRole('button', { name: '되돌리기', exact: true }).click();
await confirm.waitFor({ state: 'detached', timeout: 30000 });
check('교사 수정 되돌리기 → 원래 값', await until(async () => (await subject()) === '국어'), await subject());
await page.keyboard.press('Escape');

// 2. 두 번 수정 → 첫 작업 되돌리면 둘 다
await editSubject('국어B');
await editSubject('국어C');
hist = await openSchoolHistory();
const editButtons = hist.getByRole('button', { name: '교사 수정 전으로 되돌리기', exact: true });
for (let i = 0; i < 50 && (await editButtons.count()) < 2; i++) await page.waitForTimeout(200); // 국어B·국어C 기록이 목록에 뜰 때까지
await editButtons.nth(1).click(); // 최신순이므로 두 번째 = 국어B 작업
confirm = page.getByRole('dialog', { name: '작업 되돌리기' });
await confirm.getByText(/함께 되돌려집니다/).waitFor();
await page.screenshot({ path: `${OUT}/undo-confirm.png` });
await confirm.getByRole('button', { name: '되돌리기', exact: true }).click();
await confirm.waitFor({ state: 'detached', timeout: 30000 });
check('앞 작업 되돌리기 → 뒤 작업도 함께 (국어C → 국어)', await until(async () => (await subject()) === '국어'), await subject());
await page.keyboard.press('Escape');

// 3. 진행 단계
const status = async () => (await db.doc(`sessions/${SID}`).get()).get('status');
async function step(label, reason) {
  await go(page, `/admin/sessions/${SID}`);
  await page.getByRole('button', { name: label, exact: true }).click();
  if (reason) await page.locator('textarea').fill(reason);
  await page.getByRole('button', { name: '확인', exact: true }).click();
}
async function prevStep() {
  await go(page, `/admin/sessions/${SID}`);
  await page.getByRole('button', { name: '↶ 이전 단계로 되돌리기' }).click();
  const c = page.getByRole('dialog', { name: '작업 되돌리기' });
  await c.getByRole('button', { name: '되돌리기', exact: true }).click();
  await c.waitFor({ state: 'detached', timeout: 30000 });
}
await step('자동 배정 완료로 표시');
await until(async () => (await status()) === 'AUTO_ASSIGNED');
await step('검토 시작');
await until(async () => (await status()) === 'REVIEW');
await prevStep();
check('이전 단계로: 검토 → 자동배정', await until(async () => (await status()) === 'AUTO_ASSIGNED'), await status());
await prevStep();
check('이전 단계로 한 번 더: → 초안', await until(async () => (await status()) === 'DRAFT'), await status());

// 되돌리기를 다시 되돌리기 (복구)
await go(page, `/admin/sessions/${SID}/history`);
await page.getByRole('button', { name: /^되돌리기: 단계 변경: 자동 배정 완료로 표시/ }).first().click();
confirm = page.getByRole('dialog', { name: '작업 되돌리기' });
await confirm.getByRole('button', { name: '되돌리기', exact: true }).click();
await confirm.waitFor({ state: 'detached', timeout: 30000 });
check('되돌리기 취소 → 다시 자동배정', await until(async () => (await status()) === 'AUTO_ASSIGNED'), await status());
await page.screenshot({ path: `${OUT}/undo-history.png`, fullPage: true });

// 4. 통합 양식 업로드 = 작업 하나
await step('초안으로 되돌리기');
await until(async () => (await status()) === 'DRAFT');
const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /샘플 양식/ }).click()]);
await dl.saveAs(`${OUT}/undo-sample.xlsx`);
await page.getByRole('button', { name: '통합 양식 업로드' }).click();
const up = page.getByRole('dialog', { name: '기초 자료 통합 양식 업로드' });
await up.locator('input[type=file]').setInputFiles(`${OUT}/undo-sample.xlsx`);
await up.getByText(/검증 결과/).waitFor();
await up.getByRole('button', { name: '저장', exact: true }).click();
const keep = page.getByRole('button', { name: /기존 자료 유지/ });
if (await keep.isVisible({ timeout: 3000 }).catch(() => false)) await keep.click();
await up.getByText('저장했습니다.').waitFor({ timeout: 60000 });
const slots = async () => (await db.collection(`sessions/${SID}/slots`).get()).size;
const before = await slots();
const uploads = (await db.collection('undoOps').where('label', '==', '통합 양식 업로드').get()).docs;
check('업로드 한 번 = 작업 기록 하나', uploads.length === 1 && before > 0, `기록 ${uploads.length}개, 시험 ${before}건`);
await up.getByRole('button', { name: '닫기' }).first().click();
await go(page, `/admin/sessions/${SID}/history`);
await page.getByRole('button', { name: '통합 양식 업로드 전으로 되돌리기' }).click();
confirm = page.getByRole('dialog', { name: '작업 되돌리기' });
await confirm.getByRole('button', { name: '되돌리기', exact: true }).click();
await confirm.waitFor({ state: 'detached', timeout: 60000 });
const sampleTeachers = async () => (await db.collection('teachers').where('email', '==', 't01@sample.school.kr').where('term', '==', TERM.term).get()).size;
check('업로드 되돌리기 → 시험·교사 모두 사라짐', await until(async () => (await slots()) === 0 && (await sampleTeachers()) === 0), `시험 ${await slots()}건`);

check('콘솔 오류 없음', errors.length === 0, errors.join(' / '));
await browser.close();
process.exit(failures ? 1 : 0);
