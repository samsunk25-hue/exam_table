// 학교·학기별 명단 점검:
// 1) 교사 관리는 선택한 학교·학기 명단만 보여 준다 (처음 값 = 가장 최근 프로젝트 학기)
// 2) 같은 학년도 학기에서 불러오면 누적점수·담임 유지, 다른 학년도면 0점·담임 비움
// 3) 학기 미지정(예전) 자료는 ID 그대로 이 학기로 지정
// 4) 프로젝트 개요: 명단이 비면 다른 학기 시험실 불러오기
// 5) 교사 로그인은 가장 최근 학기 문서로 연결
import { createRequire } from 'node:module';
import { go, openApp } from './session.mjs';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
const require = createRequire(import.meta.url);
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
initializeApp({ projectId: 'smart-invigilation' });
const db = getFirestore();

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const SCHOOL = '학기중학교';
const term = (year, semester) => ({ term: `${SCHOOL}|${year}|${semester}`, school: SCHOOL, year, semester });
for (const c of ['teachers', 'rooms']) await db.recursiveDelete(db.collection(c));
for (const id of ['TERM_25_2', 'TERM_26_1', 'TERM_26_2']) await db.recursiveDelete(db.doc(`sessions/${id}`));
const session = (id, year, semester, ago) =>
  db.doc(`sessions/${id}`).set({
    schoolName: SCHOOL, year, semester, examName: `${year}-${semester} 시험`, status: 'DRAFT',
    settings: { useBaseTimetable: false }, createdAt: new Date(Date.now() - ago), updatedBy: 'seed',
  });
await session('TERM_25_2', 2025, 2, 3e9);
await session('TERM_26_1', 2026, 1, 2e9);
await session('TERM_26_2', 2026, 2, -86_400_000); // 가장 최근 (다른 점검 세션보다 나중)
const teacher = (name, email, load, homeroom, t) => ({
  name, email, subject: '국어', homeroom, defaultRole: 'NORMAL', active: true, cumulativeLoad: load, ...t, updatedBy: 'seed',
});
await db.doc('teachers/T001').set(teacher('일학기쌤', 'one@term.kr', 5, { grade: 1, classNo: 1 }, term(2026, 1)));
// 1학기에만 있는 교사: 불러올 때 체크를 풀어 빼 본다
await db.doc('teachers/T010').set(teacher('제외쌤', 'skip@term.kr', 0, null, term(2026, 1)));
await db.doc('teachers/T002').set(teacher('작년쌤', 'old@term.kr', 7, { grade: 2, classNo: 1 }, term(2025, 2)));
await db.doc('teachers/T003').set(teacher('예전쌤', null, 0, null, {}));
await db.doc('rooms/R001').set({ name: '1-1', spaceType: 'CLASSROOM', grade: 1, classNo: 1, chiefCount: 1, assistantCount: 0, ...term(2026, 1), updatedBy: 'seed' });

const { browser, page, errors } = await openApp();
await page.evaluate(() => localStorage.removeItem('sim.term'));
await go(page, '/admin/teachers');
const picker = page.getByLabel('학교·학기');
check('처음 학기 = 가장 최근 프로젝트 (2026-2)', (await picker.inputValue()) === `${SCHOOL}|2026|2`, await picker.inputValue());
check('이 학기 명단은 비어 있음', await page.getByText('이 학기에 등록된 교사가 없습니다').isVisible());

async function importFrom(label, skip) {
  await page.getByRole('button', { name: '다른 학기에서 불러오기' }).click();
  const dlg = page.getByRole('dialog', { name: '다른 학기 교사 불러오기' });
  await dlg.getByRole('button', { name: label }).click();
  if (skip) await dlg.getByRole('checkbox', { name: `${skip} 가져오기` }).uncheck();
  await dlg.getByRole('button', { name: /^\d+(명|개) 불러오기$/ }).click();
  await dlg.waitFor({ state: 'detached' }); // 창이 닫히면 저장 완료
}
const inTerm = async (t) => (await db.collection('teachers').where('term', '==', t).get()).docs;

// 같은 학년도(2026-1) → 점수·담임 유지, 새 ID
await importFrom(/2026학년도 1학기/, '제외쌤');
let now = await inTerm(`${SCHOOL}|2026|2`);
const one = now.find((d) => d.get('email') === 'one@term.kr');
check('체크 해제한 교사는 가져오지 않음', !now.some((d) => d.get('email') === 'skip@term.kr'));
check('같은 학년도 불러오기: 누적점수·담임 유지, 새 ID', one && one.id !== 'T001' && one.get('cumulativeLoad') === 5 && one.get('homeroom')?.classNo === 1, one?.id);

// 다른 학년도(2025-2) → 0점, 담임 비움
await importFrom(/2025학년도 2학기/);
now = await inTerm(`${SCHOOL}|2026|2`);
const old = now.find((d) => d.get('email') === 'old@term.kr');
check('다른 학년도 불러오기: 0점·담임 비움', old?.get('cumulativeLoad') === 0 && old?.get('homeroom') === null);

// 학기 미지정 → 그대로 지정
await importFrom(/학기 미지정/);
check('예전 자료: ID 그대로 이 학기로 지정', (await db.doc('teachers/T003').get()).get('term') === `${SCHOOL}|2026|2`);
await page.getByRole('cell', { name: '예전쌤' }).waitFor();
check('화면: 이 학기 교사 3명', (await page.locator('tbody tr').count()) === 3);

// 다른 학기로 바꾸면 그 학기 명단
await picker.selectOption(`${SCHOOL}|2026|1`);
await page.getByRole('cell', { name: '일학기쌤' }).waitFor();
check('학기 바꾸기 → 그 학기 명단만 (1학기 2명)', (await page.locator('tbody tr').count()) === 2);

// 프로젝트 개요: 시험실이 비어 있으면 불러오기
await go(page, '/admin/sessions/TERM_26_2');
await page.getByRole('button', { name: '시험실 불러오기' }).click();
const rd = page.getByRole('dialog', { name: '다른 학기 시험실 불러오기' });
await rd.getByRole('button', { name: /2026학년도 1학기/ }).click();
await rd.getByRole('button', { name: /^\d+(명|개) 불러오기$/ }).click();
await rd.waitFor({ state: 'detached' });
let rooms = 0;
for (let i = 0; i < 20 && rooms !== 1; i++) {
  rooms = (await db.collection('rooms').where('term', '==', `${SCHOOL}|2026|2`).get()).size;
  if (rooms !== 1) await new Promise((r) => setTimeout(r, 300));
}
check('개요: 다른 학기 시험실 불러오기', rooms === 1);
check('관리자 화면 콘솔 오류 없음', errors.length === 0, errors.join(' / '));
await browser.close();

// 교사 로그인 → 최근 학기(2026-2) 문서
const T = await openApp({ email: 'one@term.kr' });
const claims = (await getAuth().getUserByEmail('one@term.kr')).customClaims ?? {};
check('교사 로그인은 최근 학기 문서로 연결', claims.teacherId === one?.id, `${claims.teacherId} (기대 ${one?.id})`);
await T.browser.close();
process.exit(failures ? 1 : 0);
