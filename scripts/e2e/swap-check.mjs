// 교사 교환 요청 점검: 김국어(1교시) ↔ 이수학(2교시)
// 김국어가 교환 방법 찾기 → 맞바꾸기 요청 → 이수학 수락 → 관리자 승인 → 배정 반영 + 되돌리기 기록
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

const OUT = 'scripts/e2e/out';
mkdirSync(OUT, { recursive: true });
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

// 준비: 교사 공개 상태, 1교시 김국어 / 2교시 이수학 (같은 교실)
const SID = 'E2E_SWAP';
await db.recursiveDelete(db.doc(`sessions/${SID}`));
await db.doc(`sessions/${SID}`).set({
  schoolName: '점검중학교', year: 2026, semester: 2, examName: '교환 점검', status: 'PUBLISHED',
  settings: { useBaseTimetable: false }, createdAt: new Date(Date.now() + 300_000), updatedBy: 'seed',
});
await db.doc('rooms/RSW').set({ name: '교환-1', spaceType: 'CLASSROOM', grade: 1, classNo: 1, chiefCount: 1, assistantCount: 0, ...TERM, updatedBy: 'seed' });
const seat = (p) => `2026-10-12_${p}_1__RSW_CHIEF_1`;
for (const [p, t] of [[1, 'T001'], [2, 'T002']]) {
  await db.doc(`sessions/${SID}/slots/2026-10-12_${p}_1`).set({
    date: '2026-10-12', period: p, grade: 1, subject: p === 1 ? '국어' : '수학', type: 'EXAM', startTime: p === 1 ? '09:00' : '10:00', endTime: p === 1 ? '09:45' : '10:45',
    rooms: [{ roomId: 'RSW', classNo: 1, headcount: null, roomType: 'NORMAL' }], updatedBy: 'seed',
  });
  await db.doc(`sessions/${SID}/assignments/${seat(p)}`).set({
    slotId: `2026-10-12_${p}_1`, groupId: `2026-10-12_${p}_1__RSW`, roomId: 'RSW', role: 'CHIEF', weight: 1, teacherId: t,
    score: 0, reason: 'seed', source: 'AUTO', date: '2026-10-12', period: p, runId: null, updatedBy: 'seed',
  });
}
const teacherAt = async (p) => (await db.doc(`sessions/${SID}/assignments/${seat(p)}`).get()).get('teacherId');
const request = async () => (await db.collection(`sessions/${SID}/swapRequests`).get()).docs[0]?.data();

// 1. 김국어: 교환 방법 찾기 → 맞바꾸기 요청
const K = await openApp({ email: 'kim@test.kr' });
await go(K.page, '/me');
await K.page.getByRole('button', { name: /교환 점검/ }).click({ timeout: 3000 }).catch(() => {}); // 공개된 프로젝트가 여럿이면 이 점검 프로젝트로
await K.page.getByRole('button', { name: /10\/12 1교시 교환-1 교환/ }).click();
const dlg = K.page.getByRole('dialog', { name: '감독 교환 요청' });
await dlg.getByLabel('바꾸고 싶은 선생님').selectOption({ label: '이수학' });
await dlg.getByLabel('사유 (선택)').fill('출장');
await dlg.getByRole('button', { name: '교환 방법 찾기' }).click();
await dlg.getByText('맞바꾸기').first().waitFor({ timeout: 30000 });
await K.page.screenshot({ path: `${OUT}/swap-options.png` });
await dlg.getByRole('button', { name: '방법 1로 요청' }).click();
await dlg.waitFor({ state: 'detached', timeout: 30000 });
check('교사가 교환 방법을 찾아 요청', await until(async () => (await request())?.status === 'PENDING_PEERS'), (await request())?.summary?.join(' / '));
check('요청자 화면 콘솔 오류 없음', K.errors.length === 0, K.errors.join(' / '));
await K.browser.close();

// 2. 이수학: 수락
const L = await openApp({ email: 'lee@test.kr' });
await go(L.page, '/me');
await L.page.getByRole('button', { name: /교환 점검/ }).click({ timeout: 3000 }).catch(() => {});
await L.page.getByText('응답 필요 1').waitFor({ timeout: 20000 });
await L.page.getByRole('button', { name: '수락', exact: true }).click();
check('상대 교사 수락 → 관리자 승인 대기', await until(async () => (await request())?.status === 'PENDING_ADMIN'));
check('상대 교사 화면 콘솔 오류 없음', L.errors.length === 0, L.errors.join(' / '));
await L.browser.close();

// 3. 관리자 승인 → 반영
const A = await openApp();
await go(A.page, `/admin/sessions/${SID}/editor`);
await A.page.getByRole('button', { name: '승인·반영' }).click();
check('관리자 승인 → 배정 맞바뀜', await until(async () => (await teacherAt(1)) === 'T002' && (await teacherAt(2)) === 'T001'), `${await teacherAt(1)}, ${await teacherAt(2)}`);
check('요청 상태 = 승인·반영됨', (await request())?.status === 'APPROVED');
const undo = await db.collection('undoOps').where('sessionId', '==', SID).get();
check('되돌리기 목록에 교환 기록', undo.docs.some((d) => String(d.get('label')).startsWith('교환 승인')));
check('관리자 화면 콘솔 오류 없음', A.errors.length === 0, A.errors.join(' / '));
await A.browser.close();
process.exit(failures ? 1 : 0);
