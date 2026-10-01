// 전체 흐름 점검 (실제 학교 운영 순서, 빈 에뮬레이터에서):
// 프로젝트 생성 → 샘플 통합 양식 → 교사 불가시간 → 승인 → 자동 배정·적용 → 검토 → 교사 공개
// → 교사 확인 → 최종 확정(누적 점수) → 변경 잠금 → 잠금 해제(사유) → 확정 후 변경(사유) → 변경 이력
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
// 단계 전환: 버튼 → (사유) → 확인, 그리고 DB 상태가 실제로 바뀔 때까지 기다린다
const step = async (adminPage, label, expect, reason) => {
  await go(adminPage, `/admin/sessions/${sid}`);
  await adminPage.getByRole('button', { name: label, exact: true }).click();
  if (reason) await adminPage.locator('textarea').fill(reason);
  await adminPage.getByRole('button', { name: '확인', exact: true }).click();
  for (let i = 0; i < 60; i++) {
    if ((await db.doc(`sessions/${sid}`).get()).get('status') === expect) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  const alert = await adminPage.locator('main').innerText();
  throw new Error(`"${label}" 후 상태가 ${expect}가 아님. 화면: ${alert.slice(0, 300)}`);
};

// 빈 학교에서 시작
for (const col of ['teachers', 'rooms', 'loadLedger']) await db.recursiveDelete(db.collection(col));

const A = await openApp();
// 1. 새 시험 프로젝트
await go(A.page, '/admin');
await A.page.getByRole('button', { name: '+ 새 시험 프로젝트' }).click();
await A.page.getByLabel('학교명').fill('흐름중학교');
await A.page.getByLabel('시험명').fill('2학기 기말고사');
await A.page.getByRole('button', { name: '만들기' }).click();
await A.page.waitForURL(/\/admin\/sessions\/[^/]+$/);
const sid = A.page.url().split('/').pop();
check('1. 시험 프로젝트 생성', Boolean(sid), sid);

// 2. 샘플 통합 양식 → 그대로 업로드
const [dl] = await Promise.all([A.page.waitForEvent('download'), A.page.getByRole('button', { name: /샘플 양식/ }).click()]);
await dl.saveAs(`${OUT}/flow-sample.xlsx`);
await A.page.getByRole('button', { name: '통합 양식 업로드' }).click();
const up = A.page.getByRole('dialog', { name: '기초 자료 통합 양식 업로드' });
await up.locator('input[type=file]').setInputFiles(`${OUT}/flow-sample.xlsx`);
await up.getByText(/검증 결과/).waitFor();
await up.getByRole('button', { name: '저장', exact: true }).click();
await up.getByText('저장했습니다.').waitFor({ timeout: 60000 });
await up.getByRole('button', { name: '닫기' }).first().click();
await A.page.getByText('자동 배정을 실행할 준비가 되었습니다').waitFor();
check('2. 기초 자료 입력 → 점검 통과', true);

// 3. 교사(김민준 t01) 불가시간 제출 → 관리자 승인
const T = await openApp({ email: 't01@sample.school.kr' });
await go(T.page, '/me/availability');
await T.page.getByRole('button', { name: /^1교시/ }).first().click();
await T.page.getByRole('button', { name: '출장', exact: true }).click();
await T.page.getByRole('button', { name: '1칸 제출' }).click();
await T.page.getByRole('status').filter({ hasText: '제출했습니다' }).waitFor();
await go(A.page, `/admin/sessions/${sid}/availability`);
await A.page.getByRole('button', { name: '대기 1건 모두 승인' }).click();
await A.page.getByRole('status').filter({ hasText: '승인했습니다' }).waitFor();
check('3. 교사 불가시간 제출 → 관리자 승인', true);

// 4. 자동 배정(대안 포함) → 기본안 적용
await go(A.page, `/admin/sessions/${sid}/assign`);
await A.page.getByRole('button', { name: '자동 배정 실행', exact: true }).click();
await A.page.getByText('다중 시나리오 비교').waitFor({ timeout: 90000 });
await A.page.getByRole('button', { name: '이 결과 적용' }).click();
await A.page.getByText('현재 적용됨').waitFor({ timeout: 60000 });
const t01 = (await db.collection('teachers').where('email', '==', 't01@sample.school.kr').get()).docs[0].id;
const firstDate = (await db.collection(`sessions/${sid}/slots`).orderBy('date').limit(1).get()).docs[0].get('date');
const clash = await db.collection(`sessions/${sid}/assignments`).where('teacherId', '==', t01).where('date', '==', firstDate).where('period', '==', 1).get();
check('4. 자동 배정 적용 (불가시간 지킴)', clash.empty);

// 5. 검토 → 교사 공개 → 교사 화면
await step(A.page, '검토 시작', 'REVIEW');
await step(A.page, '교사에게 공개', 'PUBLISHED');
await go(T.page, '/me');
await T.page.getByText(/감독 \d+회/).waitFor();
check('5. 교사 공개 → 교사가 내 시간표 확인', (await T.page.getByText('초안 공개').count()) > 0);

// 6. 최종 확정 → 누적 점수 반영
await step(A.page, '최종 확정', 'CONFIRMED');
await new Promise((r) => setTimeout(r, 1500));
const ledger = await db.collection('loadLedger').where('sessionId', '==', sid).get();
const teacherLoad = (await db.doc(`teachers/${t01}`).get()).get('cumulativeLoad');
check('6. 최종 확정 → 누적 업무점수 적립', ledger.size > 20 && teacherLoad > 0, `적립 ${ledger.size}명, 김민준 ${teacherLoad}점`);

// 7. 확정 후 변경은 사유 필수 → 사유 입력 후 변경
await go(A.page, `/admin/sessions/${sid}/editor`);
await A.page.locator('tr', { hasText: '1-1' }).first().locator('button').first().click();
const ed = A.page.getByRole('dialog', { name: '감독 배정 편집' });
await ed.getByRole('button', { name: '배정', exact: true }).first().click();
await A.page.getByRole('status').filter({ hasText: '사유를 입력해야' }).waitFor();
await ed.locator('input').first().fill('출장 변경');
await ed.getByRole('button', { name: '배정', exact: true }).first().click();
await A.page.getByRole('status').filter({ hasText: '바꿨습니다' }).waitFor({ timeout: 30000 });
check('7. 확정 후 변경: 사유 없으면 막고, 사유 입력 후 저장', true);

// 8. 변경 잠금 → 편집 불가 → 잠금 해제(사유)
await step(A.page, '변경 잠금', 'LOCKED');
await go(A.page, `/admin/sessions/${sid}/editor`);
await A.page.getByText('변경 잠금 상태입니다').waitFor();
check('8. 변경 잠금 → 시간표 편집 막힘', true);
await step(A.page, '잠금 해제', 'CONFIRMED', '오류 수정');
check('9. 잠금 해제(사유) → 최종 확정으로', (await db.doc(`sessions/${sid}`).get()).get('status') === 'CONFIRMED');

// 10. 변경 이력
await go(A.page, `/admin/sessions/${sid}/history`);
await A.page.locator('tr', { hasText: '출장 변경' }).first().waitFor({ timeout: 20000 });
const hist = await A.page.locator('main').innerText();
check('10. 변경 이력: 단계 변경·확정 후 변경(사유) 기록', hist.includes('단계 변경') && hist.includes('출장 변경') && hist.includes('오류 수정'));

check('관리자 화면 콘솔 오류 없음', A.errors.length === 0, A.errors.join(' / '));
check('교사 화면 콘솔 오류 없음', T.errors.length === 0, T.errors.join(' / '));
await A.browser.close();
await T.browser.close();
process.exit(failures ? 1 : 0);
