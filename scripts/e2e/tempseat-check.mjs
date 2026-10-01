// 미배정 자리에서 명단에 없는 사람을 직접 적어 임시 감독자로 배정
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
const SID = 'E2E_TEMPSEAT';
const TERM = { term: '점검중학교|2026|2', school: '점검중학교', year: 2026, semester: 2 };
await db.recursiveDelete(db.doc(`sessions/${SID}`));
for (const d of (await db.collection('teachers').where('onlySession', '==', SID).get()).docs) await d.ref.delete();
await db.doc(`sessions/${SID}`).set({ schoolName: '점검중학교', year: 2026, semester: 2, examName: '임시 자리 점검', status: 'DRAFT', settings: { useBaseTimetable: false }, createdAt: new Date(), updatedBy: 'seed' });
await db.doc('rooms/RTS').set({ name: '임시-1', spaceType: 'CLASSROOM', grade: 1, classNo: 1, chiefCount: 1, assistantCount: 0, ...TERM, updatedBy: 'seed' });
await db.doc(`sessions/${SID}/slots/2026-10-12_1_1`).set({
  date: '2026-10-12', period: 1, grade: 1, subject: '과학', type: 'EXAM', startTime: '09:00', endTime: '09:45',
  rooms: [{ roomId: 'RTS', classNo: 1, headcount: null, roomType: 'NORMAL' }], updatedBy: 'seed',
});

const { browser, page, errors } = await openApp();
await go(page, `/admin/sessions/${SID}/editor`);
await page.getByRole('button', { name: /^1교시 임시-1 정감독 미배정/ }).click();
const form = page.getByRole('form', { name: '임시 감독자 직접 입력' });
await form.waitFor();
await form.getByLabel('임시 감독자 이름 직접 입력').fill('박강사');
await form.getByLabel('임시 감독자 메모 직접 입력').fill('외부 강사');
await form.getByRole('button', { name: '추가하고 배정' }).click();
await page.getByRole('status').filter({ hasText: '박강사님(임시 감독자)을 배정했습니다' }).waitFor({ timeout: 30000 });
const temp = (await db.collection('teachers').where('onlySession', '==', SID).get()).docs[0];
check('임시 감독자 추가 (이번 시험만)', temp?.get('name') === '박강사' && temp?.get('temporary') === true && temp?.get('note') === '외부 강사');
const a = await db.doc(`sessions/${SID}/assignments/2026-10-12_1_1__RTS_CHIEF_1`).get();
check('그 자리에 배정', a.get('teacherId') === temp?.id, a.get('teacherId'));
await page.getByRole('button', { name: /^1교시 임시-1 정감독 박강사/ }).waitFor();
check('칸에 이름 표시', true);
check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
for (const d of (await db.collection('teachers').where('onlySession', '==', SID).get()).docs) await d.ref.delete();
await db.recursiveDelete(db.doc(`sessions/${SID}`));
await db.doc('rooms/RTS').delete();
process.exit(failures ? 1 : 0);
