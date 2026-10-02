import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  DEFAULT_ROLE_WEIGHTS,
  EXCLUSION_LABEL,
  buildEngineInput,
  buildSeats,
  findSwapChains,
  seatCandidates,
  validateAssignments,
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
import { Alert, Button, Card, Select, Spinner, Table, Td, CardTitle } from '@/components/ui';
import { useCollection } from '@/lib/data';
import { callApplyChanges, errorMessage } from '@/lib/firebase';
import { termWhere, updateSessionSettings, type ExamSession, useSessionTeachers } from '@/lib/sessions';
import { sortRooms } from './RoomsPage';
import { useCurrentSession } from './SessionPage';
import { TempQuickAssign } from './TempStaffCard';

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
  const candidates = useMemo(() => {
    try {
      return seatCandidates(data.input, data.assignments.map((a) => ({ seatId: a.id, teacherId: a.teacherId })), seat.id);
    } catch {
      return []; // 감독 없음으로 바뀐 자리 등
    }
  }, [data.input, data.assignments, seat.id]);
  const seatById = new Map(data.seats.map((s) => [s.id, s]));
  const roomNameOf = new Map(data.input.rooms.map((r) => [r.id, r.name]));

  /** 이 자리는 감독을 두지 않는다: 배정이 있으면 비우고, 감독 없음 목록에 넣는다 */
  const markNone = async () => {
    if (needReason && !reason.trim()) return toast('최종 확정 이후 변경에는 사유를 입력해야 합니다.', 'alert');
    setBusy(true);
    try {
      if (current) await callApplyChanges({ sessionId: session.id, changes: [{ seatId: seat.id, teacherId: null }], reason: reason.trim() || undefined, label: '감독 없음' });
      onClose(); // 창을 먼저 닫는다 (이 자리는 곧 배정 대상에서 빠진다)
      await updateSessionSettings(session.id, { ...session.settings, noSupervisor: [...new Set([...(session.settings.noSupervisor ?? []), seat.id])] });
      toast('이 자리는 감독 없음으로 정했습니다.');
    } catch (e) {
      toast(errorMessage(e), 'alert');
      setBusy(false);
    }
  };

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
    const found = findSwapChains(data.input, plain, { teacherId: current.teacherId, seatId: seat.id, partnerId: partner || undefined }, { maxTeachers: 4, limit: 5 });
    setChains(found);
    if (!found.length) {
      // 왜 없는지와 다음에 할 일을 알려 준다
      const me = data.nameOf(current.teacherId);
      toast(
        partner
          ? `${me} 교사가 이 감독을 내주고 ${data.nameOf(partner)} 교사의 감독을 받아 오는 방법이 없습니다. 서로의 감독 시간에 수업·불가시간·다른 감독이 겹치거나 연속 감독이 너무 길어집니다. 상대를 "누구든"으로 두고 다시 찾아보세요.`
          : `${me} 교사가 이 감독을 내주고 다른 감독을 받는 방법이 없습니다 (4명까지 이어서 찾아봄). "교사 바꾸기"에서 이 시간이 비어 있는 교사에게 넘기세요.`,
        'alert',
      );
    }
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
          <Button variant="secondary" disabled={busy} onClick={() => void markNone()} title="이 자리는 감독을 두지 않습니다 (자동 배정에서 빼고 미배정으로 세지 않음)">
            감독 없음으로 정하기
          </Button>
        </div>

        {needReason && (
          <label className="flex flex-col gap-1.5">
            <span className="font-semibold">변경 사유 (최종 확정 이후 필수, 변경 이력에 남습니다)</span>
            <input className="min-h-12 rounded-xl border border-line px-4" value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
        )}

        {tab === 'change' && !current && (
          <TempQuickAssign
            session={session}
            busy={busy}
            onAssign={(id, name) => save([{ seatId: seat.id, teacherId: id }], '임시 감독자 배정', `${name}님(임시 감독자)을 배정했습니다.`)}
          />
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

type Change = { seatId: string; teacherId: string | null };

/**
 * 끌어다 놓기: from 좌석의 교사를 to 좌석으로. to가 비어 있으면 옮기기, 차 있으면 맞바꾸기.
 * 하드 조건을 어기면 이유를 돌려준다.
 */
function planDrop(data: EditorData, fromId: string, toId: string): { changes: Change[]; label: string; problem: string | null } | null {
  if (fromId === toId) return null;
  const now = new Map(data.assignments.map((a) => [a.id, a.teacherId]));
  const mover = now.get(fromId);
  if (!mover) return null;
  const other = now.get(toId) ?? null;
  const changes: Change[] = [
    { seatId: fromId, teacherId: other },
    { seatId: toId, teacherId: mover },
  ];
  for (const c of changes) {
    if (c.teacherId) now.set(c.seatId, c.teacherId);
    else now.delete(c.seatId);
  }
  const touched = new Set([fromId, toId]);
  const v = validateAssignments(data.input, [...now].map(([seatId, teacherId]) => ({ seatId, teacherId }))).filter((x) => touched.has(x.seatId));
  return {
    changes,
    label: other ? '끌어다 놓기 맞바꾸기' : '끌어다 놓기 이동',
    problem: v.length ? v.map((x) => x.message).join(' / ') : null,
  };
}

/** 최종 확정 이후 끌어다 놓기는 사유를 받는다 */
function DropReasonDialog({ text, onSubmit, onClose }: { text: string; onSubmit: (reason: string) => void; onClose: () => void }) {
  const [reason, setReason] = useState('');
  return (
    <Modal title="변경 사유" onClose={onClose}>
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (reason.trim()) onSubmit(reason.trim());
        }}
      >
        <p>{text}</p>
        <label className="grid gap-1">
          <span className="font-semibold">최종 확정 이후 변경 사유</span>
          <input aria-label="변경 사유" className="min-h-12 rounded-xl border border-line px-4" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </label>
        <div className="flex gap-2">
          <Button type="submit" disabled={!reason.trim()}>
            바꾸기
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            취소
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function SessionEditorPage() {
  const session = useCurrentSession();
  const sid = session.id;
  const slots = useCollection<SlotDoc>(`sessions/${sid}/slots`);
  const rooms = useCollection<RoomDoc>('rooms', termWhere(session));
  const teachers = useSessionTeachers(session);
  const assignments = useCollection<AssignmentDoc>(`sessions/${sid}/assignments`);
  const availability = useCollection<AvailabilityDoc>(`sessions/${sid}/availability`);
  const constraints = useCollection<ConstraintDoc>(`sessions/${sid}/constraints`);
  const timetable = useCollection<BaseTimetableDoc>(`sessions/${sid}/baseTimetable`);
  const [editing, setEditing] = useState<Seat | null>(null);
  const [releasing, setReleasing] = useState<Seat | null>(null);
  const [search, setSearch] = useState('');
  // 끌어다 놓기: 잡은 좌석, 올려놓은 좌석(가능 여부), 사유 입력 대기
  const [dragFrom, setDragFrom] = useState<string | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [hover, setHover] = useState<{ seatId: string; ok: boolean } | null>(null);
  const [pendingDrop, setPendingDrop] = useState<{ changes: Change[]; label: string; text: string } | null>(null);

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
      classDuringExam: session.settings.classDuringExam !== false,
      skipSeats: session.settings.noSupervisor ?? [],
    });
    const names = new Map(teachers.data.map((t) => [t.id, t.name]));
    const seats = buildSeats(input, DEFAULT_ROLE_WEIGHTS);
    const seatIds = new Set(seats.map((x) => x.id));
    return {
      input,
      seats,
      // 지금 자리에 없는 옛 배정은 편집에서 빼고, 아래 안내에서 정리한다
      assignments: assignments.data.filter((a) => seatIds.has(a.id)),
      nameOf: (id) => names.get(id) ?? id,
      teachers: [...teachers.data].sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    };
  }, [loading, teachers.data, rooms.data, slots.data, availability.data, constraints.data, timetable.data, assignments.data, session.settings]);

  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  if (!data) return null;

  const byId = new Map(data.assignments.map((a) => [a.id, a]));
  const orphans = assignments.data.filter((a) => !byId.has(a.id));
  const roomName = new Map(rooms.data.map((r) => [r.id, r.name]));
  const cleanOrphans = () => {
    setCleaning(true);
    return callApplyChanges({
      sessionId: session.id,
      changes: orphans.map((a) => ({ seatId: a.id, teacherId: null })),
      reason: '자습 교시 감독은 시험실마다 1명',
      label: '없는 자리 배정 정리',
    })
      .then(() => toast(`남아 있던 배정 ${orphans.length}건을 정리했습니다.`))
      .catch((e: unknown) => toast(errorMessage(e), 'alert'))
      .finally(() => setCleaning(false));
  };
  const usedRooms = new Set(data.seats.map((s) => s.roomId));
  const roomList = sortRooms(rooms.data.filter((r) => usedRooms.has(r.id)));
  const none = new Set(session.settings.noSupervisor ?? []);
  const unassigned = data.seats.filter((s) => !byId.has(s.id) && !none.has(s.id)).length;
  // 배정 결과 검색: 교사 이름(또는 시험실·과목)으로 찾기
  const q = search.trim();
  const hitTeachers = new Set(q ? data.teachers.filter((t) => t.name.includes(q)).map((t) => t.id) : []);
  const hits = q
    ? data.seats.filter((s) => {
        const a = byId.get(s.id);
        return (a && hitTeachers.has(a.teacherId)) || (roomName.get(s.roomId) ?? '').includes(q) || s.subject.includes(q);
      })
    : [];
  const hitIds = new Set(hits.map((s) => s.id));
  const release = async (seat: Seat) => {
    try {
      await updateSessionSettings(session.id, { ...session.settings, noSupervisor: (session.settings.noSupervisor ?? []).filter((x) => x !== seat.id) });
      toast('감독 없음을 해제했습니다. 이제 배정할 수 있습니다.');
    } catch (e) {
      toast(errorMessage(e), 'alert');
    }
    setReleasing(null);
  };
  const locked = session.status === 'LOCKED';

  const describe = (seatId: string) => {
    const s = data.seats.find((x) => x.id === seatId)!;
    return `${s.period}교시 ${roomName.get(s.roomId) ?? ''}`;
  };
  const apply = async (changes: Change[], label: string, reason?: string) => {
    try {
      await callApplyChanges({ sessionId: session.id, changes, reason, label });
      toast(`${label === '끌어다 놓기 맞바꾸기' ? '맞바꿨습니다' : '옮겼습니다'}.`);
    } catch (e) {
      toast(errorMessage(e), 'alert');
    }
  };
  const drop = (toId: string) => {
    const fromId = dragFrom;
    setDragFrom(null);
    setHover(null);
    if (!fromId) return;
    const plan = planDrop(data, fromId, toId);
    if (!plan) return;
    if (plan.problem) return toast(`바꿀 수 없습니다: ${plan.problem}`, 'alert');
    const mover = data.nameOf(byId.get(fromId)!.teacherId);
    const other = byId.get(toId);
    const text = other
      ? `${mover}(${describe(fromId)}) ↔ ${data.nameOf(other.teacherId)}(${describe(toId)}) 맞바꾸기`
      : `${mover}: ${describe(fromId)} → ${describe(toId)} 옮기기`;
    if (session.status === 'CONFIRMED') setPendingDrop({ changes: plan.changes, label: plan.label, text });
    else void apply(plan.changes, plan.label);
  };

  return (
    <div className="grid gap-6">
      <Card>
        <CardTitle icon="🗓️">시간표 편집</CardTitle>
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
        {orphans.length > 0 && !locked && (
          <div className="mt-3">
            <Alert tone="info">
              <p>
                감독 자리 규칙이 바뀌어(자습 교시는 시험실마다 1명) 지금은 없는 자리에 배정 {orphans.length}건이 남아 있습니다:{' '}
                {orphans
                  .slice(0, 5)
                  .map((a) => `${data.nameOf(a.teacherId)} ${Number(a.date.slice(5, 7))}/${Number(a.date.slice(8, 10))} ${a.period}교시 ${roomName.get(a.roomId) ?? ''}`)
                  .join(', ')}
                {orphans.length > 5 ? ' …' : ''}. 정리하면 교사 시간표에서도 빠집니다.
              </p>
              <Button className="mt-2" disabled={cleaning} onClick={() => void cleanOrphans()}>
                {cleaning ? '정리 중…' : '정리하기'}
              </Button>
            </Alert>
          </div>
        )}
        {data.seats.length === 0 && (
          <div className="mt-3">
            <Alert tone="info">
              아직 감독 자리가 없습니다.{' '}
              {slots.data.length === 0 ? (
                <Link to="../schedule" relative="path" className="font-semibold underline">시험 일정 입력하기 →</Link>
              ) : rooms.data.length === 0 ? (
                <Link to="../rooms" relative="path" className="font-semibold underline">시험실 등록하기 →</Link>
              ) : (
                <Link to="../schedule" relative="path" className="font-semibold underline">시험 일정에서 시험실 배치하기 →</Link>
              )}
            </Alert>
          </div>
        )}
        {data.seats.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              type="search"
              aria-label="배정 결과 검색"
              placeholder="교사 이름·시험실·과목으로 찾기"
              className="min-h-12 w-full max-w-sm rounded-xl border border-line px-4"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {q && (
              <span className="text-sm">
                <b>{hits.length}건</b>
                {hitTeachers.size === 1 && hits.length > 0 && ` · ${data.nameOf([...hitTeachers][0]!)} 감독: ${hits.map((s) => `${s.date.slice(5).replace('-', '/')} ${s.period}교시 ${roomName.get(s.roomId) ?? ''}`).join(', ')}`}
              </span>
            )}
          </div>
        )}
        {!locked && data.seats.length > 0 && (
          <p className="mt-2 text-sm text-muted">
            💡 교사 이름을 끌어 다른 칸에 놓으면 옮기거나(빈칸) 맞바꿉니다(다른 교사 칸). 놓을 수 있는 칸은 초록, 조건에 걸리는 칸은 빨강으로 표시됩니다.
          </p>
        )}
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
                          if (none.has(s.id)) {
                            return (
                              <button
                                key={s.id}
                                type="button"
                                disabled={locked}
                                aria-label={`${s.period}교시 ${r.name} ${SEAT_ROLE_LABEL[s.role]} 감독 없음`}
                                onClick={() => setReleasing(s)}
                                className="min-h-11 cursor-pointer rounded-lg border border-dashed border-line bg-bg px-2 text-left text-sm text-muted disabled:cursor-default"
                              >
                                감독 없음{s.role !== 'CHIEF' && <span className="ml-1 text-xs">{SEAT_ROLE_LABEL[s.role]}</span>}
                              </button>
                            );
                          }
                          const target = hover?.seatId === s.id && dragFrom !== s.id ? (hover.ok ? 'ring-4 ring-mint' : 'ring-4 ring-alert') : '';
                          return (
                            <button
                              key={s.id}
                              type="button"
                              disabled={locked}
                              draggable={!locked && Boolean(a)}
                              aria-label={`${s.period}교시 ${r.name} ${SEAT_ROLE_LABEL[s.role]} ${a ? data.nameOf(a.teacherId) : '미배정'}`}
                              onClick={() => setEditing(s)}
                              onDragStart={(e) => {
                                e.dataTransfer.setData('text/plain', s.id);
                                e.dataTransfer.effectAllowed = 'move';
                                setDragFrom(s.id);
                              }}
                              onDragEnd={() => (setDragFrom(null), setHover(null))}
                              onDragOver={(e) => {
                                if (!dragFrom || locked) return;
                                e.preventDefault();
                                if (hover?.seatId !== s.id) {
                                  const plan = planDrop(data, dragFrom, s.id);
                                  setHover({ seatId: s.id, ok: Boolean(plan && !plan.problem) });
                                }
                              }}
                              onDrop={(e) => {
                                e.preventDefault();
                                drop(s.id);
                              }}
                              className={`min-h-11 cursor-pointer rounded-lg px-2 text-left font-semibold transition-colors disabled:cursor-default ${target} ${hitIds.has(s.id) ? 'ring-4 ring-[#f1c40f]' : ''} ${
                                dragFrom === s.id ? 'opacity-40' : ''
                              } ${
                                a
                                  ? `${a.source === 'MANUAL' ? 'border-2 border-primary' : 'border border-line'} bg-surface hover:bg-primary-soft ${locked ? '' : 'active:cursor-grabbing'}`
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

      {releasing && (
        <Modal title="감독 없음 해제" onClose={() => setReleasing(null)}>
          <div className="grid gap-4">
            <p>이 자리에 다시 감독을 둡니다. 해제한 뒤 칸을 눌러 교사를 정하거나 자동 배정을 다시 실행하세요.</p>
            <div className="flex gap-2">
              <Button onClick={() => void release(releasing)}>해제</Button>
              <Button variant="secondary" onClick={() => setReleasing(null)}>
                취소
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {pendingDrop && (
        <DropReasonDialog
          text={pendingDrop.text}
          onClose={() => setPendingDrop(null)}
          onSubmit={(reason) => {
            void apply(pendingDrop.changes, pendingDrop.label, reason);
            setPendingDrop(null);
          }}
        />
      )}
      {editing && (
        <SeatDialog session={session} seat={editing} roomName={roomName.get(editing.roomId) ?? ''} data={data} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
