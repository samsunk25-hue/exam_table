// 로그인 영상 확인: 크기·길이를 읽고 몇 장면을 캡처한다 (개발 서버 필요)
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const OUT = 'scripts/e2e/out';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
await page.goto('http://localhost:5173/login.mp4');
const v = page.locator('video');
await v.waitFor();
const info = await v.evaluate((el) =>
  el.readyState >= 1 ? { w: el.videoWidth, h: el.videoHeight, d: el.duration } : new Promise((res) => (el.onloadedmetadata = () => res({ w: el.videoWidth, h: el.videoHeight, d: el.duration }))),
);
console.log(JSON.stringify(info));
for (const t of [0.5, info.d / 2, Math.max(0.5, info.d - 0.5)]) {
  await v.evaluate((el, t) => new Promise((res) => { el.pause(); el.onseeked = res; el.currentTime = t; }), t);
  await v.screenshot({ path: `${OUT}/video-${Math.round(t * 10)}.png` });
}
await browser.close();
