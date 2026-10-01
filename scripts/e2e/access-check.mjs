// 가입·권한 신청 점검:
// 1) 미등록 계정이 교사로 가입 신청 → 관리자 승인 → 신청 화면이 자동으로 교사 화면으로
// 2) 교사가 관리자 권한 신청 → 승인 → 관리자 화면으로
// 3) 반려 사유가 신청자에게 보임
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

// 이전 점검 흔적 정리
for (const email of ['newbie@test.kr', 'reject@test.kr']) {
  try {
    const u = await getAuth().getUserByEmail(email);
    await db.doc(`accessRequests/${u.uid}`).delete();
    await getAuth().deleteUser(u.uid);
  } catch {}
  for (const d of (await db.collection('teachers').where('email', '==', email).get()).docs) await d.ref.delete();
}
for (const d of (await db.collection('accessRequests').get()).docs) await d.ref.delete();
await db.doc('admins/kim@test.kr').delete().catch(() => {});

const admin = await openApp();
async function approveIn(adminPage, name, approve = true, note = '') {
  await go(adminPage, '/admin/admins');
  const row = adminPage.locator('tr', { hasText: name });
  await row.waitFor({ timeout: 15000 });
  if (approve) {
    await row.getByRole('button', { name: '승인' }).click();
    await adminPage.getByRole('status').filter({ hasText: '승인했습니다' }).waitFor();
  } else {
    await row.getByRole('button', { name: '반려' }).click();
    await adminPage.getByRole('dialog', { name: '신청 반려' }).locator('input').fill(note);
    await adminPage.getByRole('dialog', { name: '신청 반려' }).getByRole('button', { name: '반려' }).click();
    await adminPage.getByRole('status').filter({ hasText: '반려했습니다' }).waitFor();
  }
}

// 1. 미등록 계정 → 교사 가입 신청
{
  const u = await openApp({ email: 'newbie@test.kr' });
  await u.page.getByRole('heading', { name: '가입 신청' }).waitFor();
  await u.page.getByLabel('이름').fill('신규교사');
  await u.page.getByLabel('담당 과목').fill('과학');
  await u.page.getByRole('button', { name: '교사(사용자) 승인 신청' }).click();
  await u.page.getByText('교사(사용자) 승인 대기 중입니다.').waitFor();
  check('미등록 계정: 가입 신청 → 승인 대기', true);

  await approveIn(admin.page, '신규교사');
  await u.page.waitForURL(/\/me$/, { timeout: 20000 });
  await u.page.getByRole('heading', { name: '내 감독 시간표' }).waitFor();
  const t = (await db.collection('teachers').where('email', '==', 'newbie@test.kr').get()).docs[0];
  check('승인 → 교사 명단 등록 + 화면이 자동으로 교사 화면으로', t?.get('name') === '신규교사' && t?.get('subject') === '과학');
  check('신청자 화면 콘솔 오류 없음', u.errors.length === 0, u.errors.join(' / '));
  await u.browser.close();

  // 다음 로그인부터는 바로 교사 화면
  const again = await openApp({ email: 'newbie@test.kr' });
  check('다음 로그인: 바로 교사 화면', /\/me$/.test(again.page.url()), again.page.url());
  await again.browser.close();
}

// 2. 교사(김국어) → 관리자 권한 신청
{
  const k = await openApp({ email: 'kim@test.kr' });
  await go(k.page, '/me/admin-request');
  await k.page.getByLabel('이름').fill('김국어');
  await k.page.getByRole('button', { name: '관리자 승인 신청' }).click();
  await k.page.getByText('관리자 승인 대기 중입니다.').waitFor();
  await approveIn(admin.page, '김국어');
  await k.page.waitForURL((u) => u.pathname === '/admin', { timeout: 20000 });
  check('교사 → 관리자 신청 승인 → 관리자 화면으로', true, k.page.url());
  await k.browser.close();
  await db.doc('admins/kim@test.kr').delete(); // 다른 점검에 영향 없게 되돌림
}

// 3. 반려 사유 표시
{
  const r = await openApp({ email: 'reject@test.kr' });
  await r.page.getByLabel('이름').fill('반려대상');
  await r.page.getByRole('button', { name: '교사(사용자) 승인 신청' }).click();
  await r.page.getByText('승인 대기 중').waitFor();
  await approveIn(admin.page, '반려대상', false, '우리 학교 교사가 아닙니다');
  await r.page.getByText(/반려되었습니다: 우리 학교 교사가 아닙니다/).waitFor({ timeout: 15000 });
  check('반려 사유가 신청자에게 표시, 다시 신청 가능', await r.page.getByRole('button', { name: /승인 신청/ }).isVisible());
  await r.browser.close();
}

check('관리자 화면 콘솔 오류 없음', admin.errors.length === 0, admin.errors.join(' / '));
await admin.browser.close();
process.exit(failures ? 1 : 0);
