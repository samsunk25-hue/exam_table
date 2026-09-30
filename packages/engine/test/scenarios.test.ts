import { describe, expect, it } from 'vitest';
import { runScenarios, validateAssignments } from '../src';
import { fakeSchool } from './fixtures';

describe('다중 시나리오', () => {
  const input = fakeSchool();
  const results = Object.fromEntries(runScenarios(input).map((r) => [r.scenario.key, r.result]));

  it('모든 안이 하드 조건을 지킨다', () => {
    for (const r of Object.values(results)) expect(validateAssignments(input, r.assignments)).toEqual([]);
  });

  it('각 안은 자기 목표에서 기본안보다 낫거나 같다', () => {
    const base = results.BASE!.metrics;
    expect(results.EQUITY!.metrics.stdDev).toBeLessThanOrEqual(base.stdDev);
    expect(results.NO_CONSECUTIVE!.metrics.consecutiveCount).toBeLessThanOrEqual(base.consecutiveCount);
    expect(results.SUBJECT_HALLWAY!.metrics.subjectInRoom).toBeLessThan(base.subjectInRoom);
  });

  it('안마다 배정이 실제로 다르다', () => {
    const sig = (key: string) => results[key]!.assignments.map((a) => `${a.seatId}:${a.teacherId}`).join(',');
    expect(new Set(['BASE', 'EQUITY', 'NO_CONSECUTIVE', 'SUBJECT_HALLWAY'].map(sig)).size).toBe(4);
  });
});
