// 에뮬레이터 모드 웹앱(localhost:5173)을 Edge로 열고 로그인까지 해 주는 E2E 도우미.
import { chromium } from 'playwright-core';

export const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';

export async function openApp({ email = 'samsunk25@gmail.com', headless = true, viewport = undefined } = {}) {
  const browser = await chromium.launch({ channel: 'msedge', headless });
  const context = await browser.newContext({ acceptDownloads: true, locale: 'ko-KR', ...(viewport ? { viewport, isMobile: true, hasTouch: true } : {}) });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(`${BASE}/login`);
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Google 계정으로 로그인' }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState();

  // Auth 에뮬레이터 로그인 창: 기존 계정이 있으면 선택, 없으면 새로 추가
  const existing = popup.getByText(email, { exact: false });
  if (await existing.count()) {
    await existing.first().click();
  } else {
    await popup.getByText('Add new account').click();
    await popup.locator('#email-input').fill(email);
    await popup.getByRole('button', { name: /Sign in with/i }).click();
  }
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
  await page.locator('main, h1').first().waitFor();
  return { browser, context, page, errors };
}

/** 앱 내부 이동 후 본문이 그려질 때까지 대기 (Firestore 실시간 연결 때문에 networkidle은 쓰지 않는다) */
export async function go(page, path) {
  await page.goto(`${BASE}${path}`);
  await page.locator('main h1').first().waitFor();
}

/** 자동 배정 화면 "고급"을 열고 "자동 배정 실행"(적용 없이 기본안·대안 비교)을 누른다 */
export async function runCompare(page) {
  const adv = page.locator('details', { hasText: '고급 — 안을 직접 비교해 고르기' });
  if (!(await adv.evaluate((d) => d.open))) await adv.locator('summary').click();
  await adv.getByRole('button', { name: '자동 배정 실행', exact: true }).click();
}
