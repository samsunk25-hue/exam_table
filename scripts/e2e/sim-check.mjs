// 가중치 시뮬레이션: 샘플 학교(E2E_SAMPLE, sample-check 이후)에서 "연속 감독 피하기"를 최대로 →
// 바로 다시 계산해 연속 감독이 줄어듦 → 그 설정으로 자동 배정 실행 → 사용자 가중치 실행 결과 저장
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { go, openApp } from './session.mjs';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
const require = createRequire(import.meta.url);
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
initializeApp({ projectId: 'smart-invigilation' });
const db = getFirestore();

const OUT = 'scripts/e2e/out';
mkdirSync(OUT, { recursive: true });
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const SID = 'E2E_SAMPLE';

const A = await openApp();
await go(A.page, `/admin/sessions/${SID}/assign`);
await A.page.getByRole('heading', { name: '가중치 시뮬레이션' }).waitFor();
const table = A.page.getByRole('table', { name: '시뮬레이션 결과' });
const row = (label) => table.locator('tr', { hasText: label });
const num = async (label, col) => Number((await row(label).locator('td').nth(col).innerText()).match(/[\d.]+/)?.[0] ?? NaN);

await A.page.getByLabel('연속 감독 피하기').fill('300');
await row('연속 감독').locator('td').nth(2).getByText(/쌍/).waitFor({ timeout: 15000 });
const base = await num('연속 감독', 1);
const tuned = await num('연속 감독', 2);
check('슬라이더 → 바로 다시 계산 (연속 감독 줄어듦)', tuned <= base, `${base}쌍 → ${tuned}쌍`);
check('배정 성공률 유지', (await num('배정 성공률', 2)) >= 99, `${await num('배정 성공률', 2)}%`);
await A.page.screenshot({ path: `${OUT}/sim.png`, fullPage: true });

const before = (await db.collection(`sessions/${SID}/runs`).get()).size;
await A.page.getByRole('button', { name: '이 설정으로 자동 배정 실행' }).click();
await A.page.getByRole('status').filter({ hasText: '조정한 가중치로 실행했습니다' }).last().waitFor({ timeout: 60000 });
const runs = (await db.collection(`sessions/${SID}/runs`).get()).docs.map((d) => d.data());
const custom = runs.find((r) => r.scenario === 'CUSTOM');
check('사용자 가중치 실행 결과 저장', runs.length === before + 1 && custom?.scenarioDescription?.includes('연속 감독 -300'), custom?.scenarioDescription);
check('콘솔 오류 없음', A.errors.length === 0, A.errors.join(' / '));
await A.browser.close();
process.exit(failures ? 1 : 0);
