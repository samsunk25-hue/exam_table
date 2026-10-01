// 단순화 점검:
// (3) 4단계 탭 + 다음 할 일, (1) 시험 일정 한 화면, (5) 진행 4단계, (2) 머리글 학교·학기
// (6) 새 프로젝트에서 지난 학기 명단 이어받기, (4) 자동 배정하고 바로 적용, (7) 교사 제출 바로 반영
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { go, openApp } from './session.mjs';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
const require = createRequire(import.meta.url);
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
initializeApp({ projectId: 'smart-invigilation' });
const db = getFirestore();
const TERM = { term: '점검중학교|2026|2', school: '점검중학교', year: 2026, semester: 2 };

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

const SID = 'E2E_SIMPLE';
await db.recursiveDelete(db.doc(`sessions/${SID}`));
await db.doc(`sessions/${SID}`).set({
  schoolName: '점검중학교', year: 2026, semester: 2, examName: '단순화 점검', status: 'DRAFT',
  settings: { useBaseTimetable: false }, createdAt: new Date(Date.now() + 900_000), updatedBy: 'seed',
});
const A = await openApp();

// (3)(5) 빈 프로젝트: 4단계 탭, 진행 4단계, 다음 할 일 = 시험 일정 입력
await go(A.page, `/admin/sessions/${SID}`);
const steps = await A.page.getByRole('navigation', { name: '시험 프로젝트 단계' }).innerText();
check('4단계 탭 (준비·배정·점검·공개·출력)', ['① 준비', '② 배정', '③ 점검', '④ 공개·출력'].every((x) => steps.includes(x)));
check('진행 상태는 단계 탭에 함께 (중복 단계표 없음)', steps.includes('진행 중') && (await A.page.locator('ol').count()) === 0 && (await A.page.getByText('현재 상태').isVisible()));
const next = A.page.getByLabel('다음 할 일');
const nextText = await next.innerText();
check('다음 할 일: 준비 순서(교사 → 시험실 → 시험 일정) 중 하나', ['교사 명단 입력하기', '시험실 등록하기', '시험 일정 입력하기'].some((x) => nextText.includes(x)), nextText.replace(/\s+/g, ' '));
const prep = await A.page.getByRole('navigation', { name: '시험 프로젝트 메뉴' }).innerText().catch(() => '');
check('준비 탭 순서: 교사 명단 → 시험실 → 시험 일정', prep.indexOf('교사 명단') < prep.indexOf('시험실') && prep.indexOf('시험실') < prep.indexOf('시험 일정'), prep.replace(/\s+/g, ' '));
await go(A.page, `/admin/sessions/${SID}/schedule`);
await A.page.getByRole('button', { name: '시험 시간표 표로 입력' }).waitFor();
check('(1) 시험 일정 한 화면: 달력 하나 (중복 시험 목록·배치 표 없음)', (await A.page.getByText('시험별 시험실 배치').count()) === 0);
await A.page.screenshot({ path: 'scripts/e2e/out/simplify-schedule.png', fullPage: true });

// (2) 학교·학기 선택 없음: 교사·시험실은 프로젝트 안에서 그 학기 명단
await go(A.page, '/admin');
check('(2) 대시보드에 학교·학기 선택 없음', (await A.page.getByLabel('학교·학기').count()) === 0);
await go(A.page, `/admin/sessions/${SID}/teachers`);
check('준비 > 교사 명단 = 프로젝트 학기 명단', await A.page.getByText('점검중학교 · 2026학년도 2학기').first().isVisible());
await go(A.page, `/admin/sessions/${SID}/schedule`);
const topNav = await A.page.getByRole('navigation', { name: '주 메뉴' }).innerText();
check('상단 메뉴는 대시보드·관리자 관리만', !topNav.includes('시험일정 관리') && !topNav.includes('교사 관리') && !topNav.includes('시험실 관리'), topNav.replace(/\s+/g, ' '));

// (4) 시험 1건 넣고 → 자동 배정하고 바로 적용
await db.doc('rooms/RSIM').set({ name: '단순-1', spaceType: 'CLASSROOM', grade: 1, classNo: 1, chiefCount: 1, assistantCount: 0, ...TERM, updatedBy: 'seed' });
await db.doc(`sessions/${SID}/slots/2026-10-12_1_1`).set({
  date: '2026-10-12', period: 1, grade: 1, subject: '과학', type: 'EXAM', startTime: '09:00', endTime: '09:45',
  rooms: [{ roomId: 'RSIM', classNo: 1, headcount: null, roomType: 'NORMAL' }], updatedBy: 'seed',
});
await go(A.page, `/admin/sessions/${SID}/assign`);
await A.page.getByRole('button', { name: '자동 배정하고 바로 적용' }).waitFor();
check('자동 배정 화면: 수동 배정 유지·대안 토글 없음', (await A.page.getByText('수동 배정 유지').count()) === 0 && (await A.page.getByText('대안 시나리오 3개도').count()) === 0);
check('배정 설정·고려사항이 자동 배정 화면에', await A.page.getByRole('heading', { name: '배정 설정' }).isVisible());
await A.page.getByRole('button', { name: '자동 배정하고 바로 적용' }).click();
const applied = await until(async () => (await db.collection(`sessions/${SID}/assignments`).get()).size === 1, 60000);
const status = (await db.doc(`sessions/${SID}`).get()).get('status');
check('(4) 자동 배정하고 바로 적용 → 배정 1석, 배정 완료', applied && status === 'AUTO_ASSIGNED', status);
await go(A.page, `/admin/sessions/${SID}`);
check('다음 할 일: 바로 교사에게 공개 (검토 단계 버튼 없음)', (await A.page.getByLabel('다음 할 일').innerText()).includes('교사에게 공개하기') && (await A.page.getByRole('button', { name: '검토 시작', exact: true }).count()) === 0);

// (7) 교사 제출 바로 반영
await go(A.page, `/admin/sessions/${SID}/availability`);
await A.page.getByText('시간대별 인력 현황').waitFor({ timeout: 15000 });
check('(7) "교사 제출 바로 반영" 스위치 없음 (늘 바로 반영)', (await A.page.getByText('교사 제출 바로 반영').count()) === 0);
const K = await openApp({ email: 'kim@test.kr' });
await go(K.page, '/me/availability');
await K.page.getByRole('button', { name: /단순화 점검/ }).click({ timeout: 3000 }).catch(() => {});
await K.page.getByRole('button', { name: /^1교시/ }).first().click();
await K.page.getByRole('button', { name: '연수', exact: true }).click();
await K.page.getByRole('button', { name: '1칸 제출' }).click();
const auto = await until(async () => (await db.collection(`sessions/${SID}/availability`).get()).docs.some((d) => d.get('status') === 'APPROVED' && d.get('adminNote') === '자동 반영'));
check('(7) 교사 제출 → 바로 반영(승인)', auto);
await K.browser.close();

// (6) 새 프로젝트: 지난 학기 명단 이어받기 (점검중학교 2027학년도 1학기)
for (const d of (await db.collection('teachers').where('term', '==', '점검중학교|2027|1').get()).docs) await d.ref.delete();
await go(A.page, '/admin');
await A.page.getByRole('button', { name: '+ 새 시험 프로젝트' }).click();
await A.page.getByLabel('학교명').fill('점검중학교');
await A.page.getByLabel('학년도', { exact: true }).fill('2027');
await A.page.getByLabel('학기', { exact: true }).fill('1');
await A.page.getByLabel('시험명').fill('이어받기 점검');
const carry = A.page.getByText(/지난 학기 명단을 자동으로 이어받습니다 — 점검중학교 · 2026학년도 2학기/);
check('(6) 지난 학기 명단 자동 이어받기 안내 (체크박스·기초시간표 스위치 없음)', (await carry.waitFor({ timeout: 10000 }).then(() => true).catch(() => false)) && (await A.page.getByRole('checkbox').count()) === 0);
await A.page.getByRole('button', { name: '만들기' }).click();
await A.page.waitForURL(/\/admin\/sessions\/[^/]+$/);
const newSid = A.page.url().split('/').pop();
const carried = await until(async () => (await db.collection('teachers').where('term', '==', '점검중학교|2027|1').get()).size > 0);
const sample = (await db.collection('teachers').where('term', '==', '점검중학교|2027|1').get()).docs[0]?.data();
check('(6) 새 학기로 교사 이어받음 (새 학년도라 누적 0)', carried && sample?.cumulativeLoad === 0, `${(await db.collection('teachers').where('term', '==', '점검중학교|2027|1').get()).size}명`);
check('콘솔 오류 없음', A.errors.length === 0, A.errors.join(' / '));
await A.browser.close();

// 정리
for (const d of (await db.collection('teachers').where('term', '==', '점검중학교|2027|1').get()).docs) await d.ref.delete();
for (const d of (await db.collection('rooms').where('term', '==', '점검중학교|2027|1').get()).docs) await d.ref.delete();
for (const id of [SID, newSid]) if (id) await db.recursiveDelete(db.doc(`sessions/${id}`));
process.exit(failures ? 1 : 0);
