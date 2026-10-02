// 시간표 편집 끌어다 놓기: 맞바꾸기 / 빈칸으로 옮기기 / 조건에 걸리면 막기
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

// 1·2·3교시 같은 교실, 1교시 김국어(T001) / 2교시 이수학(T002) / 3교시 빈칸, 이수학은 3교시 불가
const SID = 'E2E_DND';
await db.recursiveDelete(db.doc(`sessions/${SID}`));
await db.doc(`sessions/${SID}`).set({
  schoolName: '점검중학교', year: 2026, semester: 2, examName: '끌어놓기 점검', status: 'REVIEW',
  settings: { useBaseTimetable: false }, createdAt: new Date(), updatedBy: 'seed',
});
await db.doc('rooms/RDD').set({ name: '끌기-1', spaceType: 'CLASSROOM', grade: 1, classNo: 9, chiefCount: 1, assistantCount: 0, ...TERM, updatedBy: 'seed' });
const seat = (p) => `2026-10-12_${p}_1__RDD_CHIEF_1`;
for (const p of [1, 2, 3]) {
  await db.doc(`sessions/${SID}/slots/2026-10-12_${p}_1`).set({
    date: '2026-10-12', period: p, grade: 1, subject: '과학', type: 'EXAM', startTime: `${8 + p}:00`.padStart(5, '0'), endTime: `${8 + p}:45`.padStart(5, '0'),
    rooms: [{ roomId: 'RDD', classNo: 9, headcount: null, roomType: 'NORMAL' }], updatedBy: 'seed',
  });
}
for (const [p, t] of [[1, 'T001'], [2, 'T002']]) {
  await db.doc(`sessions/${SID}/assignments/${seat(p)}`).set({
    slotId: `2026-10-12_${p}_1`, groupId: `2026-10-12_${p}_1__RDD`, roomId: 'RDD', role: 'CHIEF', weight: 1, teacherId: t,
    score: 0, reason: 'seed', source: 'AUTO', date: '2026-10-12', period: p, runId: null, updatedBy: 'seed',
  });
}
await db.doc(`sessions/${SID}/availability/T002_2026-10-12_3`).set({
  teacherId: 'T002', date: '2026-10-12', period: 3, available: false, reason: '출장', source: 'ADMIN', status: 'APPROVED', adminNote: null, updatedBy: 'seed',
});
const at = async (p) => (await db.doc(`sessions/${SID}/assignments/${seat(p)}`).get()).get('teacherId') ?? null;

const A = await openApp();
await go(A.page, `/admin/sessions/${SID}/editor`);
const cell = (p) => A.page.getByRole('button', { name: new RegExp(`^${p}교시 끌기-1 정감독`) });
await cell(1).waitFor();

// 1. 맞바꾸기: 1교시(김국어) → 2교시(이수학)
await cell(1).dragTo(cell(2));
check('맞바꾸기 (1교시 ↔ 2교시)', await until(async () => (await at(1)) === 'T002' && (await at(2)) === 'T001'), `${await at(1)}, ${await at(2)}`);

// 2. 옮기기: 2교시(김국어) → 3교시 빈칸
await A.page.getByRole('button', { name: /^2교시 끌기-1 정감독 김국어/ }).waitFor();
await cell(2).dragTo(cell(3));
check('빈칸으로 옮기기 (2교시 → 3교시)', await until(async () => (await at(2)) === null && (await at(3)) === 'T001'), `${await at(2)}, ${await at(3)}`);

// 3. 막기: 1교시(이수학) → 3교시 (이수학은 3교시 불가)
await A.page.getByRole('button', { name: /^3교시 끌기-1 정감독 김국어/ }).waitFor();
await cell(1).dragTo(cell(3));
const blocked = await A.page.getByRole('status').filter({ hasText: '바꿀 수 없습니다' }).last().waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
await new Promise((r) => setTimeout(r, 1000));
check('불가시간에 걸리면 막고 이유 표시', blocked && (await at(1)) === 'T002' && (await at(3)) === 'T001');
await A.page.screenshot({ path: `${OUT}/dnd.png`, fullPage: true });
check('콘솔 오류 없음', A.errors.length === 0, A.errors.join(' / '));
await A.browser.close();
await db.recursiveDelete(db.doc(`sessions/${SID}`));
process.exit(failures ? 1 : 0);
