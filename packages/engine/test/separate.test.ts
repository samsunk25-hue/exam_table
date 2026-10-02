import { describe, expect, it } from 'vitest';
import { buildSampleSchool } from '@sim/shared';
import { buildEngineInput, runAssignment, validateAssignments } from '../src';

describe('별도시험장에서 다른 학년·과목 시험', () => {
  const sample = buildSampleSchool('2026-10-16');
  const sep = sample.rooms.find((r) => r.spaceType === 'SEPARATE')!;
  // 별도시험장이 배치된 첫 시험: 그 방만 2학년 과학으로
  const target = sample.slots.find((s) => s.type === 'EXAM' && s.rooms.some((p) => p.roomId === sep.id))!;
  const slots = sample.slots.map((s) =>
    s.id === target.id ? { ...s, rooms: s.rooms.map((p) => (p.roomId === sep.id ? { ...p, grade: 2, subject: '과학' } : p)) } : s,
  );
  const input = buildEngineInput({
    teachers: sample.teachers,
    rooms: sample.rooms,
    slots,
    availability: [],
    constraints: [],
    baseTimetable: sample.timetable,
    useBaseTimetable: true,
    examWriterRule: 'NO_ROOM',
  });
  const result = runAssignment(input);
  const seats = result.seats.filter((x) => x.slotId === target.id && x.roomId === sep.id);

  it('그 별도시험장 자리는 따로 정한 학년·과목, 같은 시험의 다른 교실은 원래 과목', () => {
    expect(seats.length).toBeGreaterThan(0);
    for (const x of seats) expect([x.grade, x.subject]).toEqual([2, '과학']);
    const other = result.seats.find((x) => x.slotId === target.id && x.roomId !== sep.id)!;
    expect(other.subject).toBe(target.subject);
  });

  it('출제 교사 규칙(교실 감독 제외)은 따로 정한 과목으로 본다', () => {
    expect(validateAssignments(input, result.assignments)).toEqual([]);
    const science = new Set(sample.teachers.filter((t) => t.subject === '과학').map((t) => t.id));
    expect(science.size).toBeGreaterThan(0);
    for (const a of result.assignments.filter((x) => seats.some((s) => s.id === x.seatId))) expect(science.has(a.teacherId)).toBe(false);
  });
});
