import { useState } from 'react';
import {
  PLACEMENT_ROOM_TYPE_LABEL,
  autoPlacements,
  type Placement,
  type PlacementRoomType,
  type RoomDoc,
  type SlotDoc,
  type WithId,
} from '@sim/shared';
import { overlappingPeriods } from '@sim/engine';
import { ClockTimePicker } from '@/components/ClockTimePicker';
import { Modal } from '@/components/Modal';
import { Alert, Button, Table, Td } from '@/components/ui';
import { commitOps, ref } from '@/lib/data';
import { errorMessage } from '@/lib/firebase';
import { ScheduleEditor } from './ExamSchedulePage';
import { useCurrentSession } from './SessionPage';
import { sortRooms } from './RoomsPage';

type Slot = WithId<SlotDoc>;
type Room = WithId<RoomDoc>;

function slotLabel(s: Pick<SlotDoc, 'date' | 'period' | 'grade' | 'subject'>) {
  return `${s.date} ${s.period}교시 ${s.grade}학년 ${s.subject}`;
}

// ───────────────────────── 시험실 배치 편집 ─────────────────────────

export function PlacementEditor({ sid, slot, slots, rooms, onClose }: {
  sid: string;
  slot: Slot;
  slots: Slot[];
  rooms: Room[];
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Map<string, Placement>>(() => new Map(slot.rooms.map((p) => [p.roomId, p])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 같은 시간 다른 시험에 이미 쓰인 시험실
  const usedElsewhere = new Map<string, string>();
  for (const s of slots) {
    if (s.id === slot.id || s.date !== slot.date || s.period !== slot.period) continue;
    for (const p of s.rooms) usedElsewhere.set(p.roomId, `${s.grade}학년 ${s.subject}`);
  }

  const toggle = (r: Room, on: boolean) => {
    const next = new Map(draft);
    if (on) next.set(r.id, { roomId: r.id, classNo: r.spaceType === 'CLASSROOM' ? r.classNo : null, headcount: null, roomType: 'NORMAL' });
    else next.delete(r.id);
    setDraft(next);
  };
  const patch = (roomId: string, p: Partial<Placement>) => {
    const next = new Map(draft);
    next.set(roomId, { ...next.get(roomId)!, ...p });
    setDraft(next);
  };

  /** 별도시험장 다른 학년·과목 켜기/끄기: 켜면 이 시험의 학년·과목으로 시작 */
  const setOwnExam = (roomId: string, on: boolean) => patch(roomId, on ? { grade: slot.grade, subject: slot.subject } : { grade: null, subject: null });
  const gradeOptions = [...new Set([1, 2, 3, ...slots.map((x) => x.grade)])].sort((a, b) => a - b);

  /** 특별실 별도 시간 켜기/끄기: 켜면 시험 시간으로 시작 */
  const setOwnTime = (roomId: string, on: boolean) =>
    patch(roomId, on ? { startTime: slot.startTime ?? '', endTime: slot.endTime ?? '' } : { startTime: null, endTime: null });

  const save = async () => {
    const conflict = [...draft.keys()].find((id) => usedElsewhere.has(id));
    if (conflict) return setError(`${rooms.find((r) => r.id === conflict)?.name}은(는) 같은 시간 ${usedElsewhere.get(conflict)}에 쓰이고 있습니다.`);
    for (const p of draft.values()) {
      const name = rooms.find((r) => r.id === p.roomId)?.name;
      if ((p.grade != null || p.subject != null) && !p.subject?.trim()) return setError(`${name}: 따로 정한 시험 과목을 적으세요.`);
      if (!p.startTime && !p.endTime) continue;
      if (!p.startTime || !p.endTime) return setError(`${name}: 별도 시간의 시작·종료 시각을 모두 정하세요.`);
      if (p.startTime >= p.endTime) return setError(`${name}: 종료 시각이 시작보다 빠릅니다.`);
      // 별도 시간이 겹치는 다른 교시에 같은 시험실이 쓰이면 안 된다
      const clash = overlappingPeriods(slots, slot, p).flatMap((period) =>
        slots.filter((o) => o.date === slot.date && o.period === period && o.rooms.some((x) => x.roomId === p.roomId)),
      )[0];
      if (clash) return setError(`${name}: 별도 시간이 ${clash.period}교시와 겹치는데, 그 시간에 ${clash.grade}학년 ${clash.subject} 시험실로 쓰이고 있습니다.`);
    }
    setBusy(true);
    const ordered = sortRooms(rooms).flatMap((r) => (draft.has(r.id) ? [draft.get(r.id)!] : []));
    try {
      await commitOps([{ type: 'set', ref: ref(`sessions/${sid}/slots`, slot.id), data: { rooms: ordered }, merge: true }], '시험실 배치 변경');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal title={`시험실 배치 — ${slotLabel(slot)}`} onClose={onClose} wide>
      <div className="grid gap-4">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => setDraft(new Map(autoPlacements(slot, rooms).filter((p) => !usedElsewhere.has(p.roomId)).map((p) => [p.roomId, p])))}
          >
            기본 배치로 채우기
          </Button>
          <Button variant="secondary" onClick={() => setDraft(new Map())}>
            모두 해제
          </Button>
        </div>
        <p className="text-sm text-muted">
          별도시험장은 "별도 시간"을 켜서 시험 시간과 다르게 정할 수 있습니다 (예: 시간 연장). 다른 학년·과목 시험을 본다면 "다른 학년·과목"을 켜서 정하세요. 시간표와 감독
          알림에 그대로 표시됩니다.
        </p>
        <Table head={['사용', '시험실', '반', '시험실유형', '응시인원', '운영 시간·시험']}>
          {sortRooms(rooms).map((r) => {
            const p = draft.get(r.id);
            const busyElsewhere = usedElsewhere.get(r.id);
            return (
              <tr key={r.id} className={busyElsewhere && !p ? 'text-muted' : ''}>
                <Td>
                  <input
                    type="checkbox"
                    className="size-6 accent-primary"
                    aria-label={`${r.name} 사용`}
                    checked={Boolean(p)}
                    onChange={(e) => toggle(r, e.target.checked)}
                  />
                </Td>
                <Td className="font-bold">
                  {r.name}
                  {busyElsewhere && <div className="text-sm font-normal text-alert">같은 시간 {busyElsewhere}</div>}
                </Td>
                <Td>
                  {p && (
                    <input
                      type="number"
                      min={1}
                      max={30}
                      className="min-h-12 w-20 rounded-xl border border-line px-3"
                      value={p.classNo ?? ''}
                      onChange={(e) => patch(r.id, { classNo: e.target.value ? Number(e.target.value) : null })}
                    />
                  )}
                </Td>
                <Td>
                  {p && (
                    <select
                      className="min-h-12 rounded-xl border border-line px-3"
                      value={p.roomType}
                      onChange={(e) => patch(r.id, { roomType: e.target.value as PlacementRoomType })}
                    >
                      {Object.entries(PLACEMENT_ROOM_TYPE_LABEL).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  )}
                </Td>
                <Td>
                  {p && (
                    <input
                      type="number"
                      min={0}
                      className="min-h-12 w-24 rounded-xl border border-line px-3"
                      value={p.headcount ?? ''}
                      onChange={(e) => patch(r.id, { headcount: e.target.value ? Number(e.target.value) : null })}
                    />
                  )}
                </Td>
                <Td>
                  {p && r.spaceType === 'SEPARATE' ? (
                    <div className="grid gap-2">
                      <label className="flex min-h-12 cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          className="size-5 accent-primary"
                          aria-label={`${r.name} 별도 시간`}
                          checked={p.startTime != null || p.endTime != null}
                          onChange={(e) => setOwnTime(r.id, e.target.checked)}
                        />
                        별도 시간
                      </label>
                      {(p.startTime != null || p.endTime != null) && (
                        <div className="grid min-w-64 grid-cols-2 gap-2">
                          <ClockTimePicker label={`${r.name} 시작`} value={p.startTime ?? ''} onChange={(v) => patch(r.id, { startTime: v })} />
                          <ClockTimePicker label={`${r.name} 종료`} value={p.endTime ?? ''} onChange={(v) => patch(r.id, { endTime: v })} />
                        </div>
                      )}
                      {slot.type === 'EXAM' && (
                        <label className="flex min-h-12 cursor-pointer items-center gap-2">
                          <input
                            type="checkbox"
                            className="size-5 accent-primary"
                            aria-label={`${r.name} 다른 학년·과목`}
                            checked={p.grade != null || p.subject != null}
                            onChange={(e) => setOwnExam(r.id, e.target.checked)}
                          />
                          다른 학년·과목
                        </label>
                      )}
                      {slot.type === 'EXAM' && (p.grade != null || p.subject != null) && (
                        <div className="grid min-w-64 grid-cols-2 gap-2">
                          <select
                            aria-label={`${r.name} 학년`}
                            className="min-h-12 rounded-xl border border-line px-3"
                            value={p.grade ?? slot.grade}
                            onChange={(e) => patch(r.id, { grade: Number(e.target.value) })}
                          >
                            {gradeOptions.map((g) => (
                              <option key={g} value={g}>
                                {g}학년
                              </option>
                            ))}
                          </select>
                          <input
                            aria-label={`${r.name} 과목`}
                            placeholder="과목"
                            className="min-h-12 rounded-xl border border-line px-3"
                            value={p.subject ?? ''}
                            onChange={(e) => patch(r.id, { subject: e.target.value })}
                          />
                        </div>
                      )}
                    </div>
                  ) : p ? (
                    <span className="text-sm text-muted">시험 시간과 같음</span>
                  ) : null}
                </Td>
              </tr>
            );
          })}
        </Table>
        {error && <Alert>{error}</Alert>}
        <div className="flex gap-2">
          <Button onClick={() => void save()} disabled={busy}>
            저장 ({draft.size}실)
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            취소
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ───────────────────────── 페이지 ─────────────────────────

/** 준비 > 시험 일정: 달력·표·불러오기·AI 입력. 시험실은 자동 배치되고, 특별실 등은 그날 시험 목록의 "배치"에서 */
export function SessionSchedulePage() {
  const session = useCurrentSession();
  return <ScheduleEditor session={session} />;
}
