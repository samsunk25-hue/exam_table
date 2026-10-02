// 최종·개인 시간표 점검 (sample-check.mjs 실행 후):
// 샘플 배정 적용 → 교사 공개 → 관리자 출력(컴퓨터) → 교사 화면(휴대폰) 다운로드
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { go, openApp, runCompare } from './session.mjs';

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
const SID = 'E2E_SAMPLE';

// 1. 관리자: 배정 실행·적용 → 교사 공개 → 출력
await db.doc(`sessions/${SID}`).update({ status: 'DRAFT' }); // 다시 실행해도 되도록
{
  const { browser, page, errors } = await openApp();
  await go(page, `/admin/sessions/${SID}/assign`);
  await runCompare(page); // 가장 좋은 안을 바로 적용한다
  await db.doc(`sessions/${SID}`).update({ status: 'PUBLISHED' }); // 상태 전환은 함수 점검에서 따로 확인
  check('배정 적용 + 교사 공개', true);

  await go(page, `/admin/sessions/${SID}/print`);
  await page.getByText(/시험 감독 시간표/).first().waitFor();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: `${OUT}/print-full-desktop.png`, fullPage: true });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /엑셀 \(날짜별/ }).click()]);
  await dl.saveAs(`${OUT}/full.xlsx`);
  const wb = XLSX.readFile(`${OUT}/full.xlsx`);
  check('전체 시간표 엑셀 (날짜 3장 + 교사별)', wb.SheetNames.length === 4 && wb.SheetNames.at(-1) === '교사별', wb.SheetNames.join(','));
  await page.getByRole('button', { name: '개인 시간표' }).click();
  await page.getByText(/선생님 감독 시간표/).waitFor();
  await page.screenshot({ path: `${OUT}/print-personal-desktop.png`, fullPage: true });
  check('관리자 화면 콘솔 오류 없음', errors.length === 0, errors.join(' / '));
  await browser.close();
}

// 2. 교사(김민준, t01): 휴대폰 화면
{
  const { browser, page, errors } = await openApp({ email: 't01@sample.school.kr', viewport: { width: 390, height: 844 } });
  await go(page, '/me');
  await page.getByText(/감독 \d+회/).waitFor();
  const count = (await page.getByText(/감독 \d+회/).innerText()).match(/감독 (\d+)회/)[1];
  const myId = (await db.collection('teachers').where('email', '==', 't01@sample.school.kr').get()).docs[0].id;
  const mine = (await db.collection(`sessions/${SID}/assignments`).where('teacherId', '==', myId).get()).size;
  check('내 감독 수 = 저장된 배정 수', Number(count) === mine, `${count}회`);
  await page.screenshot({ path: `${OUT}/me-mobile.png`, fullPage: true });

  const [ics] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /휴대폰 캘린더에 추가/ }).click()]);
  await ics.saveAs(`${OUT}/me.ics`);
  const icsText = readFileSync(`${OUT}/me.ics`, 'utf8');
  check('캘린더 파일 (.ics)', (icsText.match(/BEGIN:VEVENT/g) ?? []).length === mine && icsText.includes('TZID=Asia/Seoul'), `일정 ${(icsText.match(/BEGIN:VEVENT/g) ?? []).length}개`);
  const [x] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /^엑셀$/ }).click()]);
  check('개인 엑셀 다운로드', x.suggestedFilename().endsWith('.xlsx'), x.suggestedFilename());

  await page.getByRole('button', { name: '전체 시간표' }).click();
  await page.getByText('파란색이 내 감독입니다.').waitFor();
  await page.screenshot({ path: `${OUT}/full-mobile.png`, fullPage: true });
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  check('휴대폰에서 가로 스크롤 없음', width <= 390, `${width}px`);
  check('교사 화면 콘솔 오류 없음', errors.length === 0, errors.join(' / '));
  await browser.close();
}
process.exit(failures ? 1 : 0);
