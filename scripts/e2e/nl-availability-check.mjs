// 문장으로 불가시간 입력 (9.1): 교사 "10/12 오전 출장" → 칸 선택 → 제출, 관리자 "이수학 10/12 1교시 연수" → 교사까지 골라 대리 입력
// 실행: node scripts/e2e/nl-availability-check.mjs (에뮬레이터 + npm run seed 이후, 에뮬레이터 가짜 AI 응답 사용)
import { createRequire } from 'node:module';
import { go, openApp } from './session.mjs';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
const require = createRequire(import.meta.url);
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
initializeApp({ projectId: 'smart-invigilation' });
const db = getFirestore();
const TERM = { term: '점검중학교|2026|2', school: '점검중학교', year: 2026, semester: 2 };
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const waitDocs = async (q, n) => {
  let docs = [];
  for (let i = 0; i < 40 && docs.length < n; i++) {
    docs = (await q.get()).docs;
    if (docs.length < n) await new Promise((r) => setTimeout(r, 300));
  }
  return docs;
};

// 준비: 10/12 오전 1·2교시, 오후 5교시
const SID = 'E2E_NLAVAIL';
await db.recursiveDelete(db.doc(`sessions/${SID}`));
await db.doc('rooms/RNL').set({ name: 'NL-1', spaceType: 'CLASSROOM', grade: 1, classNo: 8, chiefCount: 1, assistantCount: 0, ...TERM, updatedBy: 'seed' });
await db.doc(`sessions/${SID}`).set({
  schoolName: '점검중학교', year: 2026, semester: 2, examName: '문장 불가시간 점검', status: 'DRAFT',
  settings: { useBaseTimetable: false, autoApproveAvailability: false }, createdAt: new Date(Date.now() + 999_000), ...TERM, updatedBy: 'seed',
});
for (const [period, start] of [[1, '09:00'], [2, '10:00'], [5, '13:30']]) {
  await db.doc(`sessions/${SID}/slots/2026-10-12_${period}_1`).set({
    date: '2026-10-12', period, startTime: start, endTime: null, grade: 1, subject: `과목${period}`, type: 'EXAM',
    rooms: [{ roomId: 'RNL', classNo: 8, headcount: null, roomType: 'NORMAL' }], ...TERM, updatedBy: 'seed',
  });
}
const avail = db.collection(`sessions/${SID}/availability`);

// 1. 교사: 문장 → 오전 2칸 선택 → 제출 (승인 대기)
{
  const { browser, page, errors } = await openApp({ email: 'kim@test.kr' });
  await go(page, '/me/availability');
  const sessionBtn = page.getByRole('button', { name: /문장 불가시간 점검/ });
  if (await sessionBtn.count()) await sessionBtn.click();
  await page.getByLabel('문장으로 불가 시간 입력').fill('10/12 오전 출장입니다');
  await page.getByRole('button', { name: '칸 고르기' }).click();
  const submit = page.getByRole('button', { name: '2칸 제출' });
  await submit.waitFor({ timeout: 60000 });
  check('교사: 오전 2칸이 골라짐', true);
  check('사유 "출장"이 골라짐', (await page.getByRole('button', { name: '출장', pressed: true }).count()) === 1);
  await submit.click();
  const docs = await waitDocs(avail.where('teacherId', '==', 'T001'), 2);
  const got = docs.map((d) => `${d.get('period')}:${d.get('reason')}:${d.get('status')}`).sort().join(',');
  check('교사 제출 저장 (1·2교시, 출장, 승인 대기)', got === '1:출장:PENDING,2:출장:PENDING', got);
  check('교사 화면 오류 없음', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// 2. 관리자: 교사를 고르지 않고 이름까지 문장으로 → 교사·칸 선택 → 대리 입력 (바로 승인)
{
  const { browser, page, errors } = await openApp();
  await go(page, `/admin/sessions/${SID}/availability`);
  await page.getByLabel('문장으로 불가 시간 입력').fill('이수학 10/12 5교시 연수');
  await page.getByRole('button', { name: '칸 고르기' }).click();
  const btn = page.getByRole('button', { name: '1칸 대리 입력' });
  await btn.waitFor({ timeout: 60000 });
  check('관리자: 교사(이수학)가 골라짐', (await page.getByLabel('교사').inputValue()) === 'T002');
  await btn.click();
  const docs = await waitDocs(avail.where('teacherId', '==', 'T002'), 1);
  const got = docs.map((d) => `${d.get('period')}:${d.get('reason')}:${d.get('status')}:${d.get('source')}`).join(',');
  check('대리 입력 저장 (5교시, 연수, 승인)', got === '5:연수:APPROVED:ADMIN', got);

  // 이름 없이 적으면 안내만 하고 글은 남는다
  await page.getByLabel('교사').selectOption('');
  await page.getByLabel('문장으로 불가 시간 입력').fill('10/12 1교시 병가');
  await page.getByRole('button', { name: '칸 고르기' }).click();
  await page.getByText('어느 선생님인지 찾지 못했습니다').waitFor({ timeout: 60000 });
  check('이름이 없으면 안내 + 글 유지', (await page.getByLabel('문장으로 불가 시간 입력').inputValue()) === '10/12 1교시 병가');
  check('관리자 화면 오류 없음', errors.length === 0, errors.join(' | '));
  await browser.close();
}

await db.recursiveDelete(db.doc(`sessions/${SID}`));
await db.doc('rooms/RNL').delete();
console.log(failures ? `\n실패 ${failures}건` : '\n모두 통과');
process.exit(failures ? 1 : 0);
