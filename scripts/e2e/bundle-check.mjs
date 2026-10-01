// 통합 양식 점검: 세션 생성 → 통합 양식 다운로드 → 일정·시간표 채우기 → 업로드 → 저장 확인
// 실행: node scripts/e2e/bundle-check.mjs (에뮬레이터 + npm run seed 이후)
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { go, openApp } from './session.mjs';

const XLSX = createRequire(import.meta.url)('xlsx');
const OUT = 'scripts/e2e/out';
mkdirSync(OUT, { recursive: true });
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

// 깨끗한 상태에서 시작: 교사·시험실을 비우고 기본 교사 3명만 둔다 (다른 점검이 남긴 자료와 섞이지 않게)
{
  process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
  const require = createRequire(import.meta.url);
  const { initializeApp } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  initializeApp({ projectId: 'smart-invigilation' });
  const db = getFirestore();
const TERM = { term: '점검중학교|2026|2', school: '점검중학교', year: 2026, semester: 2 }; // 학교·학기 명단
  for (const col of ['teachers', 'rooms']) await db.recursiveDelete(db.collection(col));
  const seed = [
    ['T001', '김국어', 'kim@test.kr', '국어', { grade: 1, classNo: 1 }],
    ['T002', '이수학', 'lee@test.kr', '수학', { grade: 1, classNo: 2 }],
    ['T003', '박영어', 'park@test.kr', '영어', null],
  ];
  for (const [id, name, email, subject, homeroom] of seed) {
    await db.doc(`teachers/${id}`).set({ name, email, subject, homeroom, defaultRole: 'NORMAL', active: true, cumulativeLoad: 0, ...TERM, updatedBy: 'seed' });
  }
}

const { browser, page, errors } = await openApp();

// 1. 새 시험 프로젝트
await go(page, '/admin');
await page.getByRole('button', { name: '+ 새 시험 프로젝트' }).click();
await page.getByLabel('학교명').fill('점검중학교');
await page.getByLabel('시험명').fill(`통합양식 점검 ${Date.now() % 10000}`);
await page.getByRole('button', { name: '만들기' }).click();
await page.waitForURL(/\/admin\/sessions\/[^/]+$/);
await page.getByText('기초 자료 한 번에 입력').waitFor();

// 2. 통합 양식 다운로드
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.getByRole('button', { name: '통합 양식 다운로드' }).click(),
]);
const file = `${OUT}/${download.suggestedFilename()}`;
await download.saveAs(file);
const wb = XLSX.readFile(file);
check('통합 양식 시트 구성', ['안내', '교사', '시험실', '시험일정', '시험실배치', '김국어'].every((n) => wb.SheetNames.includes(n)), wb.SheetNames.join(','));

// 3. 시험 일정 2건 + 김국어 시간표 채우기 (2026-10-12는 월요일)
wb.Sheets['시험일정'] = XLSX.utils.aoa_to_sheet([
  ['날짜*', '교시*', '시작시간', '종료시간', '학년*', '과목*', '유형'],
  ['2026-10-12', 1, '09:00', '09:45', 1, '국어', '시험'],
  ['2026-10-12', 2, '10:00', '10:45', 1, '수학', '시험'],
]);
const grid = XLSX.utils.sheet_to_json(wb.Sheets['김국어'], { header: 1, defval: null });
grid[1][1] = '1-1 국어'; // 월 1교시
grid[2][3] = '국어 1-2'; // 수 2교시
wb.Sheets['김국어'] = XLSX.utils.aoa_to_sheet(grid);
const filled = `${OUT}/통합양식_작성.xlsx`;
XLSX.writeFile(wb, filled);

// 4. 업로드 → 검증 → 저장
await page.getByRole('button', { name: '통합 양식 업로드' }).click();
const dialog = page.getByRole('dialog', { name: '기초 자료 통합 양식 업로드' });
await dialog.locator('input[type=file]').setInputFiles(filled);
await dialog.getByText(/검증 결과/).waitFor();
check('통합 양식 검증', (await dialog.getByText(/검증 결과/).innerText()).includes('오류 0건'));
await page.screenshot({ path: `${OUT}/bundle-preview.png`, fullPage: true });
await dialog.getByRole('button', { name: '저장', exact: true }).click();
// 기존 자료 처리 팝업이 뜨면 '기존 자료 유지'
const keepBtn = page.getByRole('button', { name: /기존 자료 유지/ });
if (await keepBtn.isVisible({ timeout: 1500 }).catch(() => false)) await keepBtn.click();
await dialog.getByText('저장했습니다.').waitFor();
check('저장 결과', true, (await dialog.locator('ul').innerText()).replace(/\n/g, ' / '));
await dialog.getByRole('button', { name: '닫기' }).first().click();

// 5. 화면 반영 확인: 시험은 저장되고 시험실은 자동 배치, 기초시간표는 자동 배정 화면의 배정 설정에 표시
const sid = page.url().split('/sessions/')[1].split('/')[0];
{
  const { getFirestore } = createRequire(import.meta.url)('firebase-admin/firestore');
  let slots = [];
  for (let i = 0; i < 40; i++) {
    slots = (await getFirestore().collection(`sessions/${sid}/slots`).get()).docs.map((d) => d.data());
    if (slots.length && slots.every((x) => x.rooms?.length)) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  check('시험 2건 저장', slots.length === 2 && slots.some((x) => x.subject === '국어') && slots.some((x) => x.subject === '수학'), slots.map((x) => x.subject).join(','));
  check('시험실 자동 배치됨', slots.every((x) => x.rooms?.length > 0));
}
await go(page, `/admin/sessions/${sid}/assign`);
await page.getByText(/기초시간표: /).waitFor();
check('기초시간표 반영 (자동 배정 > 배정 설정에 표시)', await page.getByText(/교사 1명 · 수업 2건/).waitFor({ timeout: 15000 }).then(() => true).catch(() => false), (await page.getByText(/기초시간표: /).innerText()).replace(/s+/g, ' '));
await page.screenshot({ path: `${OUT}/bundle-after.png`, fullPage: true });

check('콘솔 오류 없음', errors.length === 0, errors.join(' / '));
await browser.close();
process.exit(failures ? 1 : 0);
