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
process.exit(failures ? 1 : 0);
