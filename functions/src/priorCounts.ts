import type { DutyKind } from '@sim/engine';
import type { AssignmentDoc, TeacherDoc, WithId } from '@sim/shared';
import { db } from './common';

/**
 * 같은 학교·학년도에서 이번 시험보다 먼저 만든 시험(확정 전이어도, 초안 제외)의 감독 횟수(종류별)를 이번 학기 교사 ID로 모은다.
 * 학기마다 교사 문서가 따로 있으므로 같은 사람은 이메일(없으면 이름)로 잇는다 (학년도 감독 횟수 표와 같은 기준).
 */
export async function priorCountsFor(
  sessionId: string,
  session: { schoolName?: string; year?: number; createdAt?: { toMillis(): number } },
  teachers: WithId<TeacherDoc>[],
): Promise<Record<string, Partial<Record<DutyKind, number>>>> {
  const firestore = db();
  if (!session.schoolName || !session.year) return {};
  const mine = session.createdAt?.toMillis() ?? Infinity;
  const past = (await firestore.collection('sessions').where('schoolName', '==', session.schoolName).where('year', '==', session.year).get()).docs.filter(
    (d) => d.id !== sessionId && d.get('status') !== 'DRAFT' && ((d.get('createdAt') as { toMillis(): number } | undefined)?.toMillis() ?? 0) < mine,
  );
  if (!past.length) return {};
  const assigns = (await Promise.all(past.map((d) => firestore.collection(`sessions/${d.id}/assignments`).get()))).flatMap((s) => s.docs.map((d) => d.data() as AssignmentDoc));
  if (!assigns.length) return {};

  const getAll = async (paths: string[]) => {
    const out = [];
    for (let i = 0; i < paths.length; i += 300) out.push(...(await firestore.getAll(...paths.slice(i, i + 300).map((p) => firestore.doc(p)))));
    return out;
  };
  const person = (t: { email?: string | null; name?: string }) => t.email ?? `name:${t.name}`;
  const personOf = new Map(
    (await getAll([...new Set(assigns.map((a) => `teachers/${a.teacherId}`))])).filter((d) => d.exists).map((d) => [d.id, person(d.data() as TeacherDoc)]),
  );
  const special = new Set(
    (await getAll([...new Set(assigns.map((a) => `rooms/${a.roomId}`))])).filter((d) => d.exists && d.get('spaceType') === 'SEPARATE').map((d) => d.id),
  );
  const kindOf = (a: AssignmentDoc): DutyKind =>
    a.role === 'HALLWAY' ? 'HALLWAY' : a.role === 'STUDY' ? 'STUDY' : a.role === 'EXTENDED' || special.has(a.roomId) ? 'SPECIAL' : a.role === 'ASSISTANT' ? 'ASSISTANT' : 'CHIEF';

  const byPerson = new Map<string, Partial<Record<DutyKind, number>>>();
  for (const a of assigns) {
    const p = personOf.get(a.teacherId);
    if (!p) continue;
    const c = byPerson.get(p) ?? {};
    c[kindOf(a)] = (c[kindOf(a)] ?? 0) + 1;
    byPerson.set(p, c);
  }
  const out: Record<string, Partial<Record<DutyKind, number>>> = {};
  for (const t of teachers) {
    const c = byPerson.get(person(t));
    if (c) out[t.id] = c;
  }
  return out;
}
