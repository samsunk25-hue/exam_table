// 자동 배정 + 다중 시나리오 점검: 실행 → 4개 안 비교 → 적용 → 배정 저장 확인
// 실행: node scripts/e2e/assign-check.mjs (에뮬레이터 실행 중)
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { go, openApp, runCompare } from './session.mjs';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
const require = createRequire(import.meta.url);
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
initializeApp({ projectId: 'smart-invigilation' });
const db = getFirestore();
const TERM = { term: '점검중학교|2026|2', school: '점검중학교', year: 2026, semester: 2 }; // 학교·학기 명단

const OUT = 'scripts/e2e/out';
mkdirSync(OUT, { recursive: true });
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

// 준비: 교사 16명(과목 4개), 2학년 × 3반 + 복도, 2일 × 2교시
const SID = 'E2E_ASSIGN';
await db.recursiveDelete(db.doc(`sessions/${SID}`));
const subjects = ['국어', '수학', '영어', '과학'];
const batch = db.batch();
for (let i = 1; i <= 16; i++) {
  batch.set(db.doc(`teachers/A${String(i).padStart(3, '0')}`), {
    name: `교사${i}`, email: null, subject: subjects[i % 4], homeroom: i <= 6 ? { grade: Math.ceil(i / 3), classNo: ((i - 1) % 3) + 1 } : null,
    defaultRole: i > 14 ? 'HALLWAY' : 'NORMAL', active: true, cumulativeLoad: i % 3, ...TERM, updatedBy: 'seed',
  });
}
const roomIds = [];
for (const g of [1, 2]) {
  for (const c of [1, 2, 3]) {
    roomIds.push([`EA${g}${c}`, g, c]);
    batch.set(db.doc(`rooms/EA${g}${c}`), { name: `E${g}-${c}`, spaceType: 'CLASSROOM', grade: g, classNo: c, chiefCount: 1, assistantCount: 0, ...TERM, updatedBy: 'seed' });
  }
  roomIds.push([`EH${g}`, g, null]);
  batch.set(db.doc(`rooms/EH${g}`), { name: `E${g}학년 복도`, spaceType: 'HALLWAY', grade: g, classNo: null, chiefCount: 1, assistantCount: 0, ...TERM, updatedBy: 'seed' });
}
await batch.commit();
await db.doc(`sessions/${SID}`).set({
  schoolName: '점검중학교', year: 2026, semester: 2, examName: '자동배정 점검', status: 'DRAFT',
  settings: { useBaseTimetable: false }, createdAt: new Date(), ...TERM, updatedBy: 'seed',
});
for (const date of ['2026-10-12', '2026-10-13']) {
  for (const period of [1, 2]) {
    for (const grade of [1, 2]) {
      await db.doc(`sessions/${SID}/slots/${date}_${period}_${grade}`).set({
        date, period, startTime: null, endTime: null, grade, subject: subjects[(period + grade) % 4], type: 'EXAM',
        rooms: roomIds.filter(([, g]) => g === grade).map(([roomId, , c]) => ({ roomId, classNo: c, headcount: null, roomType: 'NORMAL' })),
        ...TERM, updatedBy: 'seed',
      });
    }
  }
}

const { browser, page, errors } = await openApp();
await go(page, `/admin/sessions/${SID}/assign`);
await runCompare(page);
await page.getByText('다중 시나리오 비교').waitFor({ timeout: 60000 });
const compare = page.locator('section', { hasText: '다중 시나리오 비교' }).first();
// 실행 기록 4개가 화면에 다 들어올 때까지 (기본안이 먼저 보이고 대안이 이어서 들어온다)
let heads = [];
for (let i = 0; i < 50 && heads.length < 5; i++) {
  heads = await compare.locator('thead th').allInnerTexts();
  if (heads.length < 5) await page.waitForTimeout(200);
}
check('4개 안 비교표', heads.length === 5 && heads.some((h) => h.includes('A안')) && heads.some((h) => h.includes('C안')), heads.join(' | '));
await page.screenshot({ path: `${OUT}/assign-compare.png`, fullPage: true });

// 추천안(바로 적용된 안)이 아닌 다른 안 하나를 자세히 보기 → 적용 (추천안은 엔진 결과에 따라 바뀐다)
const KEY = { 'A안': 'EQUITY', 'B안': 'NO_CONSECUTIVE', 'C안': 'SUBJECT_HALLWAY' };
const rowButtons = compare.locator('tbody tr').last().getByRole('button');
const labels = (await rowButtons.allInnerTexts()).map((t) => t.trim());
const pick = [3, 2, 1].find((i) => labels[i] === '자세히');
const plan = heads[pick + 1].match(/[ABC]안/)[0];
await rowButtons.nth(pick).click();
await page.getByRole('heading', { name: new RegExp(plan) }).waitFor();
await page.getByRole('button', { name: '이 결과 적용' }).click();
await page.getByRole('status').filter({ hasText: '적용했습니다' }).waitFor({ timeout: 60000 });
await page.getByText('현재 적용됨').waitFor();
check(`${plan} 적용`, true);
await page.screenshot({ path: `${OUT}/assign-applied.png`, fullPage: true });

const session = await db.doc(`sessions/${SID}`).get();
const assigns = await db.collection(`sessions/${SID}/assignments`).get();
check('세션 상태 → 자동 배정 완료', session.get('status') === 'AUTO_ASSIGNED', session.get('status'));
check('배정 저장 (32석)', assigns.size === 32, `${assigns.size}석`);
const run = await db.doc(`sessions/${SID}/runs/${session.get('assignmentStats.runId')}`).get();
check(`적용한 안 = ${plan}`, run.get('scenario') === KEY[plan], run.get('scenarioLabel'));
check('콘솔 오류 없음', errors.length === 0, errors.join(' / '));
await browser.close();
process.exit(failures ? 1 : 0);
