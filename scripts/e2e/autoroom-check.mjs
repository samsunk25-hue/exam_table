// 시험실을 따로 등록하지 않아도: 교사 명단의 담임(학년·반)으로 학급 교실을 만들고 시험에 자동 배치
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
const SID = 'E2E_AUTOROOM';
const TERM = { term: '교실자동중학교|2026|2', school: '교실자동중학교', year: 2026, semester: 2 };
const clean = async () => {
  await db.recursiveDelete(db.doc(`sessions/${SID}`));
  for (const c of ['teachers', 'rooms']) for (const d of (await db.collection(c).where('term', '==', TERM.term).get()).docs) await d.ref.delete();
};
await clean();
await db.doc(`sessions/${SID}`).set({ schoolName: TERM.school, year: 2026, semester: 2, examName: '교실 자동', status: 'DRAFT', settings: { useBaseTimetable: true }, createdAt: new Date(), updatedBy: 'seed' });
for (const [id, cls] of [['AR1', 1], ['AR2', 2]]) {
  await db.doc(`teachers/${id}`).set({ name: `담임${cls}`, email: null, subject: '국어', homeroom: { grade: 1, classNo: cls }, defaultRole: 'NORMAL', active: true, cumulativeLoad: 0, ...TERM, updatedBy: 'seed' });
}
await db.doc('teachers/AR3').set({ name: '비담임', email: null, subject: '수학', homeroom: null, defaultRole: 'NORMAL', active: true, cumulativeLoad: 0, ...TERM, updatedBy: 'seed' });
await db.doc(`sessions/${SID}/slots/2026-12-01_1_1`).set({ date: '2026-12-01', period: 1, grade: 1, subject: '국어', type: 'EXAM', startTime: '09:00', endTime: '09:45', rooms: [], updatedBy: 'seed' });

const { browser, page, errors } = await openApp();
await go(page, `/admin/sessions/${SID}`);
const next = page.getByLabel('다음 할 일');
await next.waitFor();
check('담임 정보가 있으면 "시험실 등록" 단계 없음', !(await next.innerText()).includes('시험실 등록하기'), (await next.innerText()).replace(/\s+/g, ' '));
let rooms = [];
let placed = [];
for (let i = 0; i < 60 && (!rooms.length || !placed.length); i++) {
  rooms = (await db.collection('rooms').where('term', '==', TERM.term).get()).docs.map((d) => d.data());
  placed = (await db.doc(`sessions/${SID}/slots/2026-12-01_1_1`).get()).get('rooms') ?? [];
  if (!rooms.length || !placed.length) await new Promise((r) => setTimeout(r, 300));
}
check('담임 정보로 학급 교실 2개 자동 생성 (정·부 1명씩)', rooms.length === 2 && rooms.every((r) => r.spaceType === 'CLASSROOM' && r.grade === 1 && r.chiefCount === 1 && r.assistantCount === 1), rooms.map((r) => r.name).join(','));
check('시험에 학급 교실 자동 배치', placed.length === 2, JSON.stringify(placed.map((p) => p.classNo)));
await page.waitForFunction(() => document.querySelector('[aria-label="다음 할 일"]')?.textContent?.includes('자동 배정하기'), null, { timeout: 15000 }).catch(() => {});
check('바로 자동 배정 안내', (await next.innerText()).includes('자동 배정하기'));
check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
await clean();
process.exit(failures ? 1 : 0);
