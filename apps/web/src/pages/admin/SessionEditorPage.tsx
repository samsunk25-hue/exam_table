import { useMemo, useState } from 'react';
import {
  DEFAULT_ROLE_WEIGHTS,
  EXCLUSION_LABEL,
  buildEngineInput,
  buildSeats,
  findSwapChains,
  seatCandidates,
  type EngineInput,
  type Seat,
  type SwapChain,
} from '@sim/engine';
import {
  SEAT_ROLE_LABEL,
  examTimes,
  groupByDate,
  type AssignmentDoc,
  type AvailabilityDoc,
  type BaseTimetableDoc,
  type ConstraintDoc,
  type RoomDoc,
  type SlotDoc,
  type TeacherDoc,
  type WithId,
} from '@sim/shared';
import { dateLabel } from '@/components/AvailabilityGrid';
import { Modal } from '@/components/Modal';
import { AdminSwapCard } from '@/components/SwapRequests';
import { toast } from '@/components/Toast';
import { Alert, Button, Card, Select, Spinner, Table, Td } from '@/components/ui';
import { useCollection } from '@/lib/data';
import { callApplyChanges, errorMessage } from '@/lib/firebase';
import { termWhere, type ExamSession } from '@/lib/sessions';
import { sortRooms } from './RoomsPage';
import { useCurrentSession } from './SessionPage';

type Assignment = WithId<AssignmentDoc>;

interface EditorData {
  input: EngineInput;
  seats: Seat[];
  assignments: Assignment[];
  nameOf: (id: string) => string;
  teachers: WithId<TeacherDoc>[];
}

function seatText(seat: Seat, roomName: string) {
  return `${dateLabel(seat.date)} ${seat.period}교시 · ${roomName} ${SEAT_ROLE_LABEL[seat.role]} (${seat.grade}학년 ${seat.subject})`;
}

/** 좌석 편집: 후보 교사 고르기 / 비우기 / 연쇄 교환 찾기 */
function SeatDialog({
  session,
  seat,
  roomName,
  data,
  onClose,
}: {
  session: ExamSession;
  seat: Seat;
  roomName: string;
  data: EditorData;
  onClose: () => void;
}) {
  const current = data.assignments.find((a) => a.id === seat.id);
  const [tab, setTab] = useState<'change' | 'swap'>('change');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [partner, setPartner] = useState('');
  const [chains, setChains] = useState<SwapChain[] | null>(null);
  const needReason = session.status === 'CONFIRMED';
  const plain = data.assignments.map((a) => ({ seatId: a.id, teacherId: a.teacherId }));
  const candidates = useMemo(
    () => seatCandidates(data.input, data.assignments.map((a) => ({ seatId: a.id, teacherId: a.teacherId })), seat.id),
    [data.input, data.assignments, seat.id],
  );
  const seatById = new Map(data.seats.map((s) => [s.id, s]));
  const roomNameOf = new Map(data.input.rooms.map((r) => [r.id, r.name]));

  const save = async (changes: { seatId: string; teacherId: string | null }[], label: string, done: string) => {
    if (needReason && !reason.trim()) return toast('최종 확정 이후 변경에는 사유를 입력해야 합니다.', 'alert');
    setBusy(true);
    try {
      await callApplyChanges({ sessionId: session.id, changes, reason: reason.trim() || undefined, label });
      toast(done);
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'alert');
      setBusy(false);
    }
  };

  const search = () => {
    if (!current) return;
    const t0 = performance.now();
    const found = findSwapChains(data.input, plain, { teacherId: current.teacherId, seatId: seat.id, partnerId: partner || undefined }, { maxTeachers: 4, limit: 5 });
    setChains(found);
    if (!found.length) toast(`교환 경로를 찾지 못했습니다 (${Math.round(performance.now() - t0)}ms 탐색).`, 'alert');
  };

  return (
    <Modal title="감독 배정 편집" onClose={onClose} wide>
      <div className="grid gap-4">
        <div>
          <p className="font-bold">{seatText(seat, roomName)}</p>
          <p className="text-muted">
            현재: <strong className="text-ink">{current ? data.nameOf(current.teacherId) : '미배정'}</strong>
            {current && <span className="ml-2 text-sm">{current.reason}</span>}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant={tab === 'change' ? 'primary' : 'secondary'} onClick={() => setTab('change')}>
            교사 바꾸기
          </Button>
          <Button variant={tab === 'swap' ? 'primary' : 'secondary'} onClick={() => setTab('swap')} disabled={!current}>
            연쇄 교환 찾기
          </Button>
          {current && (
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => void save([{ seatId: seat.id, teacherId: null }], '비우기', '배정을 비웠습니다.')}
            >
              비우기
            </Button>
          )}
        </div>

        {needReason && (
          <label className="flex flex-col gap-1.5">
            <span className="font-semibold">변경 사유 (최종 확정 이후 필수, 변경 이력에 남습니다)</span>
            <input className="min-h-12 rounded-xl border border-line px-4" value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
        )}

        {tab === 'change' && (
          <div className="max-h-[50dvh] overflow-auto">
            <Table head={['교사', '점수', '근거·불가 사유', '']}>
              {candidates.map((c) => (
                <tr key={c.teacherId} className={c.blockedBy ? 'text-muted' : ''}>
                  <Td className="font-bold">{c.name}</Td>
                  <Td>{c.blockedBy ? '' : c.score}</Td>
                  <Td className="text-sm">{c.blockedBy ? EXCLUSION_LABEL[c.blockedBy] : c.reason}</Td>
                  <Td>
                    {!c.blockedBy && c.teacherId !== current?.teacherId && (
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() => void save([{ seatId: seat.id, teacherId: c.teacherId }], '수동 변경', `${c.name} 교사로 바꿨습니다.`)}
                      >
                        배정
                      </Button>
                    )}
                    {c.teacherId === current?.teacherId && <span className="text-sm">현재</span>}
                  </Td>
                </tr>
              ))}
            </Table>
          </div>
        )}

        {tab === 'swap' && current && (
          <div className="grid gap-3">
            <p className="text-muted">
              {data.nameOf(current.teacherId)} 교사가 이 감독을 내보내고 다른 감독 1건을 받는 교환 경로를 찾습니다. 경로에 있는 교사는 모두 1건을 주고 1건을 받으므로 감독 수는
              그대로입니다.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-60">
                <Select
                  label="바꾸고 싶은 상대 (선택)"
                  value={partner}
                  onChange={(e) => {
                    setPartner(e.target.value);
                    setChains(null);
                  }}
                  options={[
                    { value: '', label: '누구든 (가능한 경로 모두)' },
                    ...data.teachers
                      .filter((t) => t.id !== current.teacherId && data.assignments.some((a) => a.teacherId === t.id))
                      .map((t) => ({ value: t.id, label: t.name })),
                  ]}
                />
              </div>
              <Button onClick={search}>경로 찾기</Button>
            </div>
            {chains?.map((chain, i) => (
              <div key={i} className="rounded-xl border border-line p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-lg font-bold">
                    {chain.teachers.length === 2
                      ? `1:1 교환: ${data.nameOf(chain.teachers[0]!)} ⇄ ${data.nameOf(chain.teachers[1]!)}`
                      : `${chain.teachers.length}각 연쇄 교환: ${chain.teachers.map((id) => data.nameOf(id)).join(' ➔ ')}`}
                  </p>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void save(
                        chain.moves.map((m) => ({ seatId: m.seatId, teacherId: m.to })),
                        `${chain.teachers.length === 2 ? '1:1' : `${chain.teachers.length}각`} 교환`,
                        `교환을 적용했습니다 (${chain.moves.length}건).`,
                      )
                    }
                  >
                    이 경로 적용
                  </Button>
                </div>
                <ul className="mt-2 text-sm">
                  {chain.moves.map((m) => {
                    const s = seatById.get(m.seatId)!;
                    return (
                      <li key={m.seatId}>
                        {dateLabel(s.date)} {s.period}교시 {roomNameOf.get(s.roomId)} {SEAT_ROLE_LABEL[s.role]}: {data.nameOf(m.from)} → <strong>{data.nameOf(m.to)}</strong>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

export function SessionEditorPage() {
  const session = useCurrentSession();
  const sid = session.id;
  const slots = useCollection<SlotDoc>(`sessions/${sid}/slots`);
  const rooms = useCollection<RoomDoc>('rooms', termWhere(session));
  const teachers = useCollection<TeacherDoc>('teachers', termWhere(session));
  const assignments = useCollection<AssignmentDoc>(`sessions/${sid}/assignments`);
  const availability = useCollection<AvailabilityDoc>(`sessions/${sid}/availability`);
  const constraints = useCollection<ConstraintDoc>(`sessions/${sid}/constraints`);
  const timetable = useCollection<BaseTimetableDoc>(`sessions/${sid}/baseTimetable`);
  const [editing, setEditing] = useState<Seat | null>(null);

  const all = [slots, rooms, teachers, assignments, availability, constraints, timetable];
  const loading = all.some((x) => x.loading);
  const error = all.find((x) => x.error)?.error;

  const data = useMemo<EditorData | null>(() => {
    if (loading) return null;
    const input = buildEngineInput({
      teachers: teachers.data,
      rooms: rooms.data,
      slots: slots.data,
      availability: availability.data,
      constraints: constraints.data,
      baseTimetable: timetable.data,
      useBaseTimetable: session.settings.useBaseTimetable,
      examWriterRule: session.settings.examWriter ?? 'NONE',
    });
    const names = new Map(teachers.data.map((t) => [t.id, t.name]));
    return {
      input,
      seats: buildSeats(input, DEFAULT_ROLE_WEIGHTS),
      assignments: assignments.data,
      nameOf: (id) => names.get(id) ?? id,
      teachers: [...teachers.data].sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    };
  }, [loading, teachers.data, rooms.data, slots.data, availability.data, constraints.data, timetable.data, assignments.data, session.settings.useBaseTimetable, session.settings.examWriter]);

  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  if (!data) return null;

  const byId = new Map(data.assignments.map((a) => [a.id, a]));
  const roomName = new Map(rooms.data.map((r) => [r.id, r.name]));
  const usedRooms = new Set(data.seats.map((s) => s.roomId));
  const roomList = sortRooms(rooms.data.filter((r) => usedRooms.has(r.id)));
  const unassigned = data.seats.filter((s) => !byId.has(s.id)).length;
  const locked = session.status === 'LOCKED';

  return (
    <div className="grid gap-6">
      <Card>
        <h2 className="text-lg font-bold">시간표 편집</h2>
        <p className="mt-1 text-muted">
          칸을 누르면 감독 교사를 바꾸거나, 1:1이 안 될 때 여러 교사가 이어서 바꾸는 연쇄 교환 경로를 찾을 수 있습니다. 모든 변경은 저장 전에 하드 조건을 다시 검사합니다.
        </p>
        <p className="mt-2">
          배정 {data.assignments.length} / {data.seats.length}석
          {unassigned > 0 && <span className="ml-2 font-bold text-[#c0392b]">미배정 {unassigned}석</span>}
        </p>
        {locked && (
          <div className="mt-3">
            <Alert>변경 잠금 상태입니다. 개요에서 잠금을 해제해야 수정할 수 있습니다.</Alert>
          </div>
        )}
        {data.seats.length === 0 && <p className="mt-2 text-muted">시험 일정과 시험실 배치를 먼저 등록하세요.</p>}
      </Card>

      <AdminSwapCard sid={session.id} name={data.nameOf} />

      {groupByDate(examTimes(slots.data)).map(([date, times]) => (
        <Card key={date}>
          <h3 className="mb-2 font-bold">{dateLabel(date)}</h3>
          <Table head={['시험실', ...times.map((t) => `${t.period}교시`)]}>
            {roomList.map((r) => (
              <tr key={r.id}>
                <Td className="font-bold whitespace-nowrap">{r.name}</Td>
                {times.map((t) => {
                  const seats = data.seats.filter((s) => s.roomId === r.id && s.date === date && s.period === t.period);
                  return (
                    <Td key={t.period}>
                      <div className="flex flex-col gap-1">
                        {seats.map((s) => {
                          const a = byId.get(s.id);
                          return (
                            <button
                              key={s.id}
                              type="button"
                              disabled={locked}
                              onClick={() => setEditing(s)}
                              className={`min-h-11 cursor-pointer rounded-lg px-2 text-left font-semibold transition-colors disabled:cursor-default ${
                                a
                                  ? `${a.source === 'MANUAL' ? 'border-2 border-primary' : 'border border-line'} bg-surface hover:bg-primary-soft`
                                  : 'border-2 border-dashed border-alert bg-alert-soft text-[#c0392b]'
                              }`}
                            >
                              {a ? data.nameOf(a.teacherId) : '미배정'}
                              {s.role !== 'CHIEF' && <span className="ml-1 text-xs font-normal text-muted">{SEAT_ROLE_LABEL[s.role]}</span>}
                            </button>
                          );
                        })}
                      </div>
                    </Td>
                  );
                })}
              </tr>
            ))}
          </Table>
        </Card>
      ))}

      {editing && (
        <SeatDialog session={session} seat={editing} roomName={roomName.get(editing.roomId) ?? ''} data={data} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
