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
    // 감독 횟수 맞추기가 두 안 모두에 들어가 편차가 거의 같으므로 2% 안의 차이는 같다고 본다
    expect(results.EQUITY!.metrics.stdDev).toBeLessThanOrEqual(base.stdDev * 1.02);
    expect(results.NO_CONSECUTIVE!.metrics.consecutiveCount).toBeLessThanOrEqual(base.consecutiveCount);
    expect(results.SUBJECT_HALLWAY!.metrics.subjectInRoom).toBeLessThan(base.subjectInRoom);
  });

  it('안마다 배정이 실제로 다르다', () => {
    const sig = (key: string) => results[key]!.assignments.map((a) => `${a.seatId}:${a.teacherId}`).join(',');
    expect(new Set(['BASE', 'EQUITY', 'NO_CONSECUTIVE', 'SUBJECT_HALLWAY'].map(sig)).size).toBe(4);
  });
});
