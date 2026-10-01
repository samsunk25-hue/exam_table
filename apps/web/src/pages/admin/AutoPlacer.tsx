import { useEffect, useRef } from 'react';
import { autoPlacements, isSetupEditable, planClassrooms, sessionTerm, termFields, type RoomDoc, type SlotDoc } from '@sim/shared';
import { commitOps, ref, useCollection, type BatchOp } from '@/lib/data';
import { termWhere, useSessionTeachers, type ExamSession } from '@/lib/sessions';

/**
 * 시험실 자동 배치: 시험실이 없는 시험이 있고 같은 학년 교실·복도가 있으면 알아서 배치한다.
 * 그 학년 교실이 아예 없으면 교사 명단의 담임(학년·반)으로 학급 교실을 먼저 만든다 (정·부감독 각 1명).
 * (시험 일정과 시험실을 어느 순서로 넣어도 따로 "배치" 단계를 거치지 않게. 특별실은 그날 시험의 "배치"에서 더한다)
 */
export function AutoPlacer({ session }: { session: ExamSession }) {
  const slots = useCollection<SlotDoc>(`sessions/${session.id}/slots`);
  const rooms = useCollection<RoomDoc>('rooms', termWhere(session));
  const allRooms = useCollection<RoomDoc>('rooms');
  const teachers = useSessionTeachers(session);
  const done = useRef(new Set<string>());
  const editable = isSetupEditable(session.status);
  const loading = slots.loading || rooms.loading || allRooms.loading || teachers.loading;

  // 1) 시험은 있는데 그 학년 교실이 없으면 담임 정보로 학급 교실 만들기
  useEffect(() => {
    if (!editable || loading) return;
    const examGrades = new Set(slots.data.filter((s) => !s.rooms.length).map((s) => s.grade));
    const missing = [...examGrades].filter((g) => !rooms.data.some((r) => r.spaceType === 'CLASSROOM' && r.grade === g));
    if (!missing.length) return;
    const counts = new Map<number, number>();
    for (const t of teachers.data) {
      if (t.temporary || !t.homeroom || !missing.includes(t.homeroom.grade)) continue;
      counts.set(t.homeroom.grade, Math.max(counts.get(t.homeroom.grade) ?? 0, t.homeroom.classNo));
    }
    if (!counts.size) return;
    const key = `classrooms:${[...counts].map(([g, n]) => `${g}-${n}`).join(',')}`;
    if (done.current.has(key)) return;
    done.current.add(key);
    const maxGrade = Math.max(...counts.keys());
    const plan = planClassrooms(
      {
        classCounts: Array.from({ length: maxGrade }, (_, i) => counts.get(i + 1) ?? 0),
        skipped: new Set(),
        hallways: false,
        chiefCount: 1,
        assistantCount: 1,
      },
      [],
      allRooms.data.map((r) => r.id),
    );
    // 새 교실만 더한다 (이미 있는 다른 학년 시험실은 건드리지 않음)
    const term = termFields(sessionTerm(session));
    const ops: BatchOp[] = plan.upsert.map(({ id, ...data }) => ({ type: 'set', ref: ref('rooms', id), data: { ...data, ...term } }));
    if (ops.length) void commitOps(ops, `학급 교실 자동 만들기 (${ops.length}실, 담임 정보로)`).catch(() => undefined);
  }, [editable, loading, slots.data, rooms.data, allRooms.data, teachers.data, session]);

  // 2) 시험실이 없는 시험에 같은 학년 교실·복도 배치
  useEffect(() => {
    if (!editable || loading || !rooms.data.length) return;
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
  }, [editable, loading, slots.data, rooms.data, session.id]);

  return null;
}
