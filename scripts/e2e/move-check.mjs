// 교사 다른 학교로 이동: 교사 수정 → 소속 학교·학기 "직접 입력" → 저장
// → 그 학교·학기 명단으로 옮겨짐(누적 0, 담임 비움), 원래 학기 명단에서 사라짐, 되돌리기 기록
import { createRequire } from 'node:module';
import { go, openApp } from './session.mjs';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
const require = createRequire(import.meta.url);
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
initializeApp({ projectId: 'smart-invigilation' });
const db = getFirestore();
const TERM = '점검중학교|2026|2';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

await db.doc('teachers/T001').update({ cumulativeLoad: 3, homeroom: { grade: 1, classNo: 1 } });
const A = await openApp();
await A.page.evaluate((k) => localStorage.setItem('sim.term', k), TERM);
await db.doc('sessions/E2E_MOVE').set({ schoolName: '점검중학교', year: 2026, semester: 2, examName: '이동 점검', status: 'DRAFT', settings: { useBaseTimetable: false }, createdAt: new Date(), updatedBy: 'seed' });
await go(A.page, '/admin/sessions/E2E_MOVE/teachers');
await A.page.locator('tr', { hasText: '김국어' }).getByRole('button', { name: '수정' }).click();
const dlg = A.page.getByRole('dialog', { name: /교사 수정/ });
await dlg.getByLabel('소속 학교·학기').selectOption('__new');
await dlg.getByLabel('학교명').fill('이동중학교');
await dlg.getByText(/이동중학교 · 2026학년도 2학기 명단으로 옮겨집니다/).waitFor();
check('이동 안내 (배정에서 빠짐·누적 0점)', await dlg.getByText(/누적 업무점수는 0점부터/).isVisible());
await dlg.getByRole('button', { name: '저장', exact: true }).click();
await dlg.waitFor({ state: 'detached' });

let t;
for (let i = 0; i < 30; i++) {
  t = (await db.doc('teachers/T001').get()).data();
  if (t.term === '이동중학교|2026|2') break;
  await new Promise((r) => setTimeout(r, 300));
}
check('다른 학교 명단으로 이동 (누적 0, 담임 비움)', t.term === '이동중학교|2026|2' && t.cumulativeLoad === 0 && t.homeroom === null, JSON.stringify({ term: t.term, load: t.cumulativeLoad, homeroom: t.homeroom }));
check('원래 학기 명단에서 사라짐', (await A.page.locator('tr', { hasText: '김국어' }).count()) === 0);
await db.doc('sessions/E2E_MOVE2').set({ schoolName: '이동중학교', year: 2026, semester: 2, examName: '이동 도착', status: 'DRAFT', settings: { useBaseTimetable: false }, createdAt: new Date(), updatedBy: 'seed' });
await go(A.page, '/admin/sessions/E2E_MOVE2/teachers');
check('옮긴 학교·학기 프로젝트에서 보임', await A.page.getByRole('cell', { name: '김국어' }).waitFor({ timeout: 10000 }).then(() => true).catch(() => false));
const ops = await db.collection('undoOps').where('label', '==', '교사 이동: 김국어 → 이동중학교 · 2026학년도 2학기').get();
check('되돌리기 목록에 이동 기록', ops.size === 1);
check('콘솔 오류 없음', A.errors.length === 0, A.errors.join(' / '));
await A.browser.close();
for (const id of ['E2E_MOVE', 'E2E_MOVE2']) await db.recursiveDelete(db.doc(`sessions/${id}`));
process.exit(failures ? 1 : 0);
