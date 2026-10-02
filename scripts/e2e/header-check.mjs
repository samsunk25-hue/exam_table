// 머리글: 제목만 크게(역할·이메일 줄 없음), 컴퓨터·휴대폰에서 가로 넘침 없음
import { go, openApp } from './session.mjs';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  const A = await openApp({ viewport });
  await go(A.page, '/admin');
  const header = await A.page.locator('header').first().innerText();
  check(`${viewport.width}px: 이메일 줄 없음`, !header.includes('@gmail.com') && !header.includes('관리자 ·'));
  const size = await A.page.locator('header .font-hand').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  check(`${viewport.width}px: 제목 크기`, size >= 31, `${size}px`);
  check(`${viewport.width}px: 가로 넘침 없음`, !(await A.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));
  await A.page.screenshot({ path: `scripts/e2e/out/header-${viewport.width}.png` });
  await A.browser.close();
}
// 제목을 누르면 로그인 화면으로 갈지 묻고, 취소하면 그대로, 확인하면 로그아웃 후 로그인 화면
{
  const A = await openApp();
  await go(A.page, '/admin');
  await A.page.getByRole('button', { name: '로그인 화면으로 가기' }).click();
  const dlg = A.page.getByRole('dialog', { name: '로그인 화면으로 가시겠습니까?' });
  await dlg.waitFor();
  await dlg.getByRole('button', { name: '취소' }).click();
  check('제목 → 취소하면 그대로', A.page.url().endsWith('/admin'));
  await A.page.getByRole('button', { name: '로그인 화면으로 가기' }).click();
  await dlg.getByRole('button', { name: '확인' }).click();
  await A.page.waitForURL((u) => u.pathname === '/login', { timeout: 15000 }).catch(() => {});
  check('제목 → 확인하면 로그인 화면', A.page.url().endsWith('/login') && (await A.page.getByRole('button', { name: 'Google 계정으로 로그인' }).waitFor({ timeout: 10000 }).then(() => true).catch(() => false)), A.page.url());
  await A.browser.close();
}
process.exit(failures ? 1 : 0);
