import { describe, expect, it } from 'vitest';
import { findSwapChains, runAssignment, validateAssignments, type EngineInput } from '../src';
import { emptyInput, fakeSchool, teacher } from './fixtures';

/** 한 교실, 같은 날 1~3교시. A=1교시, B=2교시, C=3교시 담당 */
function threePeriods(extra: Partial<EngineInput> = {}): EngineInput {
  return emptyInput({
    teachers: [teacher('A'), teacher('B'), teacher('C')],
    rooms: [{ id: 'R', name: '1-1', chiefCount: 1, assistantCount: 0, spaceType: 'CLASSROOM' }],
    slots: [1, 2, 3].map((p) => ({ id: `S${p}`, date: '2026-10-12', period: p, grade: 1, subject: '국어', type: 'EXAM' as const })),
    groups: [1, 2, 3].map((p) => ({ id: `G${p}`, slotId: `S${p}`, roomId: 'R', grade: 1, classNo: 1, roomType: 'NORMAL' as const })),
    ...extra,
  });
}

const current = [
  { seatId: 'G1_CHIEF_1', teacherId: 'A' },
  { seatId: 'G2_CHIEF_1', teacherId: 'B' },
  { seatId: 'G3_CHIEF_1', teacherId: 'C' },
];

describe('N각 연쇄 교환', () => {
  it('1:1 교환이 가능하면 1:1을 먼저 제안한다', () => {
    const chains = findSwapChains(threePeriods(), current, { teacherId: 'A', seatId: 'G1_CHIEF_1', partnerId: 'B' });
    expect(chains[0]!.teachers).toEqual(['A', 'B']);
    expect(chains[0]!.moves).toEqual([
      { seatId: 'G1_CHIEF_1', from: 'A', to: 'B' },
      { seatId: 'G2_CHIEF_1', from: 'B', to: 'A' },
    ]);
  });

  it('B가 1교시에 불가면 1:1은 안 되고 A ➔ C ➔ B 경로를 찾는다', () => {
    const input = threePeriods({ availability: [{ teacherId: 'B', date: '2026-10-12', period: 1, status: 'APPROVED' }] });
    const chains = findSwapChains(input, current, { teacherId: 'A', seatId: 'G1_CHIEF_1', partnerId: 'B' });
    expect(chains.map((c) => c.teachers)).toEqual([['A', 'C', 'B']]);
    expect(chains[0]!.moves).toEqual([
      { seatId: 'G1_CHIEF_1', from: 'A', to: 'C' },
      { seatId: 'G3_CHIEF_1', from: 'C', to: 'B' },
      { seatId: 'G2_CHIEF_1', from: 'B', to: 'A' },
    ]);
  });

  it('아무 경로도 없으면 빈 목록', () => {
    const input = threePeriods({
      availability: [
        { teacherId: 'B', date: '2026-10-12', period: 1, status: 'APPROVED' },
        { teacherId: 'C', date: '2026-10-12', period: 1, status: 'APPROVED' },
      ],
    });
    expect(findSwapChains(input, current, { teacherId: 'A', seatId: 'G1_CHIEF_1', partnerId: 'B' })).toEqual([]);
  });

  it('가상 학교: 제안된 모든 경로는 하드 조건을 지키고 각자 감독 수가 그대로다', () => {
    const input = fakeSchool();
    const result = runAssignment(input);
    const target = result.assignments.find((a) => a.role === 'CHIEF')!;
    const chains = findSwapChains(input, result.assignments, { teacherId: target.teacherId, seatId: target.seatId }, { limit: 5 });
    expect(chains.length).toBeGreaterThan(0);
    for (const chain of chains) {
      const moved = new Map(chain.moves.map((m) => [m.seatId, m.to]));
      const next = result.assignments.map((a) => ({ seatId: a.seatId, teacherId: moved.get(a.seatId) ?? a.teacherId }));
      expect(validateAssignments(input, next)).toEqual([]);
      const count = (list: { teacherId: string }[], id: string) => list.filter((a) => a.teacherId === id).length;
      for (const id of chain.teachers) expect(count(next, id)).toBe(count(result.assignments, id));
      expect(chain.moves.find((m) => m.seatId === target.seatId)!.to).not.toBe(target.teacherId);
    }
  });
});
