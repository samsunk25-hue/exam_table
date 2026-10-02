// 불가시간 흐름 점검: 교사 제출 → 관리자 승인 → 교사 화면 반영, 관리자 대리 입력
// 실행: node scripts/e2e/availability-check.mjs (에뮬레이터 + npm run seed 이후)
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

// 준비: 시험 프로젝트 1개, 시험 2교시, 시험실 1개 (필요 감독 2명)
const SID = 'E2E_AVAIL';
await db.recursiveDelete(db.doc(`sessions/${SID}`));
await db.doc('rooms/RE2E').set({ name: 'E2E-1', spaceType: 'CLASSROOM', grade: 1, classNo: 9, chiefCount: 1, assistantCount: 1, ...TERM, updatedBy: 'seed' });
await db.doc(`sessions/${SID}`).set({
  schoolName: '점검중학교', year: 2026, semester: 2, examName: '불가시간 점검', status: 'DRAFT',
  settings: { useBaseTimetable: false, autoApproveAvailability: false }, createdAt: new Date(), ...TERM, updatedBy: 'seed',
});
for (const period of [1, 2]) {
  await db.doc(`sessions/${SID}/slots/2026-10-12_${period}_1`).set({
    date: '2026-10-12', period, startTime: period === 1 ? '09:00' : '10:00', endTime: null, grade: 1, subject: '국어', type: 'EXAM',
    rooms: [{ roomId: 'RE2E', classNo: 9, headcount: null, roomType: 'NORMAL' }], ...TERM, updatedBy: 'seed',
  });
}

// 1. 교사(김국어)가 1교시 불가 제출
{
  const { browser, page, errors } = await openApp({ email: 'kim@test.kr' });
  await go(page, '/me/availability');
  await page.getByRole('button', { name: '불가시간 점검', exact: false }).first().click().catch(() => {});
  await page.getByRole('button', { name: /^1교시/ }).first().click();
  check('안내: 이번에 적게 맡으면 다음 시험에서 더 많이(연속 포함)', await page.getByText(/다음\s*시험에서 감독이 더 많이\(연속 감독 포함\)/).isVisible());
  await page.getByRole('button', { name: '연수', exact: true }).click();
  await page.getByRole('button', { name: '1칸 제출' }).click();
  await page.getByRole('status').filter({ hasText: '제출했습니다' }).waitFor();
  await page.getByRole('button', { name: /1교시\s*승인 대기 · 연수/ }).waitFor();
  check('교사 제출 → 승인 대기 표시', true);
  await page.screenshot({ path: `${OUT}/avail-teacher.png`, fullPage: true });
  check('교사 화면 콘솔 오류 없음', errors.length === 0, errors.join(' / '));
  await browser.close();
}

// 2. 관리자 확인·승인·대리 입력
{
  const { browser, page, errors } = await openApp();
  await go(page, `/admin/sessions/${SID}/availability`);
  await page.getByRole('button', { name: /승인 대기 1/ }).waitFor();
  check('관리자: 대기 1건', true);
  const text = await page.locator('main').innerText();
  check('인력 현황: 1교시 불가(대기) 1명', /1교시\s+2명\s+\d+명\s+0명\s+1명/.test(text.replace(/\t/g, ' ')));
  await page.getByRole('button', { name: '대기 1건 모두 승인' }).click();
  await page.getByRole('status').filter({ hasText: '승인했습니다' }).waitFor();
  check('일괄 승인', true);

  await page.getByRole('combobox', { name: /^교사/ }).selectOption({ label: '박영어' });
  await page.getByRole('button', { name: /^2교시/ }).last().click();
  await page.getByRole('button', { name: '2칸 대리 입력' }).click().catch(async () => {
    await page.getByRole('button', { name: '1칸 대리 입력' }).click();
  });
  await page.getByRole('status').filter({ hasText: '입력했습니다' }).waitFor();
  check('대리 입력 (바로 승인)', true);
  // 대리 입력한 교사(박영어 T003)에게 알림: 다음 시험에 감독이 늘 수 있다는 안내
  let note;
  for (let t = 0; t < 40 && !note; t++) {
    note = (await db.collection('notifications').where('teacherId', '==', 'T003').get()).docs.find((d) => d.get('title') === '불가시간 대리 입력');
    if (!note) await new Promise((r) => setTimeout(r, 500));
  }
  check('대리 입력 → 교사 알림 (다음 시험에 더 많이 배정될 수 있음)', Boolean(note?.get('body')?.includes('다음 시험에서 감독이 더 많이')), note?.get('body'));
  await page.getByRole('button', { name: /전체 2/ }).click();
  await page.screenshot({ path: `${OUT}/avail-admin.png`, fullPage: true });
  check('관리자 화면 콘솔 오류 없음', errors.length === 0, errors.join(' / '));
  await browser.close();
}

// 3. 교사 화면에 승인 반영
{
  const { browser, page } = await openApp({ email: 'kim@test.kr' });
  await go(page, '/me/availability');
  await page.getByRole('button', { name: '불가시간 점검', exact: false }).first().click().catch(() => {});
  await page.getByRole('button', { name: /1교시\s*승인 · 연수/ }).waitFor();
  check('교사 화면: 승인 표시', true);
  const docs = await db.collection(`sessions/${SID}/availability`).get();
  check('저장된 문서 (교사 1 + 대리 1, 모두 승인)', docs.size === 2 && docs.docs.every((d) => d.get('status') === 'APPROVED'), docs.docs.map((d) => `${d.id}:${d.get('status')}:${d.get('source')}`).join(', '));

  // 4. 승인 후 교사가 직접 취소
  await page.getByRole('button', { name: /1교시\s*승인 · 연수/ }).click();
  const modal = page.getByRole('dialog', { name: '승인된 불가 시간 취소' });
  await modal.getByRole('button', { name: '제출 취소' }).click();
  await page.getByRole('status').filter({ hasText: '제출을 취소했습니다' }).waitFor();
  check('교사: 승인된 불가 시간 취소', !(await db.doc(`sessions/${SID}/availability/T001_2026-10-12_1`).get()).exists);
  await browser.close();
}

// 5. 관리자 승인 취소 → 승인 대기로
{
  const { browser, page } = await openApp();
  await go(page, `/admin/sessions/${SID}/availability`);
  await page.getByRole('button', { name: /전체 1/ }).click();
  await page.getByRole('button', { name: '승인 취소' }).click();
  await page.getByRole('status').filter({ hasText: '승인을 취소했습니다' }).waitFor();
  check('관리자: 승인 취소 → 승인 대기', (await db.doc(`sessions/${SID}/availability/T003_2026-10-12_2`).get()).get('status') === 'PENDING');
  await browser.close();
}
process.exit(failures ? 1 : 0);
