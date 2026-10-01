import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  type Timestamp,
} from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { sessionTerm, termKey, type SessionStatus, type TermRef } from '@sim/shared';
import { commitOps } from './data';
import { auth, db } from './firebase';

export interface PeriodTime {
  start: string;
  end: string;
}

export interface SessionSettings {
  useBaseTimetable: boolean;
  /** 교시별 기본 시작·종료 시각 (시험 추가 시 자동 입력) — 키는 교시 번호 */
  periodTimes?: Record<string, PeriodTime>;
}

export interface ExamSession {
  id: string;
  schoolName: string;
  year: number;
  semester: number;
  examName: string;
  status: SessionStatus;
  settings: SessionSettings;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  lastChangeReason?: string | null;
}

export type NewSession = Pick<ExamSession, 'schoolName' | 'year' | 'semester' | 'examName' | 'settings'>;

function stamp() {
  return { updatedBy: auth.currentUser!.uid, updatedAt: serverTimestamp() };
}

export function createSession(data: NewSession) {
  return addDoc(collection(db, 'sessions'), {
    ...data,
    status: 'DRAFT',
    createdAt: serverTimestamp(),
    ...stamp(),
  });
}

/** 설정 변경도 되돌리기 목록에 남긴다 */
export function updateSessionSettings(id: string, settings: SessionSettings) {
  return commitOps([{ type: 'set', ref: doc(db, 'sessions', id), data: { settings }, merge: true }], '시험 설정 변경');
}

interface Live<T> {
  data: T;
  loading: boolean;
  error: string | null;
}

export function useSessions(): Live<ExamSession[]> {
  const [state, setState] = useState<Live<ExamSession[]>>({ data: [], loading: true, error: null });
  useEffect(
    () =>
      onSnapshot(
        query(collection(db, 'sessions'), orderBy('createdAt', 'desc')),
        (snap) =>
          setState({
            data: snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ExamSession),
            loading: false,
            error: null,
          }),
        (e) => setState({ data: [], loading: false, error: e.message }),
      ),
    [],
  );
  return state;
}

export function useSession(id: string | undefined): Live<ExamSession | null> {
  const [state, setState] = useState<Live<ExamSession | null>>({ data: null, loading: true, error: null });
  useEffect(() => {
    if (!id) return;
    return onSnapshot(
      doc(db, 'sessions', id),
      (snap) =>
        setState({
          data: snap.exists() ? ({ id: snap.id, ...snap.data() } as ExamSession) : null,
          loading: false,
          error: null,
        }),
      (e) => setState({ data: null, loading: false, error: e.message }),
    );
  }, [id]);
  return state;
}

export function sessionTitle(s: Pick<ExamSession, 'year' | 'semester' | 'examName'>): string {
  return `${s.year}학년도 ${s.semester}학기 ${s.examName}`;
}

/** 이 세션 학교·학기의 교사·시험실만 구독할 때: useCollection('teachers', termWhere(session)) */
export function termWhere(s: Pick<ExamSession, 'schoolName' | 'year' | 'semester'>): [string, string] {
  return ['term', termKey(sessionTerm(s))];
}

/**
 * 교사 화면용: 내 학교·학기 프로젝트만 조회한다 (보안 규칙도 다른 학교·학기 프로젝트는 막는다).
 * 학교·학기가 지정되지 않은 교사는 볼 수 있는 프로젝트가 없다.
 */
export function useMySessions(term: TermRef | null): Live<ExamSession[]> {
  const [state, setState] = useState<Live<ExamSession[]>>({ data: [], loading: true, error: null });
  const key = term ? termKey(term) : null;
  useEffect(() => {
    if (!term) return setState({ data: [], loading: false, error: null });
    return onSnapshot(
      query(
        collection(db, 'sessions'),
        where('schoolName', '==', term.school),
        where('year', '==', term.year),
        where('semester', '==', term.semester),
      ),
      (snap) =>
        setState({
          // 색인 없이 조회하려고 정렬은 화면에서 (최신순)
          data: snap.docs
            .map((d) => ({ id: d.id, ...d.data() }) as ExamSession)
            .sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0)),
          loading: false,
          error: null,
        }),
      (e) => setState({ data: [], loading: false, error: e.message }),
    );
  }, [key]);
  return state;
}
