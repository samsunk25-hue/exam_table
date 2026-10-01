// 추가 기능 점검: 임시 감독자, 감독 없음, 배정 결과 검색, 교시 시간 자동 계산, 배정 설정의 기초시간표
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

mkdirSync('scripts/e2e/out', { recursive: true });
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const until = async (fn, ms = 20000) => {
  for (let t = 0; t < ms; t += 300) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
};

const SID = 'E2E_EXTRA';
await db.recursiveDelete(db.doc(`sessions/${SID}`));
for (const d of (await db.collection('teachers').where('onlySession', '==', SID).get()).docs) await d.ref.delete();
await db.doc(`sessions/${SID}`).set({
  schoolName: '점검중학교', year: 2026, semester: 2, examName: '추가 점검', status: 'DRAFT',
  settings: { useBaseTimetable: true }, createdAt: new Date(Date.now() + 950_000), updatedBy: 'seed',
});
await db.doc('rooms/REX').set({ name: '추가-1', spaceType: 'CLASSROOM', grade: 1, classNo: 1, chiefCount: 1, assistantCount: 1, ...TERM, updatedBy: 'seed' });
await db.doc(`sessions/${SID}/slots/2026-10-12_1_1`).set({
  date: '2026-10-12', period: 1, grade: 1, subject: '과학', type: 'EXAM', startTime: '09:00', endTime: '09:45',
  rooms: [{ roomId: 'REX', classNo: 1, headcount: null, roomType: 'NORMAL' }], updatedBy: 'seed',
});
await db.doc(`sessions/${SID}/assignments/2026-10-12_1_1__REX_CHIEF_1`).set({
  slotId: '2026-10-12_1_1', groupId: '2026-10-12_1_1__REX', roomId: 'REX', role: 'CHIEF', weight: 1, teacherId: 'T001',
  score: 0, reason: 'seed', source: 'AUTO', date: '2026-10-12', period: 1, runId: null, updatedBy: 'seed',
});
const A = await openApp();

// 임시 감독자: 교사 명단 화면에서
await go(A.page, `/admin/sessions/${SID}/teachers`);
await A.page.getByLabel('임시 감독자 이름').fill('학부모가');
await A.page.getByLabel('임시 감독자 메모').fill('학부모');
await A.page.getByRole('button', { name: '+ 추가' }).click();
const temp = await until(async () => (await db.collection('teachers').where('onlySession', '==', SID).get()).size === 1);
const tdoc = (await db.collection('teachers').where('onlySession', '==', SID).get()).docs[0]?.data();
check('임시 감독자 추가 (이 프로젝트만)', temp && tdoc?.temporary === true && tdoc?.note === '학부모');

// 배정 설정(자동 배정 화면)의 기초시간표 올리기
await go(A.page, `/admin/sessions/${SID}/assign`);
await A.page.getByRole('button', { name: '기초시간표 올리기' }).waitFor();
check('배정 설정에 기초시간표 올리기', await A.page.getByRole('button', { name: '기초시간표 올리기' }).isVisible());
check('프로젝트 탭에 기초시간표 탭 없음', (await A.page.getByRole('navigation', { name: '시험 프로젝트 메뉴' }).getByText('기초시간표').count()) === 0);

// 검색 + 감독 없음
await go(A.page, `/admin/sessions/${SID}/editor`);
await A.page.getByLabel('배정 결과 검색').fill('김국어');
check('배정 결과 검색 (김국어 1건)', await A.page.getByText(/1건 · 김국어 감독: 10\/12 1교시 추가-1/).waitFor({ timeout: 10000 }).then(() => true).catch(() => false));
await A.page.getByRole('button', { name: /^1교시 추가-1 부감독/ }).click();
await A.page.getByRole('dialog', { name: '감독 배정 편집' }).getByRole('button', { name: '감독 없음으로 정하기' }).click();
const none = await until(async () => ((await db.doc(`sessions/${SID}`).get()).get('settings.noSupervisor') ?? []).includes('2026-10-12_1_1__REX_ASSISTANT_1'));
check('감독 없음으로 정하기', none);
await A.page.getByRole('button', { name: /^1교시 추가-1 부감독 감독 없음/ }).waitFor({ timeout: 8000 }).catch(async () => { await A.page.screenshot({ path: 'scripts/e2e/out/extra-none.png', fullPage: true }); console.log('ERRORS', A.errors.join(' / ')); });
check('칸에 "감독 없음" 표시, 미배정으로 세지 않음', !(await A.page.locator('main').innerText()).includes('미배정 1석'));

// 교시 시간 자동 계산 (1교시 시작·시험 시간·쉬는 시간)
await go(A.page, `/admin/sessions/${SID}/schedule`);
await A.page.getByRole('button', { name: '시험 시간표 표로 입력' }).click();
const gridDlg = A.page.getByRole('dialog', { name: '시험 시간표 표로 입력' });
const bar = gridDlg.getByText('1교시 시작만 넣으면').locator('..');
await bar.getByLabel('시험 시간 (분)').fill('50');
await bar.getByLabel('쉬는 시간 (분)').fill('10');
await bar.locator('button[aria-haspopup]').first().click();
const clock = A.page.getByRole('dialog', { name: '1교시 시작 선택' });
await clock.getByRole('button', { name: '9', exact: true }).first().click();
await clock.getByRole('button', { name: '00', exact: true }).last().click();
const text = await gridDlg.innerText();
check('1교시 시작만 넣으면 나머지 교시 자동 (2교시 10:00~10:50)', text.includes('10:00') && text.includes('10:50') && text.includes('11:00') && text.includes('11:50'));
await A.page.screenshot({ path: 'scripts/e2e/out/extra-periods.png', fullPage: true });
check('콘솔 오류 없음', A.errors.length === 0, A.errors.join(' / '));
await A.browser.close();
for (const d of (await db.collection('teachers').where('onlySession', '==', SID).get()).docs) await d.ref.delete();
await db.recursiveDelete(db.doc(`sessions/${SID}`));
process.exit(failures ? 1 : 0);
