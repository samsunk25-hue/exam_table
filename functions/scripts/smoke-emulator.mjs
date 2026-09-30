// 에뮬레이터 종단 점검: 로그인 → 역할 판정 → 세션 생성/전환 → 관리자 추가/제거 → 감사 로그
// 실행: npm run smoke -w functions (에뮬레이터 + seed 이후)
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';

const { initializeApp: initAdmin } = await import('firebase-admin/app');
const { getAuth: adminAuth } = await import('firebase-admin/auth');
const { getFirestore: adminDb } = await import('firebase-admin/firestore');
const { initializeApp, deleteApp } = await import('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword, signOut } = await import('firebase/auth');
const { getFirestore, connectFirestoreEmulator, addDoc, collection, serverTimestamp } = await import('firebase/firestore');
const { getFunctions, connectFunctionsEmulator, httpsCallable } = await import('firebase/functions');

const PROJECT = 'smart-invigilation';
initAdmin({ projectId: PROJECT });

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function ensureUser(email) {
  try {
    await adminAuth().getUserByEmail(email);
  } catch {
    await adminAuth().createUser({ email, password: 'test1234', emailVerified: true });
  }
}

async function client(email) {
  const app = initializeApp({ apiKey: 'fake', projectId: PROJECT, authDomain: `${PROJECT}.firebaseapp.com` }, email);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  const fns = getFunctions(app, 'asia-northeast3');
  connectFunctionsEmulator(fns, '127.0.0.1', 5001);
  await signInWithEmailAndPassword(auth, email, 'test1234');
  const call = (name, data) => httpsCallable(fns, name)(data).then((r) => r.data);
  const sync = await call('syncProfile');
  const claims = (await auth.currentUser.getIdTokenResult(true)).claims;
  return { app, auth, db, call, sync, claims, close: async () => (await signOut(auth), await deleteApp(app)) };
}

async function expectError(promise, code) {
  try {
    await promise;
    return false;
  } catch (e) {
    return e.code === `functions/${code}`;
  }
}

const ADMIN = 'samsunk25@gmail.com';
for (const e of [ADMIN, 'kim@test.kr', 'lee@test.kr', 'nobody@test.kr']) await ensureUser(e);

// 1. 역할 판정
const admin = await client(ADMIN);
check('기본 관리자 → ADMIN', admin.claims.role === 'ADMIN', JSON.stringify(admin.sync));
const kim = await client('kim@test.kr');
check('교사 명단 이메일 → TEACHER(T001)', kim.claims.role === 'TEACHER' && kim.claims.teacherId === 'T001');
const nobody = await client('nobody@test.kr');
check('미등록 이메일 → 역할 없음', nobody.claims.role === undefined && nobody.sync.role === 'NONE');

// 2. 세션 생성과 상태 전환
const ref = await addDoc(collection(admin.db, 'sessions'), {
  schoolName: '점검중학교',
  year: 2026,
  semester: 2,
  examName: '점검용 기말고사',
  status: 'DRAFT',
  settings: { useBaseTimetable: true },
  createdAt: serverTimestamp(),
  updatedBy: admin.auth.currentUser.uid,
});
check('관리자 세션 생성', true, ref.id);
const t = await admin.call('transitionSession', { sessionId: ref.id, to: 'AUTO_ASSIGNED' });
check('DRAFT → AUTO_ASSIGNED', t.status === 'AUTO_ASSIGNED');
check('허용되지 않은 전환 거부 (→ LOCKED)', await expectError(admin.call('transitionSession', { sessionId: ref.id, to: 'LOCKED' }), 'failed-precondition'));
check('교사는 상태 전환 불가', await expectError(kim.call('transitionSession', { sessionId: ref.id, to: 'REVIEW' }), 'permission-denied'));

// 3. 관리자 추가/제거
const added = await admin.call('addAdmin', { email: 'Lee@Test.kr' });
check('관리자 추가 (가입 사용자 즉시 반영)', added.applied === true && added.email === 'lee@test.kr');
const lee = await client('lee@test.kr');
check('추가된 관리자 → ADMIN (교사 ID 유지)', lee.claims.role === 'ADMIN' && lee.claims.teacherId === 'T002');
check('본인 제거 거부', await expectError(lee.call('removeAdmin', { email: 'lee@test.kr' }), 'failed-precondition'));
check('기본 관리자 제거 거부', await expectError(lee.call('removeAdmin', { email: ADMIN }), 'failed-precondition'));
await admin.call('removeAdmin', { email: 'lee@test.kr' });
const leeClaims = (await adminAuth().getUserByEmail('lee@test.kr')).customClaims;
check('제거 후 교사 역할로 복귀', leeClaims?.role === 'TEACHER', JSON.stringify(leeClaims));

// 4. 감사 로그 (트리거 비동기 처리 대기)
await new Promise((r) => setTimeout(r, 3000));
const logs = await adminDb().collection(`sessions/${ref.id}/auditLogs`).get();
const actions = logs.docs.map((d) => d.get('action')).sort();
check('세션 감사 로그 (생성 + 상태 변경)', actions.includes('CREATE') && actions.includes('STATUS'), actions.join(','));
const statusLog = logs.docs.find((d) => d.get('action') === 'STATUS');
check('상태 변경 행위자 기록', statusLog?.get('userId') === admin.auth.currentUser.uid);
const adminLogs = await adminDb().collection('auditLogs').where('targetType', '==', 'admins').get();
check('관리자 변경 감사 로그', adminLogs.docs.some((d) => d.get('action') === 'DELETE' && d.get('lastEditor') === admin.auth.currentUser.uid));

for (const c of [admin, kim, nobody, lee]) await c.close();
console.log(failures === 0 ? '\n모든 점검 통과' : `\n실패 ${failures}건`);
process.exit(failures === 0 ? 0 : 1);
