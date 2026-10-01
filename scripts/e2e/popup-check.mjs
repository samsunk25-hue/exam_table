// 통합 양식 업로드 시 "기존 자료를 어떻게 할까요?" 팝업 점검 (grid-check.mjs 실행 후, 시험 6건 있는 상태)
// 시험 1건만 있는 파일을 올림 → 팝업 → 기존 유지(시험 6+1) → 다시 올림 → 지우고 바꾸기(시험 1)
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { go, openApp } from './session.mjs';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
const require = createRequire(import.meta.url);
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
initializeApp({ projectId: 'smart-invigilation' });
const db = getFirestore();
const XLSX = require('xlsx');

const OUT = 'scripts/e2e/out';
mkdirSync(OUT, { recursive: true });
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const SID = 'E2E_GRID';
const count = async () => (await db.collection(`sessions/${SID}/slots`).get()).size;
const before = await count();

// 시험일정 시트만 있는 통합 양식 (다른 날짜 시험 1건)
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['날짜*', '교시*', '시작시간', '종료시간', '학년*', '과목*', '유형'], ['2026-11-04', 1, '09:00', '09:45', 1, '국어', '시험']]), '시험일정');
const file = `${OUT}/one-slot.xlsx`;
XLSX.writeFile(wb, file);

const { browser, page, errors } = await openApp();
async function upload(choice) {
  await go(page, `/admin/sessions/${SID}`);
  await page.getByRole('button', { name: '통합 양식 업로드' }).click();
  const dialog = page.getByRole('dialog', { name: '기초 자료 통합 양식 업로드' });
  await dialog.locator('input[type=file]').setInputFiles(file);
  await dialog.getByText(/검증 결과/).waitFor();
  await dialog.getByRole('button', { name: '저장', exact: true }).click();
  const ask = page.getByRole('dialog', { name: '기존 자료를 어떻게 할까요?' });
  await ask.waitFor({ timeout: 5000 });
  const text = await ask.innerText();
  await page.screenshot({ path: `${OUT}/popup.png` });
  await ask.getByRole('button', { name: choice }).click();
  await dialog.getByText('저장했습니다.').waitFor();
  await dialog.getByRole('button', { name: '닫기' }).first().click();
  return text;
}

const t1 = await upload(/기존 자료 유지/);
check('팝업에 파일에 없는 시험 수 표시', t1.includes(`시험 ${before}건`), t1.split('\n').find((l) => l.includes('시험')) ?? '');
check('기존 자료 유지 → 시험 추가만', (await count()) === before + 1, `${before} → ${await count()}`);
await upload(/지우고 파일 내용으로 바꾸기/);
check('지우고 바꾸기 → 파일 내용만 남음', (await count()) === 1, `${await count()}건`);
check('콘솔 오류 없음', errors.length === 0, errors.join(' / '));
await browser.close();
process.exit(failures ? 1 : 0);
