import { useState } from 'react';
import { ACCESS_KIND_LABEL, type AccessRequestDoc } from '@sim/shared';
import { Modal } from '@/components/Modal';
import { toast } from '@/components/Toast';
import { Button, Card, Table, Td } from '@/components/ui';
import { useCollection } from '@/lib/data';
import { callReviewAccessRequest, errorMessage } from '@/lib/firebase';

/** 가입·관리자 권한 신청 목록: 승인 / 반려(사유) */
export function AccessRequestsCard() {
  const { data, loading } = useCollection<AccessRequestDoc>('accessRequests', ['status', 'PENDING']);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<AccessRequestDoc | null>(null);
  const [note, setNote] = useState('');

  const review = async (r: AccessRequestDoc, approve: boolean, reason?: string) => {
    setBusy(r.uid);
    try {
      await callReviewAccessRequest({ uid: r.uid, approve, note: reason });
      toast(approve ? `${r.name}(${ACCESS_KIND_LABEL[r.kind]}) 신청을 승인했습니다.` : `${r.name} 신청을 반려했습니다.`);
      setRejecting(null);
    } catch (e) {
      toast(errorMessage(e), 'alert');
    } finally {
      setBusy(null);
    }
  };

  if (loading || data.length === 0) return null;

  return (
    <Card className="mb-6 border-2 border-primary">
      <h2 className="text-lg font-bold">가입·권한 신청 {data.length}건</h2>
      <p className="mt-1 text-muted">
        교사(사용자) 신청을 승인하면 교사 명단에 등록되고, 관리자 신청을 승인하면 관리자가 됩니다. 신청자는 다음부터 이 이메일(Google 계정)로 로그인합니다.
      </p>
      <div className="mt-3">
        <Table head={['신청', '이름', '과목', '학교·학기', '이메일', '']}>
          {data.map((r) => (
            <tr key={r.uid}>
              <Td>
                <span className={`rounded-full px-3 py-1 text-sm font-bold ${r.kind === 'ADMIN' ? 'bg-alert-soft' : 'bg-primary-soft text-primary-strong'}`}>
                  {ACCESS_KIND_LABEL[r.kind]}
                </span>
              </Td>
              <Td className="font-bold">{r.name}</Td>
              <Td>{r.subject ?? ''}</Td>
              <Td>{r.school ? `${r.school} · ${r.year}학년도 ${r.semester}학기` : ''}</Td>
              <Td>{r.email}</Td>
              <Td className="whitespace-nowrap">
                <Button disabled={busy !== null} onClick={() => void review(r, true)}>
                  승인
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy !== null}
                  onClick={() => {
                    setNote('');
                    setRejecting(r);
                  }}
                >
                  반려
                </Button>
              </Td>
            </tr>
          ))}
        </Table>
      </div>
      {rejecting && (
        <Modal title="신청 반려" onClose={() => setRejecting(null)}>
          <p>
            {rejecting.name} · {rejecting.email} ({ACCESS_KIND_LABEL[rejecting.kind]})
          </p>
          <label className="mt-3 flex flex-col gap-1.5">
            <span className="font-semibold">반려 사유 (신청자에게 보입니다)</span>
            <input className="min-h-12 rounded-xl border border-line px-4" value={note} maxLength={80} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="mt-4 flex gap-2">
            <Button variant="danger" disabled={busy !== null} onClick={() => void review(rejecting, false, note.trim() || undefined)}>
              반려
            </Button>
            <Button variant="secondary" onClick={() => setRejecting(null)}>
              취소
            </Button>
          </div>
        </Modal>
      )}
    </Card>
  );
}
