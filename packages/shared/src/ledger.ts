/** 최종 확정 시 세션 배정 결과를 교사별 업무점수로 합산한다. */
export function sumLoads(assignments: { teacherId: string; weight: number }[]): Map<string, number> {
  const loads = new Map<string, number>();
  for (const a of assignments) {
    loads.set(a.teacherId, Math.round(((loads.get(a.teacherId) ?? 0) + a.weight) * 1000) / 1000);
  }
  return loads;
}
