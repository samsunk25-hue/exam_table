// 두 번째 시험 자동 배정: 같은 학년도 앞선 확정 시험의 감독 횟수를 이어서 맞춘다
// 1학기 시험(확정 전이어도)에서 김국어 정감독 3회, 이수학 0회 → 2학기 시험 정감독 1자리는 이수학에게
import { createRequire } from 'node:module';
import { go, openApp } from './session.mjs';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
const require = createRequire(import.meta.url);
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
initializeApp({ projectId: 'smart-invigilation' });
const db = getFirestore();
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const until = async (fn, ms = 60000) => {
  for (let t = 0; t < ms; t += 500) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
};

const T1 = { term: '누적중학교|2026|1', school: '누적중학교', year: 2026, semester: 1 };
const TERM = { term: '누적중학교|2026|2', school: '누적중학교', year: 2026, semester: 2 };
const cleanup = async () => {
  for (const id of ['E2E_PRIOR1', 'E2E_PRIOR2']) await db.recursiveDelete(db.doc(`sessions/${id}`));
  for (const id of ['P1KIM', 'P2KIM', 'P2LEE']) await db.doc(`teachers/${id}`).delete();
  await db.doc('rooms/RPR').delete();
};
await cleanup();
const base = { schoolName: '누적중학교', year: 2026, settings: {}, updatedBy: 'seed' };
await db.doc('sessions/E2E_PRIOR1').set({ ...base, semester: 1, examName: '누적 1학기 기말', status: 'REVIEW', createdAt: new Date(Date.now() - 9e9) });
await db.doc('sessions/E2E_PRIOR2').set({ ...base, semester: 2, examName: '누적 2학기 중간', status: 'REVIEW', createdAt: new Date() });
await db.doc('teachers/P1KIM').set({ name: '김누적', email: 'kimp@test.kr', subject: '국어', homeroom: null, defaultRole: 'NORMAL', active: true, cumulativeLoad: 0, ...T1, updatedBy: 'seed' });
for (const p of [1, 2, 3]) {
  await db.doc(`sessions/E2E_PRIOR1/assignments/a${p}`).set({ slotId: 's', groupId: 'g', roomId: 'RPR', role: 'CHIEF', weight: 1, teacherId: 'P1KIM', score: 0, reason: 'seed', source: 'AUTO', date: '2026-07-01', period: p, runId: null });
}
const teacher = (id, name, email) => db.doc(`teachers/${id}`).set({ name, email, subject: '과학', homeroom: null, defaultRole: 'NORMAL', active: true, cumulativeLoad: 0, ...TERM, updatedBy: 'seed' });
await teacher('P2KIM', '김누적', 'kimp@test.kr');
await teacher('P2LEE', '이누적', 'leep@test.kr');
await db.doc('rooms/RPR').set({ name: '누적-1', spaceType: 'CLASSROOM', grade: 1, classNo: 1, chiefCount: 1, assistantCount: 0, ...TERM, updatedBy: 'seed' });
await db.doc('sessions/E2E_PRIOR2/slots/2026-10-12_1_1').set({
  date: '2026-10-12', period: 1, grade: 1, subject: '수학', type: 'EXAM', startTime: null, endTime: null,
  rooms: [{ roomId: 'RPR', classNo: 1, headcount: null, roomType: 'NORMAL' }], updatedBy: 'seed',
});

const { browser, page, errors } = await openApp();
await go(page, '/admin/sessions/E2E_PRIOR2/assign');
await page.getByRole('button', { name: '자동 배정하고 바로 적용' }).click();
const col = db.collection('sessions/E2E_PRIOR2/assignments');
check('자동 배정 적용됨', await until(async () => (await col.get()).size === 1));
const who = (await col.get()).docs[0]?.get('teacherId');
check('정감독 1자리는 앞선 시험 0회인 이누적에게', who === 'P2LEE', who);
check('콘솔 오류 없음', errors.length === 0, errors.join(' / '));
await browser.close();
await cleanup();
console.log(failures ? `\n실패 ${failures}건` : '\n모두 통과');
process.exit(failures ? 1 : 0);
