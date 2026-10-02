import { useMemo, useState } from 'react';
import { DEFAULT_CLASS_WEIGHT, classLoadOf, classTimes } from '@sim/engine';
import type { AssignmentDoc, AvailabilityDoc, BaseTimetableDoc, ConstraintDoc, RoomDoc, SlotDoc } from '@sim/shared';
import { Alert, Button, Card, DownloadButton, Spinner, Table, Td, CardTitle } from '@/components/ui';
import { ExplainDutiesCard } from '@/components/AiCards';
import { Fold } from '@/components/Fold';
import { useCollection } from '@/lib/data';
import { sessionTitle, termWhere, useSessionTeachers } from '@/lib/sessions';
import { downloadWorkbook } from '@/lib/xlsx';
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
  /** 이번 시험 전까지 학년도 누적 */
  prior: number;
  total: number;
}

/**
 * 업무 점수(형평성): 교사별 이번 시험 업무 점수와 학년도 누적, 평균에서 얼마나 떨어졌는지.
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
  const [sort, setSort] = useState<'load' | 'total' | 'name'>('load');
  // 확정 이후에는 교사 누적 점수에 이번 시험이 이미 들어 있다
  const confirmed = session.status === 'CONFIRMED' || session.status === 'LOCKED';

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
        const load = round(mine.reduce((s, a) => s + a.weight, 0) + hours * DEFAULT_CLASS_WEIGHT);
        const times = new Set(mine.map((a) => `${a.date}|${a.period}`));
        const consecutive = [...times].filter((k) => {
          const [d, p] = k.split('|');
          return times.has(`${d}|${Number(p) + 1}`);
        }).length;
        const cumulative = t.cumulativeLoad ?? 0;
        const prior = round(confirmed ? cumulative - load : cumulative);
        return { id: t.id, name: t.name, subject: t.subject, count: mine.length, kinds, excluded, load, consecutive, classHours: hours, prior, total: round(prior + load) };
      });
  }, [teachers.data, assignments.data, confirmed, classHours, special, availability.data, constraints.data]);

  if (teachers.loading || assignments.loading || slots.loading || timetable.loading || rooms.loading) return <Spinner />;
  const error = teachers.error ?? assignments.error;
  if (error) return <Alert>{error}</Alert>;

  const stats = (key: 'load' | 'total') => {
    const v = rows.map((r) => r[key]);
    const n = v.length || 1;
    const mean = v.reduce((s, x) => s + x, 0) / n;
    const sd = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / n);
    return { mean, sd, min: Math.min(...v, 0), max: Math.max(...v, 0) };
  };
  const year = stats('total');
  const band = (x: number) => (x > year.mean + year.sd ? 'high' : x < year.mean - year.sd ? 'low' : 'mid');
  const sorted = [...rows].sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name, 'ko') : b[sort] - a[sort] || a.name.localeCompare(b.name, 'ko')));
  const scale = Math.max(year.max, 1);

  const download = () =>
    downloadWorkbook(`${sessionTitle(session)}_업무점수.xlsx`, [
      {
        name: '업무 점수',
        rows: [
          ['교사', '교과', '감독 횟수', ...KINDS.map((k) => k.label), '연속 감독', '수업 시간', '이번 시험 점수', '이전 누적', '학년도 누적', '제외 조건'],
          ...sorted.map((r) => [r.name, r.subject ?? '', r.count, ...KINDS.map((k) => r.kinds[k.key]), r.consecutive, r.classHours, r.load, r.prior, r.total, r.excluded.join(' · ')]),
        ],
      },
    ]);

  return (
    <div className="grid gap-6">
      <Card>
        <CardTitle icon="📊">업무 점수 (형평성)</CardTitle>
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">정렬</span>
            {(
              [
                ['load', '이번 시험 점수'],
                ['total', '학년도 누적'],
                ['name', '이름'],
              ] as const
            ).map(([k, l]) => (
              <Button key={k} variant={sort === k ? 'primary' : 'secondary'} onClick={() => setSort(k)}>
                {l}
              </Button>
            ))}
            <span className="mx-1 hidden h-8 w-px bg-line sm:block" />
            <DownloadButton onDownload={download} disabled={rows.length === 0}>
              엑셀로 받기
            </DownloadButton>
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            <span className="flex items-center gap-1">
              <span className="h-3 w-6 rounded bg-primary" /> 이번 시험
            </span>
            <span className="flex items-center gap-1">
              <span className="h-3 w-6 rounded bg-primary-soft" /> 이전 누적
            </span>
            <span className="flex items-center gap-1">
              <span className="size-3 rounded-full bg-alert" /> 평균보다 많이 높음
            </span>
            <span className="flex items-center gap-1">
              <span className="size-3 rounded-full bg-mint" /> 평균보다 많이 낮음
            </span>
          </div>
        </div>
        {rows.length === 0 ? (
          <p className="text-muted">이 학교·학기 교사 명단이 없습니다.</p>
        ) : (
          <Fold title={`이번 시험 교사별 명단 (${rows.length}명)`}>
          <Table head={['교사', '감독', ...KINDS.map((k) => k.label), '연속', '수업', '이번', '누적', '학년도 누적 (막대)', '제외 조건']}>
            {sorted.map((r) => {
              const b = band(r.total);
              return (
                <tr key={r.id}>
                  <Td className="font-bold whitespace-nowrap">
                    {b !== 'mid' && <span className={`mr-1.5 inline-block size-2.5 rounded-full ${b === 'high' ? 'bg-alert' : 'bg-mint'}`} aria-label={b === 'high' ? '평균보다 높음' : '평균보다 낮음'} />}
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
                  <Td>{r.total}</Td>
                  <Td className="w-[18%] min-w-32">
                    <div className="flex h-4 overflow-hidden rounded bg-bg" title={`이전 ${r.prior} + 이번 ${r.load} = ${r.total}`}>
                      <div className="bg-primary-soft" style={{ width: `${(Math.max(r.prior, 0) / scale) * 100}%` }} />
                      <div className="bg-primary" style={{ width: `${(r.load / scale) * 100}%` }} />
                    </div>
                  </Td>
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
