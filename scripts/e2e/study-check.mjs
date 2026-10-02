// 자습 교시 감독 1명: 예전 규칙으로 남은 두 번째 자습감독 배정이 있어도 수정이 막히지 않고, 편집 화면에서 정리된다
// 실행: node scripts/e2e/study-check.mjs (에뮬레이터 + npm run seed 이후)
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
const until = async (fn, ms = 20000) => {
  for (let t = 0; t < ms; t += 300) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
};

// 준비: 교실 1개(정1·부1), 1교시 시험 + 2교시 자습. 자습에는 예전 규칙대로 2명이 배정된 상태
const SID = 'E2E_STUDY';
const SLOT1 = '2026-10-12_1_1';
const SLOT2 = '2026-10-12_2_1';
const G1 = `${SLOT1}__RST`;
const G2 = `${SLOT2}__RST`;
await db.recursiveDelete(db.doc(`sessions/${SID}`));
await db.doc('rooms/RST').set({ name: '자습-1', spaceType: 'CLASSROOM', grade: 1, classNo: 7, chiefCount: 1, assistantCount: 1, ...TERM, updatedBy: 'seed' });
await db.doc(`sessions/${SID}`).set({
  schoolName: '점검중학교', year: 2026, semester: 2, examName: '자습 감독 점검', status: 'REVIEW',
  settings: { useBaseTimetable: false }, createdAt: new Date(Date.now() + 998_000), ...TERM, updatedBy: 'seed',
});
for (const [id, period, type] of [[SLOT1, 1, 'EXAM'], [SLOT2, 2, 'STUDY']]) {
  await db.doc(`sessions/${SID}/slots/${id}`).set({
    date: '2026-10-12', period, startTime: null, endTime: null, grade: 1, subject: type === 'EXAM' ? '국어' : '자습', type,
    rooms: [{ roomId: 'RST', classNo: 7, headcount: null, roomType: 'NORMAL' }], ...TERM, updatedBy: 'seed',
  });
}
const put = (seatId, groupId, slotId, role, period, teacherId) =>
  db.doc(`sessions/${SID}/assignments/${seatId}`).set({
    slotId, groupId, roomId: 'RST', role, weight: role === 'STUDY' ? 0.6 : role === 'CHIEF' ? 1 : 0.8, teacherId, score: 0, reason: '점검',
    source: 'AUTO', date: '2026-10-12', period, runId: null,
  });
await put(`${G1}_CHIEF_1`, G1, SLOT1, 'CHIEF', 1, 'T001');
await put(`${G1}_ASSISTANT_1`, G1, SLOT1, 'ASSISTANT', 1, 'T002');
await put(`${G2}_STUDY_1`, G2, SLOT2, 'STUDY', 2, 'T003');
await put(`${G2}_STUDY_2`, G2, SLOT2, 'STUDY', 2, 'T001'); // 예전 규칙의 두 번째 자습감독
const col = db.collection(`sessions/${SID}/assignments`);

const { browser, page, errors } = await openApp();
await go(page, `/admin/sessions/${SID}/editor`);
const notice = page.getByText(/지금은 없는 자리에 배정 1건이 남아 있습니다/);
check('편집 화면: 남은 배정 안내', await notice.waitFor({ timeout: 20000 }).then(() => true).catch(() => false));
check('배정 수는 지금 자리 기준 (3 / 3석)', await page.getByText('배정 3 / 3석').isVisible());

// 1) 정리하기 전 수동 수정: 남은 배정 때문에 막히지 않고, 저장하면서 함께 정리된다
await page.locator('tr', { hasText: '자습-1' }).first().locator('button').first().click();
const dialog = page.getByRole('dialog', { name: '감독 배정 편집' });
await dialog.getByRole('button', { name: '배정', exact: true }).first().click();
check('정리 전 수동 수정도 저장됨', await page.getByRole('status').filter({ hasText: '바꿨습니다' }).waitFor({ timeout: 30000 }).then(() => true).catch(() => false));
check('수동 수정과 함께 남은 배정 정리', await until(async () => !(await col.doc(`${G2}_STUDY_2`).get()).exists));
await notice.waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});

// 2) 정리하기 버튼
await put(`${G2}_STUDY_2`, G2, SLOT2, 'STUDY', 2, 'T001');
await notice.waitFor({ timeout: 20000 });
await page.getByRole('button', { name: '정리하기' }).click();
check('정리하기 → 두 번째 자습감독 삭제', await until(async () => !(await col.doc(`${G2}_STUDY_2`).get()).exists));
check('나머지 배정은 그대로', (await col.get()).size === 3);
check('안내가 사라짐', await notice.waitFor({ state: 'detached', timeout: 10000 }).then(() => true).catch(() => false));
check('콘솔 오류 없음', errors.length === 0, errors.join(' / '));
await browser.close();

await db.recursiveDelete(db.doc(`sessions/${SID}`));
await db.doc('rooms/RST').delete();
console.log(failures ? `\n실패 ${failures}건` : '\n모두 통과');
process.exit(failures ? 1 : 0);
