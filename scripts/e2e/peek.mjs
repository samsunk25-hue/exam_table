// 화면 확인용: node scripts/e2e/peek.mjs /admin/rooms
import { mkdirSync } from 'node:fs';
import { BASE, openApp } from './session.mjs';

mkdirSync('scripts/e2e/out', { recursive: true });
const { browser, page, errors } = await openApp();
await page.goto(`${BASE}${process.argv[2] ?? '/'}`);
await page.waitForTimeout(4000);
await page.screenshot({ path: 'scripts/e2e/out/peek.png', fullPage: true });
console.log('url', page.url());
console.log('errors', errors);
await browser.close();
