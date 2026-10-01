// 되돌리기: 작업마다 바꾸기 직전 문서 상태를 undoOps/{opId}(+ snapshots 하위 문서)에 기록하고,
// undoOperation으로 고른 작업 직전 상태로 복원한다.
import type { DocumentData, DocumentReference, WriteBatch } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db, requireAdmin, serverTimestamp } from './common';

export type UndoKind = 'DATA' | 'STATUS' | 'UNDO';
interface Item {
  path: string;
  before: DocumentData | null;
}

const CHUNK_BYTES = 400_000;

// 되돌릴 수 있는 문서 경로 (관리자 목록·감사 로그·되돌리기 기록 자체는 제외)
const ALLOWED = [
  /^teachers\/[^/]+$/,
  /^rooms\/[^/]+$/,
  /^loadLedger\/[^/]+$/,
  /^sessions\/[^/]+$/,
  /^sessions\/[^/]+\/(slots|availability|constraints|baseTimetable|assignments)\/[^/]+$/,
];
const allowed = (path: string) => ALLOWED.some((re) => re.test(path));

async function readItems(refs: DocumentReference[]): Promise<Item[]> {
  const uniq = [...new Map(refs.map((r) => [r.path, r])).values()];
  const out: Item[] = [];
  for (let i = 0; i < uniq.length; i += 300) {
    const snaps = await db().getAll(...uniq.slice(i, i + 300));
    for (const s of snaps) out.push({ path: s.ref.path, before: s.exists ? s.data()! : null });
  }
  return out;
}

async function writeOp(o: { label: string; kind: UndoKind; sessionId: string | null; uid: string; email?: string | null; items: Item[] }) {
  if (!o.items.length) return null;
  const firestore = db();
  const opRef = firestore.collection('undoOps').doc();
  const batch = firestore.batch();
  batch.set(opRef, {
    label: o.label,
    kind: o.kind,
    sessionId: o.sessionId,
    paths: o.items.map((x) => x.path),
    count: o.items.length,
    createdBy: o.uid,
    createdByEmail: o.email ?? null,
    createdAt: serverTimestamp(),
    undone: false,
  });
  let chunk: Item[] = [];
  let size = 0;
  let n = 0;
  const flush = () => {
    if (chunk.length) batch.set(opRef.collection('snapshots').doc(String(n++)), { items: chunk });
    chunk = [];
    size = 0;
  };
  for (const it of o.items) {
    const bytes = JSON.stringify(it).length;
    if (size + bytes > CHUNK_BYTES) flush();
    chunk.push(it);
    size += bytes;
  }
  flush();
  await batch.commit();
  return opRef.id;
}

/** 쓰기 직전에 호출: refs의 현재 상태를 작업 하나로 기록한다. */
export async function recordOp(o: { label: string; kind?: UndoKind; sessionId: string | null; uid: string; email?: string | null; refs: DocumentReference[] }) {
  return writeOp({ ...o, kind: o.kind ?? 'DATA', items: await readItems(o.refs) });
}

interface OpDoc {
  label: string;
  paths: string[];
  undone: boolean;
  sessionId: string | null;
  createdAt: FirebaseFirestore.Timestamp;
}

/**
 * 고른 작업 전으로 되돌린다. 그 뒤에 같은 문서를 바꾼 작업(연쇄 포함)도 함께 되돌려야
 * 앞뒤가 맞으므로 함께 되돌린다. 다른 문서만 바꾼 작업은 그대로 둔다.
 * 되돌리기 직전 상태도 작업 하나로 남겨 "되돌리기 취소"가 가능하다.
 */
export const undoOperation = onCall({ timeoutSeconds: 300 }, async (req) => {
  const uid = requireAdmin(req);
  const { opId, preview } = (req.data ?? {}) as { opId?: unknown; preview?: unknown };
  if (typeof opId !== 'string' || !opId) throw new HttpsError('invalid-argument', '작업 ID가 필요합니다.');
  const firestore = db();
  const target = await firestore.doc(`undoOps/${opId}`).get();
  if (!target.exists) throw new HttpsError('not-found', '작업 기록을 찾을 수 없습니다.');
  const t = target.data() as OpDoc;
  if (t.undone) throw new HttpsError('failed-precondition', '이미 되돌린 작업입니다.');

  // 고른 작업과 그 뒤 작업 (시간순)
  const later = (await firestore.collection('undoOps').where('createdAt', '>=', t.createdAt).orderBy('createdAt').get()).docs.filter(
    (d) => !(d.get('undone') as boolean),
  );
  const included = [target];
  const touched = new Set(t.paths);
  for (const d of later) {
    if (d.id === opId) continue;
    const paths = d.get('paths') as string[];
    if (paths.some((p) => touched.has(p))) {
      included.push(d);
      paths.forEach((p) => touched.add(p));
    }
  }
  const summary = included.map((d) => ({ id: d.id, label: d.get('label') as string }));
  if (preview === true) return { ops: summary, paths: touched.size };

  const bad = [...touched].find((p) => !allowed(p));
  if (bad) throw new HttpsError('failed-precondition', `되돌릴 수 없는 자료가 포함되어 있습니다: ${bad}`);

  // 되돌리기 직전 상태를 기록 (되돌리기 취소용)
  const email = (req.auth?.token.email as string | undefined) ?? null;
  await recordOp({
    label: `되돌리기: ${t.label}${included.length > 1 ? ` 외 ${included.length - 1}건` : ''}`,
    kind: 'UNDO',
    sessionId: t.sessionId,
    uid,
    email,
    refs: [...touched].map((p) => firestore.doc(p)),
  });

  // 문서마다 가장 먼저(오래된) 작업 직전 상태가 복원할 상태다 (included는 시간순)
  const restore = new Map<string, DocumentData | null>();
  for (const d of included) {
    const chunks = await d.ref.collection('snapshots').get();
    const items = chunks.docs.sort((a, b) => Number(a.id) - Number(b.id)).flatMap((c) => c.get('items') as Item[]);
    for (const { path, before } of items) if (!restore.has(path)) restore.set(path, before);
  }
  type Write = (b: WriteBatch) => void;
  const writes: Write[] = [...restore].map(([path, before]): Write => {
    const ref = firestore.doc(path);
    if (!before) return (b) => b.delete(ref);
    // 수정자는 되돌린 사람으로 남긴다 (감사 로그·보안 규칙 기준)
    return (b) => b.set(ref, 'updatedBy' in before ? { ...before, updatedBy: uid } : before);
  });
  for (let i = 0; i < writes.length; i += 400) {
    const batch = firestore.batch();
    writes.slice(i, i + 400).forEach((w) => w(batch));
    await batch.commit();
  }
  const done = firestore.batch();
  for (const d of included) done.update(d.ref, { undone: true, undoneBy: uid, undoneAt: serverTimestamp() });
  await done.commit();
  return { ops: summary, paths: touched.size };
});
