// 대시보드: 학교·학기 묶음을 폴더처럼 접고 펼친다 (새로고침 후에도 기억)
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

const SID = 'E2E_FOLD';
const LABEL = '접기중학교 · 2026학년도 2학기';
await db.doc(`sessions/${SID}`).set({ schoolName: '접기중학교', year: 2026, semester: 2, examName: '접기 점검', status: 'DRAFT', settings: { useBaseTimetable: false }, createdAt: new Date(), updatedBy: 'seed' });

const { browser, page, errors } = await openApp();
await go(page, '/admin');
const head = page.getByRole('button', { name: new RegExp(LABEL) });
await head.waitFor();
const section = page.getByRole('region', { name: LABEL });
check('처음엔 펼쳐짐', (await head.getAttribute('aria-expanded')) === 'true' && (await section.getByText('접기 점검').count()) > 0);
await head.click();
check('누르면 접힘 (프로젝트 숨김)', (await head.getAttribute('aria-expanded')) === 'false' && (await section.getByText('접기 점검').count()) === 0);
await page.reload();
await head.waitFor();
check('새로고침해도 접힘 유지', (await head.getAttribute('aria-expanded')) === 'false');
await head.click();
check('다시 누르면 펼침', (await section.getByText('접기 점검').count()) > 0);
check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
await db.recursiveDelete(db.doc(`sessions/${SID}`));
process.exit(failures ? 1 : 0);
