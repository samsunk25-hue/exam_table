// 학년도 감독 횟수: 1학기 확정 시험(다른 학기 교사 문서, 같은 이메일) + 이번 2학기 시험을 종류별로 합친다
// 김국어: 1학기 정감독 2·부감독 1·별도시험장 1 + 이번 정감독 3 → 정 5 · 부 1 · 특별실 1 · 합계 7 / 박영어: 0
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { go, openApp } from './session.mjs';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
const require = createRequire(import.meta.url);
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
initializeApp({ projectId: 'smart-invigilation' });
const db = getFirestore();
const T1 = { term: '추이중학교|2026|1', school: '추이중학교', year: 2026, semester: 1 };
const TERM = { term: '추이중학교|2026|2', school: '추이중학교', year: 2026, semester: 2 };

mkdirSync('scripts/e2e/out', { recursive: true });
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

for (const id of ['E2E_TREND1', 'E2E_TREND2']) await db.recursiveDelete(db.doc(`sessions/${id}`));
const base = { schoolName: '추이중학교', year: 2026, settings: { useBaseTimetable: false }, updatedBy: 'seed' };
await db.doc('sessions/E2E_TREND1').set({ ...base, semester: 1, examName: '추이 1학기 기말', status: 'CONFIRMED', createdAt: new Date(Date.now() - 9e9) });
await db.doc('sessions/E2E_TREND2').set({ ...base, semester: 2, examName: '추이 2학기 중간', status: 'REVIEW', createdAt: new Date() });
// 1학기 교사 문서 (같은 이메일, 다른 ID) + 확정 원장
await db.doc('teachers/T1KIM').set({ name: '김국어', email: 'kim@test.kr', subject: '국어', homeroom: null, defaultRole: 'NORMAL', active: true, cumulativeLoad: 5, ...T1, updatedBy: 'seed' });
await db.doc('loadLedger/E2E_TREND1_T1KIM').set({ sessionId: 'E2E_TREND1', teacherId: 'T1KIM', load: 5 });
// 1학기 확정 시험의 김국어 배정 (정 2·부 1·별도시험장 1)
await db.doc('rooms/RTRSEP').set({ name: '추이 별도시험장', spaceType: 'SEPARATE', grade: null, classNo: null, chiefCount: 1, assistantCount: 0, ...T1, updatedBy: 'seed' });
for (const [id, role, roomId] of [['a1', 'CHIEF', 'RTR'], ['a2', 'CHIEF', 'RTR'], ['a3', 'ASSISTANT', 'RTR'], ['a4', 'CHIEF', 'RTRSEP']]) {
  await db.doc(`sessions/E2E_TREND1/assignments/${id}`).set({ slotId: 's', groupId: 'g', roomId, role, weight: 1, teacherId: 'T1KIM', score: 0, reason: 'seed', source: 'AUTO', date: '2026-07-01', period: 1, runId: null });
}
// 이번 학기 명단: 김국어(T2KIM)·이수학·박영어
const teacher = (id, name, email, subject) => db.doc(`teachers/${id}`).set({ name, email, subject, homeroom: null, defaultRole: 'NORMAL', active: true, cumulativeLoad: 0, ...TERM, updatedBy: 'seed' });
await teacher('T2KIM', '김국어', 'kim@test.kr', '국어');
await teacher('T2LEE', '이수학', 'lee@test.kr', '수학');
await teacher('T2PARK', '박영어', 'park@test.kr', '영어');
// 이번 시험: 김국어 1·2·3교시 연속
await db.doc('rooms/RTR').set({ name: '추이-1', spaceType: 'CLASSROOM', grade: 1, classNo: 1, chiefCount: 1, assistantCount: 0, ...TERM, updatedBy: 'seed' });
for (const p of [1, 2, 3]) {
  await db.doc(`sessions/E2E_TREND2/slots/2026-10-12_${p}_1`).set({
    date: '2026-10-12', period: p, grade: 1, subject: '수학', type: 'EXAM', startTime: null, endTime: null,
    rooms: [{ roomId: 'RTR', classNo: 1, headcount: null, roomType: 'NORMAL' }], updatedBy: 'seed',
  });
  await db.doc(`sessions/E2E_TREND2/assignments/2026-10-12_${p}_1__RTR_CHIEF_1`).set({
    slotId: `2026-10-12_${p}_1`, groupId: `2026-10-12_${p}_1__RTR`, roomId: 'RTR', role: 'CHIEF', weight: 1, teacherId: 'T2KIM',
    score: 0, reason: 'seed', source: 'AUTO', date: '2026-10-12', period: p, runId: null, updatedBy: 'seed',
  });
}


const A = await openApp();
await go(A.page, '/admin/sessions/E2E_TREND2/equity');
await A.page.getByRole('heading', { name: '학년도 감독 횟수' }).waitFor();
const card = A.page.getByRole('heading', { name: '학년도 감독 횟수' }).locator('..');
check('먼저 만든 시험 1개 + 이번 시험', (await card.innerText()).includes('먼저 만든 시험 1개'));
// 명단은 처음에 접혀 있다
await card.getByText(/교사별 학년도 감독 횟수/).click();
const cells = async (name) => (await card.locator('tr', { hasText: name }).locator('td').allInnerTexts()).map((x) => x.trim());
const kim = await cells('김국어');
check('김국어: 정 5 · 부 1 · 복도 0 · 특별실 1 · 자습 0 · 합계 7', kim.slice(1).join(',') === '5,1,0,1,0,7', kim.join(','));
const park = await cells('박영어');
check('박영어: 모두 0', park.slice(1).join(',') === '0,0,0,0,0,0', park.join(','));
check('피로도 표·안내 없음', !(await card.innerText()).includes('피로도'));
await A.page.screenshot({ path: 'scripts/e2e/out/trend.png', fullPage: true });
check('콘솔 오류 없음', A.errors.length === 0, A.errors.join(' / '));
await A.browser.close();
for (const id of ['E2E_TREND1', 'E2E_TREND2']) await db.recursiveDelete(db.doc(`sessions/${id}`));
await db.doc('loadLedger/E2E_TREND1_T1KIM').delete();
for (const id of ['T1KIM', 'T2KIM', 'T2LEE', 'T2PARK']) await db.doc(`teachers/${id}`).delete();
await db.doc('rooms/RTR').delete();
await db.doc('rooms/RTRSEP').delete();
process.exit(failures ? 1 : 0);
