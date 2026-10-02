import { describe, expect, it } from 'vitest';
import { makePseudonyms } from '../src';

describe('AI로 보낼 때 교사 이름 가명', () => {
  it('명단 이름을 교사1·교사2…로 바꾸고 결과에서 되돌린다 (긴 이름 먼저, 교사12≠교사1)', () => {
    const names = Array.from({ length: 12 }, (_, i) => `이름${String.fromCharCode(44032 + i)}가`);
    const ps = makePseudonyms(['김민', '김민준', ...names]);
    const sent = ps.mask('김민준 국어 1-1 담임, 김민 수학');
    expect(sent).not.toContain('김민');
    expect(ps.unmask(sent)).toBe('김민준 국어 1-1 담임, 김민 수학');
    const last = ps.mask(names[11]!);
    expect(last).toMatch(/^교사\d+$/);
    expect(ps.unmask(last)).toBe(names[11]);
  });

  it('명단에 없는 이름·한 글자는 그대로', () => {
    const ps = makePseudonyms(['박', '이수학']);
    expect(ps.mask('박 선생님, 최신규')).toBe('박 선생님, 최신규');
    expect(ps.count).toBe(1);
  });
});
