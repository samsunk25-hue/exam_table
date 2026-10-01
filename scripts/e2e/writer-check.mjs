// 출제 교사 규칙 설정: 개요 → 배정 설정에서 고르면 저장되고 되돌리기 목록에 남는다
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
const SID = 'E2E_WRITER';
await db.recursiveDelete(db.doc(`sessions/${SID}`));
await db.doc(`sessions/${SID}`).set({
  schoolName: '점검중학교', year: 2026, semester: 2, examName: '출제 교사 점검', status: 'DRAFT',
  settings: { useBaseTimetable: false }, createdAt: new Date(), updatedBy: 'seed',
});
const A = await openApp();
await go(A.page, `/admin/sessions/${SID}`);
await A.page.getByLabel('출제 교사 규칙').selectOption('NO_ROOM');
let v;
for (let i = 0; i < 30 && v !== 'NO_ROOM'; i++) {
  v = (await db.doc(`sessions/${SID}`).get()).get('settings.examWriter');
  if (v !== 'NO_ROOM') await new Promise((r) => setTimeout(r, 300));
}
check('설정 저장 (교실 감독 제외)', v === 'NO_ROOM', v);
check('기초시간표 설정은 그대로', (await db.doc(`sessions/${SID}`).get()).get('settings.useBaseTimetable') === false);
check('콘솔 오류 없음', A.errors.length === 0, A.errors.join(' / '));
await A.browser.close();
await db.recursiveDelete(db.doc(`sessions/${SID}`));
process.exit(failures ? 1 : 0);
