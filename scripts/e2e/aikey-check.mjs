// 내 AI 키: 등록 → 끝 4자리만 표시, 키는 비공개 저장소(aiKeys)에만 → 삭제
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
const KEY = 'sk-ant-test-abcdefghijklmnopqrstuvwxyz9876';
const A = await openApp();
await go(A.page, '/admin/admins');
const ui = A.page.getByRole('heading', { name: '🔑 내 AI 키 (Claude)' }).locator('..');
if (await ui.getByRole('button', { name: '삭제' }).isVisible().catch(() => false)) await ui.getByRole('button', { name: '삭제' }).click();
check('잘못된 형식은 거절', await (async () => {
  await ui.getByLabel('Claude API 키').fill('abc');
  await ui.getByRole('button', { name: '등록' }).click();
  return ui.getByText(/키 형식이 아닙니다/).waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
})());
await ui.getByLabel('Claude API 키').fill(KEY);
await ui.getByRole('button', { name: '등록' }).click();
await ui.getByText('등록됨 · sk-ant-…9876').waitFor({ timeout: 15000 });
check('등록 → 끝 4자리만 표시', !(await ui.innerText()).includes('abcdefghij'));
const keys = (await db.collection('aiKeys').get()).docs.map((d) => d.get('key'));
check('키는 비공개 저장소(aiKeys)에 저장', keys.includes(KEY));
await ui.getByRole('button', { name: '삭제' }).click();
await ui.getByLabel('Claude API 키').waitFor({ timeout: 15000 });
check('삭제 → 저장소에서도 사라짐', !(await db.collection('aiKeys').get()).docs.some((d) => d.get('key') === KEY));
// 잘못된 형식 키를 서버가 거절한 응답(400)은 의도한 것
const errs = A.errors.filter((e) => !e.includes('status of 400'));
check('콘솔 오류 없음', errs.length === 0, errs.join(' / '));
await A.browser.close();
process.exit(failures ? 1 : 0);
