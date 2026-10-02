import { useMemo } from 'react';
import type { AssignmentDoc, TeacherDoc, WithId } from '@sim/shared';
import { Fold } from '@/components/Fold';
import { Card, Spinner, Table, Td, CardTitle } from '@/components/ui';
import { useCollection } from '@/lib/data';
import { useSessions, type ExamSession } from '@/lib/sessions';

interface Ledger {
  sessionId: string;
  teacherId: string;
  load: number;
}

type Level = 'high' | 'mid' | 'low';
const LEVEL: Record<Level, { label: string; cls: string }> = {
  high: { label: '높음', cls: 'bg-alert text-white' },
  mid: { label: '보통', cls: 'bg-primary-soft text-primary-strong' },
  low: { label: '낮음', cls: 'bg-mint-soft text-ink' },
};
const round = (n: number) => Math.round(n * 10) / 10;

/**
 * 학년도 추이와 피로도 예측: 같은 학교·학년도에 확정된 시험별 업무 점수를 교사마다 이어 보고,
 * 학년도 누적 부담 + 이번 시험 연속 감독 + 하루 최다 감독으로 피로도를 예측한다.
 * 학기마다 교사 문서가 따로 있으므로 같은 사람은 이메일(없으면 이름)로 잇는다.
 */
export function YearTrend({ session, teachers, assignments }: { session: ExamSession; teachers: WithId<TeacherDoc>[]; assignments: WithId<AssignmentDoc>[] }) {
  const sessions = useSessions();
  const ledger = useCollection<Ledger>('loadLedger');
  const everyone = useCollection<TeacherDoc>('teachers');

  const model = useMemo(() => {
    // 같은 학교·학년도, 확정된 다른 시험 (오래된 순)
    const past = sessions.data
      .filter((s) => s.id !== session.id && s.schoolName === session.schoolName && s.year === session.year && (s.status === 'CONFIRMED' || s.status === 'LOCKED'))
      .sort((a, b) => a.semester - b.semester || (a.createdAt?.toMillis() ?? 0) - (b.createdAt?.toMillis() ?? 0));
    const person = (t: Pick<TeacherDoc, 'email' | 'name'>) => t.email ?? `name:${t.name}`;
    const personOf = new Map(everyone.data.map((t) => [t.id, person(t)]));
    const pastLoad = new Map<string, Map<string, number>>(); // person → sessionId → load
    for (const l of ledger.data) {
      if (!past.some((s) => s.id === l.sessionId)) continue;
      const p = personOf.get(l.teacherId);
      if (!p) continue;
      const m = pastLoad.get(p) ?? new Map<string, number>();
      m.set(l.sessionId, (m.get(l.sessionId) ?? 0) + l.load);
      pastLoad.set(p, m);
    }

    const rows = teachers
      .filter((t) => t.active)
      .map((t) => {
        const mine = assignments.filter((a) => a.teacherId === t.id);
        const now = round(mine.reduce((s, a) => s + a.weight, 0));
        const byPast = past.map((s) => round(pastLoad.get(person(t))?.get(s.id) ?? 0));
        const year = round(byPast.reduce((s, x) => s + x, 0) + now);
        const times = new Set(mine.map((a) => `${a.date}|${a.period}`));
        const consecutive = [...times].filter((k) => {
          const [d, p] = k.split('|');
          return times.has(`${d}|${Number(p) + 1}`);
        }).length;
        const perDay = new Map<string, number>();
        for (const a of mine) perDay.set(a.date, (perDay.get(a.date) ?? 0) + 1);
        const maxDay = Math.max(0, ...perDay.values());
        return { t, now, byPast, year, consecutive, maxDay };
      });

    // 피로도: 학년도 누적이 평균보다 얼마나 높은지(표준점수) + 연속 감독 + 하루 3회 이상
    const mean = rows.reduce((s, r) => s + r.year, 0) / (rows.length || 1);
    const sd = Math.sqrt(rows.reduce((s, r) => s + (r.year - mean) ** 2, 0) / (rows.length || 1)) || 1;
    const scored = rows.map((r) => {
      const z = (r.year - mean) / sd;
      const score = z + r.consecutive * 0.5 + Math.max(0, r.maxDay - 2) * 0.7;
      const reasons = [
        z > 0.8 ? `학년도 누적이 평균보다 높음(${r.year}점)` : null,
        r.consecutive ? `연속 감독 ${r.consecutive}쌍` : null,
        r.maxDay >= 3 ? `하루 최다 ${r.maxDay}회` : null,
        z < -0.5 ? '학년도 부담 적음' : null,
      ].filter(Boolean) as string[];
      const level: Level = score >= 1.2 ? 'high' : score <= -0.5 ? 'low' : 'mid';
      return { ...r, score, level, reasons };
    });
    return { past, rows: scored.sort((a, b) => b.score - a.score || a.t.name.localeCompare(b.t.name, 'ko')) };
  }, [sessions.data, ledger.data, everyone.data, teachers, assignments, session]);

  if (sessions.loading || ledger.loading || everyone.loading) return <Spinner />;
  const short = (s: ExamSession) => `${s.semester}학기 ${s.examName}`;
  const high = model.rows.filter((r) => r.level === 'high');

  return (
    <Card>
      <CardTitle icon="📈">학년도 추이와 피로도 예측</CardTitle>
      <p className="mt-1 text-muted">
        {session.year}학년도 {session.schoolName}에서 확정된 시험 {model.past.length}개와 이번 시험을 이어 봅니다. 피로도는 학년도 누적 부담, 이번 시험 연속 감독, 하루 최다 감독
        수로 예측합니다.
      </p>
      {high.length > 0 && (
        <p className="mt-2 rounded-xl bg-alert-soft p-3 text-sm">
          <b>피로도 높음 {high.length}명:</b> {high.map((r) => r.t.name).join(', ')} — 시간표 편집에서 일부 감독을 부담이 낮은 교사에게 옮기는 것을 고려하세요.
        </p>
      )}
      <div className="mt-3">
        <Fold title={`교사별 피로도 명단 (${model.rows.length}명)`}>
        <Table head={['교사', ...model.past.map(short), '이번 시험', '학년도 합계', '피로도', '이유']}>
          {model.rows.map((r) => (
            <tr key={r.t.id}>
              <Td className="font-bold whitespace-nowrap">{r.t.name}</Td>
              {r.byPast.map((x, i) => (
                <Td key={model.past[i]!.id} className="tabular-nums">
                  {x || <span className="text-muted">0</span>}
                </Td>
              ))}
              <Td className="font-bold tabular-nums">{r.now}</Td>
              <Td className="tabular-nums">{r.year}</Td>
              <Td>
                <span className={`rounded-full px-2.5 py-0.5 text-sm font-semibold ${LEVEL[r.level].cls}`}>{LEVEL[r.level].label}</span>
              </Td>
              <Td className="text-sm text-muted">{r.reasons.join(' · ')}</Td>
            </tr>
          ))}
        </Table>
        </Fold>
      </div>
    </Card>
  );
}
