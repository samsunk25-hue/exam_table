/**
 * 메뉴 오른쪽 빈 공간에서 동물들이 천천히 걸어서 왔다 갔다 한다 (장식: 클릭·화면 읽기·인쇄에 영향 없음).
 * 이모지 동물은 왼쪽을 보고 있으므로 오른쪽으로 갈 때 좌우를 뒤집는다.
 */
const ANIMALS: { emoji: string; duration: number; delay: number; hop: number }[] = [
  { emoji: '🐕', duration: 26, delay: 0, hop: 0.4 },
  { emoji: '🐈', duration: 34, delay: -9, hop: 0.5 },
  { emoji: '🐇', duration: 22, delay: -5, hop: 0.35 },
  { emoji: '🐿️', duration: 30, delay: -17, hop: 0.4 },
  { emoji: '🐥', duration: 40, delay: -24, hop: 0.3 },
];

export function AnimalParade() {
  return (
    <div className="animal-parade no-print pointer-events-none relative hidden min-w-48 flex-1 self-stretch md:block" aria-hidden>
      {ANIMALS.map((a) => (
        <span key={a.emoji} className="animal-walker" style={{ animationDuration: `${a.duration}s`, animationDelay: `${a.delay}s` }}>
          <span className="animal-hop" style={{ animationDuration: `${a.hop}s` }}>
            {a.emoji}
          </span>
        </span>
      ))}
    </div>
  );
}
