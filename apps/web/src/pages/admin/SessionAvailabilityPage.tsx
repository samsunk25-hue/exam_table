import { Link } from 'react-router';
import { useMemo, useState } from 'react';
import {
  AVAILABILITY_STATUS_LABEL,
  capacityByTime,
  examTimes,
  groupByDate,
  type AvailabilityDoc,
  type RoomDoc,
  type SlotDoc,
} from '@sim/shared';
import { AvailabilityGrid, GridLegend, ReasonPicker, dateLabel } from '@/components/AvailabilityGrid';
import { AvailabilityText, type AvailabilityTextResult } from '@/components/AvailabilityText';
import { Modal } from '@/components/Modal';
import { toast } from '@/components/Toast';
import { Alert, Button, Card, Select, Spinner, Table, Td, CardTitle } from '@/components/ui';
import { cellKey, deleteAvailability, reviewAvailability, sortAvailability, submitAvailability, type Availability } from '@/lib/availability';
import { useCollection } from '@/lib/data';
import { termWhere, useSessionTeachers } from '@/lib/sessions';
import { errorMessage } from '@/lib/firebase';
import { useCurrentSession } from './SessionPage';

/** 시간대별 필요 감독 수와 가용 교사 수 */
function CapacityCard({ rows }: { rows: ReturnType<typeof capacityByTime> }) {
  const short = rows.filter((r) => r.available < r.need);
  return (
    <Card>
      <CardTitle icon="👥">시간대별 인력 현황</CardTitle>
      <p className="mt-1 text-muted">가용 인원 = 감독 가능한 교사 − 불가시간(승인·대기) 교사. 자동 배정 전에 부족한 시간이 없는지 확인하세요.</p>
      {short.length > 0 && (
        <div className="mt-3">
          <Alert>
            감독 인원이 부족한 시간이 {short.length}곳 있습니다: {short.map((r) => `${dateLabel(r.date)} ${r.period}교시`).join(', ')}
          </Alert>
        </div>
      )}
      {rows.length === 0 ? (
        <p className="mt-3 text-muted">
          시험 일정이 없습니다.{' '}
          <Link to="../schedule" relative="path" className="font-semibold text-primary-strong underline underline-offset-2">
            시험 일정 입력하기 →
          </Link>
        </p>
      ) : (
        groupByDate(rows).map(([date, list]) => (
          <section key={date} className="mt-4">
            <h3 className="mb-1 font-bold">{dateLabel(date)}</h3>
            <Table head={['교시', '필요 감독', '가용 교사', '불가(승인)', '불가(대기)', '여유']}>
              {list.map((r) => {
                const spare = r.available - r.need;
                return (
                  <tr key={r.period} className={spare < 0 ? 'bg-alert-soft' : ''}>
                    <Td className="font-bold">{r.period}교시</Td>
                    <Td>{r.need}명</Td>
                    <Td className="font-bold">{r.available}명</Td>
                    <Td>{r.approvedOff}명</Td>
                    <Td>{r.pendingOff ? <span className="font-semibold text-primary-strong">{r.pendingOff}명</span> : '0명'}</Td>
                    <Td className={spare < 0 ? 'font-bold text-[#c0392b]' : ''}>{spare < 0 ? `${-spare}명 부족` : `${spare}명`}</Td>
                  </tr>
                );
              })}
            </Table>
          </section>
        ))
      )}
    </Card>
  );
}

/** 제출 목록: 승인·반려·삭제 */
function RequestsCard({ sid, list, nameOf }: { sid: string; list: Availability[]; nameOf: (id: string) => string }) {
  const [filter, setFilter] = useState<'PENDING' | 'ALL'>('PENDING');
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState<Availability | null>(null);
  const [note, setNote] = useState('');
  const pending = list.filter((a) => a.status === 'PENDING');
  const shown = sortAvailability(filter === 'PENDING' ? pending : list, nameOf);

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast(done);
    } catch (e) {
      toast(errorMessage(e), 'alert');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle icon="📮">제출된 불가 시간</CardTitle>
        <div className="flex flex-wrap gap-2">
          <Button variant={filter === 'PENDING' ? 'primary' : 'secondary'} onClick={() => setFilter('PENDING')}>
            승인 대기 {pending.length}
          </Button>
          <Button variant={filter === 'ALL' ? 'primary' : 'secondary'} onClick={() => setFilter('ALL')}>
            전체 {list.length}
          </Button>
        </div>
      </div>
      {pending.length > 0 && (
        <div className="mt-3">
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => void run(() => reviewAvailability(sid, pending.map((a) => a.id), 'APPROVED'), `${pending.length}건을 승인했습니다.`)}
          >
            대기 {pending.length}건 모두 승인
          </Button>
        </div>
      )}
      {shown.length === 0 ? (
        <p className="mt-4 text-muted">{filter === 'PENDING' ? '승인을 기다리는 제출이 없습니다.' : '제출된 불가 시간이 없습니다.'}</p>
      ) : (
        <div className="mt-3">
          <Table head={['교사', '날짜', '교시', '사유', '상태', '']}>
            {shown.map((a) => (
              <tr key={a.id} className={a.status === 'REJECTED' ? 'text-muted' : ''}>
                <Td className="font-bold">{nameOf(a.teacherId)}</Td>
                <Td className="whitespace-nowrap">{dateLabel(a.date)}</Td>
                <Td>{a.period}교시</Td>
                <Td>{a.reason}</Td>
                <Td>
                  {AVAILABILITY_STATUS_LABEL[a.status]}
                  {a.source === 'ADMIN' && <span className="ml-1 text-sm text-muted">(대리)</span>}
                  {a.adminNote && <div className="text-sm text-muted">{a.adminNote}</div>}
                </Td>
                <Td className="whitespace-nowrap">
                  {a.status !== 'APPROVED' ? (
                    <Button variant="ghost" disabled={busy} onClick={() => void run(() => reviewAvailability(sid, [a.id], 'APPROVED'), '승인했습니다.')}>
                      승인
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void run(() => reviewAvailability(sid, [a.id], 'PENDING'), '승인을 취소했습니다 (승인 대기로 돌림).')}
                    >
                      승인 취소
                    </Button>
                  )}
                  {a.status !== 'REJECTED' && (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        setNote('');
                        setRejecting(a);
                      }}
                    >
                      반려
                    </Button>
                  )}
                  <Button variant="ghost" disabled={busy} onClick={() => void run(() => deleteAvailability(sid, [a.id]), '삭제했습니다.')}>
                    삭제
                  </Button>
                </Td>
              </tr>
            ))}
          </Table>
        </div>
      )}

      {rejecting && (
        <Modal title="불가 시간 반려" onClose={() => setRejecting(null)}>
          <p>
            {nameOf(rejecting.teacherId)} · {dateLabel(rejecting.date)} {rejecting.period}교시 ({rejecting.reason})
          </p>
          <label className="mt-3 flex flex-col gap-1.5">
            <span className="font-semibold">반려 사유 (교사에게 보입니다)</span>
            <input
              className="min-h-12 rounded-xl border border-line px-4 outline-none focus:border-primary"
              value={note}
              maxLength={60}
              placeholder="예: 해당 시간 감독 인원 부족"
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <div className="mt-4 flex gap-2">
            <Button
              variant="danger"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await reviewAvailability(sid, [rejecting.id], 'REJECTED', note.trim() || null);
                  setRejecting(null);
                }, '반려했습니다.')
              }
            >
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

/** 관리자 대리 입력 (바로 승인) */
function ProxyCard({ sid, teachers, times, all }: { sid: string; teachers: { id: string; name: string }[]; times: ReturnType<typeof examTimes>; all: Availability[] }) {
  const [teacherId, setTeacherId] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState('출장');
  const [busy, setBusy] = useState(false);
  const [reasonKey, setReasonKey] = useState(0);
  const entries = useMemo(() => new Map(all.filter((a) => a.teacherId === teacherId).map((a) => [cellKey(a), a])), [all, teacherId]);

  // 문장으로 고른 칸 (교사 이름까지 적으면 교사도 고른다). 교사가 바뀌면 선택을 새로 시작한다.
  const fromText = (r: AvailabilityTextResult) => {
    const who = r.teacherId ?? teacherId;
    if (!who) return;
    const have = new Set(all.filter((a) => a.teacherId === who).map(cellKey));
    const keys = r.cells.map(cellKey).filter((k) => !have.has(k));
    if (!keys.length) {
      toast('그 시간은 이미 입력되어 있습니다.');
      return;
    }
    setSelected(new Set([...(who === teacherId ? selected : []), ...keys]));
    setTeacherId(who);
    setReason(r.reason);
    setReasonKey((n) => n + 1);
    toast(`${teachers.find((t) => t.id === who)?.name} 교사 ${keys.length}칸을 골랐습니다. 확인 후 대리 입력을 누르세요.`);
  };

  const submit = async () => {
    setBusy(true);
    try {
      const cells = [...selected].map((k) => {
        const [date, period] = k.split('|');
        return { date: date!, period: Number(period) };
      });
      await submitAvailability(sid, teacherId, cells, reason.trim() || '기타', true);
      toast(`${teachers.find((t) => t.id === teacherId)?.name} 교사의 불가 시간 ${cells.length}칸을 입력했습니다 (승인).`);
      setSelected(new Set());
    } catch (e) {
      toast(errorMessage(e), 'alert');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardTitle icon="✍️">대리 입력</CardTitle>
      <p className="mt-1 text-muted">교사 대신 불가 시간을 입력합니다. 관리자가 입력한 항목은 바로 승인됩니다.</p>
      <div className="mt-3">
        <AvailabilityText
          sessionId={sid}
          teacherId={teacherId || undefined}
          placeholder={teacherId ? '문장으로 적어도 됩니다. 예) 11/3 오전 출장' : '예) 김국어 11/3 오전 출장 — 이름까지 적으면 교사도 골라 줍니다'}
          onResult={fromText}
        />
      </div>
      <div className="mt-3 max-w-sm">
        <Select
          label="교사"
          value={teacherId}
          onChange={(e) => {
            setTeacherId(e.target.value);
            setSelected(new Set());
          }}
          options={[{ value: '', label: '교사를 선택하세요' }, ...teachers.map((t) => ({ value: t.id, label: t.name }))]}
        />
      </div>
      {teacherId && (
        <div className="mt-4 grid gap-4">
          <GridLegend />
          <AvailabilityGrid
            times={times}
            entries={entries}
            selected={selected}
            onToggle={(key) => {
              const next = new Set(selected);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              setSelected(next);
            }}
            onEntryClick={(entry) => toast(`이미 ${AVAILABILITY_STATUS_LABEL[entry.status]} 상태입니다. 위 목록에서 승인·반려·삭제할 수 있습니다.`)}
          />
          {selected.size > 0 && (
            <>
              <ReasonPicker key={reasonKey} value={reason} onChange={setReason} />
              <div className="flex gap-2">
                <Button onClick={() => void submit()} disabled={busy}>
                  {busy ? '입력 중…' : `${selected.size}칸 대리 입력`}
                </Button>
                <Button variant="secondary" onClick={() => setSelected(new Set())} disabled={busy}>
                  선택 해제
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

export function SessionAvailabilityPage() {
  const session = useCurrentSession();
  const sid = session.id;
  const slots = useCollection<SlotDoc>(`sessions/${sid}/slots`);
  const rooms = useCollection<RoomDoc>('rooms', termWhere(session));
  const teachers = useSessionTeachers(session);
  const availability = useCollection<AvailabilityDoc>(`sessions/${sid}/availability`);

  const nameById = useMemo(() => new Map(teachers.data.map((t) => [t.id, t.name])), [teachers.data]);
  const nameOf = (id: string) => nameById.get(id) ?? `(삭제된 교사 ${id})`;
  const capacity = useMemo(
    () => capacityByTime(slots.data, rooms.data, teachers.data, availability.data),
    [slots.data, rooms.data, teachers.data, availability.data],
  );
  const times = useMemo(() => examTimes(slots.data), [slots.data]);
  const activeTeachers = useMemo(
    () => teachers.data.filter((t) => t.active && t.defaultRole !== 'EXCLUDED').sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    [teachers.data],
  );

  const loading = slots.loading || rooms.loading || teachers.loading || availability.loading;
  const error = slots.error ?? rooms.error ?? teachers.error ?? availability.error;
  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;

  return (
    <div className="grid gap-6">
      {/* 교사가 낸 불가시간은 승인 없이 바로 반영된다 (관리자는 아래 목록에서 문제 있는 것만 반려) */}
      <CapacityCard rows={capacity} />
      <RequestsCard sid={sid} list={availability.data} nameOf={nameOf} />
      {times.length > 0 && <ProxyCard sid={sid} teachers={activeTeachers} times={times} all={availability.data} />}
    </div>
  );
}
