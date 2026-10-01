// 다른 프로젝트 시험 시간표 불러오기 점검: 시작일을 옮겨(+7일) 가져오고, 없는 시험실 배치는 뺀다
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

const SRC = 'E2E_IMP_SRC';
const DST = 'E2E_IMP_DST';
for (const id of [SRC, DST]) await db.recursiveDelete(db.doc(`sessions/${id}`));
await db.doc('rooms/IMP1').set({ name: 'I1-1', spaceType: 'CLASSROOM', grade: 1, classNo: 1, chiefCount: 1, assistantCount: 0, updatedBy: 'seed' });
const base = { schoolName: '불러오기중학교', year: 2026, semester: 2, status: 'DRAFT', settings: { useBaseTimetable: false }, updatedBy: 'seed' };
await db.doc(`sessions/${SRC}`).set({ ...base, examName: '원본 시험', createdAt: new Date(), settings: { useBaseTimetable: false, periodTimes: { 1: { start: '09:00', end: '09:45' } } } });
await db.doc(`sessions/${DST}`).set({ ...base, examName: '새 시험', createdAt: new Date(Date.now() + 1000) });
const slot = (date, period, grade, subject, type, rooms) => ({ date, period, startTime: '09:00', endTime: '09:45', grade, subject, type, rooms });
await db.doc(`sessions/${SRC}/slots/2026-10-12_1_1`).set(slot('2026-10-12', 1, 1, '국어', 'EXAM', [{ roomId: 'IMP1', classNo: 1, headcount: null, roomType: 'NORMAL' }, { roomId: 'GONE', classNo: 2, headcount: null, roomType: 'NORMAL' }]));
await db.doc(`sessions/${SRC}/slots/2026-10-13_2_1`).set(slot('2026-10-13', 2, 1, '자습', 'STUDY', []));
await db.doc(`sessions/${DST}/slots/2026-11-01_1_3`).set(slot('2026-11-01', 1, 3, '옛것', 'EXAM', []));

const { browser, page, errors } = await openApp();
await go(page, `/admin/sessions/${DST}/setup`);
await page.getByRole('button', { name: '다른 프로젝트에서 불러오기' }).click();
const dlg = page.getByRole('dialog', { name: '다른 프로젝트 시험 시간표 불러오기' });
await dlg.getByRole('button', { name: /원본 시험/ }).click();
await dlg.getByLabel('첫 시험일').fill('2026-10-19');
await dlg.getByText('모든 날짜를 7일 뒤로 옮깁니다.').waitFor();
check('기존 시험 교체 안내', await dlg.getByText('기존 시험 1건은 지우고').isVisible());
await dlg.getByRole('button', { name: '불러오기', exact: true }).click();
await page.getByRole('status').filter({ hasText: '시험 2건을 불러왔습니다' }).last().waitFor({ timeout: 20000 });

const got = await db.collection(`sessions/${DST}/slots`).get();
const s1 = got.docs.find((d) => d.id === '2026-10-19_1_1');
const s2 = got.docs.find((d) => d.id === '2026-10-20_2_1');
check(
  '날짜 옮겨 불러옴 + 기존 시험 삭제 + 없는 시험실 제외',
  got.size === 2 && s1?.get('rooms').length === 1 && s2?.get('type') === 'STUDY',
  got.docs.map((d) => d.id).join(', '),
);
const pt = (await db.doc(`sessions/${DST}`).get()).get('settings.periodTimes');
check('교시별 기본 시간도 가져옴', pt?.[1]?.start === '09:00');
check('콘솔 오류 없음', errors.length === 0, errors.join(' / '));
await browser.close();
for (const id of [SRC, DST]) await db.recursiveDelete(db.doc(`sessions/${id}`));
process.exit(failures ? 1 : 0);
