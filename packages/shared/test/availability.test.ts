import { describe, expect, it } from 'vitest';
import { availabilityId, capacityByTime, examTimes, groupByDate, type AvailabilityDoc, type RoomDoc, type SlotDoc, type TeacherDoc, type WithId } from '../src';

const slot = (date: string, period: number, grade: number, roomIds: string[]): WithId<SlotDoc> => ({
  id: `${date}_${period}_${grade}`,
  date,
  period,
  startTime: period === 1 ? '09:00' : null,
  endTime: null,
  grade,
  subject: '국어',
  type: 'EXAM',
  rooms: roomIds.map((roomId) => ({ roomId, classNo: null, headcount: null, roomType: 'NORMAL' })),
});

const room = (id: string, chief: number, assistant = 0): WithId<RoomDoc> => ({
  id,
  name: id,
  spaceType: 'CLASSROOM',
  grade: 1,
  classNo: 1,
  chiefCount: chief,
  assistantCount: assistant,
});

const teacher = (id: string, extra: Partial<TeacherDoc> = {}): WithId<TeacherDoc> => ({
  id,
  name: id,
  email: null,
  subject: null,
  homeroom: null,
  defaultRole: 'NORMAL',
  active: true,
  cumulativeLoad: 0,
  ...extra,
});

const off = (teacherId: string, date: string, period: number, status: AvailabilityDoc['status']): AvailabilityDoc => ({
  teacherId,
  date,
  period,
  available: false,
  reason: '출장',
  source: 'TEACHER',
  status,
});

describe('불가시간', () => {
  it('문서 ID는 교사·날짜·교시로 정해진다 (같은 칸 중복 제출 방지)', () => {
    expect(availabilityId('T001', '2026-10-12', 2)).toBe('T001_2026-10-12_2');
  });

  it('시험 일정에서 날짜·교시 목록을 뽑고 날짜별로 묶는다', () => {
    const times = examTimes([slot('2026-10-13', 1, 1, []), slot('2026-10-12', 2, 1, []), slot('2026-10-12', 1, 2, []), slot('2026-10-12', 1, 1, [])]);
    expect(times.map((t) => `${t.date}/${t.period}`)).toEqual(['2026-10-12/1', '2026-10-12/2', '2026-10-13/1']);
    expect(times[0]!.startTime).toBe('09:00');
    expect(groupByDate(times).map(([d, l]) => [d, l.length])).toEqual([
      ['2026-10-12', 2],
      ['2026-10-13', 1],
    ]);
  });

  it('시간대별 필요 인원과 가용 인원 (반려는 가용, 제외 교사는 계산에서 뺀다)', () => {
    const cap = capacityByTime(
      [slot('2026-10-12', 1, 1, ['A', 'B']), slot('2026-10-12', 1, 2, ['C']), slot('2026-10-12', 2, 1, ['A'])],
      [room('A', 1, 1), room('B', 1), room('C', 1)],
      [teacher('T1'), teacher('T2'), teacher('T3'), teacher('T4', { defaultRole: 'EXCLUDED' }), teacher('T5', { active: false })],
      [
        off('T1', '2026-10-12', 1, 'APPROVED'),
        off('T2', '2026-10-12', 1, 'PENDING'),
        off('T3', '2026-10-12', 1, 'REJECTED'),
        off('T4', '2026-10-12', 1, 'APPROVED'),
      ],
    );
    expect(cap.map((c) => [c.period, c.need, c.available, c.approvedOff, c.pendingOff])).toEqual([
      [1, 4, 1, 1, 1],
      [2, 2, 3, 0, 0],
    ]);
  });

  it('자습 교시는 시험실마다 1명만 필요하다 (정·부감독 수와 상관없이)', () => {
    const study = { ...slot('2026-10-12', 3, 1, ['A', 'B']), type: 'STUDY' as const };
    const cap = capacityByTime([study], [room('A', 1, 1), room('B', 2, 1)], [teacher('T1')], []);
    expect(cap[0]!.need).toBe(2);
  });
});
