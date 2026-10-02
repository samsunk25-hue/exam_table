import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_WEIGHTS, buildEngineInput, runAssignment, type EngineInput, type Metrics, type Weights } from '@sim/engine';
import type { AssignmentDoc, AvailabilityDoc, BaseTimetableDoc, ConstraintDoc, RoomDoc, SlotDoc } from '@sim/shared';
import { Alert, Button, Card, Spinner, CardTitle } from '@/components/ui';
import { useCollection } from '@/lib/data';
import { termWhere, type ExamSession, useSessionTeachers } from '@/lib/sessions';

/** 슬라이더 하나: 화면에서는 모두 "클수록 강하게" (감점 항목은 부호를 뒤집어 저장) */
interface Knob {
  key: keyof Weights;
  label: string;
  hint: string;
  max: number;
  /** 감점(음수) 가중치면 true */
  negative?: boolean;
  /** 출제 교사: 복도 가점과 교실 감점을 함께 */
  pair?: keyof Weights;
  onlyBase?: boolean;
}

const KNOBS: Knob[] = [
  { key: 'countBalance', label: '감독 횟수 맞추기', hint: '이번 시험에 이미 많이 맡은 교사일수록 감점 (1회마다)', max: 200, negative: true },
  { key: 'lowLoad', label: '부담 적은 교사 우선', hint: '누적 업무점수가 낮은 교사에게 가점', max: 200 },
  { key: 'highLoad', label: '부담 많은 교사 피하기', hint: '누적 업무점수가 높은 교사에게 감점', max: 200, negative: true },
  { key: 'consecutive', label: '연속 감독 피하기', hint: '같은 날 이어지는 교시 감독에 감점', max: 300, negative: true },
  { key: 'baseMatch', label: '기초시간표 반과 맞추기', hint: '그 시간 그 반 수업 교사에게 가점', max: 200, onlyBase: true },
  { key: 'notHomeroomGrade', label: '다른 학년 담임 우선', hint: '시험 학년의 담임이 아닌 교사에게 가점', max: 100 },
  { key: 'hallwayMatch', label: '복도전담 교사는 복도로', hint: '복도전담 교사가 복도를 맡으면 가점', max: 100 },
  { key: 'examSubjectHallway', label: '출제 교사 복도 대기', hint: '시험 과목 교사가 그 시간 복도면 가점, 교실이면 감점', max: 200, pair: 'examSubjectRoom' },
];

type Values = Partial<Record<keyof Weights, number>>;
const toUi = (k: Knob, w: Weights) => Math.abs(w[k.key]);
const toWeights = (v: Values): Partial<Weights> => {
  const out: Partial<Weights> = {};
  for (const k of KNOBS) {
    const x = v[k.key];
    if (x === undefined) continue;
    out[k.key] = k.negative ? -x : x;
    if (k.pair) out[k.pair] = -x;
  }
  return out;
};

const ROWS: { key: keyof Metrics; label: string; fmt: (m: Metrics) => string; better: 'up' | 'down' }[] = [
  { key: 'successRate', label: '배정 성공률', fmt: (m) => `${Math.round(m.successRate * 1000) / 10}%`, better: 'up' },
  { key: 'assignedCount', label: '미배정', fmt: (m) => `${m.seatCount - m.assignedCount}석`, better: 'down' },
  { key: 'countGap', label: '감독 횟수 차 (최다-최소)', fmt: (m) => `${m.countGap}회`, better: 'down' },
  { key: 'stdDev', label: '업무점수 편차', fmt: (m) => `±${m.stdDev.toFixed(2)}`, better: 'down' },
  { key: 'maxMinGap', label: '최고-최저 차', fmt: (m) => m.maxMinGap.toFixed(1), better: 'down' },
  { key: 'consecutiveCount', label: '연속 감독', fmt: (m) => `${m.consecutiveCount}쌍`, better: 'down' },
  { key: 'subjectInRoom', label: '출제 교사 교실 감독', fmt: (m) => `${m.subjectInRoom}건`, better: 'down' },
];
const valueOf = (key: keyof Metrics, m: Metrics) => (key === 'assignedCount' ? m.seatCount - m.assignedCount : (m[key] as number));

/**
 * 가중치 시뮬레이션: 슬라이더로 조건별 중요도를 바꾸면 브라우저에서 바로 배정을 다시 계산해 기본값과 비교한다.
 * 마음에 들면 그 가중치로 서버에서 정식 실행(onRun)해 적용할 수 있다.
 */
export function WeightSimulator({
  session,
  keepManual,
  disabled,
  onRun,
}: {
  session: ExamSession;
  keepManual: boolean;
  disabled: boolean;
  onRun: (weights: Partial<Weights>) => Promise<void>;
}) {
  const sid = session.id;
  const slots = useCollection<SlotDoc>(`sessions/${sid}/slots`);
  const rooms = useCollection<RoomDoc>('rooms', termWhere(session));
  const teachers = useSessionTeachers(session);
  const assignments = useCollection<AssignmentDoc>(`sessions/${sid}/assignments`);
  const availability = useCollection<AvailabilityDoc>(`sessions/${sid}/availability`);
  const constraints = useCollection<ConstraintDoc>(`sessions/${sid}/constraints`);
  const timetable = useCollection<BaseTimetableDoc>(`sessions/${sid}/baseTimetable`);
  const all = [slots, rooms, teachers, assignments, availability, constraints, timetable];
  const loading = all.some((x) => x.loading);
  const [values, setValues] = useState<Values>({});
  const [applied, setApplied] = useState<Values>({});
  const [busy, setBusy] = useState(false);

  // 슬라이더를 멈춘 뒤 0.25초 후에 다시 계산 (끌 때마다 계산하지 않게)
  useEffect(() => {
    const t = setTimeout(() => setApplied(values), 250);
    return () => clearTimeout(t);
  }, [values]);

  const input = useMemo<EngineInput | null>(() => {
    if (loading || slots.data.length === 0) return null;
    return buildEngineInput({
      teachers: teachers.data,
      rooms: rooms.data,
      slots: slots.data,
      availability: availability.data,
      constraints: constraints.data,
      baseTimetable: timetable.data,
      useBaseTimetable: session.settings.useBaseTimetable,
      examWriterRule: session.settings.examWriter ?? 'NONE',
      classDuringExam: session.settings.classDuringExam !== false,
      skipSeats: session.settings.noSupervisor ?? [],
      extendedPreferred: session.settings.extendedPreferred ?? [],
      pinned: keepManual ? assignments.data.filter((a) => a.source === 'MANUAL').map((a) => ({ seatId: a.id, teacherId: a.teacherId })) : [],
    });
  }, [loading, slots.data, rooms.data, teachers.data, availability.data, constraints.data, timetable.data, assignments.data, keepManual, session.settings]);

  // 기준 = 이 프로젝트 기본 가중치 (출제 교사 규칙 포함)
  const base = useMemo(() => (input ? runAssignment(input).metrics : null), [input]);
  const custom = useMemo(() => {
    if (!input || !Object.keys(applied).length) return null;
    const t0 = performance.now();
    const m = runAssignment({ ...input, settings: { ...input.settings, weights: { ...input.settings.weights, ...toWeights(applied) } } }).metrics;
    return { m, ms: Math.round(performance.now() - t0) };
  }, [input, applied]);

  // 슬라이더 처음 값: 엔진 기본값 (출제 교사 규칙이 있으면 그 값)
  const writer = session.settings.examWriter ?? 'NONE';
  const defaults: Weights = { ...DEFAULT_WEIGHTS, ...(writer === 'NONE' ? {} : { examSubjectHallway: 60, examSubjectRoom: -60 }) };
  const knobs = KNOBS.filter((k) => !k.onlyBase || session.settings.useBaseTimetable);
  const changed = Object.keys(values).length > 0;

  if (loading) return <Spinner />;
  const error = all.find((x) => x.error)?.error;

  return (
    <Card>
      <CardTitle icon="🎚️">가중치 시뮬레이션</CardTitle>
      <p className="mt-1 text-muted">
        조건별 중요도를 슬라이더로 바꾸면 바로 다시 계산해 기본 설정과 비교합니다. 하드 조건(불가시간·동시간 중복 등)은 항상 지킵니다. 마음에 들면 그 설정으로 자동 배정을
        실행하세요.
      </p>
      {error && <Alert>{error}</Alert>}
      {!input ? (
        <p className="mt-3 text-muted">시험 일정을 먼저 등록하세요.</p>
      ) : (
        <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="grid gap-4">
            {knobs.map((k) => {
              const v = values[k.key] ?? toUi(k, defaults);
              return (
                <label key={k.key} className="grid gap-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{k.label}</span>
                    <span className={`text-sm tabular-nums ${values[k.key] !== undefined ? 'font-bold text-primary-strong' : 'text-muted'}`}>
                      {v}
                      {values[k.key] !== undefined && <span className="ml-1 font-normal text-muted">(기본 {toUi(k, defaults)})</span>}
                    </span>
                  </span>
                  <input
                    type="range"
                    aria-label={k.label}
                    min={0}
                    max={k.max}
                    step={5}
                    value={v}
                    disabled={disabled}
                    onChange={(e) => setValues({ ...values, [k.key]: Number(e.target.value) })}
                    className="w-full accent-primary"
                  />
                  <span className="text-xs text-muted">{k.hint}</span>
                </label>
              );
            })}
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setValues({})} disabled={!changed}>
                기본값으로
              </Button>
              <Button
                onClick={async () => {
                  setBusy(true);
                  await onRun(toWeights(values));
                  setBusy(false);
                }}
                disabled={disabled || !changed || busy}
              >
                {busy ? '실행 중…' : '이 설정으로 자동 배정 실행'}
              </Button>
            </div>
          </div>

          <div>
            <table className="w-full border-collapse text-left" aria-label="시뮬레이션 결과">
              <thead>
                <tr className="border-b-2 border-line text-sm text-muted">
                  <th className="py-2">지표</th>
                  <th className="py-2">기본 설정</th>
                  <th className="py-2">조정한 설정</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r) => {
                  const b = base ? valueOf(r.key, base) : 0;
                  const c = custom ? valueOf(r.key, custom.m) : null;
                  // 화면에 보이는 값이 같으면 변화 없음으로 본다 (아주 작은 소수 차이)
                  const diff = c === null || (base && custom && r.fmt(base) === r.fmt(custom.m)) ? 0 : c - b;
                  const good = diff !== 0 && (r.better === 'up' ? diff > 0 : diff < 0);
                  return (
                    <tr key={r.key} className="border-b border-line">
                      <td className="py-2 font-semibold">{r.label}</td>
                      <td className="py-2 tabular-nums">{base ? r.fmt(base) : '-'}</td>
                      <td className={`py-2 font-bold tabular-nums ${c === null || diff === 0 ? '' : good ? 'text-[#1e8449]' : 'text-[#c0392b]'}`}>
                        {custom ? r.fmt(custom.m) : '슬라이더를 움직여 보세요'}
                        {c !== null && diff !== 0 && <span className="ml-1 text-xs">{good ? '▲ 좋아짐' : '▼ 나빠짐'}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {custom && <p className="mt-2 text-xs text-muted">브라우저에서 계산 {custom.ms}ms · 실제 적용은 "이 설정으로 자동 배정 실행" 후 결과를 확인하고 적용하세요.</p>}
          </div>
        </div>
      )}
    </Card>
  );
}
