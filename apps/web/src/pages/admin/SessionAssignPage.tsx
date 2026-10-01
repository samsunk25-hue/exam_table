import { useMemo, useState } from 'react';
import type { Timestamp } from 'firebase/firestore';
import {
  SEAT_ROLE_LABEL,
  examTimes,
  groupByDate,
  isSetupEditable,
  type AssignmentDoc,
  type AvailabilityDoc,
  type RoomDoc,
  type RunDoc,
  type SlotDoc,
  type TeacherDoc,
  type WithId,
} from '@sim/shared';
import { dateLabel } from '@/components/AvailabilityGrid';
import { toast } from '@/components/Toast';
import { Alert, Button, Card, Spinner, Table, Td, Toggle } from '@/components/ui';
import { useCollection } from '@/lib/data';
import { termWhere } from '@/lib/sessions';
import { callApplyRun, callRunAssignment, errorMessage } from '@/lib/firebase';
import { sortRooms } from './RoomsPage';
import { useCurrentSession } from './SessionPage';

type Run = WithId<RunDoc & { createdAt?: Timestamp; appliedAt?: Timestamp }>;

function timeText(ts?: Timestamp) {
  if (!ts) return '';
  const d = ts.toDate();
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;
const SCENARIO_ORDER = ['BASE', 'EQUITY', 'NO_CONSECUTIVE', 'SUBJECT_HALLWAY'];

/** 다중 시나리오 비교: 지표별로 가장 좋은 안을 강조한다 */
function ScenarioCompare({
  runs,
  selectedId,
  appliedRunId,
  onSelect,
}: {
  runs: Run[];
  selectedId: string;
  appliedRunId?: string;
  onSelect: (id: string) => void;
}) {
  const rows: { label: string; value: (r: Run) => number; format: (v: number) => string; better: 'high' | 'low'; hint: string }[] = [
    { label: '성공률', value: (r) => r.metrics.successRate, format: pct, better: 'high', hint: '배정된 자리 비율' },
    { label: '미배정', value: (r) => r.unassigned.length, format: (v) => `${v}석`, better: 'low', hint: '직접 채워야 할 자리' },
    { label: '누적 부담 편차', value: (r) => r.metrics.stdDev, format: (v) => `${v}`, better: 'low', hint: '낮을수록 공평' },
    { label: '최대-최소 차', value: (r) => r.metrics.maxMinGap, format: (v) => `${v}`, better: 'low', hint: '가장 많이·적게 맡은 교사 차이' },
    { label: '연속 배정', value: (r) => r.metrics.consecutiveCount ?? 0, format: (v) => `${v}회`, better: 'low', hint: '같은 날 연달아 감독' },
    { label: '출제과목 교실 감독', value: (r) => r.metrics.subjectInRoom ?? 0, format: (v) => `${v}회`, better: 'low', hint: '자기 과목 시험 교실 감독' },
  ];
  return (
    <Card>
      <h2 className="text-lg font-bold">다중 시나리오 비교</h2>
      <p className="mt-1 text-muted">같은 조건에서 목표를 달리해 만든 전체 배정안입니다. 모든 안은 하드 조건을 지킵니다. 초록색은 해당 지표에서 가장 좋은 안입니다.</p>
      <div className="mt-3">
        <Table head={['지표', ...runs.map((r) => r.scenarioLabel ?? r.scenario)]}>
          {rows.map((row) => {
            const values = runs.map(row.value);
            const best = row.better === 'high' ? Math.max(...values) : Math.min(...values);
            return (
              <tr key={row.label}>
                <Td>
                  <div className="font-bold">{row.label}</div>
                  <div className="text-sm text-muted">{row.hint}</div>
                </Td>
                {runs.map((r, i) => (
                  <Td key={r.id} className={values[i] === best && new Set(values).size > 1 ? 'bg-mint-soft font-bold' : ''}>
                    {row.format(values[i]!)}
                  </Td>
                ))}
              </tr>
            );
          })}
          <tr>
            <Td />
            {runs.map((r) => (
              <Td key={r.id}>
                <Button variant={r.id === selectedId ? 'primary' : 'secondary'} onClick={() => onSelect(r.id)}>
                  {r.id === selectedId ? '보는 중' : '자세히'}
                  {r.id === appliedRunId ? ' ✓' : ''}
                </Button>
              </Td>
            ))}
          </tr>
        </Table>
      </div>
    </Card>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'alert' | 'ok' }) {
  return (
    <div className={`rounded-xl px-4 py-3 ${tone === 'alert' ? 'bg-alert-soft' : tone === 'ok' ? 'bg-mint-soft' : 'bg-bg'}`}>
      <div className="text-sm text-muted">{label}</div>
      <div className="text-xl font-bold">{value}</div>
    </div>
  );
}

/** 날짜별: 행 = 시험실, 열 = 교시, 칸 = 배정된 교사 */
function AssignmentGrid({ run, slots, rooms, nameOf }: { run: RunDoc; slots: WithId<SlotDoc>[]; rooms: WithId<RoomDoc>[]; nameOf: (id: string) => string }) {
  const times = examTimes(slots);
  const byCell = new Map<string, { label: string; unassigned: boolean }[]>();
  const push = (key: string, v: { label: string; unassigned: boolean }) => byCell.set(key, [...(byCell.get(key) ?? []), v]);
  for (const a of run.assignments) {
    push(`${a.date}|${a.period}|${a.roomId}`, { label: `${nameOf(a.teacherId)}${a.role === 'ASSISTANT' ? '(부)' : a.role === 'EXTENDED' ? '(연장)' : ''}`, unassigned: false });
  }
  for (const u of run.unassigned) push(`${u.date}|${u.period}|${u.roomId}`, { label: `미배정(${SEAT_ROLE_LABEL[u.role]})`, unassigned: true });
  const usedRooms = new Set([...run.assignments, ...run.unassigned].map((a) => a.roomId));
  const roomList = sortRooms(rooms.filter((r) => usedRooms.has(r.id)));

  return (
    <div className="grid gap-5">
      {groupByDate(times).map(([date, list]) => (
        <section key={date}>
          <h3 className="mb-1 font-bold">{dateLabel(date)}</h3>
          <Table head={['시험실', ...list.map((t) => `${t.period}교시`)]}>
            {roomList.map((r) => (
              <tr key={r.id}>
                <Td className="font-bold whitespace-nowrap">{r.name}</Td>
                {list.map((t) => {
                  const cell = byCell.get(`${date}|${t.period}|${r.id}`) ?? [];
                  return (
                    <Td key={t.period} className={cell.some((c) => c.unassigned) ? 'bg-alert-soft' : ''}>
                      {cell.map((c, i) => (
                        <div key={i} className={c.unassigned ? 'font-bold text-[#c0392b]' : 'font-semibold'}>
                          {c.label}
                        </div>
                      ))}
                    </Td>
                  );
                })}
              </tr>
            ))}
          </Table>
        </section>
      ))}
    </div>
  );
}

function LoadTable({ run, teachers }: { run: RunDoc; teachers: WithId<TeacherDoc>[] }) {
  const count = new Map<string, number>();
  for (const a of run.assignments) count.set(a.teacherId, (count.get(a.teacherId) ?? 0) + 1);
  const rows = teachers
    .filter((t) => run.loads[t.id])
    .map((t) => ({ t, session: run.loads[t.id]![0], total: run.loads[t.id]![1], n: count.get(t.id) ?? 0 }))
    .sort((a, b) => b.session - a.session || a.t.name.localeCompare(b.t.name, 'ko'));
  const max = Math.max(1, ...rows.map((r) => r.session));
  return (
    <Table head={['교사', '배정 수', '이번 부담', '', '누적 부담']}>
      {rows.map(({ t, session, total, n }) => (
        <tr key={t.id}>
          <Td className="font-bold">{t.name}</Td>
          <Td>{n}회</Td>
          <Td>{session}</Td>
          <Td className="w-1/3">
            <div className="h-3 rounded-full bg-bg">
              <div className="h-3 rounded-full bg-primary" style={{ width: `${(session / max) * 100}%` }} />
            </div>
          </Td>
          <Td>{total}</Td>
        </tr>
      ))}
    </Table>
  );
}

export function SessionAssignPage() {
  const session = useCurrentSession();
  const sid = session.id;
  const runs = useCollection<RunDoc>(`sessions/${sid}/runs`);
  const assignments = useCollection<AssignmentDoc>(`sessions/${sid}/assignments`);
  const availability = useCollection<AvailabilityDoc>(`sessions/${sid}/availability`);
  const slots = useCollection<SlotDoc>(`sessions/${sid}/slots`);
  const rooms = useCollection<RoomDoc>('rooms', termWhere(session));
  const teachers = useCollection<TeacherDoc>('teachers', termWhere(session));
  const [keepManual, setKeepManual] = useState(true);
  const [withScenarios, setWithScenarios] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<'grid' | 'load'>('grid');
  const [busy, setBusy] = useState<'run' | 'apply' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sortedRuns = useMemo(
    () => ([...runs.data] as Run[]).sort((a, b) => (b.createdAt?.toMillis() ?? Infinity) - (a.createdAt?.toMillis() ?? Infinity)),
    [runs.data],
  );
  const nameById = useMemo(() => new Map(teachers.data.map((t) => [t.id, t.name])), [teachers.data]);
  const nameOf = (id: string) => nameById.get(id) ?? id;
  const run = sortedRuns.find((r) => r.id === selectedId) ?? sortedRuns.find((r) => (r.scenario ?? 'BASE') === 'BASE') ?? sortedRuns[0];
  const batch = run?.batchId ? SCENARIO_ORDER.flatMap((k) => sortedRuns.filter((r) => r.batchId === run.batchId && r.scenario === k)) : [];
  const appliedRunId = (session as { assignmentStats?: { runId?: string } }).assignmentStats?.runId;
  const editable = isSetupEditable(session.status);
  const manualCount = assignments.data.filter((a) => a.source === 'MANUAL').length;
  const pendingCount = availability.data.filter((a) => a.status === 'PENDING').length;

  const loading = runs.loading || assignments.loading || availability.loading || slots.loading || rooms.loading || teachers.loading;
  if (loading) return <Spinner />;

  const execute = async () => {
    setBusy('run');
    setError(null);
    try {
      const { data } = await callRunAssignment({ sessionId: sid, keepManual, scenarios: withScenarios });
      setSelectedId(data.runId);
      toast(
        data.runs.length > 1
          ? `기본안과 대안 ${data.runs.length - 1}개를 만들었습니다. 비교한 뒤 하나를 골라 적용하세요.`
          : `자동 배정을 실행했습니다. 성공률 ${pct(data.metrics.successRate)} (미배정 ${data.unassigned}석). 확인 후 적용하세요.`,
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const apply = async () => {
    if (!run) return;
    setBusy('apply');
    setError(null);
    try {
      const { data } = await callApplyRun({ sessionId: sid, runId: run.id });
      toast(`배정 ${data.assigned}건을 적용했습니다.`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-6">
      <Card>
        <h2 className="text-lg font-bold">자동 배정 실행</h2>
        <p className="mt-1 text-muted">
          하드 조건(동시간 중복, 불가시간, 연장 감독 직후)을 지키면서 점수(기초시간표 일치, 부담 형평성, 연속 배정 등)가 높은 교사를 배정합니다.
          실행 결과를 확인한 뒤 "적용"을 눌러야 실제 배정이 바뀝니다.
        </p>
        <div className="mt-3 grid gap-2">
          {pendingCount > 0 && <Alert tone="info">승인 대기 중인 불가시간 {pendingCount}건도 "불가"로 보고 배정합니다.</Alert>}
          <p className="text-sm text-muted">
            현재 적용된 배정: {assignments.data.length}석{manualCount ? ` (수동 ${manualCount})` : ''} · 기초시간표 반영 {session.settings.useBaseTimetable ? '켜짐' : '꺼짐'}
          </p>
          <Toggle
            label="수동 배정 유지"
            hint="시간표 편집에서 직접 정한 배정은 그대로 두고 나머지만 다시 배정합니다."
            checked={keepManual}
            onChange={setKeepManual}
            disabled={!editable}
          />
          <Toggle
            label="대안 시나리오 3개도 만들기 (다중 시나리오)"
            hint="A안 형평성 극대화 · B안 연속 배정 배제 · C안 출제 교사 복도 대기 우선을 함께 계산해 기본안과 비교합니다."
            checked={withScenarios}
            onChange={setWithScenarios}
            disabled={!editable}
          />
        </div>
        {!editable && <p className="mt-2 text-muted">교사 공개 이후에는 자동 배정을 다시 실행할 수 없습니다.</p>}
        {error && (
          <div className="mt-3">
            <Alert>{error}</Alert>
          </div>
        )}
        <div className="mt-4">
          <Button onClick={() => void execute()} disabled={!editable || busy !== null || slots.data.length === 0}>
            {busy === 'run' ? '배정 계산 중…' : '자동 배정 실행'}
          </Button>
          {slots.data.length === 0 && <span className="ml-3 text-muted">기본 설정에서 시험 일정을 먼저 등록하세요.</span>}
        </div>
      </Card>

      {run && batch.length > 1 && (
        <ScenarioCompare runs={batch} selectedId={run.id} appliedRunId={appliedRunId} onSelect={setSelectedId} />
      )}

      {run && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold">
              {run.scenarioLabel ?? '실행 결과'} <span className="text-base font-normal text-muted">{timeText(run.createdAt)}</span>
              {run.id === appliedRunId && <span className="ml-2 rounded-full bg-mint-soft px-3 py-1 text-sm">현재 적용됨</span>}
            </h2>
            {editable && run.id !== appliedRunId && (
              <Button onClick={() => void apply()} disabled={busy !== null}>
                {busy === 'apply' ? '적용 중…' : '이 결과 적용'}
              </Button>
            )}
          </div>

          {run.scenarioDescription && <p className="mt-1 text-muted">{run.scenarioDescription}</p>}
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Metric label="감독 자리" value={`${run.metrics.seatCount}석`} />
            <Metric label="배정" value={`${run.metrics.assignedCount}석`} />
            <Metric
              label="성공률"
              value={pct(run.metrics.successRate)}
              tone={run.metrics.successRate >= 0.95 ? 'ok' : 'alert'}
            />
            <Metric label="누적 부담 편차" value={`${run.metrics.stdDev}`} />
            <Metric label="최대-최소 차" value={`${run.metrics.maxMinGap}`} />
          </div>

          {run.unassigned.length > 0 && (
            <div className="mt-4">
              <Alert>
                <p className="font-semibold">미배정 {run.unassigned.length}석 — 시간표 편집에서 직접 배정하거나 불가시간·시험실을 조정하세요.</p>
                <ul className="mt-1 max-h-48 list-disc overflow-auto pl-5 text-sm">
                  {run.unassigned.map((u) => (
                    <li key={u.seatId}>
                      {dateLabel(u.date)} {u.period}교시 · {u.message}
                    </li>
                  ))}
                </ul>
              </Alert>
            </div>
          )}
          {run.rejectedPinned.length > 0 && (
            <div className="mt-3">
              <Alert>유지하지 못한 수동 배정 {run.rejectedPinned.length}건: {run.rejectedPinned.join(' / ')}</Alert>
            </div>
          )}

          <div className="mt-5 flex gap-2">
            <Button variant={view === 'grid' ? 'primary' : 'secondary'} onClick={() => setView('grid')}>
              시험실별 배정표
            </Button>
            <Button variant={view === 'load' ? 'primary' : 'secondary'} onClick={() => setView('load')}>
              교사별 부담
            </Button>
          </div>
          <div className="mt-4">
            {view === 'grid' ? (
              <AssignmentGrid run={run} slots={slots.data} rooms={rooms.data} nameOf={nameOf} />
            ) : (
              <LoadTable run={run} teachers={teachers.data} />
            )}
          </div>
        </Card>
      )}

      {sortedRuns.length > 1 && (
        <Card>
          <h2 className="text-lg font-bold">실행 기록</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {sortedRuns.slice(0, 10).map((r) => (
              <Button key={r.id} variant={r.id === run?.id ? 'primary' : 'secondary'} onClick={() => setSelectedId(r.id)}>
                {timeText(r.createdAt)} · {r.scenarioLabel?.split(' ')[0] ?? '기본안'} · {pct(r.metrics.successRate)}
                {r.id === appliedRunId ? ' ✓' : ''}
              </Button>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
