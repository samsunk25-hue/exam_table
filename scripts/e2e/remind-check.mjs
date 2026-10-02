// 감독 10분 전 앱 알림: 출력 화면에서 학생 안내사항 저장 → 알림 작업 실행 → 교사 🔔에 교시·학년반·역할·안내사항, 두 번 돌려도 한 번만
// 실행: node scripts/e2e/remind-check.mjs (에뮬레이터 + npm run seed 이후, functions 빌드 필요)
import { createRequire } from 'node:module';
import { go, openApp } from './session.mjs';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
const require = createRequire(import.meta.url);
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
initializeApp({ projectId: 'smart-invigilation' });
const db = getFirestore();
// 1분마다 도는 함수와 같은 코드를 따로 묶어 직접 부른다 (함수 빌드는 index.js 하나로 묶여 있음)
const { execSync } = require('node:child_process');
execSync('npx esbuild src/reminders.ts --bundle --platform=node --format=cjs --outfile=../scripts/e2e/out/_reminders.cjs --external:firebase-admin --external:firebase-functions --log-level=error', { cwd: 'functions' });
const { sendDueReminders } = require('./out/_reminders.cjs');
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

// 오늘(한국 시간) 지금부터 8분 뒤 시작하는 1교시 시험, 김국어(T001) 정감독
const now = new Date();
const k = new Date(now.getTime() + 9 * 3600_000 + 8 * 60_000);
const today = k.toISOString().slice(0, 10);
const hm = (d) => d.toISOString().slice(11, 16);
const start = hm(k);
const end = hm(new Date(k.getTime() + 45 * 60_000));
const TERM = { term: '점검중학교|2026|2', school: '점검중학교', year: 2026, semester: 2 };
const SID = 'E2E_REMIND';
const SLOT = `${today}_1_1`;
await db.recursiveDelete(db.doc(`sessions/${SID}`));
await db.doc('rooms/RRM').set({ name: '1-7', spaceType: 'CLASSROOM', grade: 1, classNo: 7, chiefCount: 1, assistantCount: 1, ...TERM, updatedBy: 'seed' });
await db.doc(`sessions/${SID}`).set({
  schoolName: '점검중학교', year: 2026, semester: 2, examName: '알림 점검', status: 'PUBLISHED',
  settings: { useBaseTimetable: false }, createdAt: new Date(), ...TERM, updatedBy: 'seed',
});
await db.doc(`sessions/${SID}/slots/${SLOT}`).set({
  date: today, period: 1, startTime: start, endTime: end, grade: 1, subject: '국어', type: 'EXAM',
  rooms: [{ roomId: 'RRM', classNo: 7, headcount: null, roomType: 'NORMAL' }], ...TERM, updatedBy: 'seed',
});
await db.doc(`sessions/${SID}/assignments/${SLOT}__RRM_CHIEF_1`).set({
  slotId: SLOT, groupId: `${SLOT}__RRM`, roomId: 'RRM', role: 'CHIEF', weight: 1, teacherId: 'T001', score: 0, reason: '점검',
  source: 'AUTO', date: today, period: 1, runId: null,
});
const reminder = db.doc(`notifications/remind_${SID}_${SLOT}__RRM_CHIEF_1`);
await reminder.delete().catch(() => {});

// 1. 관리자: 출력 화면에서 학생 안내사항 저장
const A = await openApp();
await go(A.page, `/admin/sessions/${SID}/print`);
await A.page.getByLabel('학생 안내사항').fill('휴대폰은 전원을 끄고 가방에');
await A.page.getByRole('button', { name: '저장', exact: true }).click();
check('학생 안내사항 저장', await until(async () => (await db.doc(`sessions/${SID}`).get()).get('studentNotice') === '휴대폰은 전원을 끄고 가방에'));
check('관리자 화면 콘솔 오류 없음', A.errors.length === 0, A.errors.join(' / '));
await A.browser.close();

// 2. 알림 작업 (1분마다 도는 함수와 같은 코드)
const sent1 = await sendDueReminders(now);
const sent2 = await sendDueReminders(now);
const n = (await reminder.get()).data();
check('10분 안 감독에게 알림 1건, 다시 돌려도 중복 없음', n && sent2 === 0 && sent1 >= 1, `처음 ${sent1}건, 다시 ${sent2}건`);
check('제목: 몇 분 뒤 · 교시 · 학년반 · 역할', /^\d+분 뒤 감독: 1교시 1-7 정감독$/.test(n?.title ?? ''), n?.title);
check('내용: 시간·과목, 학생 안내사항', String(n?.body).includes(`${start}~${end}`) && String(n?.body).includes('학생 안내: 휴대폰은 전원을 끄고 가방에'), String(n?.body).replace(/\n/g, ' / '));

// 3. 교사 화면 🔔
const K = await openApp({ email: 'kim@test.kr' });
await K.page.getByRole('button', { name: /^알림/ }).first().click();
const panel = K.page.getByRole('dialog', { name: '알림' });
check('교사 🔔에 감독 알림', await panel.getByText(/분 뒤 감독: 1교시 1-7 정감독/).waitFor({ timeout: 15000 }).then(() => true).catch(() => false));
check('교사 화면 콘솔 오류 없음', K.errors.length === 0, K.errors.join(' / '));
await K.browser.close();

await reminder.delete().catch(() => {});
await db.recursiveDelete(db.doc(`sessions/${SID}`));
await db.doc('rooms/RRM').delete();
console.log(failures ? `\n실패 ${failures}건` : '\n모두 통과');
process.exit(failures ? 1 : 0);
