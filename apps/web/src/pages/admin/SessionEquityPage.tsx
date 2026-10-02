import { useMemo } from 'react';
import { DEFAULT_CLASS_WEIGHT, classLoadOf, classTimes } from '@sim/engine';
import type { AssignmentDoc, AvailabilityDoc, BaseTimetableDoc, ConstraintDoc, RoomDoc, SlotDoc } from '@sim/shared';
import { Alert, Card, CardTitle, Spinner, Table, Td } from '@/components/ui';
import { ExplainDutiesCard } from '@/components/AiCards';
import { Fold } from '@/components/Fold';
import { useCollection } from '@/lib/data';
import { termWhere, useSessionTeachers } from '@/lib/sessions';
import { useCurrentSession } from './SessionPage';
import { YearTrend } from './YearTrend';

/** 감독 종류: 정감독·부감독·복도·특별실(별도시험장)·자습 */
const KINDS = [
  { key: 'chief', label: '정감독' },
  { key: 'assistant', label: '부감독' },
  { key: 'hallway', label: '복도' },
  { key: 'special', label: '특별실' },
  { key: 'study', label: '자습' },
] as const;
type Kind = (typeof KINDS)[number]['key'];
const round = (n: number) => Math.round(n * 10) / 10;

interface Row {
  id: string;
  name: string;
  subject: string | null;
  count: number;
  kinds: Record<Kind, number>;
  /** 배정에서 빠지는 조건 (감독 제외 설정·불가시간·배정 금지 규칙·시험 중 수업) */
  excluded: string[];
  /** 이번 시험 업무 점수 (역할 가중치 합) */
  load: number;
  /** 같은 날 이어지는 교시 감독 쌍 수 */
  consecutive: number;
  /** 시험 없는 학년 수업 시간 */
  classHours: number;
}

/**
 * 점검: 교사별 이번 시험 감독 횟수·업무 점수와 제외 조건 (학년도 누적은 아래 학년도 감독 횟수 표).
 * 업무 점수 = 맡은 감독의 역할 가중치 합 (정 1.0 · 부 0.8 · 복도 0.7 · 연장 1.5 · 자습 0.5 등 배정 엔진과 같은 값)
 */
export function SessionEquityPage() {
  const session = useCurrentSession();
  const teachers = useSessionTeachers(session);
  const assignments = useCollection<AssignmentDoc>(`sessions/${session.id}/assignments`);
  const slots = useCollection<SlotDoc>(`sessions/${session.id}/slots`);
  const timetable = useCollection<BaseTimetableDoc>(`sessions/${session.id}/baseTimetable`);
  const rooms = useCollection<RoomDoc>('rooms', termWhere(session));
  const availability = useCollection<AvailabilityDoc>(`sessions/${session.id}/availability`);
  const constraints = useCollection<ConstraintDoc>(`sessions/${session.id}/constraints`);
  // 시험 없는 학년 수업 시간 (기본 켜짐, 기초시간표가 있을 때) — 업무 점수에 더한다
  const classHours = useMemo(() => {
    if (session.settings.classDuringExam === false) return new Map<string, number>();
    const entries = timetable.data.flatMap((d) => d.entries.map((e) => ({ ...e, teacherId: d.id })));
    return classLoadOf(classTimes(slots.data, entries), 1);
  }, [slots.data, timetable.data, session.settings.classDuringExam]);

  const writerRule = session.settings.examWriter ?? 'NONE';
  const special = useMemo(() => new Set(rooms.data.filter((r) => r.spaceType === 'SEPARATE').map((r) => r.id)), [rooms.data]);
  const rows = useMemo<Row[]>(() => {
    const byTeacher = new Map<string, AssignmentDoc[]>();
    for (const a of assignments.data) byTeacher.set(a.teacherId, [...(byTeacher.get(a.teacherId) ?? []), a]);
    return teachers.data
      .filter((t) => t.active || byTeacher.has(t.id))
      .map((t) => {
        const mine = byTeacher.get(t.id) ?? [];
        const kinds: Record<Kind, number> = { chief: 0, assistant: 0, hallway: 0, special: 0, study: 0 };
        for (const a of mine) {
          const k: Kind =
            a.role === 'HALLWAY' ? 'hallway' : a.role === 'STUDY' ? 'study' : a.role === 'EXTENDED' || special.has(a.roomId) ? 'special' : a.role === 'ASSISTANT' ? 'assistant' : 'chief';
          kinds[k]++;
        }
        const hours = classHours.get(t.id) ?? 0;
        // 제외 조건과 사유 (사유를 적었으면 함께)
        const excluded: string[] = [];
        if (t.defaultRole === 'EXCLUDED') excluded.push('감독 제외로 설정');
        if (t.defaultRole === 'HALLWAY') excluded.push('복도 전담');
        const off = availability.data.filter((a) => a.teacherId === t.id && a.status !== 'REJECTED');
        if (off.length) {
          const why = [...new Set(off.map((a) => a.reason?.trim()).filter(Boolean))];
          excluded.push(`불가시간 ${off.length}칸${why.length ? ` (${why.join(', ')})` : ''}`);
        }
        const forbid = constraints.data.filter((c) => (c.teacherId === t.id || c.teacherId === '*') && c.priority === 'HARD');
        if (forbid.length) {
          const labels = forbid.map((c) => c.label?.trim()).filter(Boolean);
          excluded.push(`배정 금지 규칙 ${forbid.length}개${labels.length ? ` (${labels.join(', ')})` : ''}`);
        }
        if (hours) excluded.push(`시험 중 수업 ${hours}시간`);
        // 이번 시험 과목의 담당 교과 교사 (출제 교사 규칙이 켜져 있으면 그 시간 처리도)
        const myExams = t.subject ? slots.data.filter((x) => x.type === 'EXAM' && x.subject === t.subject) : [];
        if (myExams.length) {
          const grades = [...new Set(myExams.map((x) => x.grade))].sort((a, b) => a - b).join('·');
          const rule = writerRule === 'NO_ROOM' ? ', 그 시간 교실 감독 제외' : writerRule === 'PREFER_HALLWAY' ? ', 그 시간 복도 대기 우선' : '';
          excluded.push(`시험 과목 교사 (${t.subject}: ${grades}학년${rule})`);
        }
        const load = round(mine.reduce((s, a) => s + a.weight, 0) + hours * DEFAULT_CLASS_WEIGHT);
        const times = new Set(mine.map((a) => `${a.date}|${a.period}`));
        const consecutive = [...times].filter((k) => {
          const [d, p] = k.split('|');
          return times.has(`${d}|${Number(p) + 1}`);
        }).length;
        return { id: t.id, name: t.name, subject: t.subject, count: mine.length, kinds, excluded, load, consecutive, classHours: hours };
      });
  }, [teachers.data, assignments.data, classHours, special, availability.data, constraints.data, slots.data, writerRule]);

  if (teachers.loading || assignments.loading || slots.loading || timetable.loading || rooms.loading) return <Spinner />;
  const error = teachers.error ?? assignments.error;
  if (error) return <Alert>{error}</Alert>;

  // 이번 시험 점수가 높은 순
  const sorted = [...rows].sort((a, b) => b.load - a.load || a.name.localeCompare(b.name, 'ko'));

  return (
    <div className="grid gap-6">
      <Card>
        <CardTitle icon="📊">이번 시험 감독 횟수</CardTitle>
        <p className="mt-1 mb-3 text-muted">이번 시험에서 교사마다 맡은 감독 종류별 횟수와 업무 점수, 배정에서 빠지는 조건입니다.</p>
        {rows.length === 0 ? (
          <p className="text-muted">이 학교·학기 교사 명단이 없습니다.</p>
        ) : (
          <Fold title={`이번 시험 교사별 명단 (${rows.length}명)`}>
          <Table head={['교사', '감독', ...KINDS.map((k) => k.label), '연속', '수업', '이번', '제외 조건']}>
            {sorted.map((r) => {
              return (
                <tr key={r.id}>
                  <Td className="font-bold whitespace-nowrap">
                    {r.name}
                    {r.subject && <span className="ml-1 text-sm font-normal text-muted">{r.subject}</span>}
                  </Td>
                  <Td>{r.count}회</Td>
                  {KINDS.map((k) => (
                    <Td key={k.key} className={r.kinds[k.key] ? 'tabular-nums' : 'text-muted tabular-nums'}>
                      {r.kinds[k.key]}
                    </Td>
                  ))}
                  <Td className={r.consecutive ? 'font-semibold' : 'text-muted'}>{r.consecutive}</Td>
                  <Td className={r.classHours ? 'font-semibold' : 'text-muted'}>
                    {r.classHours ? `${r.classHours}시간` : 0}
                  </Td>
                  <Td className="font-bold">{r.load}</Td>
                  <Td className="min-w-48 text-sm text-muted">{r.excluded.join(' · ')}</Td>
                </tr>
              );
            })}
          </Table>
          </Fold>
        )}
      </Card>

      <YearTrend session={session} teachers={teachers.data} assignments={assignments.data} />
      {assignments.data.length > 0 && (
        <ExplainDutiesCard
          sessionId={session.id}
          teachers={[...teachers.data].filter((t) => assignments.data.some((a) => a.teacherId === t.id)).sort((a, b) => a.name.localeCompare(b.name, 'ko'))}
        />
      )}
    </div>
  );
}
