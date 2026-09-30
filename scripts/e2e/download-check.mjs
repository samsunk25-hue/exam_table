// 양식 다운로드 → 안내 메시지 → 같은 파일 재업로드 점검: node scripts/e2e/download-check.mjs
import { mkdirSync } from 'node:fs';
import { go, openApp } from './session.mjs';

const OUT = 'scripts/e2e/out';
mkdirSync(OUT, { recursive: true });
const { browser, page, errors } = await openApp();
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

for (const [path, uploadTitle] of [
  ['/admin/teachers', '교사 명단 업로드'],
  ['/admin/rooms', '시험실 업로드'],
]) {
  await go(page, path);
  await page.waitForTimeout(800);
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }),
    page.getByRole('button', { name: /양식 다운로드/ }).first().click(),
  ]);
  const file = `${OUT}/${download.suggestedFilename()}`;
  await download.saveAs(file);
  check(`${path} 다운로드`, true, download.suggestedFilename());
  const toast = page.getByRole('status').filter({ hasText: '다운로드 폴더에 저장했습니다' });
  check(`${path} 저장 안내 표시`, await toast.isVisible());

  // 내려받은 양식을 그대로 다시 올리면 오류 없이 저장 가능해야 한다
  await page.getByRole('button', { name: '엑셀 업로드' }).click();
  const dialog = page.getByRole('dialog', { name: uploadTitle });
  await dialog.locator('input[type=file]').setInputFiles(file);
  await dialog.getByText(/검증 결과/).waitFor();
  const heading = await dialog.getByText(/검증 결과/).innerText();
  check(`${path} 재업로드 검증`, heading.includes('오류 0건'), heading.replace(/\s+/g, ' '));
  await page.screenshot({ path: `${OUT}/upload${path.replaceAll('/', '_')}.png`, fullPage: true });
  const save = dialog.getByRole('button', { name: '저장', exact: true });
  if (await save.isEnabled()) {
    await save.click();
    await dialog.getByText(/저장했습니다/).waitFor();
    check(`${path} 저장`, true, await dialog.getByText(/저장했습니다/).innerText());
  }
  await dialog.getByRole('button', { name: '닫기' }).first().click();
}

check('콘솔 오류 없음', errors.length === 0, errors.join(' / '));
await browser.close();
process.exit(failures ? 1 : 0);
