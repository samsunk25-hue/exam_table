// Firestore 보안 규칙 테스트. `npm run test:rules -w functions` (Java 필요, 에뮬레이터 자동 실행)
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

let env: RulesTestEnvironment;

const admin = () => env.authenticatedContext('admin', { role: 'ADMIN' }).firestore();
const kim = () => env.authenticatedContext('kim', { role: 'TEACHER', teacherId: 'T001' }).firestore();
const stranger = () => env.authenticatedContext('stranger', {}).firestore();

async function seed(status: string) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'sessions/S1'), { status, updatedBy: 'admin' });
    await setDoc(doc(db, 'sessions/S1/assignments/A1'), { teacherId: 'T001', weight: 1 });
    await setDoc(doc(db, 'sessions/S1/availability/V2'), { teacherId: 'T002', status: 'PENDING', source: 'TEACHER' });
    await setDoc(doc(db, 'teachers/T001'), { name: '김교사', updatedBy: 'admin' });
  });
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-rules',
    firestore: { rules: readFileSync(resolve(__dirname, '../../../firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
afterAll(() => env.cleanup());
beforeEach(() => env.clearFirestore());

describe('역할', () => {
  it('역할이 없는 사용자는 아무것도 읽을 수 없다', async () => {
    await seed('DRAFT');
    await assertFails(getDoc(doc(stranger(), 'sessions/S1')));
    await assertFails(getDoc(doc(stranger(), 'teachers/T001')));
  });

  it('관리자 목록은 관리자만 읽고, 아무도 직접 쓸 수 없다', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'admins/a@school.kr'), { email: 'a@school.kr' }));
    await assertSucceeds(getDoc(doc(admin(), 'admins/a@school.kr')));
    await assertFails(getDoc(doc(kim(), 'admins/a@school.kr')));
    await assertFails(setDoc(doc(admin(), 'admins/b@school.kr'), { email: 'b@school.kr', updatedBy: 'admin' }));
  });

  it('관리자 쓰기는 updatedBy가 본인이어야 한다', async () => {
    await assertSucceeds(setDoc(doc(admin(), 'rooms/R1'), { name: '1-1', updatedBy: 'admin' }));
    await assertFails(setDoc(doc(admin(), 'rooms/R2'), { name: '1-2', updatedBy: 'someone' }));
    await assertFails(setDoc(doc(kim(), 'rooms/R3'), { name: '1-3', updatedBy: 'kim' }));
  });
});

describe('가입·권한 신청', () => {
  const newbie = () => env.authenticatedContext('nb', { email: 'NB@test.kr' }).firestore();
  const req = { uid: 'nb', email: 'nb@test.kr', name: '신규', subject: null, kind: 'TEACHER', status: 'PENDING', note: null };

  it('본인 신청만 대기 상태로 쓸 수 있고, 승인 상태로는 쓸 수 없다', async () => {
    await assertSucceeds(setDoc(doc(newbie(), 'accessRequests/nb'), req));
    await assertFails(setDoc(doc(newbie(), 'accessRequests/other'), { ...req, uid: 'other' }));
    await assertFails(setDoc(doc(newbie(), 'accessRequests/nb'), { ...req, status: 'APPROVED' }));
    await assertFails(setDoc(doc(newbie(), 'accessRequests/nb'), { ...req, email: 'someone@else.kr' }));
  });

  it('신청 목록은 관리자만 볼 수 있다', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'accessRequests/nb'), req));
    await assertSucceeds(getDoc(doc(admin(), 'accessRequests/nb')));
    await assertFails(getDoc(doc(kim(), 'accessRequests/nb')));
  });
});

describe('되돌리기 기록', () => {
  const op = { label: '교사 수정', kind: 'DATA', sessionId: null, paths: ['teachers/T001'], count: 1, createdBy: 'admin', undone: false };

  it('관리자는 본인 이름으로 새 기록만 남기고, 고치거나 지울 수 없다', async () => {
    await assertSucceeds(setDoc(doc(admin(), 'undoOps/O1'), op));
    await assertFails(setDoc(doc(admin(), 'undoOps/O2'), { ...op, createdBy: 'someone' }));
    await assertFails(setDoc(doc(admin(), 'undoOps/O3'), { ...op, undone: true }));
    await assertFails(updateDoc(doc(admin(), 'undoOps/O1'), { undone: true }));
    await assertFails(deleteDoc(doc(admin(), 'undoOps/O1')));
  });

  it('교사는 기록을 읽거나 쓸 수 없다', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'undoOps/O1'), op));
    await assertFails(getDoc(doc(kim(), 'undoOps/O1')));
    await assertFails(setDoc(doc(kim(), 'undoOps/O9'), { ...op, createdBy: 'kim' }));
  });
});

describe('세션 상태', () => {
  it('관리자는 DRAFT로만 세션을 만들고, 상태 필드는 직접 바꿀 수 없다', async () => {
    await assertSucceeds(setDoc(doc(admin(), 'sessions/S9'), { status: 'DRAFT', updatedBy: 'admin' }));
    await assertFails(setDoc(doc(admin(), 'sessions/S8'), { status: 'LOCKED', updatedBy: 'admin' }));
    await assertFails(updateDoc(doc(admin(), 'sessions/S9'), { status: 'PUBLISHED', updatedBy: 'admin' }));
    await assertSucceeds(updateDoc(doc(admin(), 'sessions/S9'), { examName: '2학기 중간', updatedBy: 'admin' }));
  });

  it('공개 이후에는 기본 데이터를 수정할 수 없다', async () => {
    await seed('PUBLISHED');
    await assertFails(setDoc(doc(admin(), 'sessions/S1/slots/X'), { period: 1, updatedBy: 'admin' }));
  });
});

describe('배정 결과', () => {
  it('교사는 공개 전에는 볼 수 없고 공개 후에는 볼 수 있다', async () => {
    await seed('REVIEW');
    await assertFails(getDoc(doc(kim(), 'sessions/S1/assignments/A1')));
    await seed('PUBLISHED');
    await assertSucceeds(getDoc(doc(kim(), 'sessions/S1/assignments/A1')));
  });

  it('배정과 감사 로그는 클라이언트가 쓸 수 없다', async () => {
    await seed('REVIEW');
    await assertFails(setDoc(doc(admin(), 'sessions/S1/assignments/A2'), { teacherId: 'T001', updatedBy: 'admin' }));
    await assertFails(setDoc(doc(admin(), 'sessions/S1/auditLogs/L1'), { action: 'CREATE' }));
  });
});

describe('불가시간', () => {
  const mine = { teacherId: 'T001', date: '2026-10-12', period: 1, status: 'PENDING', source: 'TEACHER', updatedBy: 'kim' };

  it('교사는 본인 불가시간만 대기 상태로 제출할 수 있다', async () => {
    await seed('DRAFT');
    await assertSucceeds(setDoc(doc(kim(), 'sessions/S1/availability/V1'), mine));
    await assertFails(setDoc(doc(kim(), 'sessions/S1/availability/V3'), { ...mine, status: 'APPROVED' }));
    await assertFails(setDoc(doc(kim(), 'sessions/S1/availability/V4'), { ...mine, teacherId: 'T002' }));
  });

  it('교사는 다른 교사의 불가시간을 읽거나 지울 수 없다', async () => {
    await seed('DRAFT');
    await assertFails(getDoc(doc(kim(), 'sessions/S1/availability/V2')));
    await assertFails(deleteDoc(doc(kim(), 'sessions/S1/availability/V2')));
  });

  it('교사는 본인 불가시간을 승인 후에도 취소할 수 있지만, 교사 공개 이후에는 안 된다', async () => {
    await seed('DRAFT');
    await env.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore(), 'sessions/S1/availability/V5'), { ...mine, status: 'APPROVED', updatedBy: 'admin' }),
    );
    await assertSucceeds(deleteDoc(doc(kim(), 'sessions/S1/availability/V5')));
    await seed('PUBLISHED');
    await env.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore(), 'sessions/S1/availability/V6'), { ...mine, status: 'APPROVED', updatedBy: 'admin' }),
    );
    await assertFails(deleteDoc(doc(kim(), 'sessions/S1/availability/V6')));
  });

  it('관리자는 승인할 수 있다', async () => {
    await seed('DRAFT');
    await assertSucceeds(updateDoc(doc(admin(), 'sessions/S1/availability/V2'), { status: 'APPROVED', updatedBy: 'admin' }));
  });
});
