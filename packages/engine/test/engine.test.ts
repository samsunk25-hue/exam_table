import { describe, expect, it } from 'vitest';
import { overlappingPeriods, runAssignment, seatCandidates, validateAssignments, weekdayOf, type EngineInput } from '../src';
import { emptyInput, fakeSchool, teacher } from './fixtures';

/** 교실 1개, 시험 1개(날짜 2026-10-12 월요일 1교시) */
function oneRoom(extra: Partial<EngineInput> = {}): EngineInput {
  return emptyInput({
    rooms: [{ id: 'R11', name: '1-1', chiefCount: 1, assistantCount: 1, spaceType: 'CLASSROOM' }],
    slots: [{ id: 'S1', date: '2026-10-12', period: 1, grade: 1, subject: '수학', type: 'EXAM' }],
    groups: [{ id: 'G1', slotId: 'S1', roomId: 'R11', grade: 1, classNo: 1, roomType: 'NORMAL' }],
    ...extra,
  });
}

describe('좌석 생성', () => {
  it('정·부감독 좌석과 역할 가중치를 만든다', () => {
    const r = runAssignment(oneRoom({ teachers: [teacher('A'), teacher('B')] }));
    expect(r.seats.map((s) => [s.id, s.role, s.weight])).toEqual([
      ['G1_CHIEF_1', 'CHIEF', 1.0],
      ['G1_ASSISTANT_1', 'ASSISTANT', 0.8],
    ]);
  });

  it('연장 그룹은 정감독 좌석이 연장감독(1.5)이 된다', () => {
    const input = oneRoom({ teachers: [teacher('A'), teacher('B')] });
    input.groups[0]!.roomType = 'EXTENDED';
    expect(runAssignment(input).seats[0]).toMatchObject({ role: 'EXTENDED', weight: 1.5 });
  });

  it('날짜를 요일로 변환한다', () => {
    expect(weekdayOf('2026-10-12')).toBe(1);
    expect(weekdayOf('2026-10-18')).toBe(7);
  });
});

describe('하드 조건', () => {
  it('불가시간(승인·대기)은 배정하지 않고, 반려는 무시한다', () => {
    const input = oneRoom({
      teachers: [teacher('A'), teacher('B'), teacher('C')],
      availability: [
        { teacherId: 'A', date: '2026-10-12', period: 1, status: 'APPROVED' },
        { teacherId: 'B', date: '2026-10-12', period: 1, status: 'PENDING' },
        { teacherId: 'C', date: '2026-10-12', period: 1, status: 'REJECTED' },
      ],
    });
    const r = runAssignment(input);
    expect(r.assignments.map((a) => a.teacherId)).toEqual(['C']);
    expect(r.unassigned).toHaveLength(1);
    expect(r.unassigned[0]!.message).toBe(
      '1-1반 수학 부감독 미배정 (가용 인력 0명 - 불가시간 2명, 동시간 타 감독 1명)',
    );
  });

  it('동시간대 중복 배정을 하지 않는다', () => {
    const input = oneRoom({ teachers: [teacher('A')] });
    const r = runAssignment(input);
    expect(r.assignments).toHaveLength(1);
    expect(validateAssignments(input, r.assignments)).toEqual([]);
  });

  it('연장감독 직후 교시에는 배정하지 않는다', () => {
    const input = emptyInput({
      teachers: [teacher('A'), teacher('B')],
      rooms: [
        { id: 'SEP', name: '별도실', chiefCount: 1, assistantCount: 0, spaceType: 'SEPARATE' },
        { id: 'R11', name: '1-1', chiefCount: 1, assistantCount: 0, spaceType: 'CLASSROOM' },
      ],
      slots: [
        { id: 'S1', date: '2026-10-12', period: 1, grade: 1, subject: '수학', type: 'EXAM' },
        { id: 'S2', date: '2026-10-12', period: 2, grade: 1, subject: '영어', type: 'EXAM' },
      ],
      groups: [
        { id: 'G1', slotId: 'S1', roomId: 'SEP', grade: 1, classNo: null, roomType: 'EXTENDED' },
        { id: 'G2', slotId: 'S2', roomId: 'R11', grade: 1, classNo: 1, roomType: 'NORMAL' },
      ],
    });
    const r = runAssignment(input);
    const ext = r.assignments.find((a) => a.role === 'EXTENDED')!;
    const next = r.assignments.find((a) => a.slotId === 'S2')!;
    expect(ext.teacherId).not.toBe(next.teacherId);

    const bad = [
      { seatId: 'G1_EXTENDED_1', teacherId: 'A' },
      { seatId: 'G2_CHIEF_1', teacherId: 'A' },
    ];
    expect(validateAssignments(input, bad).map((v) => v.reason)).toContain('AFTER_EXTENDED');
  });

  it('특별실 별도 시간이 다음 교시와 겹치면 그 교시까지 차지한다 (중복 배정·불가시간)', () => {
    const base = {
      rooms: [
        { id: 'SEP', name: '특별실', chiefCount: 1, assistantCount: 0, spaceType: 'SEPARATE' as const },
        { id: 'R11', name: '1-1', chiefCount: 1, assistantCount: 0, spaceType: 'CLASSROOM' as const },
      ],
      slots: [
        { id: 'S1', date: '2026-10-12', period: 1, grade: 1, subject: '수학', type: 'EXAM' as const },
        { id: 'S2', date: '2026-10-12', period: 2, grade: 1, subject: '영어', type: 'EXAM' as const },
      ],
      groups: [
        { id: 'G1', slotId: 'S1', roomId: 'SEP', grade: 1, classNo: null, roomType: 'SPECIAL' as const, alsoPeriods: [2] },
        { id: 'G2', slotId: 'S2', roomId: 'R11', grade: 1, classNo: 1, roomType: 'NORMAL' as const },
      ],
    };
    const input = emptyInput({ ...base, teachers: [teacher('A'), teacher('B')] });
    const r = runAssignment(input);
    expect(r.unassigned).toHaveLength(0);
    expect(r.assignments.find((a) => a.slotId === 'S1')!.teacherId).not.toBe(r.assignments.find((a) => a.slotId === 'S2')!.teacherId);
    expect(validateAssignments(input, [{ seatId: 'G1_CHIEF_1', teacherId: 'A' }, { seatId: 'G2_CHIEF_1', teacherId: 'A' }]).map((v) => v.reason)).toContain('BUSY');

    // 2교시 불가인 교사는 1교시 특별실(2교시까지 이어짐)도 맡을 수 없다
    const busy = emptyInput({
      ...base,
      teachers: [teacher('A'), teacher('B')],
      availability: [{ teacherId: 'A', date: '2026-10-12', period: 2, status: 'APPROVED' }],
    });
    expect(runAssignment(busy).assignments.find((a) => a.slotId === 'S1')!.teacherId).toBe('B');
  });

  it('HARD 예외 규칙과 배정 제외 교사, 복도 역할을 지킨다', () => {
    const input = oneRoom({
      teachers: [
        teacher('A', { homeroom: { grade: 1, classNo: 1 } }),
        teacher('B', { defaultRole: 'EXCLUDED' }),
        teacher('C', { defaultRole: 'HALLWAY' }),
        teacher('D'),
      ],
      constraints: [{ teacherId: 'A', type: 'HOMEROOM_EXCLUDE', priority: 'HARD' }],
    });
    const r = runAssignment(input);
    expect(r.assignments.map((a) => a.teacherId)).toEqual(['D']);
  });
});

describe('소프트 점수', () => {
  const base = () =>
    oneRoom({
      rooms: [{ id: 'R11', name: '1-1', chiefCount: 1, assistantCount: 0, spaceType: 'CLASSROOM' }],
      teachers: [teacher('A'), teacher('B')],
      baseTimetable: [{ teacherId: 'B', weekday: 1, period: 1, grade: 1, classNo: 1 }],
    });

  it('기초시간표 반영을 켜면 원래 수업 교사가 +50을 받는다', () => {
    const input = base();
    input.settings.useBaseTimetable = true;
    const [a] = runAssignment(input).assignments;
    expect(a!.teacherId).toBe('B');
    expect(a!.reason).toContain('+50(기초일치)');
  });

  it('기초시간표 반영을 끄면 가점이 없다', () => {
    const [a] = runAssignment(base()).assignments;
    expect(a!.teacherId).toBe('A');
    expect(a!.reason).not.toContain('기초일치');
  });

  it('SOFT 예외 규칙은 감점한다', () => {
    const input = base();
    input.constraints = [{ teacherId: 'A', type: 'SUBJECT_EXCLUDE', target: '수학', priority: 'SOFT' }];
    const [a] = runAssignment(input).assignments;
    expect(a!.teacherId).toBe('B');
  });

  it('글로 쓴 고려사항(RULE): 금지·피하기·우선, 모든 교사(*) 규칙', () => {
    // 금지: A는 1교시 정감독 금지 → B
    const forbid = base();
    forbid.constraints = [{ teacherId: 'A', type: 'RULE', when: { periods: [1], roles: ['CHIEF'] }, priority: 'HARD' }];
    expect(runAssignment(forbid).assignments[0]!.teacherId).toBe('B');
    // 조건이 안 맞으면(2교시) 적용 안 됨 → A
    const other = base();
    other.constraints = [{ teacherId: 'A', type: 'RULE', when: { periods: [2] }, priority: 'HARD' }];
    expect(runAssignment(other).assignments[0]!.teacherId).toBe('A');
    // 우선: B에 +100 → B, 이유에 표시
    const prefer = base();
    prefer.constraints = [{ teacherId: 'B', type: 'RULE', when: { dates: ['2026-10-12'] }, priority: 'SOFT', penalty: 100 }];
    const [p] = runAssignment(prefer).assignments;
    expect(p!.teacherId).toBe('B');
    expect(p!.reason).toContain('+100(예외규칙)');
    // 모든 교사 금지: 1학년 수학은 아무도 못 맡음 → 미배정
    const all = base();
    all.constraints = [{ teacherId: '*', type: 'RULE', when: { grades: [1], subjects: ['수학'] }, priority: 'HARD' }];
    expect(runAssignment(all).unassigned).toHaveLength(1);
  });

  it('누적 부담이 낮은 교사를 우선한다', () => {
    const input = base();
    input.teachers[0]!.priorLoad = 10;
    const [a] = runAssignment(input).assignments;
    expect(a!.teacherId).toBe('B');
  });
});

describe('감독구분', () => {
  const hallway = () =>
    emptyInput({
      rooms: [{ id: 'H1', name: '1학년 복도', chiefCount: 1, assistantCount: 0, spaceType: 'HALLWAY' }],
      slots: [{ id: 'S1', date: '2026-10-12', period: 1, grade: 1, subject: '수학', type: 'EXAM' }],
      groups: [{ id: 'G1', slotId: 'S1', roomId: 'H1', grade: 1, classNo: null, roomType: 'NORMAL' }],
    });

  it('복도 자리는 복도전담 교사가 우선한다', () => {
    const input = hallway();
    input.teachers = [teacher('A'), teacher('B', { defaultRole: 'HALLWAY' })];
    const [a] = runAssignment(input).assignments;
    expect(a).toMatchObject({ teacherId: 'B', role: 'HALLWAY' });
    expect(a!.reason).toContain('+20(복도전담)');
  });

  it('복도전담 교사가 없으면 일반 교사도 복도를 맡는다', () => {
    const input = hallway();
    input.teachers = [teacher('A')];
    expect(runAssignment(input).assignments.map((a) => a.teacherId)).toEqual(['A']);
  });
});

describe('고정 배정(pinned)', () => {
  it('고정 배정은 유지하고, 하드 조건 위반 고정은 거부한다', () => {
    const input = oneRoom({
      teachers: [teacher('A'), teacher('B'), teacher('C')],
      availability: [{ teacherId: 'C', date: '2026-10-12', period: 1, status: 'APPROVED' }],
      pinned: [
        { seatId: 'G1_ASSISTANT_1', teacherId: 'A' },
        { seatId: 'G1_CHIEF_1', teacherId: 'C' },
      ],
    });
    const r = runAssignment(input);
    expect(r.assignments.find((a) => a.seatId === 'G1_ASSISTANT_1')).toMatchObject({ teacherId: 'A', source: 'MANUAL' });
    expect(r.assignments.find((a) => a.seatId === 'G1_CHIEF_1')!.teacherId).toBe('B');
    expect(r.rejectedPinned.map((v) => v.reason)).toEqual(['UNAVAILABLE']);
  });
});

describe('수동 편집 후보', () => {
  it('가능한 교사를 점수순으로, 불가 교사는 사유와 함께 뒤에 둔다', () => {
    const input = oneRoom({
      teachers: [teacher('A'), teacher('B'), teacher('C')],
      availability: [{ teacherId: 'C', date: '2026-10-12', period: 1, status: 'APPROVED' }],
    });
    const list = seatCandidates(input, [{ seatId: 'G1_ASSISTANT_1', teacherId: 'A' }], 'G1_CHIEF_1');
    expect(list.map((c) => [c.teacherId, c.blockedBy])).toEqual([
      ['B', null],
      ['C', 'UNAVAILABLE'],
      ['A', 'BUSY'],
    ]);
  });
});

describe('가상 학교 (교사 60명, 4일 × 3교시, 28실)', () => {
  const input = fakeSchool();

  it('하드 조건 위반 0건, 성공률 95% 이상, 1초 이내', () => {
    const t0 = performance.now();
    const r = runAssignment(input);
    const elapsed = performance.now() - t0;

    expect(validateAssignments(input, r.assignments)).toEqual([]);
    expect(r.metrics.successRate).toBeGreaterThanOrEqual(0.95);
    expect(elapsed).toBeLessThan(1000);
  });

  it('같은 입력이면 같은 결과를 낸다', () => {
    expect(runAssignment(input)).toEqual(runAssignment(input));
  });

  it('형평성 재배치로 이번 세션 부담 편차가 작다', () => {
    const r = runAssignment(input);
    const normal = input.teachers.filter((t) => t.active && t.defaultRole === 'NORMAL');
    const session = normal.map((t) => r.metrics.sessionLoads[t.id]!);
    expect(Math.max(...session) - Math.min(...session)).toBeLessThanOrEqual(6);
    // 과거 부담이 반영되어 누적 편차는 과거 편차보다 줄어든다
    const prior = normal.map((t) => t.priorLoad);
    const total = normal.map((t) => r.metrics.loads[t.id]!);
    expect(Math.max(...total) - Math.min(...total)).toBeLessThan(Math.max(...prior) - Math.min(...prior));
  });

  it('검증 함수가 주입된 중복 배정을 잡아낸다', () => {
    const r = runAssignment(input);
    const [a, b] = r.assignments.filter((x) => x.slotId === r.assignments[0]!.slotId);
    const tampered = r.assignments.map((x) => (x.seatId === b!.seatId ? { ...x, teacherId: a!.teacherId } : x));
    expect(validateAssignments(input, tampered).map((v) => v.reason)).toContain('BUSY');
  });

  it('인력이 부족하면 미배정 사유를 설명한다', () => {
    const tight = fakeSchool({ teacherCount: 30, hallwayTeachers: 2 });
    const r = runAssignment(tight);
    expect(validateAssignments(tight, r.assignments)).toEqual([]);
    expect(r.unassigned.length).toBeGreaterThan(0);
    expect(r.unassigned[0]!.message).toMatch(/미배정 \(가용 인력 0명 - .*동시간 타 감독 \d+명/);
  });
});

describe('별도 시간 → 겹치는 교시', () => {
  const slot = (period: number, startTime: string, endTime: string) => ({
    date: '2026-10-12', period, grade: 1, subject: '수학', type: 'EXAM' as const, startTime, endTime, rooms: [],
  });
  const slots = [slot(1, '09:00', '09:45'), slot(2, '10:00', '10:45'), slot(3, '11:00', '11:45')];
  const p = { roomId: 'SEP', classNo: null, headcount: 2, roomType: 'SPECIAL' as const };

  it('시간을 따로 정하지 않으면 겹치는 교시가 없다', () => {
    expect(overlappingPeriods(slots, slots[0]!, p)).toEqual([]);
  });
  it('종료를 10:20으로 늘리면 2교시와 겹친다', () => {
    expect(overlappingPeriods(slots, slots[0]!, { ...p, endTime: '10:20' })).toEqual([2]);
  });
  it('쉬는 시간 안에서 끝나면 겹치지 않는다', () => {
    expect(overlappingPeriods(slots, slots[0]!, { ...p, endTime: '09:55' })).toEqual([]);
  });
});

describe('출제 교사 규칙', () => {
  // 1학년 국어 시험: 교실 1(정감독) + 복도 1, 교사 = 국어 교사 A + 수학 교사 B
  const input = (rule: 'NONE' | 'PREFER_HALLWAY' | 'NO_ROOM', teachers = [teacher('A', { subject: '국어' }), teacher('B', { subject: '수학' })]) =>
    emptyInput({
      teachers,
      rooms: [
        { id: 'R11', name: '1-1', chiefCount: 1, assistantCount: 0, spaceType: 'CLASSROOM' },
        { id: 'H1', name: '1학년 복도', chiefCount: 1, assistantCount: 0, spaceType: 'HALLWAY' },
      ],
      slots: [{ id: 'S1', date: '2026-10-12', period: 1, grade: 1, subject: '국어', type: 'EXAM' }],
      groups: [
        { id: 'G1', slotId: 'S1', roomId: 'R11', grade: 1, classNo: 1, roomType: 'NORMAL' },
        { id: 'G2', slotId: 'S1', roomId: 'H1', grade: 1, classNo: null, roomType: 'NORMAL' },
      ],
      settings: { useBaseTimetable: false, examWriterRule: rule },
    });

  it('복도 대기 우선: 국어 교사가 국어 시험 시간에 복도로', () => {
    const r = runAssignment(input('PREFER_HALLWAY'));
    expect(r.assignments.find((a) => a.teacherId === 'A')!.role).toBe('HALLWAY');
  });

  it('교실 감독 제외: 국어 교사는 교실에 배정할 수 없다 (복도는 가능)', () => {
    const only = input('NO_ROOM', [teacher('A', { subject: '국어' })]);
    const r = runAssignment(only);
    expect(r.assignments.map((a) => a.role)).toEqual(['HALLWAY']);
    expect(validateAssignments(only, [{ seatId: 'G1_CHIEF_1', teacherId: 'A' }]).map((v) => v.reason)).toContain('EXAM_WRITER');
  });

  it('상관없음: 제한 없이 배정된다', () => {
    const r = runAssignment(input('NONE', [teacher('A', { subject: '국어' })]));
    expect(r.assignments).toHaveLength(1);
  });
});

describe('일부 학년만 시험 (수업 중 교사 제외)', () => {
  // 월요일 1교시: 1학년만 시험, 2학년은 수업. A는 그 시간 2학년 수업, B는 수업 없음
  const input = (classDuringExam: boolean) =>
    emptyInput({
      teachers: [teacher('A'), teacher('B')],
      rooms: [{ id: 'R11', name: '1-1', chiefCount: 1, assistantCount: 0, spaceType: 'CLASSROOM' }],
      slots: [{ id: 'S1', date: '2026-10-12', period: 1, grade: 1, subject: '국어', type: 'EXAM' }],
      groups: [{ id: 'G1', slotId: 'S1', roomId: 'R11', grade: 1, classNo: 1, roomType: 'NORMAL' }],
      baseTimetable: [{ teacherId: 'A', weekday: 1, period: 1, grade: 2, classNo: 3 }],
      settings: { useBaseTimetable: true, classDuringExam },
    });

  it('켜면: 시험 없는 학년을 가르치는 교사는 감독하지 않는다', () => {
    const on = input(true);
    expect(runAssignment(on).assignments.map((a) => a.teacherId)).toEqual(['B']);
    expect(validateAssignments(on, [{ seatId: 'G1_CHIEF_1', teacherId: 'A' }]).map((v) => v.reason)).toContain('IN_CLASS');
  });

  it('끄면: 제한 없음', () => {
    expect(validateAssignments(input(false), [{ seatId: 'G1_CHIEF_1', teacherId: 'A' }])).toEqual([]);
  });
});

describe('감독 없음 자리', () => {
  it('배정하지 않고 미배정으로도 세지 않는다', () => {
    const input = oneRoom({ teachers: [teacher('A'), teacher('B')] });
    input.settings.skipSeats = ['G1_ASSISTANT_1'];
    const r = runAssignment(input);
    expect(r.assignments.map((a) => a.seatId)).toEqual(['G1_CHIEF_1']);
    expect(r.unassigned).toHaveLength(0);
    expect(r.metrics.seatCount).toBe(1);
  });
});

describe('수업 시간도 업무 점수', () => {
  it('수업 시간을 업무 점수로 세어 형평성에 반영한다', () => {
    // 월 1·3교시 1학년 시험 / A는 1교시에 2학년 수업 → 1교시는 B, 3교시는 점수가 낮은 A (A = 수업 0.8 + 감독 1)
    const input = emptyInput({
      teachers: [teacher('A'), teacher('B')],
      rooms: [{ id: 'R11', name: '1-1', chiefCount: 1, assistantCount: 0, spaceType: 'CLASSROOM' }],
      slots: [
        { id: 'S1', date: '2026-10-12', period: 1, grade: 1, subject: '국어', type: 'EXAM' },
        { id: 'S2', date: '2026-10-12', period: 3, grade: 1, subject: '수학', type: 'EXAM' },
      ],
      groups: [
        { id: 'G1', slotId: 'S1', roomId: 'R11', grade: 1, classNo: 1, roomType: 'NORMAL' },
        { id: 'G2', slotId: 'S2', roomId: 'R11', grade: 1, classNo: 1, roomType: 'NORMAL' },
      ],
      baseTimetable: [{ teacherId: 'A', weekday: 1, period: 1, grade: 2, classNo: 1 }],
      settings: { useBaseTimetable: true, classDuringExam: true },
    });
    const r = runAssignment(input);
    expect(r.assignments.map((a) => a.teacherId)).toEqual(['B', 'A']);
    expect(r.metrics.sessionLoads.A).toBe(1.8); // 수업 1시간 0.8 + 정감독 1
    expect(r.metrics.sessionLoads.B).toBe(1);
  });
});

describe('임시 감독자', () => {
  it('교사가 충분하면 쓰지 않고, 모자랄 때만 쓴다', () => {
    const tmp = { ...teacher('X'), temporary: true };
    const enough = oneRoom({ teachers: [teacher('A'), teacher('B'), tmp] });
    expect(runAssignment(enough).assignments.map((a) => a.teacherId).sort()).toEqual(['A', 'B']);
    const short = oneRoom({ teachers: [teacher('A'), tmp] });
    expect(runAssignment(short).assignments.map((a) => a.teacherId).sort()).toEqual(['A', 'X']);
  });
});
