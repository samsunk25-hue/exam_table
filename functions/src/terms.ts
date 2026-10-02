// 학기(학교·학년도·학기) 이름 바꾸기·삭제. 학기는 따로 저장되지 않고 시험 프로젝트·교사·시험실 문서마다 적혀 있으므로
// 그 문서들을 한꺼번에 고치고, 교사 로그인 권한(학교·학기)도 다시 계산한다.
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { termFields, termKey, type TermRef } from '@sim/shared';
import { refreshUserRole } from './admins';
import { db, requireAdmin, serverTimestamp } from './common';
import { deleteSessionData } from './session';

function readTerm(v: unknown, what: string): TermRef {
  const t = (v ?? {}) as { school?: unknown; year?: unknown; semester?: unknown };
  const school = typeof t.school === 'string' ? t.school.trim() : '';
  const year = Number(t.year);
  const semester = Number(t.semester);
  if (!school || school.length > 40 || !Number.isInteger(year) || year < 2000 || year > 2100 || (semester !== 1 && semester !== 2)) {
    throw new HttpsError('invalid-argument', `${what}: 학교명·학년도·학기(1 또는 2)를 확인해 주세요.`);
  }
  return { school, year, semester };
}

/** 이 학기의 시험 프로젝트·교사·시험실 문서 */
async function docsOf(t: TermRef) {
  const key = termKey(t);
  const [sessions, teachers, rooms] = await Promise.all([
    db().collection('sessions').where('schoolName', '==', t.school).where('year', '==', t.year).where('semester', '==', t.semester).get(),
    db().collection('teachers').where('term', '==', key).get(),
    db().collection('rooms').where('term', '==', key).get(),
  ]);
  return { sessions: sessions.docs, teachers: teachers.docs, rooms: rooms.docs };
}

/** 교사 이메일들의 로그인 권한(학교·학기)을 다시 계산 (이미 가입한 사용자만) */
async function refreshEmails(emails: (string | null | undefined)[]) {
  for (const e of [...new Set(emails.filter((x): x is string => !!x))]) await refreshUserRole(e);
}

/** 관리자: 학기 이름 바꾸기 (학교명·학년도·학기). 이미 있는 학기로는 바꿀 수 없다 */
export const renameTerm = onCall({ timeoutSeconds: 300 }, async (req) => {
  const uid = requireAdmin(req);
  const from = readTerm((req.data as { from?: unknown })?.from, '바꿀 학기');
  const to = readTerm((req.data as { to?: unknown })?.to, '새 이름');
  if (termKey(from) === termKey(to)) return { sessions: 0, teachers: 0, rooms: 0 };
  const target = await docsOf(to);
  if (target.sessions.length || target.teachers.length || target.rooms.length) {
    throw new HttpsError('already-exists', '이미 있는 학교·학기입니다. 다른 이름을 적어 주세요.');
  }
  const src = await docsOf(from);
  const stamp = { updatedBy: uid, updatedAt: serverTimestamp() };
  const ops = [
    ...src.sessions.map((d) => ({ ref: d.ref, data: { schoolName: to.school, year: to.year, semester: to.semester, ...stamp } })),
    ...[...src.teachers, ...src.rooms].map((d) => ({ ref: d.ref, data: { ...termFields(to), ...stamp } })),
  ];
  for (let i = 0; i < ops.length; i += 400) {
    const batch = db().batch();
    for (const o of ops.slice(i, i + 400)) batch.update(o.ref, o.data);
    await batch.commit();
  }
  await refreshEmails(src.teachers.map((d) => d.get('email') as string | null));
  return { sessions: src.sessions.length, teachers: src.teachers.length, rooms: src.rooms.length };
});

/** 관리자: 학기 삭제 — 그 학기의 시험 프로젝트(하위 자료·누적 점수 포함)·교사 명단·시험실을 모두 지운다. 학교명을 다시 적어 확인 */
export const deleteTerm = onCall({ timeoutSeconds: 540 }, async (req) => {
  const uid = requireAdmin(req);
  const term = readTerm((req.data as { term?: unknown })?.term, '지울 학기');
  const confirm = (req.data as { confirm?: unknown })?.confirm;
  if (typeof confirm !== 'string' || confirm.trim() !== term.school) throw new HttpsError('invalid-argument', '확인을 위해 학교명을 똑같이 적어 주세요.');
  const src = await docsOf(term);
  for (const s of src.sessions) await deleteSessionData(s.id, uid);
  const refs = [...src.teachers, ...src.rooms].map((d) => d.ref);
  for (let i = 0; i < refs.length; i += 400) {
    const batch = db().batch();
    for (const r of refs.slice(i, i + 400)) batch.delete(r);
    await batch.commit();
  }
  await refreshEmails(src.teachers.map((d) => d.get('email') as string | null));
  return { sessions: src.sessions.length, teachers: src.teachers.length, rooms: src.rooms.length };
});
