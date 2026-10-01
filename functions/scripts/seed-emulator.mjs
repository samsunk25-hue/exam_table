// 에뮬레이터 전용 샘플 데이터. 실행: npm run seed -w functions (에뮬레이터 실행 중이어야 함)
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';

const { initializeApp } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');

initializeApp({ projectId: 'smart-invigilation' });
const db = getFirestore();
const TERM = { term: '점검중학교|2026|2', school: '점검중학교', year: 2026, semester: 2 }; // 학교·학기 명단

const teachers = [
  { id: 'T001', name: '김국어', email: 'kim@test.kr', subject: '국어', homeroom: { grade: 1, classNo: 1 } },
  { id: 'T002', name: '이수학', email: 'lee@test.kr', subject: '수학', homeroom: { grade: 1, classNo: 2 } },
  { id: 'T003', name: '박영어', email: 'park@test.kr', subject: '영어', homeroom: null },
];

const batch = db.batch();
for (const { id, ...t } of teachers) {
  batch.set(db.doc(`teachers/${id}`), {
    ...t,
    defaultRole: 'NORMAL',
    active: true,
    cumulativeLoad: 0,
    ...TERM, updatedBy: 'seed',
  });
}
await batch.commit();
console.log(`교사 ${teachers.length}명 등록: ${teachers.map((t) => t.email).join(', ')}`);
