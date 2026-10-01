import { useEffect, useRef } from 'react';
import { autoPlacements, isSetupEditable, type RoomDoc, type SlotDoc } from '@sim/shared';
import { commitOps, ref, useCollection, type BatchOp } from '@/lib/data';
import { termWhere, type ExamSession } from '@/lib/sessions';

/**
 * 시험실 자동 배치: 시험실이 없는 시험이 있고 같은 학년 교실·복도가 있으면 알아서 배치한다.
 * (시험 일정과 시험실을 어느 순서로 넣어도 따로 "배치" 단계를 거치지 않게. 특별실은 그날 시험의 "배치"에서 더한다)
 */
export function AutoPlacer({ session }: { session: ExamSession }) {
  const slots = useCollection<SlotDoc>(`sessions/${session.id}/slots`);
  const rooms = useCollection<RoomDoc>('rooms', termWhere(session));
  const done = useRef(new Set<string>());
  const editable = isSetupEditable(session.status);

  useEffect(() => {
    if (!editable || slots.loading || rooms.loading || !rooms.data.length) return;
    // 같은 시간 다른 시험에서 이미 쓰는 시험실은 뺀다
    const used = new Set(slots.data.flatMap((s) => s.rooms.map((p) => `${s.date}|${s.period}|${p.roomId}`)));
    const ops: BatchOp[] = [];
    const sorted = [...slots.data].sort((a, b) => a.date.localeCompare(b.date) || a.period - b.period || a.grade - b.grade);
    for (const s of sorted) {
      if (s.rooms.length) continue;
      const placements = autoPlacements(s, rooms.data).filter((p) => !used.has(`${s.date}|${s.period}|${p.roomId}`));
      // 같은 배치를 두 번 쓰지 않는다 (저장이 화면에 돌아오기 전에 다시 계산될 수 있음)
      const key = `${s.id}:${placements.map((p) => p.roomId).join(',')}`;
      if (!placements.length || done.current.has(key)) continue;
      done.current.add(key);
      placements.forEach((p) => used.add(`${s.date}|${s.period}|${p.roomId}`));
      ops.push({ type: 'set', ref: ref(`sessions/${session.id}/slots`, s.id), data: { rooms: placements }, merge: true });
    }
    if (ops.length) void commitOps(ops, `시험실 자동 배치 (${ops.length}건)`).catch(() => undefined);
  }, [editable, slots.loading, rooms.loading, slots.data, rooms.data, session.id]);

  return null;
}
