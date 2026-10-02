import { expect, it } from 'vitest';
import { buildSampleSchool } from '@sim/shared';
import { buildEngineInput, runAssignment, validateAssignments } from '../src';

/**
 * 공평성 점검: 무작위 불가시간·배정 금지·앞선 시험 횟수로 자동 배정한 뒤
 * - 누적이 2회 이상 많은 교사(A)의 감독 하나를 적은 교사(B)에게 넘겨도 규칙 위반이 없는데 넘기지 않은 경우
 * - 한 종류가 2회 이상 많은 A의 그 감독과 B의 다른 감독을 맞바꿔 두 종류 모두 고르게 되는데 안 바꾼 경우
 * 가 하나도 없어야 한다.
 */
it('무작위 불가시간·배정 금지·앞선 시험 횟수에서도 넘기거나 맞바꿔 더 고르게 할 수 있는 감독이 남지 않는다', { timeout: 120000 }, () => {
  let seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const s = buildSampleSchool('2026-10-16');
  const days = ['2026-10-16', '2026-10-19', '2026-10-20'];
  const kindOf = (a: { role: string; seatId: string }) => (a.seatId.includes('SSEP') ? 'SPECIAL' : a.role);
  const problems: string[] = [];
  for (let trial = 0; trial < 12; trial++) {
    // 교사 4명 중 1명꼴로 일부 시간 출장, 8%는 모든 감독 금지, 홀수 회차는 앞선 시험 횟수를 무작위로
    const availability = s.teachers.flatMap((t) =>
      rand() < 0.25
        ? days.flatMap((date) =>
            [1, 2, 3].filter(() => rand() < 0.4).map((period) => ({ teacherId: t.id, date, period, available: false, reason: '출장', source: 'ADMIN', status: 'APPROVED' })),
          )
        : [],
    ) as Parameters<typeof buildEngineInput>[0]['availability'];
    const constraints = s.teachers.filter(() => rand() < 0.08).map((t) => ({ teacherId: t.id, type: 'RULE' as const, priority: 'HARD' as const, label: '연수' }));
    const prior: Record<string, Record<string, number>> = {};
    if (trial % 2) for (const t of s.teachers) prior[t.id] = { CHIEF: Math.floor(rand() * 4), ASSISTANT: Math.floor(rand() * 4), STUDY: Math.floor(rand() * 2) };
    const input = buildEngineInput({
      teachers: s.teachers,
      rooms: s.rooms,
      slots: s.slots,
      availability,
      constraints,
      baseTimetable: s.timetable,
      useBaseTimetable: true,
      classDuringExam: true,
      priorCounts: prior,
    });
    const r = runAssignment(input);
    for (const v of validateAssignments(input, r.assignments)) problems.push(`${trial}회차 규칙 위반: ${v.message}`);

    const ids = input.teachers.filter((t) => t.active && t.defaultRole !== 'EXCLUDED' && !constraints.some((c) => c.teacherId === t.id)).map((t) => t.id);
    const tot = (id: string) => Object.values(prior[id] ?? {}).reduce((x, y) => x + y, 0) + r.assignments.filter((a) => a.teacherId === id).length;
    const ok = (list: typeof r.assignments) => validateAssignments(input, list).length === 0;
    for (const A of ids) {
      for (const B of ids) {
        if (tot(A) - tot(B) < 2) continue;
        const a = r.assignments.find((x) => x.teacherId === A && ok(r.assignments.map((y) => (y.seatId === x.seatId ? { ...y, teacherId: B } : y))));
        if (a) problems.push(`${trial}회차 넘기기: ${A}(${tot(A)}회) → ${B}(${tot(B)}회) ${a.seatId}`);
      }
    }

    // 역할: 일부 시간 배정 금지가 없는 교사끼리 (그런 교사는 남은 시간 정감독 우선이라 역할 맞추기에서 빠진다)
    const free = ids.filter((id) => !availability.some((x) => x.teacherId === id));
    const kc = (id: string, kind: string) => (prior[id]?.[kind] ?? 0) + r.assignments.filter((a) => a.teacherId === id && kindOf(a) === kind).length;
    for (const kind of ['CHIEF', 'ASSISTANT', 'STUDY', 'SPECIAL']) {
      for (const A of free) {
        for (const B of free) {
          if (kc(A, kind) - kc(B, kind) < 2) continue;
          const found = r.assignments
            .filter((x) => x.teacherId === A && kindOf(x) === kind)
            .some((a) =>
              r.assignments
                .filter((x) => x.teacherId === B && kindOf(x) !== kind && kc(B, kindOf(x)) - kc(A, kindOf(x)) >= 1)
                .some((b) => ok(r.assignments.map((y) => (y.seatId === a.seatId ? { ...y, teacherId: B } : y.seatId === b.seatId ? { ...y, teacherId: A } : y)))),
            );
          if (found) problems.push(`${trial}회차 역할 맞바꾸기: ${kind} ${A}(${kc(A, kind)}) ↔ ${B}(${kc(B, kind)})`);
        }
      }
    }
  }
  expect(problems).toEqual([]);
});
