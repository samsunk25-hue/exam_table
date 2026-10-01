// 로그인 화면(로그아웃 상태)과 링크 미리보기 태그 확인: node scripts/e2e/login-shot.mjs [주소]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:5173';
mkdirSync('scripts/e2e/out', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
for (const [name, viewport] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport });
  await page.goto(`${base}/login`);
  await page.locator('img[src="/hero.jpg"]').waitFor({ timeout: 15000 });
  await page.screenshot({ path: `scripts/e2e/out/login-${name}.png`, fullPage: true });
  if (name === 'desktop') {
    console.log('title:', await page.title());
    console.log('og:image:', await page.locator('meta[property="og:image"]').getAttribute('content'));
    const img = await page.locator('img[src="/hero.jpg"]').evaluate((el) => `${el.naturalWidth}x${el.naturalHeight}`);
    console.log('hero loaded:', img);
  }
  await page.close();
}
await browser.close();
