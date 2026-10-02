// 자동 배정: 직접 정한 배정을 그대로 둘지 / 모두 다시 배정할지 고르기 (assign-check → editor-check 다음에, E2E_ASSIGN)
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
const until = async (fn, ms = 60000) => {
  for (let t = 0; t < ms; t += 500) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
};

const SID = 'E2E_ASSIGN';
const col = db.collection(`sessions/${SID}/assignments`);
const manual = async () => (await col.where('source', '==', 'MANUAL').get()).size;
// 직접 정한 배정이 하나는 있게
if ((await manual()) === 0) {
  const first = (await col.limit(1).get()).docs[0];
  await first.ref.update({ source: 'MANUAL' });
}
const before = await manual();

const { browser, page, errors } = await openApp();
await go(page, `/admin/sessions/${SID}/assign`);
const keep = page.getByRole('radio', { name: /그대로 두고 나머지만 다시 배정/ });
const all = page.getByRole('radio', { name: /모두 다시 배정/ });
await keep.waitFor();
check('직접 정한 배정이 있으면 고르기가 보이고 기본은 "그대로 두기"', (await keep.isChecked()) && !(await all.isChecked()), `직접 정한 배정 ${before}석`);
await all.check();
await page.getByRole('button', { name: '자동 배정하고 바로 적용' }).click();
check('"모두 다시 배정" → 직접 정한 배정 없음', await until(async () => (await manual()) === 0), `${await manual()}석 남음`);
check('콘솔 오류 없음', errors.length === 0, errors.join(' / '));
await browser.close();
console.log(failures ? `\n실패 ${failures}건` : '\n모두 통과');
process.exit(failures ? 1 : 0);
