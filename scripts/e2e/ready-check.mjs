// 준비가 덜 된 프로젝트: 교사·시험실·시험실 배치가 없으면 "다음 할 일"이 그것부터 안내하고, 자동 배정은 막는다
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
const SID = 'E2E_READY';
const TERM = { term: '준비중학교|2026|2', school: '준비중학교', year: 2026, semester: 2 };
await db.recursiveDelete(db.doc(`sessions/${SID}`));
await db.doc(`sessions/${SID}`).set({ schoolName: '준비중학교', year: 2026, semester: 2, examName: '준비 점검', status: 'DRAFT', settings: { useBaseTimetable: false }, createdAt: new Date(), updatedBy: 'seed' });
await db.doc(`sessions/${SID}/slots/2026-12-09_1_1`).set({ date: '2026-12-09', period: 1, grade: 1, subject: '국어', type: 'EXAM', startTime: '09:00', endTime: '09:45', rooms: [], updatedBy: 'seed' });

const { browser, page, errors } = await openApp();
const next = page.getByLabel('다음 할 일');
const say = async () => (await next.innerText()).replace(/\s+/g, ' ');

await go(page, `/admin/sessions/${SID}`);
await next.waitFor();
check('교사 없음 → 교사 명단 입력 안내', (await say()).includes('교사 명단 입력하기'), await say());
// 기초 자료 점검의 문제 항목: 누르면 고칠 화면으로
const fixLink = page.getByRole('link', { name: '교사 명단에서 고치기 →' }).first();
await fixLink.waitFor();
await fixLink.click();
await page.waitForURL(/teachers$/);
check('점검 항목 링크 → 교사 명단 화면', page.url().endsWith(`/admin/sessions/${SID}/teachers`), page.url());
check('"기본 설정" 같은 없는 탭 이름 안내 없음', !(await page.locator('body').innerText()).includes('기본 설정'));
await go(page, `/admin/sessions/${SID}`);
await next.waitFor();

await db.doc('teachers/RDY1').set({ name: '준비교사', email: null, subject: '국어', homeroom: null, defaultRole: 'NORMAL', active: true, cumulativeLoad: 0, ...TERM, updatedBy: 'seed' });
await page.waitForFunction(() => document.querySelector('[aria-label="다음 할 일"]')?.textContent?.includes('시험실 등록하기'), null, { timeout: 15000 }).catch(() => {});
check('시험실 없음 → 시험실 등록 안내', (await say()).includes('시험실 등록하기'), await say());

// 학년이 맞지 않는 시험실만 있으면: 자동 배치할 수 없다는 안내, 자동 배정은 서버에서 막힘
await db.doc('rooms/RDYR').set({ name: '2-1', spaceType: 'CLASSROOM', grade: 2, classNo: 1, chiefCount: 1, assistantCount: 0, ...TERM, updatedBy: 'seed' });
await page.waitForFunction(() => document.querySelector('[aria-label="다음 할 일"]')?.textContent?.includes('시험실 확인하기'), null, { timeout: 15000 }).catch(() => {});
check('배치할 교실 없음 → 시험실 확인 안내', (await say()).includes('시험실 확인하기'), await say());

await go(page, `/admin/sessions/${SID}/editor`);
await page.getByText('아직 감독 자리가 없습니다.').waitFor();
check('시간표 편집: 무엇을 먼저 할지 링크', await page.getByRole('link', { name: '시험 일정에서 시험실 배치하기 →' }).isVisible());

await go(page, `/admin/sessions/${SID}/assign`);
// 자리가 없으면 거부되므로 버튼만 누르고 안내를 본다
await page.getByRole('button', { name: '자동 배정하고 바로 적용' }).click();
const msg = await page.getByText('감독 자리가 없습니다').first().waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
check('자리 없으면 자동 배정 거부 안내', msg);

// 맞는 학년 교실을 등록하면 따로 배치하지 않아도 자동 배치 → 바로 자동 배정 안내
await db.doc('rooms/RDYR2').set({ name: '1-1', spaceType: 'CLASSROOM', grade: 1, classNo: 1, chiefCount: 1, assistantCount: 0, ...TERM, updatedBy: 'seed' });
await go(page, `/admin/sessions/${SID}`);
let placed = [];
for (let i = 0; i < 40 && !placed.length; i++) {
  placed = (await db.doc(`sessions/${SID}/slots/2026-12-09_1_1`).get()).get('rooms') ?? [];
  if (!placed.length) await new Promise((r) => setTimeout(r, 300));
}
check('시험실 자동 배치 (배치 단계 없음)', placed.some((p) => p.roomId === 'RDYR2'), JSON.stringify(placed));
await page.waitForFunction(() => document.querySelector('[aria-label="다음 할 일"]')?.textContent?.includes('자동 배정하기'), null, { timeout: 15000 }).catch(() => {});
check('모두 준비 → 자동 배정 안내', (await say()).includes('자동 배정하기'), await say());
check('콘솔 오류 없음', errors.filter((e) => !e.includes('감독 자리가 없습니다') && !e.includes('failed-precondition') && !e.includes('400 (Bad Request)')).length === 0, errors.join(' | '));
await browser.close();
await db.recursiveDelete(db.doc(`sessions/${SID}`));
await db.doc('teachers/RDY1').delete();
await db.doc('rooms/RDYR').delete();
await db.doc('rooms/RDYR2').delete();
process.exit(failures ? 1 : 0);
