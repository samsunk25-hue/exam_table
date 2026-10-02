// 별도시험장 우선 교사: 배정 설정에서 교사를 고르면 자동 배정이 그 교사를 별도시험장 정감독(연장)·부감독에 먼저 넣는다
// 실행: sample-check.mjs 다음에 (E2E_SAMPLE, 별도시험장 배치가 있는 샘플 학교)
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
const until = async (fn, ms = 20000) => {
  for (let t = 0; t < ms; t += 300) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
};

const SID = 'E2E_SAMPLE';
await db.doc(`sessions/${SID}`).set({ status: 'DRAFT', settings: { extendedPreferred: [] } }, { merge: true });
const teachers = (await db.collection('teachers').where('term', '==', '샘플중학교|2026|2').get()).docs
  .map((d) => ({ id: d.id, name: d.get('name') }))
  .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
const picks = teachers.slice(-2); // 이름순 마지막 두 명

const { browser, page, errors } = await openApp();
await go(page, `/admin/sessions/${SID}/assign`);
const add = page.getByLabel('별도시험장 우선 교사 추가');
await add.waitFor();
for (const t of picks) {
  await add.selectOption({ value: t.id });
  await page.getByRole('button', { name: `${t.name} 빼기` }).waitFor();
}
const saved = await until(async () => {
  const ids = (await db.doc(`sessions/${SID}`).get()).get('settings.extendedPreferred') ?? [];
  return picks.every((t) => ids.includes(t.id));
});
check('배정 설정: 우선 교사 2명 저장', saved, picks.map((t) => t.name).join(', '));

await runCompare(page);
await page.locator('section', { hasText: '다중 시나리오 비교' }).first().getByRole('button', { name: '자세히' }).first().click();
await page.getByRole('button', { name: '이 결과 적용' }).click();
// 새 배정이 적용될 때까지 (샘플 점검의 예전 배정이 남아 있으므로 새 점수 이유로 확인)
const applied = await until(async () => (await db.collection(`sessions/${SID}/assignments`).get()).docs.some((d) => String(d.get('reason')).includes('별도시험장 우선')), 60000);
const docs = (await db.collection(`sessions/${SID}/assignments`).get()).docs;
const sepRooms = new Set((await db.collection('rooms').where('name', '==', '별도시험장').get()).docs.map((d) => d.id));
const sepSeats = docs.filter((d) => sepRooms.has(d.get('roomId')));
const byPick = sepSeats.filter((d) => picks.some((t) => t.id === d.get('teacherId')));
check('별도시험장 자리를 우선 교사가 맡음', applied && sepSeats.length > 0 && byPick.length === sepSeats.length, `${byPick.length} / ${sepSeats.length}자리`);
check('콘솔 오류 없음', errors.length === 0, errors.join(' / '));
await browser.close();
await db.doc(`sessions/${SID}`).set({ settings: { extendedPreferred: [] } }, { merge: true });
console.log(failures ? `\n실패 ${failures}건` : '\n모두 통과');
process.exit(failures ? 1 : 0);
