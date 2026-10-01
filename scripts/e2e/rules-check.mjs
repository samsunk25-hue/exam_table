// 글로 쓴 고려사항 → AI 규칙 (에뮬레이터 가짜 응답) → 미리보기 → 저장 → 자동 배정 반영 → 삭제
import { createRequire } from 'node:module';
import { go, openApp, runCompare } from './session.mjs';

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
const TERM = { term: '점검중학교|2026|2', school: '점검중학교', year: 2026, semester: 2 };

const SID = 'E2E_RULES';
await db.recursiveDelete(db.doc(`sessions/${SID}`));
await db.doc(`sessions/${SID}`).set({
  schoolName: '점검중학교', year: 2026, semester: 2, examName: '규칙 점검', status: 'DRAFT',
  settings: { useBaseTimetable: false }, createdAt: new Date(Date.now() + 990_000), updatedBy: 'seed',
});
await db.doc('rooms/RRU').set({ name: '규칙-1', spaceType: 'CLASSROOM', grade: 1, classNo: 1, chiefCount: 1, assistantCount: 0, ...TERM, updatedBy: 'seed' });
await db.doc(`sessions/${SID}/slots/2026-11-03_1_1`).set({
  date: '2026-11-03', period: 1, grade: 1, subject: '국어', type: 'EXAM', startTime: '09:00', endTime: '09:45',
  rooms: [{ roomId: 'RRU', classNo: 1, headcount: null, roomType: 'NORMAL' }], updatedBy: 'seed',
});
const teachers = (await db.collection('teachers').where('term', '==', TERM.term).get()).docs.filter((d) => d.get('active') !== false && !d.get('temporary'));
const kim = teachers.find((d) => d.get('name')?.startsWith('김')) ?? teachers[0];
const kimName = kim.get('name');

const { browser, page, errors } = await openApp();
// 글로 쓰는 고려사항은 자동 배정 화면 위에 있다
await go(page, `/admin/sessions/${SID}/assign`);
const card = page.getByRole('heading', { name: '글로 쓰는 고려사항 (AI)' });
await card.waitFor();
await page.getByLabel('고려사항').fill(`${kimName} 선생님은 11/3 1교시에 병원 진료라 빼 주세요.`);
await page.getByRole('button', { name: 'AI로 규칙 만들기' }).click();
const preview = page.getByRole('region', { name: '규칙 미리보기' });
await preview.waitFor({ timeout: 60000 });
const ptext = await preview.innerText();
check('미리보기: 교사·날짜·교시·금지', ptext.includes(kimName) && ptext.includes('11/3') && ptext.includes('1교시') && ptext.includes('금지'), ptext.replace(/\s+/g, ' ').slice(0, 120));
await page.getByRole('button', { name: '고른 규칙 저장' }).click();
const saved = page.getByRole('region', { name: '저장된 규칙' });
await saved.waitFor();
let docs = [];
for (let i = 0; i < 40 && !docs.length; i++) {
  docs = (await db.collection(`sessions/${SID}/constraints`).get()).docs;
  if (!docs.length) await new Promise((r) => setTimeout(r, 300));
}
check('규칙 저장 (RULE·HARD·조건)', docs.length === 1 && docs[0].get('type') === 'RULE' && docs[0].get('priority') === 'HARD' && docs[0].get('teacherId') === kim.id && docs[0].get('when.periods')?.[0] === 1, JSON.stringify(docs[0]?.data()));
check('원래 문장도 함께 저장', String(docs[0]?.get('sourceText')).includes('병원'));

// 자동 배정: 그 교사는 그 자리에 오지 않는다
await go(page, `/admin/sessions/${SID}/assign`);
await runCompare(page);
await page.getByText('다중 시나리오 비교').waitFor({ timeout: 60000 });
await page.locator('section', { hasText: '다중 시나리오 비교' }).first().getByRole('button', { name: '자세히' }).first().click();
await page.getByRole('button', { name: '이 결과 적용' }).click();
await page.getByRole('status').filter({ hasText: '적용했습니다' }).waitFor({ timeout: 60000 });
const who = (await db.collection(`sessions/${SID}/assignments`).get()).docs.map((d) => d.get('teacherId'));
check('자동 배정에서 그 교사는 빠짐', who.length > 0 && !who.includes(kim.id), JSON.stringify(who));

// 삭제
await go(page, `/admin/sessions/${SID}/assign`);
await page.getByRole('button', { name: /삭제$/ }).filter({ hasText: '×' }).first().click();
let left = 1;
for (let i = 0; i < 40 && left; i++) {
  left = (await db.collection(`sessions/${SID}/constraints`).get()).size;
  if (left) await new Promise((r) => setTimeout(r, 300));
}
check('규칙 삭제', left === 0);
check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
await db.recursiveDelete(db.doc(`sessions/${SID}`));
await db.doc('rooms/RRU').delete();
process.exit(failures ? 1 : 0);
