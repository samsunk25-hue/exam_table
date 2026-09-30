import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type DocumentReference,
  type WriteBatch,
} from 'firebase/firestore';
import { useEffect, useState } from 'react';
import type { WithId } from '@sim/shared';
import { auth, db } from './firebase';

export interface Live<T> {
  data: T;
  loading: boolean;
  error: string | null;
}

/**
 * 컬렉션 실시간 구독. path가 null이면 구독하지 않는다.
 * where를 주면 해당 필드가 값과 같은 문서만 구독한다 (보안 규칙상 교사는 본인 문서만 조회 가능).
 */
export function useCollection<T>(path: string | null, where_?: [field: string, value: string]): Live<WithId<T>[]> {
  const [state, setState] = useState<Live<WithId<T>[]>>({ data: [], loading: true, error: null });
  const [field, value] = where_ ?? [null, null];
  useEffect(() => {
    if (!path) return;
    setState((s) => ({ ...s, loading: true }));
    const ref = collection(db, path);
    return onSnapshot(
      field ? query(ref, where(field, '==', value)) : ref,
      (snap) =>
        setState({
          data: snap.docs.map((d) => ({ id: d.id, ...(d.data() as T) })),
          loading: false,
          error: null,
        }),
      (e) => setState({ data: [], loading: false, error: e.message }),
    );
  }, [path, field, value]);
  return state;
}

/** 보안 규칙이 요구하는 수정자 기록 */
export function stamp() {
  return { updatedBy: auth.currentUser!.uid, updatedAt: serverTimestamp() };
}

export type BatchOp =
  | { type: 'set'; ref: DocumentReference; data: Record<string, unknown>; merge?: boolean }
  | { type: 'delete'; ref: DocumentReference };

/** Firestore 배치 한도(500)를 넘지 않게 나눠서 커밋한다. */
export async function commitOps(ops: BatchOp[], chunk = 400): Promise<void> {
  for (let i = 0; i < ops.length; i += chunk) {
    const batch: WriteBatch = writeBatch(db);
    for (const op of ops.slice(i, i + chunk)) {
      if (op.type === 'set') batch.set(op.ref, { ...op.data, ...stamp() }, { merge: op.merge ?? false });
      else batch.delete(op.ref);
    }
    await batch.commit();
  }
}

export function ref(path: string, id: string): DocumentReference {
  return doc(db, path, id);
}
