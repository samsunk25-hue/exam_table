// AI 기능 점검 (에뮬레이터: 키가 없으면 가짜 응답) — swap-check 이후 실행 (E2E_SWAP 공개 상태 필요)
// 1) 문서에서 AI로 읽기 → 통합 양식 검증 창 → 저장 → 시험 일정·교사(담임)·기초시간표 저장
// 2) 관리자 업무 점수 화면 "교사별 배정 이유", 교사 화면에는 없음
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
check('읽을 자료: 시험 일정·교사 명단·기초시간표 모두 기본 선택', (await dlg.getByRole('button', { pressed: true }).count()) === 3);
await dlg.getByLabel('문서 내용 붙여 넣기').fill('10월 12일 1교시 1학년 국어, 2학년 수학 / 문서교사가 국어 1-5 담임');
await dlg.getByRole('button', { name: 'AI로 읽기' }).click();
const review = A.page.getByRole('dialog', { name: 'AI가 읽은 자료 확인·저장' });
await review.getByRole('heading', { name: /검증 결과/ }).waitFor({ timeout: 60000 });
await review.getByText(/을 읽었습니다/).first().waitFor({ timeout: 10000 }).catch(() => {});
const reviewText = await review.innerText();
check('AI 결과 → 통합 양식 검증 창', reviewText.includes('시험 3건 · 교사 2명 · 기초시간표 교사 1명(수업 3건)을 읽었습니다'), reviewText.replace(/s+/g, ' ').slice(0, 600));
check('기초시간표 전체 교체 안내', reviewText.includes('기초시간표 전체가 읽은 내용으로 바뀝니다'));
await A.page.screenshot({ path: 'scripts/e2e/out/ai-extract.png' });
await review.getByRole('button', { name: '저장', exact: true }).click();
const keep = A.page.getByRole('button', { name: /기존 자료 유지/ });
if (await keep.isVisible({ timeout: 2000 }).catch(() => false)) await keep.click();
await review.getByText('저장했습니다.').waitFor({ timeout: 60000 });
const slots = (await db.collection(`sessions/${SID}/slots`).get()).size;
const t = (await db.collection('teachers').where('name', '==', '문서교사가').get()).docs[0]?.data();
check('읽은 시험 일정 저장 (자습 포함 3건)', slots === 3, `${slots}건`);
check('읽은 교사 저장 (이 학기, 1-5 담임)', t?.term === '점검중학교|2026|2' && t?.homeroom?.classNo === 5, JSON.stringify(t?.homeroom));
const tId = (await db.collection('teachers').where('name', '==', '문서교사가').get()).docs[0]?.id;
const tt = tId ? (await db.doc(`sessions/${SID}/baseTimetable/${tId}`).get()).get('entries') : null;
check('읽은 기초시간표 저장 (월1 1-5 국어 등 3칸)', tt?.length === 3 && tt.some((e) => e.weekday === 1 && e.period === 1 && e.grade === 1 && e.classNo === 5 && e.subject === '국어'), JSON.stringify(tt));
await review.getByRole('button', { name: '닫기' }).first().click();

check('관리자 화면 콘솔 오류 없음', A.errors.length === 0, A.errors.join(' / '));
await A.browser.close();

// 2. 배정 이유 설명: 관리자만 (업무 점수 화면에서 교사를 골라), 교사 화면에는 없음
const B = await openApp();
await go(B.page, '/admin/sessions/E2E_SWAP/equity');
await B.page.getByLabel('설명할 교사').selectOption({ label: '김국어' });
await B.page.getByRole('button', { name: 'AI에게 설명 듣기' }).click();
const ok3 = await B.page.getByText(/김국어 선생님은 이번 시험에서 감독/).waitFor({ timeout: 60000 }).then(() => true).catch(() => false);
check('관리자: 교사를 골라 배정 이유 설명', ok3);
await B.page.screenshot({ path: 'scripts/e2e/out/ai-explain.png', fullPage: true });
check('관리자 화면 콘솔 오류 없음 (설명)', B.errors.length === 0, B.errors.join(' / '));
await B.browser.close();
const K = await openApp({ email: 'kim@test.kr' });
await go(K.page, '/me');
await K.page.getByText(/내 감독|감독 시간표/).first().waitFor({ timeout: 20000 }).catch(() => {});
check('교사 화면에는 AI 설명 없음', (await K.page.getByRole('button', { name: 'AI에게 설명 듣기' }).count()) === 0);
check('교사 화면 콘솔 오류 없음', K.errors.length === 0, K.errors.join(' / '));
await K.browser.close();
await db.recursiveDelete(db.doc(`sessions/${SID}`));
process.exit(failures ? 1 : 0);
