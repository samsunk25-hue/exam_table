import { describe, expect, it } from 'vitest';
import type { AssignmentDoc, SlotDoc, WithId } from '@sim/shared';
import { kstNow, planReminders } from '../../src/reminderPlan';

const slot = (id: string, period: number, start: string | null, extra: Partial<SlotDoc> = {}): WithId<SlotDoc> => ({
  id,
  date: '2026-10-12',
  period,
  startTime: start,
  endTime: start ? `${start.slice(0, 2)}:45` : null,
  grade: 1,
  subject: '국어',
  type: 'EXAM',
  rooms: [{ roomId: 'R13', classNo: 3, headcount: null, roomType: 'NORMAL' }],
  ...extra,
});
const duty = (id: string, slotId: string, period: number, role: AssignmentDoc['role'], roomId = 'R13'): WithId<AssignmentDoc> => ({
  id,
  slotId,
  groupId: `${slotId}__${roomId}`,
  roomId,
  role,
  weight: 1,
  teacherId: `T_${id}`,
  score: 0,
  reason: '',
  source: 'AUTO',
  date: '2026-10-12',
  period,
  runId: null,
});
const rooms = new Map([
  ['R13', { name: '1-3' }],
  ['SEP', { name: '별도시험장' }],
]);

describe('감독 10분 전 알림', () => {
  it('한국 시간으로 오늘 날짜·분을 잡는다', () => {
    expect(kstNow(new Date('2026-10-12T00:52:00Z'))).toEqual({ date: '2026-10-12', minute: 9 * 60 + 52 });
  });

  it('10분 안에 시작하는 감독만, 학년-반·정/부 구분과 안내사항(있을 때만)', () => {
    const slots = [slot('S1', 1, '09:00'), slot('S2', 2, '10:00')];
    const assignments = [duty('a', 'S1', 1, 'CHIEF'), duty('b', 'S1', 1, 'ASSISTANT'), duty('c', 'S2', 2, 'CHIEF')];
    const at = { date: '2026-10-12', minute: 8 * 60 + 52 }; // 08:52 → 1교시 8분 전
    const r = planReminders({ sessionId: 'X', now: at, slots, assignments, rooms, studentNotice: '  ' });
    expect(r.map((x) => x.title)).toEqual(['8분 뒤 감독: 1교시 1-3 정감독', '8분 뒤 감독: 1교시 1-3 부감독']);
    expect(r[0]!.body).toBe('10/12 09:00~09:45 · 1학년 국어 · 1-3 정감독');
    expect(r[0]!.id).toBe('remind_X_a');
    const withNotice = planReminders({ sessionId: 'X', now: at, slots, assignments, rooms, studentNotice: '휴대폰은 가방에' });
    expect(withNotice[0]!.body.split('\n')[1]).toBe('학생 안내: 휴대폰은 가방에');
  });

  it('시작 시각이 지났거나 10분보다 멀거나, 시각이 없거나 다른 날이면 보내지 않는다', () => {
    const slots = [slot('S1', 1, '09:00'), slot('S3', 3, null)];
    const assignments = [duty('a', 'S1', 1, 'CHIEF'), duty('n', 'S3', 3, 'CHIEF'), { ...duty('d', 'S1', 1, 'CHIEF'), date: '2026-10-13' }];
    const plan = (minute: number) => planReminders({ sessionId: 'X', now: { date: '2026-10-12', minute }, slots, assignments, rooms }).map((x) => x.id);
    expect(plan(9 * 60)).toEqual([]); // 정각(시작)
    expect(plan(8 * 60 + 49)).toEqual([]); // 11분 전
    expect(plan(8 * 60 + 50)).toEqual(['remind_X_a']); // 10분 전
  });

  it('별도시험장이 2교시에 걸치면 2교시 감독은 2교시 시작(10:00) 10분 전에', () => {
    const s1 = slot('S1', 1, '09:00', { rooms: [{ roomId: 'SEP', classNo: null, headcount: 2, roomType: 'EXTENDED', startTime: '09:00', endTime: '10:10' }] });
    const s2 = slot('S2', 2, '10:00');
    const d2 = { ...duty('p2', 'S1', 2, 'CHIEF', 'SEP') };
    const r = planReminders({ sessionId: 'X', now: { date: '2026-10-12', minute: 9 * 60 + 52 }, slots: [s1, s2], assignments: [d2], rooms });
    expect(r.map((x) => [x.title, x.body])).toEqual([['8분 뒤 감독: 2교시 별도시험장 정감독', '10/12 10:00~10:10 · 1학년 국어 · 별도시험장 정감독']]);
  });

  it('별도시험장에서 다른 학년·과목을 정했으면 알림에 그 학년·과목', () => {
    const s1 = slot('S1', 1, '09:00', { rooms: [{ roomId: 'SEP', classNo: null, headcount: 1, roomType: 'NORMAL', grade: 2, subject: '과학' }] });
    const r = planReminders({ sessionId: 'X', now: { date: '2026-10-12', minute: 8 * 60 + 55 }, slots: [s1], assignments: [duty('s', 'S1', 1, 'CHIEF', 'SEP')], rooms });
    expect(r[0]!.body).toBe('10/12 09:00~09:45 · 2학년 과학 · 별도시험장 정감독');
  });

  it('별도시험장은 그 시험실의 별도 시작 시각으로', () => {
    const s = slot('S1', 1, '09:00', {
      rooms: [{ roomId: 'SEP', classNo: null, headcount: 2, roomType: 'EXTENDED', startTime: '08:40', endTime: '10:10' }],
    });
    const r = planReminders({ sessionId: 'X', now: { date: '2026-10-12', minute: 8 * 60 + 35 }, slots: [s], assignments: [duty('e', 'S1', 1, 'EXTENDED', 'SEP')], rooms });
    expect(r.map((x) => [x.title, x.body])).toEqual([['5분 뒤 감독: 1교시 별도시험장 연장감독', '10/12 08:40~10:10 · 1학년 국어 · 별도시험장 연장감독']]);
  });
});
