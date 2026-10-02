import { describe, expect, it } from 'vitest';
import { buildSampleSchool, nextWeekdays } from '@sim/shared';
import { buildEngineInput, runAssignment, validateAssignments } from '../src';

describe('통합 양식 샘플 (교사 25명)', () => {
  const sample = buildSampleSchool('2026-10-16'); // 금요일 → 금·월·화

  it('평일 3일, 하루 3교시(1·2교시 시험, 3교시 자습), 45분 시험 + 15분 휴식', () => {
    expect(nextWeekdays('2026-10-16', 3)).toEqual(['2026-10-16', '2026-10-19', '2026-10-20']);
    expect(sample.teachers).toHaveLength(25);
    expect(sample.slots).toHaveLength(3 * 3 * 3);
    const day1g1 = sample.slots.filter((s) => s.date === '2026-10-16' && s.grade === 1).sort((a, b) => a.period - b.period);
    expect(day1g1.map((s) => [s.period, s.type, s.startTime, s.endTime])).toEqual([
      [1, 'EXAM', '09:00', '09:45'],
      [2, 'EXAM', '10:00', '10:45'],
      [3, 'STUDY', '11:00', '11:45'],
    ]);
  });

  it('기초시간표는 교사·학급 모두 같은 시간에 겹치지 않는다', () => {
    const teacherCells = sample.timetable.flatMap((d) => d.entries.map((e) => `${d.id}|${e.weekday}|${e.period}`));
    expect(new Set(teacherCells).size).toBe(teacherCells.length);
    const classCells = sample.timetable.flatMap((d) => d.entries.map((e) => `${e.grade}-${e.classNo}|${e.weekday}|${e.period}`));
    expect(new Set(classCells).size).toBe(classCells.length);
    expect(classCells.length).toBeGreaterThan(9 * 25); // 9개 학급 × 주 28시간
  });

  it('자동 배정이 모든 자리를 하드 조건 위반 없이 채운다', () => {
    const input = buildEngineInput({
      teachers: sample.teachers,
      rooms: sample.rooms,
      slots: sample.slots,
      availability: [],
      constraints: [],
      baseTimetable: sample.timetable,
      useBaseTimetable: true,
    });
    const result = runAssignment(input);
    expect(result.metrics.successRate).toBe(1);
    expect(validateAssignments(input, result.assignments)).toEqual([]);
    expect(result.assignments.some((a) => a.reason.includes('기초일치'))).toBe(true);
    expect(result.assignments.filter((a) => a.role === 'STUDY').length).toBe(3 * 3 * 3); // 3일 × 3학년 × 3반, 자습은 반마다 1명
    expect(result.assignments.some((a) => a.role === 'HALLWAY')).toBe(false); // 복도 감독 없음
    expect(result.assignments.filter((a) => a.role === 'ASSISTANT').length).toBeGreaterThan(0);
  });
});
