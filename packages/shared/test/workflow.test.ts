import { describe, expect, it } from 'vitest';
import { SESSION_STATUSES, TRANSITIONS, findTransition, isPublished, isSetupEditable, sumLoads } from '../src';

describe('워크플로', () => {
  it('모든 상태에 전환 규칙이 있고 대상이 유효하다', () => {
    for (const s of SESSION_STATUSES) {
      for (const t of TRANSITIONS[s]) expect(SESSION_STATUSES).toContain(t.to);
    }
  });

  it('확정 이후에는 공개 이전 단계로 돌아갈 수 없다', () => {
    expect(findTransition('CONFIRMED', 'PUBLISHED')).toBeUndefined();
    expect(findTransition('LOCKED', 'DRAFT')).toBeUndefined();
    expect(findTransition('LOCKED', 'CONFIRMED')?.requiresReason).toBe(false); // 사유는 모두 선택
  });

  it('교사 공개와 기본 데이터 편집 가능 단계', () => {
    expect(isPublished('REVIEW')).toBe(false);
    expect(isPublished('PUBLISHED')).toBe(true);
    expect(isSetupEditable('REVIEW')).toBe(true);
    expect(isSetupEditable('PUBLISHED')).toBe(false);
  });
});

describe('업무점수 합산', () => {
  it('교사별로 가중치를 더한다', () => {
    const loads = sumLoads([
      { teacherId: 'A', weight: 1 },
      { teacherId: 'A', weight: 0.8 },
      { teacherId: 'B', weight: 1.5 },
    ]);
    expect(Object.fromEntries(loads)).toEqual({ A: 1.8, B: 1.5 });
  });
});
