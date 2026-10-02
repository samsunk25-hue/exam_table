import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import type { RunMetrics, SessionStatus } from '@sim/shared';

// 웹 앱 설정값은 공개 식별자이며 접근 제어는 보안 규칙이 담당한다.
const app = initializeApp({
  apiKey: 'AIzaSyBQohFqN2AdmsAF6vhQ7k4I7SRUSoeK4oc',
  authDomain: 'smart-invigilation.firebaseapp.com',
  projectId: 'smart-invigilation',
  storageBucket: 'smart-invigilation.firebasestorage.app',
  messagingSenderId: '936568026682',
  appId: '1:936568026682:web:50af317cae161392542703',
});

export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app, 'asia-northeast3');

export const usingEmulators = import.meta.env.VITE_USE_EMULATORS === 'true';
if (usingEmulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}

export type Role = 'ADMIN' | 'TEACHER' | 'NONE';

export const callSyncProfile = httpsCallable<void, { role: Role; teacherId: string | null; refreshed: boolean }>(
  functions,
  'syncProfile',
);

export const callTransitionSession = httpsCallable<
  { sessionId: string; to: SessionStatus; reason?: string },
  { status: SessionStatus }
>(functions, 'transitionSession');

export const callDeleteSession = httpsCallable<{ sessionId: string }, { revertedTeachers: number }>(functions, 'deleteSession');
type TermArg = { school: string; year: number; semester: number };
type TermCounts = { sessions: number; teachers: number; rooms: number };
export const callRenameTerm = httpsCallable<{ from: TermArg; to: TermArg }, TermCounts>(functions, 'renameTerm', { timeout: 300_000 });
export const callDeleteTerm = httpsCallable<{ term: TermArg; confirm: string }, TermCounts>(functions, 'deleteTerm', { timeout: 540_000 });

export const callRunAssignment = httpsCallable<
  { sessionId: string; keepManual: boolean; scenarios: boolean; weights?: Record<string, number> },
  {
    runId: string;
    batchId: string;
    metrics: RunMetrics;
    unassigned: number;
    runs: { runId: string; scenario: string; metrics: RunMetrics; unassigned: number }[];
  }
>(functions, 'runAssignment', { timeout: 120_000 });

export const callApplyRun = httpsCallable<{ sessionId: string; runId: string }, { assigned: number; removed: number }>(
  functions,
  'applyRun',
  { timeout: 120_000 },
);

export const callApplyChanges = httpsCallable<
  { sessionId: string; changes: { seatId: string; teacherId: string | null }[]; reason?: string; label?: string },
  { changed: number }
>(functions, 'applyAssignmentChanges', { timeout: 60_000 });

export const callUndoOperation = httpsCallable<{ opId: string; preview?: boolean }, { ops: { id: string; label: string }[]; paths: number }>(
  functions,
  'undoOperation',
);
type SwapOption = { kind: 'SWAP' | 'HANDOVER'; moves: { seatId: string; from: string; to: string; label: string }[]; summary: string[] };
export const callSuggestSwaps = httpsCallable<{ sessionId: string; seatId: string; partnerId?: string }, { options: SwapOption[] }>(functions, 'suggestSwaps');
export const callCreateSwapRequest = httpsCallable<
  { sessionId: string; kind: SwapOption['kind']; moves: SwapOption['moves']; reason?: string },
  { requestId: string; status: string }
>(functions, 'createSwapRequest');
export const callActSwapRequest = httpsCallable<
  { sessionId: string; requestId: string; action: 'accept' | 'decline' | 'cancel' | 'approve' | 'reject'; note?: string },
  { status: string }
>(functions, 'actSwapRequest');
// AI 기능 (Claude)
export interface AiSlotRow {
  date: string;
  period: number;
  startTime?: string | null;
  endTime?: string | null;
  grade: number;
  subject: string;
  type: '시험' | '자습';
}
export interface AiTeacherRow {
  name: string;
  subject?: string | null;
  homeroomGrade?: number | null;
  homeroomClass?: number | null;
  email?: string | null;
}
/** 기초시간표: 교사별 수업 목록 ("월1 1-3 국어") */
export interface AiTimetableRow {
  teacher: string;
  lessons: string[];
}
export type AiPart = 'schedule' | 'teachers' | 'timetable';
export const callAiExtract = httpsCallable<
  { parts: AiPart[]; files: { name: string; mediaType: string; data: string }[]; text?: string; year: number },
  { slots: AiSlotRow[]; teachers: AiTeacherRow[]; timetable: AiTimetableRow[]; notes: string[] }
>(functions, 'aiExtract', { timeout: 300_000 });
export const callAiExplainDuties = httpsCallable<{ sessionId: string; teacherId: string }, { text: string }>(functions, 'aiExplainDuties', { timeout: 300_000 });
export const callAiRules = httpsCallable<{ sessionId: string; text: string }, { rules: import('@sim/shared').ConstraintDoc[]; notes: string[] }>(functions, 'aiRules', {
  timeout: 300_000,
});
export const callSetMyAiKey = httpsCallable<{ key: string }, { last4: string }>(functions, 'setMyAiKey');
export const callClearMyAiKey = httpsCallable<void, { cleared: boolean }>(functions, 'clearMyAiKey');
export const callAddAdmin = httpsCallable<{ email: string }, { email: string; applied: boolean }>(functions, 'addAdmin');
export const callRemoveAdmin = httpsCallable<{ email: string }, { email: string }>(functions, 'removeAdmin');
export const callReviewAccessRequest = httpsCallable<{ uid: string; approve: boolean; note?: string }, { status: string }>(
  functions,
  'reviewAccessRequest',
);

/** Firebase 오류를 사용자에게 보여줄 한국어 문장으로 */
export function errorMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e && typeof e.message === 'string') {
    if ('code' in e && e.code === 'permission-denied') return '권한이 없습니다.';
    return e.message;
  }
  return '알 수 없는 오류가 발생했습니다.';
}
