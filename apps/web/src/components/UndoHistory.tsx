import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where, type Timestamp } from 'firebase/firestore';
import { Modal } from '@/components/Modal';
import { toast } from '@/components/Toast';
import { Alert, Button, Spinner } from '@/components/ui';
import { callUndoOperation, db, errorMessage } from '@/lib/firebase';

export interface UndoOp {
  id: string;
  label: string;
  kind: 'DATA' | 'STATUS' | 'UNDO';
  sessionId: string | null;
  count: number;
  createdByEmail: string | null;
  createdAt: Timestamp | null;
  undone: boolean;
}

/** 이 프로젝트(sessionId) 또는 학교 공통(null) 작업 기록, 최신순 */
export function useUndoOps(sessionId: string | null) {
  const [state, setState] = useState<{ data: UndoOp[]; loading: boolean; error: string | null }>({ data: [], loading: true, error: null });
  useEffect(
    () =>
      onSnapshot(
        query(collection(db, 'undoOps'), where('sessionId', '==', sessionId)),
        (snap) =>
          setState({
            data: snap.docs
              .map((d) => ({ id: d.id, ...d.data() }) as UndoOp)
              .sort((a, b) => (b.createdAt?.toMillis() ?? Date.now()) - (a.createdAt?.toMillis() ?? Date.now())),
            loading: false,
            error: null,
          }),
        (e) => setState({ data: [], loading: false, error: e.message }),
      ),
    [sessionId],
  );
  return state;
}

function when(t: Timestamp | null) {
  const d = t?.toDate();
  if (!d) return '방금';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 되돌리기 확인: 함께 되돌려지는 작업을 먼저 보여 준다 */
export function UndoConfirm({ op, onClose }: { op: UndoOp; onClose: () => void }) {
  const [preview, setPreview] = useState<{ ops: { id: string; label: string }[]; paths: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    callUndoOperation({ opId: op.id, preview: true })
      .then((r) => setPreview(r.data))
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [op.id]);

  const run = async () => {
    setBusy(true);
    try {
      const r = await callUndoOperation({ opId: op.id });
      toast(`"${op.label}"${r.data.ops.length > 1 ? ` 외 ${r.data.ops.length - 1}건` : ''} 작업 전으로 되돌렸습니다.`);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Modal title="작업 되돌리기" onClose={() => !busy && onClose()}>
      <div className="grid gap-4">
        <p>
          <b>{op.label}</b> ({when(op.createdAt)}) 작업을 하기 전 상태로 되돌립니다.
        </p>
        {!preview && !error && <Spinner />}
        {preview && preview.ops.length > 1 && (
          <Alert tone="info">
            이 작업 뒤에 같은 자료를 바꾼 작업 {preview.ops.length - 1}건도 함께 되돌려집니다:{' '}
            {preview.ops
              .slice(1)
              .map((o) => o.label)
              .join(', ')}
          </Alert>
        )}
        {preview && <p className="text-sm text-muted">자료 {preview.paths}건이 복원됩니다. 되돌린 뒤에도 목록의 "되돌리기" 작업을 다시 되돌리면 원래대로 돌아갑니다.</p>}
        {error && <Alert>{error}</Alert>}
        <div className="flex gap-2">
          <Button onClick={() => void run()} disabled={busy || !preview}>
            {busy ? '되돌리는 중…' : '되돌리기'}
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            취소
          </Button>
        </div>
      </div>
    </Modal>
  );
}

const KIND_BADGE: Record<UndoOp['kind'], string> = { DATA: '', STATUS: '단계', UNDO: '되돌리기' };

/** 작업 기록 목록: 원하는 작업을 골라 그 전으로 되돌린다 */
export function UndoHistory({ sessionId, title }: { sessionId: string | null; title: string }) {
  const ops = useUndoOps(sessionId);
  const [limit, setLimit] = useState(15);
  const [target, setTarget] = useState<UndoOp | null>(null);

  return (
    <section aria-label={title}>
      <h2 className="text-lg font-bold">{title}</h2>
      <p className="mt-1 text-muted">작업을 골라 그 작업을 하기 전 상태로 되돌립니다. 진행 단계 변경(공개·확정 등)도 되돌릴 수 있습니다.</p>
      {ops.loading && <Spinner />}
      {ops.error && <Alert>{ops.error}</Alert>}
      {!ops.loading && ops.data.length === 0 && <p className="mt-3 text-muted">아직 기록된 작업이 없습니다.</p>}
      <ul className="mt-3 grid gap-2">
        {ops.data.slice(0, limit).map((o) => (
          <li key={o.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3 ${o.undone ? 'opacity-60' : ''}`}>
            <div>
              <div className="font-bold">
                {KIND_BADGE[o.kind] && <span className="mr-2 rounded-lg bg-primary-soft px-2 py-0.5 text-xs text-primary-strong">{KIND_BADGE[o.kind]}</span>}
                <span className={o.undone ? 'line-through' : ''}>{o.label}</span>
                {o.undone && <span className="ml-2 text-sm font-normal text-muted">(되돌림)</span>}
              </div>
              <div className="text-sm text-muted">
                {when(o.createdAt)} · {o.createdByEmail ?? '알 수 없음'} · 자료 {o.count}건
              </div>
            </div>
            {!o.undone && (
              <Button variant="secondary" onClick={() => setTarget(o)} aria-label={`${o.label} 전으로 되돌리기`}>
                ↶ 이 작업 전으로
              </Button>
            )}
          </li>
        ))}
      </ul>
      {ops.data.length > limit && (
        <Button variant="ghost" className="mt-2" onClick={() => setLimit(limit + 30)}>
          더 보기 ({ops.data.length - limit}건)
        </Button>
      )}
      {target && <UndoConfirm op={target} onClose={() => setTarget(null)} />}
    </section>
  );
}
