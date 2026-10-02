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
import { sessionTerm, termKey, type ExamWriterRule, type SessionStatus, type TeacherDoc, type TermRef, type WithId } from '@sim/shared';
import { commitOps, useCollection } from './data';
import { auth, db } from './firebase';

export interface PeriodTime {
  start: string;
  end: string;
}

export interface SessionSettings {
  useBaseTimetable: boolean;
  /** 교시별 기본 시작·종료 시각 (시험 추가 시 자동 입력) — 키는 교시 번호 */
  periodTimes?: Record<string, PeriodTime>;
  /** 교사가 낸 불가시간을 관리자 승인 없이 바로 반영 (관리자는 문제 있는 것만 반려) */
  autoApproveAvailability?: boolean;
  /** 시험 없는 학년은 수업: 그 시간 기초시간표에 수업이 있는 교사는 감독에서 뺀다 */
  classDuringExam?: boolean;
  /** 별도시험장 감독 우선 교사 — 예전 설정(정·부 모두). 새로 고르면 아래 둘로 옮긴다 */
  extendedPreferred?: string[];
  /** 별도시험장 정감독(연장) 우선 교사 */
  extendedChief?: string[];
  /** 별도시험장 부감독 우선 교사 */
  extendedAssistant?: string[];
  /** 감독 없음으로 정한 자리(좌석 ID) */
  noSupervisor?: string[];
  /** 출제 교사 배정 규칙 (없으면 상관없음) */
  examWriter?: ExamWriterRule;
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
  /** 감독 10분 전 알림에 붙이는 학생 안내사항 (관리자가 적었을 때만) */
  studentNotice?: string | null;
  /** 대시보드에서 숨긴 지난 프로젝트 */
  hidden?: boolean;
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
    // 교사용 AI 설명은 프로젝트를 만든 관리자의 AI 키를 쓴다
    createdBy: auth.currentUser!.uid,
    ...stamp(),
  });
}

/** 설정 변경도 되돌리기 목록에 남긴다 */
export function updateStudentNotice(id: string, text: string) {
  return commitOps([{ type: 'set', ref: doc(db, 'sessions', id), data: { studentNotice: text.trim() || null }, merge: true }], '학생 안내사항 변경');
}

export function updateSessionSettings(id: string, settings: SessionSettings) {
  return commitOps([{ type: 'set', ref: doc(db, 'sessions', id), data: { settings }, merge: true }], '시험 설정 변경');
}

interface Live<T> {
  data: T;
  loading: boolean;
  error: string | null;
}

/**
 * 설정 기본값: 기초시간표는 올리기만 하면 반영(없으면 영향 없음), 교사가 낸 불가시간은 바로 반영(관리자는 예외만 반려).
 * 예전에 꺼 둔 값이 있어도 이제 켜는 스위치가 없으므로 항상 이 값으로 본다.
 */
export function withDefaults(s: ExamSession): ExamSession {
  return { ...s, settings: { ...s.settings, useBaseTimetable: true, autoApproveAvailability: s.settings?.autoApproveAvailability !== false } };
}

export function useSessions(): Live<ExamSession[]> {
  const [state, setState] = useState<Live<ExamSession[]>>({ data: [], loading: true, error: null });
  useEffect(
    () =>
      onSnapshot(
        query(collection(db, 'sessions'), orderBy('createdAt', 'desc')),
        (snap) =>
          setState({
            data: snap.docs.map((d) => withDefaults({ id: d.id, ...d.data() } as ExamSession)),
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
          data: snap.exists() ? withDefaults({ id: snap.id, ...snap.data() } as ExamSession) : null,
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
            .map((d) => withDefaults({ id: d.id, ...d.data() } as ExamSession))
            .sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0)),
          loading: false,
          error: null,
        }),
      (e) => setState({ data: [], loading: false, error: e.message }),
    );
  }, [key]);
  return state;
}

/** 이 프로젝트에서 쓰는 교사: 같은 학교·학기 명단 + 이 프로젝트의 임시 감독자 (다른 프로젝트 임시 감독자는 뺀다) */
export function useSessionTeachers(s: ExamSession): Live<WithId<TeacherDoc>[]> {
  const all = useCollection<TeacherDoc>('teachers', termWhere(s));
  return { ...all, data: all.data.filter((t) => !t.onlySession || t.onlySession === s.id) };
}
