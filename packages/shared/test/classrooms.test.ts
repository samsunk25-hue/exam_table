import { describe, expect, it } from 'vitest';
import { configFromRooms, planClassrooms, type RoomDoc, type WithId } from '../src';

const cfg = (classCounts: number[], skipped: string[] = [], hallways = true) => ({
  classCounts,
  skipped: new Set(skipped),
  hallways,
  chiefCount: 1,
  assistantCount: 0,
});

describe('학급 수로 교실 만들기', () => {
  it('학년별 학급 수만큼 교실과 복도를 만들고, 체크 해제한 교실은 뺀다', () => {
    const plan = planClassrooms(cfg([3, 2], ['1-2']), []);
    expect(plan.upsert.map((r) => [r.id, r.name, r.spaceType])).toEqual([
      ['R001', '1-1', 'CLASSROOM'],
      ['R002', '1-3', 'CLASSROOM'],
      ['R003', '1학년 복도', 'HALLWAY'],
      ['R004', '2-1', 'CLASSROOM'],
      ['R005', '2-2', 'CLASSROOM'],
      ['R006', '2학년 복도', 'HALLWAY'],
    ]);
    expect(plan.created).toBe(6);
    expect(plan.remove).toEqual([]);
  });

  it('기존 시험실은 ID를 유지해 수정하고, 빠진 교실·복도만 삭제한다. 특별실은 건드리지 않는다', () => {
    const rooms: WithId<RoomDoc>[] = [
      { id: 'R001', name: '1-1', spaceType: 'CLASSROOM', grade: 1, classNo: 1, chiefCount: 1, assistantCount: 0 },
      { id: 'R002', name: '1-2', spaceType: 'CLASSROOM', grade: 1, classNo: 2, chiefCount: 1, assistantCount: 0 },
      { id: 'R003', name: '1학년 복도', spaceType: 'HALLWAY', grade: 1, classNo: null, chiefCount: 2, assistantCount: 0 },
      { id: 'R004', name: '별도시험장', spaceType: 'SEPARATE', grade: null, classNo: null, chiefCount: 1, assistantCount: 1 },
    ];
    const plan = planClassrooms(cfg([1]), rooms);
    expect(plan.upsert.map((r) => [r.id, r.name, r.chiefCount])).toEqual([
      ['R001', '1-1', 1],
      ['R003', '1학년 복도', 2],
    ]);
    expect(plan.remove.map((r) => r.name)).toEqual(['1-2']);
    expect(plan.created).toBe(0);

    const noHall = planClassrooms(cfg([1], [], false), rooms);
    expect(noHall.remove.map((r) => r.name)).toEqual(['1-2', '1학년 복도']);
  });

  it('기존 시험실에서 학급 수와 체크 상태를 되살린다', () => {
    const config = configFromRooms([
      { name: '1-1', spaceType: 'CLASSROOM', grade: 1, classNo: 1, chiefCount: 1, assistantCount: 1 },
      { name: '1-3', spaceType: 'CLASSROOM', grade: 1, classNo: 3, chiefCount: 1, assistantCount: 1 },
    ]);
    expect(config.classCounts).toEqual([3, 0, 0]);
    expect([...config.skipped]).toEqual(['1-2']);
    expect(config.hallways).toBe(false);
    expect(config.assistantCount).toBe(1);
    expect(configFromRooms([]).hallways).toBe(true);
  });
});
