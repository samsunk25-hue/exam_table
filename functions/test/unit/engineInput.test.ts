import { describe, expect, it } from 'vitest';
import { runAssignment, validateAssignments } from '@sim/engine';
import type { RoomDoc, SlotDoc, TeacherDoc, WithId } from '@sim/shared';
import { buildEngineInput, toRunDoc, type SessionData } from '../../src/engineInput';

const teacher = (id: string, extra: Partial<TeacherDoc> = {}): WithId<TeacherDoc> => ({
  id,
  name: `교사${id}`,
  email: null,
  subject: null,
  homeroom: null,
  defaultRole: 'NORMAL',
  active: true,
  cumulativeLoad: 0,
  ...extra,
});

const rooms: WithId<RoomDoc>[] = [
  { id: 'R1', name: '1-1', spaceType: 'CLASSROOM', grade: 1, classNo: 1, chiefCount: 1, assistantCount: 0 },
  { id: 'H1', name: '1학년 복도', spaceType: 'HALLWAY', grade: 1, classNo: null, chiefCount: 1, assistantCount: 0 },
];

const slot: WithId<SlotDoc> = {
  id: '2026-10-12_1_1',
  date: '2026-10-12',
  period: 1,
  startTime: '09:00',
  endTime: null,
  grade: 1,
  subject: '국어',
  type: 'EXAM',
  rooms: [
    { roomId: 'R1', classNo: 1, headcount: null, roomType: 'NORMAL' },
    { roomId: 'H1', classNo: null, headcount: null, roomType: 'NORMAL' },
    { roomId: 'GONE', classNo: null, headcount: null, roomType: 'NORMAL' },
  ],
};

function data(extra: Partial<SessionData> = {}): SessionData {
  return {
    teachers: [teacher('T1', { cumulativeLoad: 5 }), teacher('T2'), teacher('T3', { defaultRole: 'HALLWAY' })],
    rooms,
    slots: [slot],
    availability: [],
    constraints: [],
    baseTimetable: [{ id: 'T2', teacherId: 'T2', entries: [{ weekday: 1, period: 1, grade: 1, classNo: 1, subject: '국어' }] }],
    useBaseTimetable: true,
    ...extra,
  };
}

describe('Firestore 자료 → 엔진 입력', () => {
  it('배치를 그룹으로, 교사별 시간표를 수업 목록으로 펼치고 삭제된 시험실은 뺀다', () => {
    const input = buildEngineInput(data());
    expect(input.groups.map((g) => g.id)).toEqual(['2026-10-12_1_1__R1', '2026-10-12_1_1__H1']);
    expect(input.baseTimetable).toEqual([{ teacherId: 'T2', weekday: 1, period: 1, grade: 1, classNo: 1, subject: '국어' }]);
    expect(input.teachers.find((t) => t.id === 'T1')!.priorLoad).toBe(5);
  });

  it('엔진 실행 결과를 runs 문서로 바꾼다 (기초시간표 가점, 복도전담, 날짜·교시 포함)', () => {
    const input = buildEngineInput(data());
    const result = runAssignment(input);
    const run = toRunDoc(result, { createdBy: 'u1', useBaseTimetable: true, keepManual: true, elapsedMs: 3 });
    expect(run.metrics).toMatchObject({ seatCount: 2, assignedCount: 2, successRate: 1 });
    const byRoom = Object.fromEntries(run.assignments.map((a) => [a.roomId, a]));
    expect(byRoom.R1).toMatchObject({ teacherId: 'T2', date: '2026-10-12', period: 1, role: 'CHIEF' });
    expect(byRoom.R1!.reason).toContain('원래 그 반 수업 교사');
    expect(byRoom.H1).toMatchObject({ teacherId: 'T3', role: 'HALLWAY' });
    expect(run.loads.T2).toEqual([1, 1]);
    expect(run.loads.T1).toEqual([0, 5]);
    expect(validateAssignments(input, run.assignments)).toEqual([]);
  });

  it('수동 배정은 고정으로 넘겨 유지한다', () => {
    const input = buildEngineInput(data({ pinned: [{ seatId: '2026-10-12_1_1__R1_CHIEF_1', teacherId: 'T1' }] }));
    const run = toRunDoc(runAssignment(input), { createdBy: 'u1', useBaseTimetable: true, keepManual: true, elapsedMs: 1 });
    expect(run.assignments.find((a) => a.roomId === 'R1')).toMatchObject({ teacherId: 'T1', source: 'MANUAL' });
  });

  it('불가시간이 생기면 이전 결과는 검증에서 걸린다 (적용 전 재검증)', () => {
    const run = toRunDoc(runAssignment(buildEngineInput(data())), { createdBy: 'u1', useBaseTimetable: true, keepManual: true, elapsedMs: 1 });
    const changed = buildEngineInput(
      data({ availability: [{ teacherId: 'T2', date: '2026-10-12', period: 1, available: false, reason: '출장', source: 'ADMIN', status: 'APPROVED' }] }),
    );
    expect(validateAssignments(changed, run.assignments).map((v) => v.reason)).toEqual(['UNAVAILABLE']);
  });
});
