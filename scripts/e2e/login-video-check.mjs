// 로그인 화면 영상: 자동 재생(소리 없음, 반복) 확인 + 화면 캡처 (컴퓨터·휴대폰)
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const OUT = 'scripts/e2e/out';
mkdirSync(OUT, { recursive: true });
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const browser = await chromium.launch({ channel: 'msedge' });
// reduce: Windows "애니메이션 효과"를 끈 학교 컴퓨터와 같은 환경
for (const [name, viewport, reducedMotion] of [
  ['desktop', { width: 1280, height: 900 }, 'no-preference'],
  ['desktop(애니메이션 끔)', { width: 1280, height: 900 }, 'reduce'],
  ['mobile', { width: 390, height: 844 }, 'no-preference'],
]) {
  const page = await browser.newPage({ viewport, reducedMotion });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(process.argv[2] ?? 'http://localhost:5173/');
  const v = page.locator('video');
  await v.waitFor();
  await page.waitForFunction(() => {
    const el = document.querySelector('video');
    return el && el.currentTime > 0.5;
  }, null, { timeout: 15000 }).catch(() => {});
  const st = await v.evaluate((el) => ({ t: el.currentTime, muted: el.muted, loop: el.loop, paused: el.paused, w: el.clientWidth }));
  check(`${name}: 자동 재생 중 (소리 없음·반복)`, st.t > 0.5 && st.muted && st.loop && !st.paused, JSON.stringify(st));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check(`${name}: 가로 넘침 없음`, !overflow);
  check(`${name}: 로그인 버튼 보임`, await page.getByRole('button', { name: /Google 계정으로 로그인/ }).isVisible());
  check(`${name}: 콘솔 오류 없음`, errors.length === 0, errors.join(' / '));
  await page.getByRole('button', { name: '영상 일시정지' }).click();
  check(`${name}: 일시정지 버튼`, await v.evaluate((el) => el.paused));
  await page.getByRole('button', { name: '영상 재생' }).click();
  await page.screenshot({ path: `${OUT}/login-video-${name.replace(/W/g, '')}.png` });
  await page.close();
}
await browser.close();
process.exit(failures ? 1 : 0);
