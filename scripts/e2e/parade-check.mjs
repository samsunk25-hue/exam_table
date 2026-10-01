// 메뉴 오른쪽 동물 행진: 움직이는지, 메뉴 클릭을 막지 않는지, 휴대폰에서는 숨는지
import { openApp, go } from './session.mjs';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const A = await openApp();
await go(A.page, '/admin');
const dog = A.page.locator('.animal-walker').first();
const x1 = (await dog.boundingBox()).x;
await A.page.waitForTimeout(1500);
const x2 = (await dog.boundingBox()).x;
check('동물이 움직인다', Math.abs(x2 - x1) > 5, `${Math.round(x1)} → ${Math.round(x2)}`);
await A.page.locator('header nav').screenshot({ path: 'scripts/e2e/out/parade.png' });
await A.page.getByRole('link', { name: '교사 관리' }).click();
await A.page.waitForURL(/\/admin\/teachers$/);
check('메뉴 클릭 정상', true);
await A.page.setViewportSize({ width: 390, height: 844 });
check('휴대폰에서는 숨김', !(await A.page.locator('.animal-parade').isVisible()));
check('콘솔 오류 없음', A.errors.length === 0, A.errors.join(' / '));
await A.browser.close();
process.exit(failures ? 1 : 0);
