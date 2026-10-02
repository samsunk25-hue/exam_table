import { collection, getDocs } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import type { AssignmentDoc, RoomDoc, TeacherDoc, WithId } from '@sim/shared';
import { Fold } from '@/components/Fold';
import { Card, Spinner, Table, Td, CardTitle } from '@/components/ui';
import { useCollection } from '@/lib/data';
import { db } from '@/lib/firebase';
import { useSessions, type ExamSession } from '@/lib/sessions';

/** 학년도 감독 횟수의 열: 정감독·부감독·복도·특별실(별도시험장)·자습 */
const KINDS = [
  { key: 'chief', label: '정감독' },
  { key: 'assistant', label: '부감독' },
  { key: 'hallway', label: '복도' },
  { key: 'special', label: '특별실' },
  { key: 'study', label: '자습' },
] as const;
type Kind = (typeof KINDS)[number]['key'];
const zero = (): Record<Kind, number> => ({ chief: 0, assistant: 0, hallway: 0, special: 0, study: 0 });

/**
 * 학년도 감독 횟수: 같은 학교·학년도에서 이번 시험보다 먼저 만든 시험(확정 전이어도, 초안 제외)과 이번 시험을 합쳐 교사마다 감독 종류별 총 횟수.
 * 자동 배정도 같은 기준으로 앞선 시험 횟수를 이어서 맞춘다 (functions/src/priorCounts.ts).
 * 학기마다 교사 문서가 따로 있으므로 같은 사람은 이메일(없으면 이름)로 잇는다.
 */
export function YearTrend({ session, teachers, assignments }: { session: ExamSession; teachers: WithId<TeacherDoc>[]; assignments: WithId<AssignmentDoc>[] }) {
  const sessions = useSessions();
  const everyone = useCollection<TeacherDoc>('teachers');
  const rooms = useCollection<RoomDoc>('rooms');
  // 같은 학교·학년도, 이번 시험보다 먼저 만든 다른 시험 (초안 제외)
  const mine = session.createdAt?.toMillis() ?? Infinity;
  const pastIds = sessions.data
    .filter((s) => s.id !== session.id && s.schoolName === session.schoolName && s.year === session.year && s.status !== 'DRAFT' && (s.createdAt?.toMillis() ?? 0) < mine)
    .map((s) => s.id)
    .join(',');
  const [pastAssign, setPastAssign] = useState<WithId<AssignmentDoc>[] | null>(null);
  useEffect(() => {
    let alive = true;
    const ids = pastIds ? pastIds.split(',') : [];
    void Promise.all(ids.map((id) => getDocs(collection(db, `sessions/${id}/assignments`)))).then((snaps) => {
      if (alive) setPastAssign(snaps.flatMap((sn) => sn.docs.map((d) => ({ id: d.id, ...(d.data() as AssignmentDoc) }))));
    });
    return () => {
      alive = false;
    };
  }, [pastIds]);

  const rows = useMemo(() => {
    const person = (t: Pick<TeacherDoc, 'email' | 'name'>) => t.email ?? `name:${t.name}`;
    const personOf = new Map(everyone.data.map((t) => [t.id, person(t)]));
    const special = new Set(rooms.data.filter((r) => r.spaceType === 'SEPARATE').map((r) => r.id));
    const kindOf = (a: AssignmentDoc): Kind =>
      a.role === 'HALLWAY' ? 'hallway' : a.role === 'STUDY' ? 'study' : a.role === 'EXTENDED' || special.has(a.roomId) ? 'special' : a.role === 'ASSISTANT' ? 'assistant' : 'chief';
    const counts = new Map<string, Record<Kind, number>>();
    for (const a of [...(pastAssign ?? []), ...assignments]) {
      const p = personOf.get(a.teacherId);
      if (!p) continue;
      const c = counts.get(p) ?? zero();
      c[kindOf(a)]++;
      counts.set(p, c);
    }
    return teachers
      .filter((t) => t.active)
      .map((t) => {
        const c = counts.get(person(t)) ?? zero();
        return { t, c, total: KINDS.reduce((n, k) => n + c[k.key], 0) };
      })
      .sort((a, b) => b.total - a.total || a.t.name.localeCompare(b.t.name, 'ko'));
  }, [everyone.data, rooms.data, pastAssign, assignments, teachers]);

  if (sessions.loading || everyone.loading || rooms.loading || pastAssign === null) return <Spinner />;
  const pastCount = pastIds ? pastIds.split(',').length : 0;

  return (
    <Card>
      <CardTitle icon="📈">학년도 감독 횟수</CardTitle>
      <p className="mt-1 text-muted">
        {session.year}학년도 {session.schoolName}에서 이번 시험보다 먼저 만든 시험 {pastCount}개와 이번 시험을 합친 감독 종류별 총 횟수입니다. 자동 배정도 이 횟수를 이어서 맞춥니다.
      </p>
      <div className="mt-3">
        <Fold title={`교사별 학년도 감독 횟수 (${rows.length}명)`}>
          <Table head={['교사', ...KINDS.map((k) => k.label), '합계']}>
            {rows.map((r) => (
              <tr key={r.t.id}>
                <Td className="font-bold whitespace-nowrap">{r.t.name}</Td>
                {KINDS.map((k) => (
                  <Td key={k.key} className="tabular-nums">
                    {r.c[k.key] || <span className="text-muted">0</span>}
                  </Td>
                ))}
                <Td className="font-bold tabular-nums">{r.total}</Td>
              </tr>
            ))}
          </Table>
        </Fold>
      </div>
    </Card>
  );
}
