// 시험일정 관리 점검: 시계로 교시 시간 설정 → 달력 날짜 선택 → 여러 학년 시험 추가
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { go, openApp } from './session.mjs';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
const require = createRequire(import.meta.url);
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
initializeApp({ projectId: 'smart-invigilation' });
const db = getFirestore();
const TERM = { term: '점검중학교|2026|2', school: '점검중학교', year: 2026, semester: 2 }; // 학교·학기 명단

const OUT = 'scripts/e2e/out';
mkdirSync(OUT, { recursive: true });
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const SID = 'E2E_SCHED';
await db.recursiveDelete(db.doc(`sessions/${SID}`));
await db.doc(`sessions/${SID}`).set({
  schoolName: '점검중학교', year: 2026, semester: 2, examName: '일정 점검', status: 'DRAFT',
  settings: { useBaseTimetable: false }, createdAt: new Date(Date.now() + 60_000), ...TERM, updatedBy: 'seed',
});
for (const g of [1, 2]) {
  await db.doc(`rooms/SC${g}`).set({ name: `S${g}-1`, spaceType: 'CLASSROOM', grade: g, classNo: 1, chiefCount: 1, assistantCount: 0, ...TERM, updatedBy: 'seed' });
}

const { browser, page, errors } = await openApp();
await go(page, `/admin/sessions/${SID}/schedule`);

// 1. 교시 시간은 표 입력 팝업에서: 시험 시간 45분 · 쉬는 시간 15분 · 1교시 시작 9:00 → 모든 교시 자동
check('따로 있던 "교시별 기본 시간" 카드 없음', (await page.getByRole('heading', { name: '교시별 기본 시간' }).count()) === 0);
await page.getByRole('button', { name: '시험 시간표 표로 입력' }).click();
const timeDlg = page.getByRole('dialog', { name: '시험 시간표 표로 입력' });
const bar = timeDlg.getByText('1교시 시작만 넣으면').locator('..');
await bar.getByLabel('시험 시간 (분)').fill('45');
await bar.getByLabel('쉬는 시간 (분)').fill('15');
await bar.locator('button[aria-haspopup]').first().click();
await page.getByRole('dialog', { name: '1교시 시작 선택' }).getByRole('button', { name: '9', exact: true }).first().click();
await page.getByRole('dialog', { name: '1교시 시작 선택' }).getByRole('button', { name: '00', exact: true }).last().click();
const card = await timeDlg.innerText();
check('시계로 1교시 시작 → 모든 교시 자동', ['09:00', '09:45', '10:00', '10:45', '11:00', '11:45'].every((t) => card.includes(t)));
// 교시 추가: 쉬는 시간 15분을 알아서 이어 붙인다
await timeDlg.getByRole('button', { name: '+ 교시 추가' }).click();
await timeDlg.getByRole('button', { name: '+ 교시 추가' }).click();
const card2 = await timeDlg.innerText();
check('쉬는 시간으로 나머지 교시 자동 계산 (+교시 추가)', ['12:00', '12:45', '13:00', '13:45'].every((t) => card2.includes(t)));
// 저장된 교시 시간은 시험 추가 때 쓰이므로 여기서는 설정에 직접 넣는다 (표 저장은 grid-check에서 점검)
await timeDlg.getByRole('button', { name: '닫기' }).first().click().catch(() => {});
await page.keyboard.press('Escape');
await db.doc(`sessions/${SID}`).set({ settings: { periodTimes: { 1: { start: '09:00', end: '09:45' }, 2: { start: '10:00', end: '10:45' }, 3: { start: '11:00', end: '11:45' } } } }, { merge: true });

// 2. 달력에서 10월 12일 선택 → 시험 추가
await page.getByRole('button', { name: /^10월 12일/ }).click();
await page.getByRole('heading', { name: /10월 12일/ }).waitFor();
await page.getByRole('button', { name: '+ 시험 추가' }).click();
const form = page.getByRole('dialog', { name: /시험 추가/ });
check('교시 기본 시간 자동 입력', (await form.innerText()).includes('09:00') && (await form.innerText()).includes('09:45'));
await form.getByLabel('1학년 과목').fill('국어');
await form.getByLabel('2학년 과목').fill('수학');
await form.getByRole('checkbox', { name: '3학년' }).uncheck();
await page.screenshot({ path: `${OUT}/schedule-form.png`, fullPage: true });
await form.getByRole('button', { name: '저장' }).click();
await page.getByRole('status').filter({ hasText: '시험 2건을 추가했습니다' }).last().waitFor();
await page.getByText('1교시 · 1학년 국어').waitFor();
check('달력 표시', await page.getByRole('button', { name: /10월 12일 시험 2건/ }).isVisible());
await page.screenshot({ path: `${OUT}/schedule-after.png`, fullPage: true });

const slots = await db.collection(`sessions/${SID}/slots`).get();
const s1 = slots.docs.find((d) => d.id === '2026-10-12_1_1');
check('저장된 시험 (시간·자동 배치)', slots.size === 2 && s1?.get('startTime') === '09:00' && s1?.get('rooms').some((p) => p.roomId === 'SC1'), slots.docs.map((d) => `${d.id}:${d.get('subject')}`).join(', '));

// 4. 여러 교시 동시 선택: 표(가로 교시, 세로 학년)에 입력
await page.getByRole('button', { name: /^10월 13일/ }).click();
await page.getByRole('button', { name: '+ 시험 추가' }).click();
const f2 = page.getByRole('dialog', { name: /시험 추가/ });
await f2.getByRole('button', { name: '2교시', exact: true }).click();
await f2.getByLabel('1학년 1교시 과목').fill('영어');
await f2.getByLabel('1학년 2교시 과목').fill('자습');
await f2.getByRole('checkbox', { name: '2학년' }).uncheck();
await f2.getByRole('checkbox', { name: '3학년' }).uncheck();
await page.screenshot({ path: `${OUT}/schedule-multi.png`, fullPage: true });
await f2.getByRole('button', { name: '저장' }).click();
await page.getByRole('status').filter({ hasText: '시험 2건을 추가했습니다' }).last().waitFor();
let study;
for (let i = 0; i < 50 && !study; i++) {
  study = (await db.doc(`sessions/${SID}/slots/2026-10-13_2_1`).get()).data();
  if (!study) await new Promise((r) => setTimeout(r, 300));
}
check('여러 교시 한 번에 추가 (자습·교시 시간)', study?.type === 'STUDY' && study?.startTime === '10:00', JSON.stringify({ type: study?.type, start: study?.startTime }));

// 5. 기간 선택 (주말 제외) → 표 입력에 날짜가 들어감
await page.getByRole('button', { name: '기간 선택' }).click();
await page.getByRole('button', { name: /^10월 16일/ }).click();
await page.getByRole('button', { name: /^10월 21일/ }).click();
await page.getByText('4일 (주말 제외)').waitFor();
await page.screenshot({ path: `${OUT}/schedule-range.png`, fullPage: true });
await page.getByRole('button', { name: '이 기간 시험 시간표 표로 입력' }).click();
const gridDlg = page.getByRole('dialog', { name: '시험 시간표 표로 입력' });
const gtext = await gridDlg.innerText();
check('기간 선택 → 표 입력에 날짜 4일', ['10월 16일', '10월 19일', '10월 20일', '10월 21일'].every((d) => gtext.includes(d)) && !gtext.includes('10월 17일'));
await gridDlg.getByRole('button', { name: '닫기' }).first().click();
check('콘솔 오류 없음', errors.length === 0, errors.join(' / '));
await browser.close();
process.exit(failures ? 1 : 0);
