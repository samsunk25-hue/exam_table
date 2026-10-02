// 학기 이름 바꾸기·삭제: 대시보드 학기 묶음에서 이름 바꾸기 → 프로젝트·교사·시험실이 새 이름으로, 삭제 → 모두 사라짐
// 실행: node scripts/e2e/termedit-check.mjs (에뮬레이터 + npm run seed 이후)
import { createRequire } from 'node:module';
import { go, openApp } from './session.mjs';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
const require = createRequire(import.meta.url);
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
initializeApp({ projectId: 'smart-invigilation' });
const db = getFirestore();
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const until = async (fn, ms = 30000) => {
  for (let t = 0; t < ms; t += 300) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
};

const OLD = { school: '학기점검중학교', year: 2026, semester: 2 };
const NEW = { school: '학기점검중', year: 2027, semester: 1 };
const key = (t) => `${t.school}|${t.year}|${t.semester}`;
const fields = (t) => ({ term: key(t), school: t.school, year: t.year, semester: t.semester });
for (const t of [OLD, NEW]) {
  for (const c of ['teachers', 'rooms']) for (const d of (await db.collection(c).where('term', '==', key(t)).get()).docs) await d.ref.delete();
  for (const d of (await db.collection('sessions').where('schoolName', '==', t.school).get()).docs) await db.recursiveDelete(d.ref);
}
await db.doc('sessions/E2E_TERMEDIT').set({ schoolName: OLD.school, year: OLD.year, semester: OLD.semester, examName: '학기 이름 점검', status: 'DRAFT', settings: {}, createdAt: new Date(Date.now() + 997_000), updatedBy: 'seed' });
await db.doc('teachers/TTE1').set({ name: '학기쌤', email: 'termedit@test.kr', subject: '국어', homeroom: null, defaultRole: 'NORMAL', active: true, cumulativeLoad: 0, ...fields(OLD), updatedBy: 'seed' });
await db.doc('rooms/RTE1').set({ name: '학기-1', spaceType: 'CLASSROOM', grade: 1, classNo: 1, chiefCount: 1, assistantCount: 0, ...fields(OLD), updatedBy: 'seed' });

const { browser, page, errors } = await openApp();
await go(page, '/admin');
const label = `${OLD.school} · ${OLD.year}학년도 ${OLD.semester}학기`;
await page.getByRole('button', { name: `${label} 이름 바꾸기` }).click();
const dlg = page.getByRole('dialog', { name: '학기 이름 바꾸기' });
await dlg.getByLabel('학교명').fill(NEW.school);
await dlg.getByLabel('학년도').fill(String(NEW.year));
await dlg.locator('select').selectOption(String(NEW.semester));
await dlg.getByRole('button', { name: '바꾸기', exact: true }).click();
const renamed = await until(async () => {
  const s = (await db.doc('sessions/E2E_TERMEDIT').get()).data();
  const t = (await db.doc('teachers/TTE1').get()).data();
  const r = (await db.doc('rooms/RTE1').get()).data();
  return s?.schoolName === NEW.school && s?.year === NEW.year && s?.semester === NEW.semester && t?.term === key(NEW) && r?.term === key(NEW);
});
check('이름 바꾸기: 프로젝트·교사·시험실 모두 새 학기로', renamed);
const newLabel = `${NEW.school} · ${NEW.year}학년도 ${NEW.semester}학기`;
check('대시보드에 새 이름', await page.getByRole('button', { name: `${newLabel} 이름 바꾸기` }).waitFor({ timeout: 15000 }).then(() => true).catch(() => false));

// 이미 있는 이름으로는 못 바꿈
await db.doc('rooms/RTE2').set({ name: '다른-1', spaceType: 'CLASSROOM', grade: 1, classNo: 1, chiefCount: 1, assistantCount: 0, ...fields(OLD), updatedBy: 'seed' });
await page.getByRole('button', { name: `${newLabel} 이름 바꾸기` }).click();
await dlg.getByLabel('학교명').fill(OLD.school);
await dlg.getByLabel('학년도').fill(String(OLD.year));
await dlg.locator('select').selectOption(String(OLD.semester));
await dlg.getByRole('button', { name: '바꾸기', exact: true }).click();
check('이미 있는 학기 이름은 막음', await dlg.getByText('이미 있는 학교·학기입니다').waitFor({ timeout: 15000 }).then(() => true).catch(() => false));
await dlg.getByRole('button', { name: '취소' }).click();
await db.doc('rooms/RTE2').delete();

// 삭제: 학교명을 적어야 지워진다
await page.getByRole('button', { name: `${newLabel} 삭제` }).click();
const del = page.getByRole('dialog', { name: '학기 삭제' });
check('학교명을 적기 전에는 삭제 버튼 꺼짐', await del.getByRole('button', { name: '학기 삭제' }).isDisabled());
await del.getByRole('textbox').fill(NEW.school);
await del.getByRole('button', { name: '학기 삭제' }).click();
const gone = await until(async () => !(await db.doc('sessions/E2E_TERMEDIT').get()).exists && !(await db.doc('teachers/TTE1').get()).exists && !(await db.doc('rooms/RTE1').get()).exists, 60000);
check('삭제: 프로젝트·교사·시험실 모두 지워짐', gone);
// 이미 있는 이름 거절(409)은 의도한 응답
const real = errors.filter((e) => !e.includes('409'));
check('콘솔 오류 없음', real.length === 0, real.join(' / '));
await browser.close();
console.log(failures ? `\n실패 ${failures}건` : '\n모두 통과');
process.exit(failures ? 1 : 0);
