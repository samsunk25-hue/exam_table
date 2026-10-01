import { useMemo, useState } from 'react';
import {
  AVAILABILITY_STATUS_LABEL,
  examTimes,
  isSetupEditable,
  type AvailabilityDoc,
  type SlotDoc,
} from '@sim/shared';
import { useAuth } from '@/auth/AuthProvider';
import { AvailabilityGrid, GridLegend, ReasonPicker, dateLabel } from '@/components/AvailabilityGrid';
import { Modal } from '@/components/Modal';
import { toast } from '@/components/Toast';
import { Alert, Button, Card, PageTitle, Spinner, Table, Td } from '@/components/ui';
import { cellKey, deleteAvailability, submitAvailability, type Availability } from '@/lib/availability';
import { useCollection } from '@/lib/data';
import { errorMessage } from '@/lib/firebase';
import { sessionTitle, useMySessions, type ExamSession } from '@/lib/sessions';

function MyAvailabilityForm({ session, teacherId }: { session: ExamSession; teacherId: string }) {
  const sid = session.id;
  const slots = useCollection<SlotDoc>(`sessions/${sid}/slots`);
  const mine = useCollection<AvailabilityDoc>(`sessions/${sid}/availability`, ['teacherId', teacherId]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState('출장');
  const [busy, setBusy] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<Availability | null>(null);

  const times = useMemo(() => examTimes(slots.data), [slots.data]);
  const entries = useMemo(() => new Map(mine.data.map((a) => [cellKey(a), a])), [mine.data]);
  const sortedMine = [...mine.data].sort((a, b) => a.date.localeCompare(b.date) || a.period - b.period);

  if (slots.loading || mine.loading) return <Spinner />;
  if (slots.error || mine.error) return <Alert>{slots.error ?? mine.error}</Alert>;
  if (times.length === 0) {
    return (
      <Card>
        <p className="text-muted">아직 시험 일정이 등록되지 않았습니다. 관리자가 일정을 올리면 불가 시간을 제출할 수 있습니다.</p>
      </Card>
    );
  }

  const toggle = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelected(next);
  };

  const submit = async () => {
    setBusy(true);
    try {
      const cells = [...selected].map((k) => {
        const [date, period] = k.split('|');
        return { date: date!, period: Number(period) };
      });
      await submitAvailability(sid, teacherId, cells, reason.trim(), false);
      toast(`불가 시간 ${cells.length}칸을 제출했습니다. 관리자 승인을 기다립니다.`);
      setSelected(new Set());
    } catch (e) {
      toast(errorMessage(e), 'alert');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!cancelTarget) return;
    setBusy(true);
    try {
      await deleteAvailability(sid, [cancelTarget.id]);
      toast('제출을 취소했습니다.');
      setCancelTarget(null);
    } catch (e) {
      toast(errorMessage(e), 'alert');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6">
      <Card>
        <h2 className="text-lg font-bold">근무할 수 없는 시간을 누르세요</h2>
        <p className="mt-1 text-muted">
          여러 칸을 고른 뒤 사유를 선택하고 제출합니다. 이미 제출한 칸을 누르면 취소할 수 있습니다 (승인된 것도 교사 공개 전까지 취소 가능).
        </p>
        <div className="my-4">
          <GridLegend />
        </div>
        <AvailabilityGrid
          times={times}
          entries={entries}
          selected={selected}
          onToggle={toggle}
          onEntryClick={setCancelTarget}
        />
      </Card>

      {selected.size > 0 && (
        <Card className="sticky bottom-4 z-10 border-primary shadow-lg">
          <div className="grid gap-4">
            <ReasonPicker value={reason} onChange={setReason} />
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => void submit()} disabled={busy || !reason.trim()}>
                {busy ? '제출 중…' : `${selected.size}칸 제출`}
              </Button>
              <Button variant="secondary" onClick={() => setSelected(new Set())} disabled={busy}>
                선택 해제
              </Button>
            </div>
          </div>
        </Card>
      )}

      <Card>
        <h2 className="text-lg font-bold">내 제출 내역</h2>
        {sortedMine.length === 0 ? (
          <p className="mt-2 text-muted">제출한 불가 시간이 없습니다.</p>
        ) : (
          <Table head={['날짜', '교시', '사유', '상태', '관리자 메모']}>
            {sortedMine.map((a) => (
              <tr key={a.id}>
                <Td>{dateLabel(a.date)}</Td>
                <Td className="font-bold">{a.period}교시</Td>
                <Td>{a.reason}</Td>
                <Td className={a.status === 'REJECTED' ? 'text-muted' : 'font-semibold'}>
                  {AVAILABILITY_STATUS_LABEL[a.status]}
                  {a.source === 'ADMIN' && <span className="ml-1 text-sm font-normal text-muted">(관리자 입력)</span>}
                </Td>
                <Td>{a.adminNote ?? ''}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {cancelTarget && (
        <Modal title={cancelTarget.status === 'APPROVED' ? '승인된 불가 시간 취소' : '제출 취소'} onClose={() => setCancelTarget(null)}>
          <p>
            {dateLabel(cancelTarget.date)} {cancelTarget.period}교시 ({cancelTarget.reason}, {AVAILABILITY_STATUS_LABEL[cancelTarget.status]}) 을(를)
            취소할까요?
          </p>
          {cancelTarget.status === 'APPROVED' && (
            <p className="mt-2 text-muted">취소하면 이 시간에도 감독이 배정될 수 있습니다. 이미 자동 배정이 끝났다면 관리자에게도 알려 주세요.</p>
          )}
          <div className="mt-4 flex gap-2">
            <Button variant="danger" onClick={() => void cancel()} disabled={busy}>
              제출 취소
            </Button>
            <Button variant="secondary" onClick={() => setCancelTarget(null)} disabled={busy}>
              닫기
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function MyAvailabilityPage() {
  const { teacherId } = useAuth();
  const { data: sessions, loading, error } = useMySessions(teacherId);
  const open = sessions.filter((s) => isSetupEditable(s.status));
  const [sid, setSid] = useState<string | null>(null);
  const current = open.find((s) => s.id === sid) ?? open[0];

  return (
    <>
      <PageTitle sub="출장·연수 등으로 시험 감독을 할 수 없는 시간을 제출하세요.">불가 시간 관리</PageTitle>
      {loading && <Spinner />}
      {error && <Alert>{error}</Alert>}
      {!loading && !current && (
        <Card>
          <p className="text-muted">지금 불가 시간을 받고 있는 시험이 없습니다.</p>
        </Card>
      )}
      {open.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {open.map((s) => (
            <Button key={s.id} variant={s.id === current?.id ? 'primary' : 'secondary'} onClick={() => setSid(s.id)}>
              {sessionTitle(s)}
            </Button>
          ))}
        </div>
      )}
      {current && teacherId && (
        <>
          <p className="mb-4 font-semibold">{sessionTitle(current)}</p>
          <MyAvailabilityForm key={current.id} session={current} teacherId={teacherId} />
        </>
      )}
    </>
  );
}
