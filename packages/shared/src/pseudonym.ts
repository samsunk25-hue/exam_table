/**
 * AI로 보내기 전에 교사 이름을 가명(교사1, 교사2…)으로 바꾸고, 결과에서 원래 이름으로 되돌린다.
 * 명단에 있는 이름만 바꿀 수 있다 (PDF·사진 속 글자나 명단에 없는 이름은 그대로 간다).
 */
export function makePseudonyms(names: string[]) {
  // 긴 이름부터 바꿔야 "김민준"이 "김민"보다 먼저 바뀐다. 두 글자 미만은 다른 낱말과 겹치기 쉬워 뺀다
  const list = [...new Set(names.map((n) => n.trim()).filter((n) => n.length >= 2))].sort((a, b) => b.length - a.length);
  const alias = new Map(list.map((n, i) => [n, `교사${i + 1}`]));
  const real = new Map([...alias].map(([n, a]) => [a, n]));
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const toAlias = list.length ? new RegExp(list.map(esc).join('|'), 'g') : null;
  // 교사12가 교사1로 먼저 바뀌지 않도록 숫자 뒤가 숫자가 아닐 때만
  const toReal = /교사(\d+)(?!\d)/g;
  return {
    count: list.length,
    mask: (text: string) => (toAlias ? text.replace(toAlias, (m) => alias.get(m) ?? m) : text),
    unmask: (text: string) => text.replace(toReal, (m) => real.get(m) ?? m),
  };
}
