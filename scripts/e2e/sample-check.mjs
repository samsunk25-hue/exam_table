// 샘플 양식 점검: 샘플 다운로드 → 그대로 업로드 → 저장 → 자동 배정 100%
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

const SID = 'E2E_SAMPLE';
// 빈 학교에서 샘플을 쓰는 상황: 에뮬레이터의 교사·시험실을 비운다
for (const col of ['teachers', 'rooms']) await db.recursiveDelete(db.collection(col));
await db.recursiveDelete(db.doc(`sessions/${SID}`));
await db.doc(`sessions/${SID}`).set({
  schoolName: '샘플중학교', year: 2026, semester: 2, examName: '샘플 점검', status: 'DRAFT',
  settings: { useBaseTimetable: true }, createdAt: new Date(), updatedBy: 'seed',
});

const { browser, page, errors } = await openApp();
await go(page, `/admin/sessions/${SID}`);
const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /샘플 양식/ }).click()]);
const file = `${OUT}/${download.suggestedFilename()}`;
await download.saveAs(file);
const wb = XLSX.readFile(file);
const slotRows = XLSX.utils.sheet_to_json(wb.Sheets['시험일정'], { header: 1 }).slice(1);
check('샘플 시트 구성', wb.SheetNames.length === 5 + 25 && slotRows.length === 27, `시트 ${wb.SheetNames.length}장, 시험 ${slotRows.length}행`);
// 열: 날짜, 교시, 시작, 종료, 학년, 과목, 유형 — 첫날 1학년의 세 교시
const day1g1 = slotRows.filter((r) => r[0] === slotRows[0][0] && r[4] === 1).map((r) => [r[1], r[2], r[3], r[6]]);
check('45분 시험 + 15분 휴식, 3교시 자습', JSON.stringify(day1g1) === JSON.stringify([[1, '09:00', '09:45', '시험'], [2, '10:00', '10:45', '시험'], [3, '11:00', '11:45', '자습']]), JSON.stringify(day1g1));

// 시험실배치(선택): 기본 배치와 같은 시험은 특별실 행만 들어 있어야 한다
const placeRows = XLSX.utils.sheet_to_json(wb.Sheets['시험실배치'], { header: 1 }).slice(1);
check('시험실배치 시트는 별도시험장 행만', placeRows.length === 3 && placeRows.every((r) => r[3] === '별도시험장'), JSON.stringify(placeRows));

await page.getByRole('button', { name: '통합 양식 업로드' }).click();
const dialog = page.getByRole('dialog', { name: '기초 자료 통합 양식 업로드' });
await dialog.locator('input[type=file]').setInputFiles(file);
await dialog.getByText(/검증 결과/).waitFor();
check('샘플 그대로 업로드 → 오류 0건', (await dialog.getByText(/검증 결과/).innerText()).includes('오류 0건'));
await dialog.getByRole('button', { name: '저장', exact: true }).click();
// 기존 자료 처리 팝업이 뜨면 '기존 자료 유지'
const keepBtn = page.getByRole('button', { name: /기존 자료 유지/ });
if (await keepBtn.isVisible({ timeout: 1500 }).catch(() => false)) await keepBtn.click();
await dialog.getByText('저장했습니다.').waitFor({ timeout: 60000 });
const done = (await dialog.locator('ul').innerText()).replace(/\n/g, ' / ');
check('저장 (교사 25 · 시험 27 · 시간표)', done.includes('교사 25명 (신규 25)') && done.includes('시험 일정 27건') && done.includes('기초시간표 교사 25명'), done);
await dialog.getByRole('button', { name: '닫기' }).first().click();

const slotDocs = await db.collection(`sessions/${SID}/slots`).get();
const p1g1 = slotDocs.docs.filter((d) => d.get('grade') === 1 && d.get('period') === 1);
const roomsOf = (d) => d.get('rooms').map((p) => p.roomType === 'EXTENDED' ? 'SEP' : p.classNo ?? 'H').join(',');
check('특별실 + 자동 배치가 합쳐짐 (1학년 1교시: 교실 3 + 별도시험장, 복도 없음)', p1g1.length === 3 && p1g1.every((d) => roomsOf(d) === '1,2,3,SEP'), p1g1.map(roomsOf).join(' / '));
check('모든 시험에 시험실 배치', slotDocs.docs.every((d) => d.get('rooms').length > 0));

await go(page, `/admin/sessions/${SID}/assign`);
await page.getByRole('checkbox', { name: /대안 시나리오/ }).uncheck();
await page.getByRole('button', { name: '자동 배정 실행', exact: true }).click();
await page.getByText(/^성공률$/).waitFor({ timeout: 60000 });
const metrics = await page.locator('main').innerText();
check('자동 배정 성공률 100%', /성공률\s*100%/.test(metrics));

// 별도시험장 연장(09:00~10:10)은 2교시(10:00~)와 겹치므로 그 감독 교사는 같은 날 2교시에 배정되지 않는다
check('별도 시간 저장 (별도시험장 09:00~10:10)', p1g1.every((d) => d.get('rooms').some((p) => p.startTime === '09:00' && p.endTime === '10:10')));
const runs = await db.collection(`sessions/${SID}/runs`).get();
const run = runs.docs.sort((a, b) => b.get('createdAt').toMillis() - a.get('createdAt').toMillis())[0].data();
const at = (seatId) => {
  const [date, period] = seatId.split('__')[0].split('_');
  return { date, period: Number(period) };
};
const clashes = run.assignments
  .filter((a) => a.seatId.includes('__SSEP_'))
  .filter((ext) => run.assignments.some((o) => o.teacherId === ext.teacherId && at(o.seatId).date === at(ext.seatId).date && at(o.seatId).period === 2));
check('연장 시간이 겹치는 2교시에는 같은 교사 배정 없음', clashes.length === 0, `${clashes.length}건`);
await page.screenshot({ path: `${OUT}/sample-assign.png`, fullPage: true });
check('콘솔 오류 없음', errors.length === 0, errors.join(' / '));
await browser.close();
process.exit(failures ? 1 : 0);
