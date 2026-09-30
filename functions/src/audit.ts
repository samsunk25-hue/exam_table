import { onDocumentWritten, type Change, type DocumentSnapshot, type FirestoreEvent } from 'firebase-functions/v2/firestore';
import { buildAuditLog } from './auditLog';
import { db, serverTimestamp } from './common';

// 자기 자신(auditLogs)과 엔진 미리보기·내부 인덱스는 기록하지 않는다.
const SKIP = new Set(['auditLogs', 'runs', 'busy']);

type WriteEvent = FirestoreEvent<Change<DocumentSnapshot> | undefined, Record<string, string>>;

async function record(logCollection: string, targetType: string, targetId: string, event: WriteEvent) {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before && !after) return;
  // 이벤트 ID를 문서 ID로 써서 트리거 재시도 시 중복 기록을 막는다.
  await db()
    .collection(logCollection)
    .doc(event.id)
    .set({ ...buildAuditLog(targetType, targetId, before, after), createdAt: serverTimestamp() });
}

export const auditSession = onDocumentWritten('sessions/{sid}', (event) =>
  record(`sessions/${event.params.sid}/auditLogs`, 'sessions', event.params.sid, event),
);

export const auditSessionChild = onDocumentWritten('sessions/{sid}/{coll}/{docId}', (event) => {
  const { sid, coll, docId } = event.params;
  if (!coll || !docId || SKIP.has(coll)) return;
  return record(`sessions/${sid}/auditLogs`, coll, docId, event);
});

export const auditTeacher = onDocumentWritten('teachers/{id}', (event) =>
  record('auditLogs', 'teachers', event.params.id, event),
);

export const auditRoom = onDocumentWritten('rooms/{id}', (event) =>
  record('auditLogs', 'rooms', event.params.id, event),
);

export const auditAdmin = onDocumentWritten('admins/{email}', (event) =>
  record('auditLogs', 'admins', event.params.email, event),
);
