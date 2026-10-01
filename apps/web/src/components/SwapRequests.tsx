import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where, type Timestamp } from 'firebase/firestore';
import { OPEN_SWAP_STATUSES, SWAP_STATUS_LABEL, type SwapKind, type SwapMoveDoc, type SwapRequestDoc } from '@sim/shared';
import { Modal } from '@/components/Modal';
import { toast } from '@/components/Toast';
import { Alert, Button, Card, Field, Spinner } from '@/components/ui';
import { callActSwapRequest, callCreateSwapRequest, callSuggestSwaps, db, errorMessage } from '@/lib/firebase';
import type { Duty } from '@/lib/timetable';

export type SwapRequest = SwapRequestDoc & { id: string; createdAt?: Timestamp };
type Option = { kind: SwapKind; moves: SwapMoveDoc[]; summary: string[] };

/** 교사: 내가 들어 있는 요청 / 관리자(teacherId null): 전체 */
export function useSwapRequests(sid: string, teacherId: string | null) {
  const [state, setState] = useState<{ data: SwapRequest[]; loading: boolean; error: string | null }>({ data: [], loading: true, error: null });
  useEffect(() => {
    const col = collection(db, `sessions/${sid}/swapRequests`);
    return onSnapshot(
      teacherId ? query(col, where('parties', 'array-contains', teacherId)) : col,
      (snap) =>
        setState({
          data: snap.docs
            .map((d) => ({ id: d.id, ...d.data() }) as SwapRequest)
            .sort((a, b) => (b.createdAt?.toMillis() ?? Date.now()) - (a.createdAt?.toMillis() ?? Date.now())),
          loading: false,
          error: null,
        }),
      (e) => setState({ data: [], loading: false, error: e.message }),
    );
  }, [sid, teacherId]);
  return state;
}

const isOpen = (r: SwapRequest) => OPEN_SWAP_STATUSES.includes(r.status);

async function act(sid: string, r: SwapRequest, action: 'accept' | 'decline' | 'cancel' | 'approve' | 'reject', done: string, note?: string) {
  try {
    await callActSwapRequest({ sessionId: sid, requestId: r.id, action, note });
    toast(done);
  } catch (e) {
    toast(errorMessage(e), 'alert');
  }
}

function RequestItem({ sid, r, name, me, admin }: { sid: string; r: SwapRequest; name: (id: string) => string; me: string | null; admin: boolean }) {
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const run = async (action: Parameters<typeof act>[2], done: string, n?: string) => {
    setBusy(true);
    await act(sid, r, action, done, n);
    setBusy(false);
  };
  const myTurn = me !== null && r.status === 'PENDING_PEERS' && r.responses[me] === 'PENDING';
  return (
    <li className="rounded-xl border border-line p-3" aria-label={`교환 요청 ${name(r.requesterId)}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-bold">
          {name(r.requesterId)} 선생님의 {r.kind === 'SWAP' ? '교환' : '넘기기'} 요청
          <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${isOpen(r) ? 'bg-primary-soft text-primary-strong' : 'bg-bg text-muted'}`}>
            {SWAP_STATUS_LABEL[r.status]}
          </span>
        </div>
      </div>
      <ul className="mt-1 text-sm">
        {r.summary.map((s) => (
          <li key={s}>• {s}</li>
        ))}
      </ul>
      {r.reason && <p className="mt-1 text-sm text-muted">사유: {r.reason}</p>}
      {r.status === 'PENDING_PEERS' && (
        <p className="mt-1 text-sm text-muted">
          수락:{' '}
          {Object.entries(r.responses)
            .map(([t, v]) => `${name(t)} ${v === 'ACCEPTED' ? '✓' : v === 'DECLINED' ? '✗' : '대기'}`)
            .join(', ')}
        </p>
      )}
      {r.note && <p className="mt-1 text-sm text-alert">{r.note}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {myTurn && (
          <>
            <Button onClick={() => void run('accept', '수락했습니다.')} disabled={busy}>
              수락
            </Button>
            <Button variant="secondary" onClick={() => void run('decline', '거절했습니다.')} disabled={busy}>
              거절
            </Button>
          </>
        )}
        {admin && r.status === 'PENDING_ADMIN' && (
          <Button onClick={() => void run('approve', '승인해 시간표에 반영했습니다.')} disabled={busy}>
            승인·반영
          </Button>
        )}
        {admin && isOpen(r) && (
          <Button variant="secondary" onClick={() => setRejecting(true)} disabled={busy}>
            반려
          </Button>
        )}
        {isOpen(r) && !admin && me === r.requesterId && (
          <Button variant="ghost" onClick={() => void run('cancel', '요청을 취소했습니다.')} disabled={busy}>
            요청 취소
          </Button>
        )}
      </div>
      {rejecting && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <Field label="반려 사유" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button variant="danger" onClick={() => void run('reject', '반려했습니다.', note)} disabled={busy}>
            반려하기
          </Button>
        </div>
      )}
    </li>
  );
}

export function SwapRequestList({ sid, list, name, me, admin, empty }: { sid: string; list: SwapRequest[]; name: (id: string) => string; me: string | null; admin: boolean; empty: string }) {
  if (!list.length) return <p className="text-muted">{empty}</p>;
  return (
    <ul className="grid gap-2">
      {list.map((r) => (
        <RequestItem key={r.id} sid={sid} r={r} name={name} me={me} admin={admin} />
      ))}
    </ul>
  );
}

/** 교사: 내 감독 하나를 골라 교환 방법을 찾고 요청한다 */
function SwapDialog({ sid, duty, colleagues, onClose }: { sid: string; duty: Duty; colleagues: { id: string; name: string }[]; onClose: () => void }) {
  const [partner, setPartner] = useState('');
  const [reason, setReason] = useState('');
  const [options, setOptions] = useState<Option[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await callSuggestSwaps({ sessionId: sid, seatId: duty.id, partnerId: partner || undefined });
      setOptions(r.data.options);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const send = async (o: Option) => {
    setBusy(true);
    try {
      await callCreateSwapRequest({ sessionId: sid, kind: o.kind, moves: o.moves, reason: reason.trim() || undefined });
      toast('교환을 요청했습니다. 관련 선생님이 수락하면 관리자가 승인합니다.');
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Modal title="감독 교환 요청" onClose={onClose} wide>
      <div className="grid gap-4">
        <p>
          <b>
            {duty.date.slice(5).replace('-', '/')} {duty.period}교시 {duty.roomName} {duty.role}
          </b>{' '}
          감독을 다른 선생님과 바꾸거나 넘깁니다.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1">
            <span className="text-sm font-semibold">바꾸고 싶은 선생님 (선택)</span>
            <select aria-label="바꾸고 싶은 선생님" className="min-h-12 rounded-xl border border-line px-3" value={partner} onChange={(e) => setPartner(e.target.value)}>
              <option value="">누구든 (가능한 방법 모두)</option>
              {colleagues.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <Field label="사유 (선택)" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: 출장" />
          <Button onClick={() => void search()} disabled={busy}>
            {busy && !options ? '찾는 중…' : '교환 방법 찾기'}
          </Button>
        </div>
        {busy && !options && <Spinner />}
        {options && options.length === 0 && <Alert tone="info">조건(불가시간·동시간 감독 등)을 지키는 교환 방법이 없습니다. 관리자에게 문의하세요.</Alert>}
        {options && options.length > 0 && (
          <ul className="grid gap-2">
            {options.map((o, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3">
                <div>
                  <div className="font-bold">
                    {o.kind === 'SWAP' ? (o.moves.length > 2 ? `연쇄 교환 (${new Set(o.moves.map((m) => m.to)).size}명)` : '맞바꾸기') : '넘기기'}
                  </div>
                  <ul className="text-sm">
                    {o.summary.map((s) => (
                      <li key={s}>• {s}</li>
                    ))}
                  </ul>
                </div>
                <Button variant="secondary" onClick={() => void send(o)} disabled={busy} aria-label={`방법 ${i + 1}로 요청`}>
                  이 방법으로 요청
                </Button>
              </li>
            ))}
          </ul>
        )}
        {error && <Alert>{error}</Alert>}
      </div>
    </Modal>
  );
}

/** 교사 화면: 감독 교환 (요청하기 + 내가 관련된 요청 목록) */
export function TeacherSwapPanel({
  sid,
  open,
  teacherId,
  duties,
  teachers,
}: {
  sid: string;
  /** 교환 가능한 단계(교사 공개·교환 기간)인지 */
  open: boolean;
  teacherId: string;
  duties: Duty[];
  teachers: { id: string; name: string }[];
}) {
  const reqs = useSwapRequests(sid, teacherId);
  const [duty, setDuty] = useState<Duty | null>(null);
  const name = (id: string) => teachers.find((t) => t.id === id)?.name ?? id;
  const busySeats = new Set(reqs.data.filter(isOpen).flatMap((r) => r.moves.map((m) => m.seatId)));
  const toAnswer = reqs.data.filter((r) => r.status === 'PENDING_PEERS' && r.responses[teacherId] === 'PENDING');

  return (
    <Card className="no-print">
      <h2 className="text-lg font-bold">
        감독 교환
        {toAnswer.length > 0 && <span className="ml-2 rounded-full bg-alert px-2 py-0.5 text-sm text-white">응답 필요 {toAnswer.length}</span>}
      </h2>
      {open ? (
        <>
          <p className="mt-1 text-muted">바꾸고 싶은 감독을 고르면 조건을 지키는 교환 방법을 찾아 드립니다. 관련 선생님 수락 → 관리자 승인 후 반영됩니다.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {duties.map((d) => (
              <Button key={d.id} variant="secondary" disabled={busySeats.has(d.id)} onClick={() => setDuty(d)}>
                {d.date.slice(5).replace('-', '/')} {d.period}교시 {d.roomName} 교환
                {busySeats.has(d.id) && ' (요청 중)'}
              </Button>
            ))}
          </div>
        </>
      ) : (
        <p className="mt-1 text-muted">교환 요청은 교사 공개·교환 기간에만 할 수 있습니다.</p>
      )}
      <div className="mt-4">
        {reqs.loading ? (
          <Spinner />
        ) : (
          <SwapRequestList sid={sid} list={reqs.data} name={name} me={teacherId} admin={false} empty="관련된 교환 요청이 없습니다." />
        )}
      </div>
      {duty && <SwapDialog sid={sid} duty={duty} colleagues={teachers.filter((t) => t.id !== teacherId)} onClose={() => setDuty(null)} />}
    </Card>
  );
}

/** 관리자 화면: 교환 요청 승인·반려 */
export function AdminSwapCard({ sid, name }: { sid: string; name: (id: string) => string }) {
  const reqs = useSwapRequests(sid, null);
  const [all, setAll] = useState(false);
  const open = reqs.data.filter(isOpen);
  const shown = all ? reqs.data : open;
  if (!reqs.loading && reqs.data.length === 0) return null;
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">
          교사 교환 요청 {open.length > 0 && <span className="ml-1 rounded-full bg-alert px-2 py-0.5 text-sm text-white">{open.length}</span>}
        </h2>
        <Button variant="ghost" onClick={() => setAll(!all)}>
          {all ? '진행 중만 보기' : `처리된 요청도 보기 (${reqs.data.length - open.length})`}
        </Button>
      </div>
      <div className="mt-3">
        {reqs.loading ? <Spinner /> : <SwapRequestList sid={sid} list={shown} name={name} me={null} admin empty="진행 중인 교환 요청이 없습니다." />}
      </div>
    </Card>
  );
}
