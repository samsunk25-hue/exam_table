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
    expect(result.assignments.some((a) => a.reason.includes('원래 그 반 수업 교사'))).toBe(true);
    expect(result.assignments.filter((a) => a.role === 'STUDY').length).toBe(3 * 3 * 3); // 3일 × 3학년 × 3반, 자습은 반마다 1명
    expect(result.assignments.some((a) => a.role === 'HALLWAY')).toBe(false); // 복도 감독 없음
    expect(result.assignments.filter((a) => a.role === 'ASSISTANT').length).toBeGreaterThan(0);
  });
});

describe('형평성: 매 시험 감독 수는 비슷하게, 누적 차이는 줄인다', () => {
  const sample = buildSampleSchool('2026-10-16');
  // 학년도 누적을 교사마다 다르게 (0 ~ 12점)
  const teachers = sample.teachers.map((t, i) => ({ ...t, cumulativeLoad: (i % 5) * 3 }));
  const input = buildEngineInput({
    teachers,
    rooms: sample.rooms,
    slots: sample.slots,
    availability: [],
    constraints: [],
    baseTimetable: sample.timetable,
    useBaseTimetable: true,
  });
  const result = runAssignment(input);
  const count = new Map<string, number>();
  for (const a of result.assignments) count.set(a.teacherId, (count.get(a.teacherId) ?? 0) + 1);
  const eligible = input.teachers.filter((t) => t.active && t.defaultRole !== 'EXCLUDED');

  it('이번 시험 감독 횟수 차이는 1회 이하', () => {
    expect(result.metrics.successRate).toBe(1);
    expect(validateAssignments(input, result.assignments)).toEqual([]);
    expect(result.metrics.countGap).toBeLessThanOrEqual(1);
  });

  it('정감독·부감독·자습·별도시험장 횟수도 교사마다 차이 1회 이하', () => {
    const sep = (a: { seatId: string }) => a.seatId.includes('SSEP');
    const kinds: ((a: { role: string; seatId: string }) => boolean)[] = [
      (a) => a.role === 'CHIEF' && !sep(a),
      (a) => a.role === 'ASSISTANT' && !sep(a),
      (a) => a.role === 'STUDY',
      sep,
    ];
    for (const f of kinds) {
      const v = eligible.map((t) => result.assignments.filter((a) => a.teacherId === t.id && f(a)).length);
      expect(Math.max(...v) - Math.min(...v)).toBeLessThanOrEqual(1);
    }
  });

  it('1회 더 맡는 교사는 학년도 누적이 낮은 쪽', () => {
    const max = Math.max(...eligible.map((t) => count.get(t.id) ?? 0));
    const avgPrior = (ids: string[]) => ids.reduce((s, id) => s + input.teachers.find((t) => t.id === id)!.priorLoad, 0) / ids.length;
    const more = eligible.filter((t) => (count.get(t.id) ?? 0) === max).map((t) => t.id);
    const less = eligible.filter((t) => (count.get(t.id) ?? 0) < max).map((t) => t.id);
    if (less.length && more.length) expect(avgPrior(more)).toBeLessThan(avgPrior(less));
  });
});

describe('일부 시간만 배정 금지인 교사는 남은 시간에 정감독 우선', () => {
  const sample = buildSampleSchool('2026-10-16');
  const blocked = sample.teachers.slice(0, 3).map((t) => t.id);
  // 첫날 1·2교시 출장
  const availability = blocked.flatMap((teacherId) =>
    [1, 2].map((period) => ({ teacherId, date: '2026-10-16', period, available: false, reason: '출장', source: 'ADMIN', status: 'APPROVED' })),
  ) as Parameters<typeof buildEngineInput>[0]['availability'];
  const input = buildEngineInput({
    teachers: sample.teachers.map((t, i) => ({ ...t, cumulativeLoad: (i % 5) * 3 })),
    rooms: sample.rooms,
    slots: sample.slots,
    availability,
    constraints: [],
    baseTimetable: sample.timetable,
    useBaseTimetable: true,
  });
  const result = runAssignment(input);

  it('남은 시험 교시는 모두 정감독, 연속도 허용, 총 감독 차이는 1회 이하', () => {
    expect(result.metrics.successRate).toBe(1);
    expect(validateAssignments(input, result.assignments)).toEqual([]);
    expect(result.metrics.countGap).toBeLessThanOrEqual(1);
    for (const id of blocked) {
      const mine = result.assignments.filter((a) => a.teacherId === id);
      expect(mine.filter((a) => a.role === 'ASSISTANT')).toEqual([]);
      expect(mine.filter((a) => a.role === 'CHIEF').length).toBeGreaterThan(mine.filter((a) => a.role === 'STUDY').length);
    }
  });

  it('나머지 교사는 역할별 차이 1회 이하', () => {
    const others = input.teachers.filter((t) => t.active && t.defaultRole !== 'EXCLUDED' && !blocked.includes(t.id));
    for (const role of ['CHIEF', 'ASSISTANT', 'STUDY']) {
      const v = others.map((t) => result.assignments.filter((a) => a.teacherId === t.id && a.role === role && !a.seatId.includes('SSEP')).length);
      expect(Math.max(...v) - Math.min(...v)).toBeLessThanOrEqual(1);
    }
  });
});

describe('두 번째 시험부터는 앞선 확정 시험의 감독 횟수를 이어서 맞춘다', () => {
  const sample = buildSampleSchool('2026-10-16');
  const kindOf = (a: { role: string; seatId: string }) => (a.seatId.includes('SSEP') ? 'SPECIAL' : a.role);
  const prior: Record<string, Record<string, number>> = {};
  const results = [1, 2, 3].map(() => {
    const input = buildEngineInput({
      teachers: sample.teachers,
      rooms: sample.rooms,
      slots: sample.slots,
      availability: [],
      constraints: [],
      baseTimetable: sample.timetable,
      useBaseTimetable: true,
      priorCounts: structuredClone(prior),
    });
    const result = runAssignment(input);
    for (const a of result.assignments) {
      const c = (prior[a.teacherId] ??= {});
      c[kindOf(a)] = (c[kindOf(a)] ?? 0) + 1;
    }
    return { input, result };
  });
  const ids = sample.teachers.map((t) => t.id);
  const gap = (v: number[]) => Math.max(...v) - Math.min(...v);

  it('시험마다 감독 횟수 차이는 1회 이하', () => {
    for (const { input, result } of results) {
      expect(result.metrics.successRate).toBe(1);
      expect(validateAssignments(input, result.assignments)).toEqual([]);
      expect(result.metrics.countGap).toBeLessThanOrEqual(1);
    }
  });

  it('세 번 시험을 합친 누적 감독 횟수도 전체·역할별 모두 차이 1회 이하', () => {
    expect(gap(ids.map((id) => Object.values(prior[id] ?? {}).reduce((n, v) => n + v, 0)))).toBeLessThanOrEqual(1);
    for (const k of ['CHIEF', 'ASSISTANT', 'STUDY', 'SPECIAL']) expect(gap(ids.map((id) => prior[id]?.[k] ?? 0))).toBeLessThanOrEqual(1);
  });
});

describe('앞선 시험에서 배정 금지로 적게 맡은 교사는 다음 시험에서 더 맡는다', () => {
  const sample = buildSampleSchool('2026-10-16');
  const blocked = sample.teachers.slice(0, 3).map((t) => t.id);
  const kindOf = (a: { role: string; seatId: string }) => (a.seatId.includes('SSEP') ? 'SPECIAL' : a.role);
  const run = (constraints: Parameters<typeof buildEngineInput>[0]['constraints'], priorCounts?: Record<string, Record<string, number>>) => {
    const input = buildEngineInput({
      teachers: sample.teachers,
      rooms: sample.rooms,
      slots: sample.slots,
      availability: [],
      constraints,
      baseTimetable: sample.timetable,
      useBaseTimetable: true,
      priorCounts,
    });
    return { input, result: runAssignment(input) };
  };
  // 첫 시험: 3명은 모든 감독 금지 (연수)
  const first = run(blocked.map((teacherId) => ({ teacherId, type: 'RULE', priority: 'HARD', label: '연수' })));
  const prior: Record<string, Record<string, number>> = {};
  for (const a of first.result.assignments) {
    const c = (prior[a.teacherId] ??= {});
    c[kindOf(a)] = (c[kindOf(a)] ?? 0) + 1;
  }
  const second = run([], prior);
  const now = (id: string) => second.result.assignments.filter((a) => a.teacherId === id).length;
  const others = sample.teachers.map((t) => t.id).filter((id) => !blocked.includes(id));

  it('첫 시험에서는 0회', () => {
    for (const id of blocked) expect(first.result.assignments.some((a) => a.teacherId === id)).toBe(false);
  });

  it('두 번째 시험에서는 다른 교사보다 훨씬 많이 맡아 누적 차이를 줄인다 (연속 감독 포함)', () => {
    expect(second.result.metrics.successRate).toBe(1);
    expect(validateAssignments(second.input, second.result.assignments)).toEqual([]);
    const most = Math.max(...others.map(now));
    for (const id of blocked) expect(now(id)).toBeGreaterThanOrEqual(most + 2);
  });

  it('모든 교시를 이어 맡을 때 정감독끼리·부감독끼리 잇지 않고 정·부를 섞는다', () => {
    for (const id of blocked) {
      const mine = second.result.assignments.filter((a) => a.teacherId === id && (a.role === 'CHIEF' || a.role === 'ASSISTANT'));
      const at = (a: (typeof mine)[number]) => second.input.slots.find((x) => x.id === a.slotId)!;
      const sameRun = mine.filter((a) => mine.some((b) => at(b).date === at(a).date && at(b).period === at(a).period + 1 && b.role === a.role));
      expect(sameRun).toEqual([]);
    }
  });
});
