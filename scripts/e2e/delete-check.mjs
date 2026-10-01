// 사용자 보고 재현 + 프로젝트 삭제 점검:
// 1) 다른 이름의 기존 교사들이 담임을 맡고 있는 상태에서 새 프로젝트에 샘플 통합 양식 업로드 → 오류 없이 담임 넘김 안내
// 2) 저장 후 기존 교사의 담임이 풀림
// 3) 대시보드에서 프로젝트 삭제 → 하위 자료·이력까지 사라짐
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { go, openApp } from './session.mjs';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
const require = createRequire(import.meta.url);
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
initializeApp({ projectId: 'smart-invigilation' });
const db = getFirestore();
const TERM = { term: '삭제중학교|2026|2', school: '삭제중학교', year: 2026, semester: 2 }; // 학교·학기 명단

const OUT = 'scripts/e2e/out';
mkdirSync(OUT, { recursive: true });
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

// 기존 교사(예전 샘플)가 1-1 ~ 1-3반 담임
await db.recursiveDelete(db.collection('teachers'));
for (const [i, name] of ['김국어1', '김국어2', '박영어1'].entries()) {
  await db.doc(`teachers/T90${i}`).set({
    name, email: null, subject: null, homeroom: { grade: 1, classNo: i + 1 }, defaultRole: 'NORMAL', active: true, cumulativeLoad: 0, ...TERM, updatedBy: 'seed',
  });
}

const A = await openApp();
await go(A.page, '/admin');
await A.page.getByRole('button', { name: '+ 새 시험 프로젝트' }).click();
await A.page.getByLabel('학교명').fill('삭제중학교');
await A.page.getByLabel('시험명').fill('삭제 점검');
await A.page.getByRole('button', { name: '만들기' }).click();
await A.page.waitForURL(/\/admin\/sessions\/[^/]+$/);
const sid = A.page.url().split('/').pop();

const [dl] = await Promise.all([A.page.waitForEvent('download'), A.page.getByRole('button', { name: /샘플 양식/ }).click()]);
await dl.saveAs(`${OUT}/delete-sample.xlsx`);
await A.page.getByRole('button', { name: '통합 양식 업로드' }).click();
const up = A.page.getByRole('dialog', { name: '기초 자료 통합 양식 업로드' });
await up.locator('input[type=file]').setInputFiles(`${OUT}/delete-sample.xlsx`);
await up.getByText(/검증 결과/).waitFor();
const text = await up.innerText();
check('기존 담임과 겹쳐도 오류 없음', !/오류 [1-9]\d*건/.test(text), text.match(/오류 \d+건/)?.[0]);
check('담임 넘김 안내 표시', text.includes('1-1반 담임: 기존 김국어1'));
await up.getByRole('button', { name: '저장', exact: true }).click();
// 기존 자료가 있으면 유지/교체를 묻는다 → 유지
const keep = A.page.getByRole('button', { name: /기존 자료 유지/ });
if (await keep.isVisible({ timeout: 3000 }).catch(() => false)) await keep.click();
await up.getByText('저장했습니다.').waitFor({ timeout: 60000 });
const old = (await db.doc('teachers/T900').get()).get('homeroom');
check('저장 후 기존 교사 담임 해제', old === null);
await up.getByRole('button', { name: '닫기' }).first().click();

// 프로젝트 삭제 (이력이 남아 있게 일정 한 건 더 저장된 상태)
const before = (await db.collection(`sessions/${sid}/slots`).get()).size;
await go(A.page, '/admin');
await A.page.getByRole('button', { name: /삭제 점검 삭제$/ }).click();
const dlg = A.page.getByRole('dialog', { name: '시험 프로젝트 삭제' });
const del = dlg.getByRole('button', { name: '삭제', exact: true });
check('시험명 입력 전에는 삭제 버튼 비활성', await del.isDisabled());
await dlg.locator('input').fill('삭제 점검');
await del.click();
await A.page.getByRole('status').filter({ hasText: '삭제했습니다' }).waitFor({ timeout: 60000 });
await new Promise((r) => setTimeout(r, 4000)); // 늦게 도는 감사 트리거 기다림
const left = await db.doc(`sessions/${sid}`).listCollections();
const sizes = await Promise.all(left.map(async (c) => `${c.id}:${(await c.get()).size}`));
check(
  '삭제: 세션과 하위 자료 모두 사라짐',
  !(await db.doc(`sessions/${sid}`).get()).exists && sizes.every((s) => s.endsWith(':0')),
  `일정 ${before}건 → 남은 컬렉션 [${sizes.join(', ')}]`,
);
check('대시보드 목록에서 사라짐', (await A.page.getByRole('link', { name: /삭제 점검/ }).count()) === 0);
check('관리자 화면 콘솔 오류 없음', A.errors.length === 0, A.errors.join(' / '));
await A.browser.close();
process.exit(failures ? 1 : 0);
