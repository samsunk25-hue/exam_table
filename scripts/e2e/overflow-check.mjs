// 휴대폰 폭에서 화면 밖으로 넘치는 요소 찾기: node scripts/e2e/overflow-check.mjs /me 이메일
import { go, openApp } from './session.mjs';

const [path = '/me', email = 't01@sample.school.kr', button] = process.argv.slice(2);
const { browser, page } = await openApp({ email, viewport: { width: 390, height: 844 } });
await go(page, path);
await page.waitForTimeout(2500);
if (button) {
  await page.getByRole('button', { name: button }).click();
  await page.waitForTimeout(1500);
}
const wide = await page.evaluate(() =>
  [...document.querySelectorAll('body *')]
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ r }) => r.right > 391 && r.width > 0)
    .slice(0, 12)
    .map(({ el, r }) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} right=${Math.round(r.right)} w=${Math.round(r.width)} text=${(el.textContent ?? '').trim().slice(0, 30)}`),
);
console.log(`scrollWidth=${await page.evaluate(() => document.documentElement.scrollWidth)}`);
console.log(wide.join('\n'));
await browser.close();
