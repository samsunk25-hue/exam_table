import { useMemo, useState } from 'react';
import { SEAT_ROLE_LABEL, type AssignmentDoc, type SeatRole, type TeacherDoc } from '@sim/shared';
import { Alert, Button, Card, DownloadButton, Spinner, Table, Td } from '@/components/ui';
import { useCollection } from '@/lib/data';
import { sessionTitle, termWhere } from '@/lib/sessions';
import { downloadWorkbook } from '@/lib/xlsx';
import { useCurrentSession } from './SessionPage';

const ROLES: SeatRole[] = ['CHIEF', 'ASSISTANT', 'HALLWAY', 'EXTENDED', 'STUDY'];
const round = (n: number) => Math.round(n * 10) / 10;

interface Row {
  id: string;
  name: string;
  subject: string | null;
  count: number;
  roles: Record<SeatRole, number>;
  /** 이번 시험 업무 점수 (역할 가중치 합) */
  load: number;
  /** 같은 날 이어지는 교시 감독 쌍 수 */
  consecutive: number;
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
  const teachers = useCollection<TeacherDoc>('teachers', termWhere(session));
  const assignments = useCollection<AssignmentDoc>(`sessions/${session.id}/assignments`);
  const [sort, setSort] = useState<'load' | 'total' | 'name'>('load');
  // 확정 이후에는 교사 누적 점수에 이번 시험이 이미 들어 있다
  const confirmed = session.status === 'CONFIRMED' || session.status === 'LOCKED';

  const rows = useMemo<Row[]>(() => {
    const byTeacher = new Map<string, AssignmentDoc[]>();
    for (const a of assignments.data) byTeacher.set(a.teacherId, [...(byTeacher.get(a.teacherId) ?? []), a]);
    return teachers.data
      .filter((t) => t.active || byTeacher.has(t.id))
      .map((t) => {
        const mine = byTeacher.get(t.id) ?? [];
        const roles = Object.fromEntries(ROLES.map((r) => [r, mine.filter((a) => a.role === r).length])) as Record<SeatRole, number>;
        const load = round(mine.reduce((s, a) => s + a.weight, 0));
        const times = new Set(mine.map((a) => `${a.date}|${a.period}`));
        const consecutive = [...times].filter((k) => {
          const [d, p] = k.split('|');
          return times.has(`${d}|${Number(p) + 1}`);
        }).length;
        const cumulative = t.cumulativeLoad ?? 0;
        const prior = round(confirmed ? cumulative - load : cumulative);
        return { id: t.id, name: t.name, subject: t.subject, count: mine.length, roles, load, consecutive, prior, total: round(prior + load) };
      });
  }, [teachers.data, assignments.data, confirmed]);

  if (teachers.loading || assignments.loading) return <Spinner />;
  const error = teachers.error ?? assignments.error;
  if (error) return <Alert>{error}</Alert>;

  const stats = (key: 'load' | 'total') => {
    const v = rows.map((r) => r[key]);
    const n = v.length || 1;
    const mean = v.reduce((s, x) => s + x, 0) / n;
    const sd = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / n);
    return { mean, sd, min: Math.min(...v, 0), max: Math.max(...v, 0) };
  };
  const now = stats('load');
  const year = stats('total');
  const band = (x: number) => (x > year.mean + year.sd ? 'high' : x < year.mean - year.sd ? 'low' : 'mid');
  const sorted = [...rows].sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name, 'ko') : b[sort] - a[sort] || a.name.localeCompare(b.name, 'ko')));
  const scale = Math.max(year.max, 1);

  const download = () =>
    downloadWorkbook(`${sessionTitle(session)}_업무점수.xlsx`, [
      {
        name: '업무 점수',
        rows: [
          ['교사', '교과', '감독 횟수', ...ROLES.map((r) => SEAT_ROLE_LABEL[r]), '연속 감독', '이번 시험 점수', '이전 누적', '학년도 누적'],
          ...sorted.map((r) => [r.name, r.subject ?? '', r.count, ...ROLES.map((x) => r.roles[x]), r.consecutive, r.load, r.prior, r.total]),
        ],
      },
    ]);

  return (
    <div className="grid gap-6">
      <Card>
        <h2 className="text-lg font-bold">업무 점수 (형평성)</h2>
        <p className="mt-1 text-muted">
          업무 점수 = 맡은 감독의 역할 가중치 합 (정감독 1.0, 부감독 0.8, 연장감독 1.5 등). 학년도 누적은 같은 학년도에 확정된 시험 점수를 더한 값으로, 자동 배정은
          누적이 낮은 교사에게 먼저 배정합니다.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ['감독 교사', `${rows.filter((r) => r.count > 0).length}명`, `전체 ${rows.length}명`],
            ['이번 시험 평균', `${round(now.mean)}점`, `최고 ${round(now.max)} · 최저 ${round(now.min)}`],
            ['이번 시험 편차', `±${round(now.sd)}점`, `최고-최저 ${round(now.max - now.min)}점`],
            ['학년도 누적 편차', `±${round(year.sd)}점`, `평균 ${round(year.mean)}점`],
          ].map(([label, value, sub]) => (
            <div key={label} className="rounded-xl bg-bg p-3">
              <div className="text-sm text-muted">{label}</div>
              <div className="text-2xl font-bold">{value}</div>
              <div className="text-xs text-muted">{sub}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
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
      </Card>

      <Card>
        {rows.length === 0 ? (
          <p className="text-muted">이 학교·학기 교사 명단이 없습니다.</p>
        ) : (
          <Table head={['교사', '감독', '역할', '연속', '이번', '누적', '학년도 누적 (막대)']}>
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
                  <Td className="text-sm whitespace-nowrap text-muted">
                    {ROLES.filter((x) => r.roles[x])
                      .map((x) => `${SEAT_ROLE_LABEL[x]} ${r.roles[x]}`)
                      .join(' · ')}
                  </Td>
                  <Td className={r.consecutive ? 'font-semibold' : 'text-muted'}>{r.consecutive}</Td>
                  <Td className="font-bold">{r.load}</Td>
                  <Td>{r.total}</Td>
                  <Td className="w-[32%] min-w-40">
                    <div className="flex h-4 overflow-hidden rounded bg-bg" title={`이전 ${r.prior} + 이번 ${r.load} = ${r.total}`}>
                      <div className="bg-primary-soft" style={{ width: `${(Math.max(r.prior, 0) / scale) * 100}%` }} />
                      <div className="bg-primary" style={{ width: `${(r.load / scale) * 100}%` }} />
                    </div>
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </div>
  );
}
