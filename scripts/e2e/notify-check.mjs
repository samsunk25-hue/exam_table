// 앱 알림 점검:
// 1) 관리자가 교사에게 공개 → 김국어 종에 1건 → 누르면 읽음 + 내 시간표로
// 2) 김국어 불가시간 신청 → 관리자 종에 "불가시간 신청" → 관리자 승인 → 김국어에게 "불가시간 승인"
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

await db.recursiveDelete(db.collection('notifications'));
const base = { schoolName: '점검중학교', year: 2026, semester: 2, settings: { useBaseTimetable: false, autoApproveAvailability: false }, updatedBy: 'seed' };
for (const id of ['E2E_NOTE', 'E2E_NOTE2']) await db.recursiveDelete(db.doc(`sessions/${id}`));
await db.doc('sessions/E2E_NOTE').set({ ...base, examName: '알림 공개 점검', status: 'REVIEW', createdAt: new Date(Date.now() + 400_000) });
await db.doc('sessions/E2E_NOTE2').set({ ...base, examName: '알림 불가 점검', status: 'DRAFT', createdAt: new Date(Date.now() + 500_000) });
await db.doc('rooms/RNT').set({ name: '알림-1', spaceType: 'CLASSROOM', grade: 1, classNo: 1, chiefCount: 1, assistantCount: 0, ...TERM, updatedBy: 'seed' });
for (const sid of ['E2E_NOTE', 'E2E_NOTE2']) {
  await db.doc(`sessions/${sid}/slots/2026-10-12_1_1`).set({
    date: '2026-10-12', period: 1, grade: 1, subject: '국어', type: 'EXAM', startTime: '09:00', endTime: '09:45',
    rooms: [{ roomId: 'RNT', classNo: 1, headcount: null, roomType: 'NORMAL' }], updatedBy: 'seed',
  });
}
await db.doc('sessions/E2E_NOTE/assignments/2026-10-12_1_1__RNT_CHIEF_1').set({
  slotId: '2026-10-12_1_1', groupId: '2026-10-12_1_1__RNT', roomId: 'RNT', role: 'CHIEF', weight: 1, teacherId: 'T001',
  score: 0, reason: 'seed', source: 'AUTO', date: '2026-10-12', period: 1, runId: null, updatedBy: 'seed',
});

// 1. 공개 알림
const A = await openApp();
await go(A.page, '/admin/sessions/E2E_NOTE');
await A.page.getByRole('button', { name: /^교사에게 공개/ }).first().click();
await A.page.getByRole('button', { name: '확인', exact: true }).click();
for (let i = 0; i < 40; i++) {
  if ((await db.collection('notifications').where('teacherId', '==', 'T001').get()).size) break;
  await new Promise((r) => setTimeout(r, 300));
}
const K = await openApp({ email: 'kim@test.kr' });
await go(K.page, '/me/availability');
const bell = K.page.getByRole('button', { name: /^알림/ });
await K.page.getByRole('button', { name: '알림 1건 안 읽음' }).waitFor({ timeout: 20000 });
check('교사 종: 안 읽은 알림 1건', true);
await bell.click();
const panel = K.page.getByRole('dialog', { name: '알림' });
await panel.getByText('감독 시간표 공개').waitFor();
await K.page.screenshot({ path: `${OUT}/notify-teacher.png` });
await panel.getByRole('button', { name: /감독 시간표 공개/ }).click();
await K.page.waitForURL(/\/me$/);
await K.page.getByRole('button', { name: '알림', exact: true }).waitFor({ timeout: 10000 });
check('알림 누르면 내 시간표로 + 읽음 처리', true);

// 2. 불가시간: 교사 신청 → 관리자 알림 → 승인 → 교사 알림
await go(K.page, '/me/availability');
await K.page.getByRole('button', { name: '알림 불가 점검', exact: false }).first().click().catch(() => {});
await K.page.getByRole('button', { name: /^1교시/ }).first().click();
await K.page.getByRole('button', { name: '출장', exact: true }).click();
await K.page.getByRole('button', { name: '1칸 제출' }).click();
await K.page.getByRole('status').filter({ hasText: '제출했습니다' }).waitFor();

await go(A.page, '/admin');
await A.page.getByRole('button', { name: /^알림 \d+건 안 읽음$/ }).waitFor({ timeout: 20000 });
await A.page.getByRole('button', { name: /^알림/ }).click();
const ap = A.page.getByRole('dialog', { name: '알림' });
check('관리자 종: 불가시간 신청 알림', await ap.getByText(/김국어 선생님이 불가시간 1건을 신청했습니다/).isVisible({ timeout: 10000 }).catch(() => false));
await A.page.screenshot({ path: `${OUT}/notify-admin.png` });
await ap.getByRole('button', { name: /불가시간 신청/ }).click();
await A.page.waitForURL(/E2E_NOTE2\/availability$/);
await A.page.getByRole('button', { name: '대기 1건 모두 승인' }).click();
await A.page.getByRole('status').filter({ hasText: '승인했습니다' }).waitFor();

await K.page.getByRole('button', { name: '알림 1건 안 읽음' }).waitFor({ timeout: 20000 });
await K.page.getByRole('button', { name: /^알림/ }).click();
check('교사: 불가시간 승인 알림', await K.page.getByRole('dialog', { name: '알림' }).getByText(/1교시 불가시간이 승인되었습니다/).isVisible());

check('관리자 화면 콘솔 오류 없음', A.errors.length === 0, A.errors.join(' / '));
check('교사 화면 콘솔 오류 없음', K.errors.length === 0, K.errors.join(' / '));
await A.browser.close();
await K.browser.close();
process.exit(failures ? 1 : 0);
