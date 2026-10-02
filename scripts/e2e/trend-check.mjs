// 학년도 추이·피로도 예측: 1학기 확정 시험(다른 학기 교사 문서, 같은 이메일) + 이번 2학기 시험
// 김국어: 1학기 5점 + 이번 3교시 연속 3회 → 피로도 높음 / 박영어: 감독 없음 → 낮음
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
await A.page.getByRole('heading', { name: '학년도 추이와 피로도 예측' }).waitFor();
const card = A.page.getByRole('heading', { name: '학년도 추이와 피로도 예측' }).locator('..');
// 명단은 처음에 접혀 있다
await card.getByText(/교사별 피로도 명단/).click();
const kim = card.locator('tr', { hasText: '김국어' });
const kimText = await kim.innerText();
check('지난 시험 열 (1학기 기말)', (await card.innerText()).includes('1학기 추이 1학기 기말'));
check('김국어: 1학기 5 + 이번 3 = 학년도 8', /5\s+3\s+8/.test(kimText.replace(/\s+/g, ' ')), kimText.replace(/\s+/g, ' '));
check('김국어 피로도 높음 (연속 감독)', kimText.includes('높음') && kimText.includes('연속 감독 2쌍'));
const park = (await card.locator('tr', { hasText: '박영어' }).innerText()).replace(/\s+/g, ' ');
check('박영어 피로도 낮음', park.includes('낮음'), park + ' / 행 ' + (await card.locator('tbody tr').count()));
check('피로도 높음 안내', (await card.innerText()).includes('피로도 높음 1명'));
await A.page.screenshot({ path: 'scripts/e2e/out/trend.png', fullPage: true });
check('콘솔 오류 없음', A.errors.length === 0, A.errors.join(' / '));
await A.browser.close();
for (const id of ['E2E_TREND1', 'E2E_TREND2']) await db.recursiveDelete(db.doc(`sessions/${id}`));
await db.doc('loadLedger/E2E_TREND1_T1KIM').delete();
for (const id of ['T1KIM', 'T2KIM', 'T2LEE', 'T2PARK']) await db.doc(`teachers/${id}`).delete();
await db.doc('rooms/RTR').delete();
process.exit(failures ? 1 : 0);
