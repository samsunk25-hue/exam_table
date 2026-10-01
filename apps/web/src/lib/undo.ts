// 되돌리기 기록: 관리자가 자료를 바꾸기 직전 상태를 작업 단위로 undoOps에 남긴다.
// 실제 복원은 undoOperation 함수가 한다 (배정·세션 상태처럼 함수만 쓸 수 있는 자료도 있으므로).
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  writeBatch,
  type DocumentData,
  type DocumentReference,
} from 'firebase/firestore';
import { auth, db } from './firebase';

/** 기록 문서 하나에 담을 스냅샷 크기 (Firestore 문서 한도 1MB보다 넉넉히 작게) */
const CHUNK_BYTES = 400_000;

class Recorder {
  readonly befores = new Map<string, DocumentData | null>();
  constructor(readonly label: string) {}

  /** 아직 기록하지 않은 문서의 현재 상태를 읽어 둔다. 같은 컬렉션 문서가 많으면 컬렉션을 한 번에 읽는다. */
  async capture(refs: DocumentReference[]) {
    const fresh = [...new Map(refs.filter((r) => !this.befores.has(r.path)).map((r) => [r.path, r])).values()];
    const byParent = new Map<string, DocumentReference[]>();
    for (const r of fresh) byParent.set(r.parent.path, [...(byParent.get(r.parent.path) ?? []), r]);
    await Promise.all(
      [...byParent].map(async ([parent, list]) => {
        if (list.length > 20) {
          const snap = await getDocs(collection(db, parent));
          const data = new Map(snap.docs.map((d) => [d.ref.path, d.data()]));
          for (const r of list) this.befores.set(r.path, data.get(r.path) ?? null);
        } else {
          const snaps = await Promise.all(list.map((r) => getDoc(r)));
          snaps.forEach((s, i) => this.befores.set(list[i]!.path, s.exists() ? s.data() : null));
        }
      }),
    );
  }

  async save() {
    if (!this.befores.size) return;
    const items = [...this.befores].map(([path, before]) => ({ path, before }));
    const sessionId = items.map((x) => x.path.match(/^sessions\/([^/]+)/)?.[1]).find(Boolean) ?? null;
    const opRef = doc(collection(db, 'undoOps'));
    const batch = writeBatch(db);
    batch.set(opRef, {
      label: this.label,
      kind: 'DATA',
      sessionId,
      paths: items.map((x) => x.path),
      count: items.length,
      createdBy: auth.currentUser!.uid,
      createdByEmail: auth.currentUser!.email ?? null,
      createdAt: serverTimestamp(),
      undone: false,
    });
    let chunk: typeof items = [];
    let size = 0;
    let n = 0;
    const flush = () => {
      if (chunk.length) batch.set(doc(opRef, 'snapshots', String(n++)), { items: chunk });
      chunk = [];
      size = 0;
    };
    for (const it of items) {
      const bytes = JSON.stringify(it).length;
      if (size + bytes > CHUNK_BYTES) flush();
      chunk.push(it);
      size += bytes;
    }
    flush();
    await batch.commit();
  }
}

let current: Recorder | null = null;

async function isAdmin(): Promise<boolean> {
  const token = await auth.currentUser?.getIdTokenResult();
  return token?.claims.role === 'ADMIN';
}

/**
 * fn 안의 모든 쓰기(commitOps)를 작업 하나로 묶어 되돌리기 목록에 남긴다.
 * 이미 묶는 중이면 바깥 작업에 합친다. 관리자가 아니면 기록하지 않는다.
 * 중간에 실패해도 그때까지 바뀐 부분은 기록해 되돌릴 수 있게 한다.
 */
export async function undoable<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (current || !(await isAdmin())) return fn();
  const rec = new Recorder(label);
  current = rec;
  try {
    return await fn();
  } finally {
    current = null;
    await rec.save().catch((e: unknown) => console.warn('되돌리기 기록 실패', e));
  }
}

/** 쓰기 직전에 호출: 지금 묶고 있는 작업이 있으면 문서들의 현재 상태를 기록한다. */
export async function captureBefore(refs: DocumentReference[]) {
  await current?.capture(refs);
}
