// 메뉴 오른쪽 동물 행진: 움직이는지, 메뉴 클릭을 막지 않는지, 휴대폰에서는 행진 대신 제목 옆 세 마리가 제자리에서 튀는지
import { openApp, go } from './session.mjs';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const A = await openApp();
// 학교 PC처럼 Windows 애니메이션 효과가 꺼진(움직임 줄이기) 상태에서도 동물은 움직여야 한다
await A.page.emulateMedia({ reducedMotion: 'reduce' });
await go(A.page, '/admin');
const dog = A.page.locator('.animal-walker').first();
const x1 = (await dog.boundingBox()).x;
await A.page.waitForTimeout(1500);
const x2 = (await dog.boundingBox()).x;
check('동물이 움직인다', Math.abs(x2 - x1) > 5, `${Math.round(x1)} → ${Math.round(x2)}`);
await A.page.locator('header nav').screenshot({ path: 'scripts/e2e/out/parade.png' });
await A.page.getByRole('link', { name: '관리자 관리' }).click();
await A.page.waitForURL(/\/admin\/admins$/);
check('메뉴 클릭 정상', true);
check('컴퓨터에서는 세 마리 숨김', !(await A.page.locator('header .animal-bounce').first().isVisible()));

await A.page.setViewportSize({ width: 390, height: 844 });
check('휴대폰에서는 행진 숨김', !(await A.page.locator('.animal-parade').isVisible()));
const bounce = A.page.locator('header .animal-bounce');
check('휴대폰: 제목 옆 세 마리', (await bounce.count()) === 3 && (await bounce.first().isVisible()));
const x0 = Math.round((await bounce.first().boundingBox()).x);
const ys = [];
const xs = [];
for (let i = 0; i < 6; i++) {
  const b = await bounce.first().boundingBox();
  ys.push(Math.round(b.y));
  xs.push(Math.round(b.x));
  await A.page.waitForTimeout(120);
}
check('휴대폰: 위아래로 튄다', new Set(ys).size > 1, ys.join(','));
check('휴대폰: 제자리 (옆으로 움직이지 않음)', xs.every((x) => Math.abs(x - x0) <= 4), xs.join(','));
const lines = await A.page
  .locator('header .font-hand')
  .first()
  .evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).fontSize)));
check('휴대폰: 제목 2줄', lines === 2, `${lines}줄`);
await A.page.locator('header').first().screenshot({ path: 'scripts/e2e/out/parade-phone.png' });
check('콘솔 오류 없음', A.errors.length === 0, A.errors.join(' / '));
await A.browser.close();
process.exit(failures ? 1 : 0);
