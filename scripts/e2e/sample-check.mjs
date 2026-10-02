// 샘플 양식 점검: 샘플 다운로드 → 그대로 업로드 → 저장 → 자동 배정 100%
import { mkdirSync } from 'node:fs';
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
const ttRows = XLSX.utils.sheet_to_json(wb.Sheets['기초시간표'] ?? {}, { header: 1 });
check('샘플 시트 구성 (안내·교사·시험실·시험일정·시험실배치·기초시간표)', wb.SheetNames.length === 6 && slotRows.length === 27, `시트 ${wb.SheetNames.join(',')}, 시험 ${slotRows.length}행`);
check('기초시간표 한 장: 교사 25명 행, 월1~금7 열', ttRows.length === 26 && ttRows[0][0] === '교사' && ttRows[0][1] === '월1' && ttRows[0].length === 36, `${ttRows.length}행 ${ttRows[0]?.length}열`);
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
await runCompare(page);
await page.getByText(/^성공률$/).first().waitFor({ timeout: 60000 });
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

// 샘플을 "기존 자료 지우고 파일 내용으로 바꾸기"로 다시 올리기: 파일에 없는 시험실이 시험에 배치되어 있어도
// 삭제된 시험실이 남지 않고 자동 배치가 새로 된다 (전에는 "삭제된 시험실이 배치되어 있습니다" 오류)
await db.doc('rooms/ROLD').set({ name: '옛시험실', spaceType: 'CLASSROOM', grade: 1, classNo: 9, chiefCount: 1, assistantCount: 1, term: '샘플중학교|2026|2', school: '샘플중학교', year: 2026, semester: 2 });
const g2 = slotDocs.docs.find((d) => d.get('grade') === 2 && d.get('type') === 'EXAM');
await g2.ref.update({ rooms: [...g2.get('rooms'), { roomId: 'ROLD', classNo: 9, headcount: null, roomType: 'NORMAL' }] });
await go(page, `/admin/sessions/${SID}`);
await page.getByRole('button', { name: '통합 양식 업로드' }).click();
await dialog.locator('input[type=file]').setInputFiles(file);
await dialog.getByText(/검증 결과/).waitFor();
await dialog.getByRole('button', { name: '저장', exact: true }).click();
await page.getByRole('button', { name: /기존 자료 지우고 파일 내용으로 바꾸기/ }).click();
await dialog.getByText('저장했습니다.').waitFor({ timeout: 60000 });
await dialog.getByRole('button', { name: '닫기' }).first().click();
const roomIds = new Set((await db.collection('rooms').get()).docs.map((d) => d.id));
const slots2 = (await db.collection(`sessions/${SID}/slots`).get()).docs;
const stale = slots2.filter((d) => d.get('rooms').some((p) => !roomIds.has(p.roomId)));
check('다시 올려도 삭제된 시험실을 가리키는 시험 없음', !roomIds.has('ROLD') && stale.length === 0, `${stale.length}건`);
const p1g1b = slots2.filter((d) => d.get('grade') === 1 && d.get('period') === 1);
check('다시 올린 뒤 배치도 같음 (교실 3 + 별도시험장)', p1g1b.every((d) => roomsOf(d) === '1,2,3,SEP'), p1g1b.map(roomsOf).join(' / '));
check('시험실 배치 수 = 시험 27건에 맞음', slots2.length === 27 && slots2.reduce((n, d) => n + d.get('rooms').length, 0) === 27 * 3 + 3, `${slots2.reduce((n, d) => n + d.get('rooms').length, 0)}개`);
check('콘솔 오류 없음', errors.length === 0, errors.join(' / '));
await browser.close();
process.exit(failures ? 1 : 0);
