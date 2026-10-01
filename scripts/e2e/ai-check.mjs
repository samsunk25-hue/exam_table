// AI 기능 점검 (에뮬레이터: 키가 없으면 가짜 응답) — swap-check 이후 실행 (E2E_SWAP 공개 상태 필요)
// 1) 문서에서 AI로 읽기 → 통합 양식 검증 창 → 저장 → 시험 일정·교사(담임) 저장
// 2) 업무 점수 탭 AI 공정성 리포트
// 3) 교사 화면 "왜 이렇게 배정됐나요?"
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { go, openApp } from './session.mjs';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
const require = createRequire(import.meta.url);
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
initializeApp({ projectId: 'smart-invigilation' });
const db = getFirestore();

mkdirSync('scripts/e2e/out', { recursive: true });
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

const SID = 'E2E_AI';
await db.recursiveDelete(db.doc(`sessions/${SID}`));
await db.doc(`sessions/${SID}`).set({
  schoolName: '점검중학교', year: 2026, semester: 2, examName: 'AI 점검', status: 'DRAFT',
  settings: { useBaseTimetable: false }, createdAt: new Date(), updatedBy: 'seed',
});
for (const d of (await db.collection('teachers').where('name', 'in', ['문서교사가', '문서교사나']).get()).docs) await d.ref.delete();

// 1. 문서에서 읽기
const A = await openApp();
await go(A.page, `/admin/sessions/${SID}`);
await A.page.getByRole('button', { name: '📄 학교 문서에서 AI로 읽기' }).click();
const dlg = A.page.getByRole('dialog', { name: '학교 문서에서 AI로 읽기' });
await dlg.getByLabel('문서 내용 붙여 넣기').fill('10월 12일 1교시 1학년 국어, 2학년 수학 / 문서교사가 국어 1-5 담임');
await dlg.getByRole('button', { name: 'AI로 읽기' }).click();
const review = A.page.getByRole('dialog', { name: 'AI가 읽은 자료 확인·저장' });
await review.getByRole('heading', { name: /검증 결과/ }).waitFor({ timeout: 60000 });
check('AI 결과 → 통합 양식 검증 창', (await review.innerText()).includes('시험 3건 · 교사 2명을 읽었습니다'));
await A.page.screenshot({ path: 'scripts/e2e/out/ai-extract.png' });
await review.getByRole('button', { name: '저장', exact: true }).click();
const keep = A.page.getByRole('button', { name: /기존 자료 유지/ });
if (await keep.isVisible({ timeout: 2000 }).catch(() => false)) await keep.click();
await review.getByText('저장했습니다.').waitFor({ timeout: 60000 });
const slots = (await db.collection(`sessions/${SID}/slots`).get()).size;
const t = (await db.collection('teachers').where('name', '==', '문서교사가').get()).docs[0]?.data();
check('읽은 시험 일정 저장 (자습 포함 3건)', slots === 3, `${slots}건`);
check('읽은 교사 저장 (이 학기, 1-5 담임)', t?.term === '점검중학교|2026|2' && t?.homeroom?.classNo === 5, JSON.stringify(t?.homeroom));
await review.getByRole('button', { name: '닫기' }).first().click();

// 2. 공정성 리포트 (E2E_SWAP: swap-check가 만든 공개 상태 프로젝트)
await go(A.page, '/admin/sessions/E2E_SWAP/equity');
await A.page.getByRole('button', { name: '리포트 만들기' }).click();
const ok2 = await A.page.getByText(/학년도 누적 평균/).waitFor({ timeout: 60000 }).then(() => true).catch(() => false);
check('AI 공정성 리포트 표시', ok2);
check('관리자 화면 콘솔 오류 없음', A.errors.length === 0, A.errors.join(' / '));
await A.browser.close();

// 3. 교사 설명
const K = await openApp({ email: 'kim@test.kr' });
await go(K.page, '/me');
await K.page.getByRole('button', { name: /교환 점검/ }).click({ timeout: 3000 }).catch(() => {});
await K.page.getByRole('button', { name: 'AI에게 설명 듣기' }).click();
const ok3 = await K.page.getByText(/김국어 선생님은 이번 시험에서 감독/).waitFor({ timeout: 60000 }).then(() => true).catch(() => false);
check('교사: 왜 이렇게 배정됐나요? 설명', ok3);
await K.page.screenshot({ path: 'scripts/e2e/out/ai-explain.png', fullPage: true });
check('교사 화면 콘솔 오류 없음', K.errors.length === 0, K.errors.join(' / '));
await K.browser.close();
await db.recursiveDelete(db.doc(`sessions/${SID}`));
process.exit(failures ? 1 : 0);
