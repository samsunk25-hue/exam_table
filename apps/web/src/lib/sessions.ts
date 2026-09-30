import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  type Timestamp,
} from 'firebase/firestore';
import { useEffect, useState } from 'react';
import type { SessionStatus } from '@sim/shared';
import { auth, db } from './firebase';

export interface SessionSettings {
  useBaseTimetable: boolean;
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

export function updateSessionSettings(id: string, settings: SessionSettings) {
  return updateDoc(doc(db, 'sessions', id), { settings, ...stamp() });
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
