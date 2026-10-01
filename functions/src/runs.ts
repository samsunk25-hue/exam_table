import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { SCENARIOS, runAssignment as runEngine, scenarioInput, validateAssignments, type EngineInput, type ScenarioKey, type Weights } from '@sim/engine';
import {
  isSetupEditable,
  type AssignmentDoc,
  type AvailabilityDoc,
  type BaseTimetableDoc,
  type ConstraintDoc,
  type RoomDoc,
  type RunDoc,
  type SessionStatus,
  type SlotDoc,
  type TeacherDoc,
  type WithId,
  sessionTerm,
  termKey,
} from '@sim/shared';
import { recordOp } from './undo';
import { db, requireAdmin, serverTimestamp } from './common';
import type { QuerySnapshot, WriteBatch } from 'firebase-admin/firestore';
import { buildEngineInput, toRunDoc, type SessionData } from './engineInput';

const RUN_OPTIONS = { timeoutSeconds: 120, memory: '512MiB' as const };

function withIds<T>(snap: QuerySnapshot): WithId<T>[] {
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as T) }));
}

async function loadSession(sessionId: string) {
  const ref = db().doc(`sessions/${sessionId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', '시험 프로젝트를 찾을 수 없습니다.');
  const status = snap.get('status') as SessionStatus;
  if (!isSetupEditable(status)) {
    throw new HttpsError('failed-precondition', '교사 공개 이후에는 자동 배정을 다시 실행하거나 적용할 수 없습니다.');
  }
  return { ref, status, useBaseTimetable: snap.get('settings.useBaseTimetable') === true };
}

export async function loadData(sessionId: string, useBaseTimetable: boolean) {
  const firestore = db();
  // 이 세션 학교·학기의 교사·시험실만 쓴다
  const session = (await firestore.doc(`sessions/${sessionId}`).get()).data() ?? {};
  const term = termKey(sessionTerm(session as { schoolName: string; year: number; semester: number }));
  const [teachers, rooms, slots, availability, constraints, baseTimetable, assignments] = await Promise.all([
    firestore.collection('teachers').where('term', '==', term).get(),
    firestore.collection('rooms').where('term', '==', term).get(),
    firestore.collection(`sessions/${sessionId}/slots`).get(),
    firestore.collection(`sessions/${sessionId}/availability`).get(),
    firestore.collection(`sessions/${sessionId}/constraints`).get(),
    firestore.collection(`sessions/${sessionId}/baseTimetable`).get(),
    firestore.collection(`sessions/${sessionId}/assignments`).get(),
  ]);
  const data: SessionData = {
    // 임시 감독자는 그 프로젝트에서만 쓴다
    teachers: withIds<TeacherDoc>(teachers).filter((t) => !t.onlySession || t.onlySession === sessionId),
    rooms: withIds<RoomDoc>(rooms),
    slots: withIds<SlotDoc>(slots),
    availability: availability.docs.map((d) => d.data() as AvailabilityDoc),
    constraints: constraints.docs.map((d) => d.data() as ConstraintDoc),
    baseTimetable: withIds<BaseTimetableDoc>(baseTimetable),
    useBaseTimetable,
    examWriterRule: (session as { settings?: { examWriter?: 'NONE' | 'PREFER_HALLWAY' | 'NO_ROOM' } }).settings?.examWriter ?? 'NONE',
    // 기본 켜짐 (기초시간표가 없으면 아무 영향 없음)
    classDuringExam: (session as { settings?: { classDuringExam?: boolean } }).settings?.classDuringExam !== false,
    skipSeats: (session as { settings?: { noSupervisor?: string[] } }).settings?.noSupervisor ?? [],
  };
  return { data, current: withIds<AssignmentDoc>(assignments) };
}

// 시뮬레이션에서 바꿀 수 있는 가중치와 범위
const WEIGHT_RANGE: Partial<Record<keyof Weights, [number, number]>> = {
  baseMatch: [0, 200],
  lowLoad: [0, 200],
  highLoad: [-200, 0],
  notHomeroomGrade: [0, 100],
  consecutive: [-1000, 0],
  hallwayMatch: [0, 100],
  examSubjectHallway: [0, 200],
  examSubjectRoom: [-200, 0],
};
const WEIGHT_LABEL: Partial<Record<keyof Weights, string>> = {
  baseMatch: '기초시간표',
  lowLoad: '부담 적은 교사',
  highLoad: '부담 많은 교사',
  notHomeroomGrade: '다른 학년 담임',
  consecutive: '연속 감독',
  hallwayMatch: '복도전담',
  examSubjectHallway: '출제 교사 복도',
  examSubjectRoom: '출제 교사 교실',
};

function sanitizeWeights(raw: unknown): Partial<Weights> | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: Partial<Weights> = {};
  for (const [k, range] of Object.entries(WEIGHT_RANGE) as [keyof Weights, [number, number]][]) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.min(range[1], Math.max(range[0], Math.round(v)));
  }
  return Object.keys(out).length ? out : null;
}

function describeWeights(w: Partial<Weights>): string {
  return Object.entries(w)
    .map(([k, v]) => `${WEIGHT_LABEL[k as keyof Weights] ?? k} ${v! > 0 ? '+' : ''}${v}`)
    .join(', ');
}

function args(data: unknown): Record<string, unknown> {
  return (data ?? {}) as Record<string, unknown>;
}

/** 자동 배정 실행 → runs 문서로 저장 (실제 배정은 바꾸지 않는다) */
export const runAssignment = onCall(RUN_OPTIONS, async (req) => {
  const uid = requireAdmin(req);
  const { sessionId, keepManual, scenarios, weights } = args(req.data);
  const custom = sanitizeWeights(weights);
  if (typeof sessionId !== 'string') throw new HttpsError('invalid-argument', '세션 ID가 필요합니다.');
  const keep = keepManual !== false;

  const session = await loadSession(sessionId);
  const { data, current } = await loadData(sessionId, session.useBaseTimetable);
  if (data.slots.length === 0) throw new HttpsError('failed-precondition', '시험 일정이 없습니다. 기본 설정에서 일정을 먼저 등록하세요.');

  data.pinned = keep ? current.filter((a) => a.source === 'MANUAL').map((a) => ({ seatId: a.id, teacherId: a.teacherId })) : [];
  const input = buildEngineInput(data);
  if (!input.teachers.some((t) => t.active && t.defaultRole !== 'EXCLUDED')) {
    throw new HttpsError('failed-precondition', '감독할 교사가 없습니다. 준비 > 교사 명단을 먼저 넣으세요.');
  }
  if (input.groups.length === 0) throw new HttpsError('failed-precondition', '감독 자리가 없습니다. 시험실을 등록하고 시험 일정에서 시험실을 배치하세요.');

  // 다중 시나리오: 기본안 + A(형평성)·B(연속 배제)·C(출제 교사 복도) — 같은 batchId로 묶는다
  // 가중치 시뮬레이션에서 정한 값이 있으면 그 안 하나만 실행한다
  const keys = scenarios === true ? SCENARIOS.map((s) => s.key) : (['BASE'] as ScenarioKey[]);
  const list: { scenario: { key: string; label: string; description: string }; input: EngineInput }[] = custom
    ? [
        {
          scenario: { key: 'CUSTOM', label: '사용자 가중치', description: describeWeights(custom) },
          input: { ...input, settings: { ...input.settings, weights: { ...input.settings.weights, ...custom } } },
        },
      ]
    : SCENARIOS.filter((s) => keys.includes(s.key)).map((s) => ({ scenario: s, input: scenarioInput(input, s) }));
  const col = db().collection(`sessions/${sessionId}/runs`);
  const batchId = col.doc().id;
  const out: { runId: string; scenario: string; metrics: RunDoc['metrics']; unassigned: number }[] = [];
  for (const { scenario, input: scenarioIn } of list) {
    const t0 = Date.now();
    const result = runEngine(scenarioIn);
    const run = toRunDoc(result, {
      createdBy: uid,
      useBaseTimetable: session.useBaseTimetable,
      keepManual: keep,
      elapsedMs: Date.now() - t0,
      batchId,
      scenario,
    });
    const ref = await col.add({ ...run, createdAt: serverTimestamp() });
    out.push({ runId: ref.id, scenario: scenario.key, metrics: run.metrics, unassigned: run.unassigned.length });
  }
  const base = out[0]!;
  return { runId: base.runId, batchId, metrics: base.metrics, unassigned: base.unassigned, runs: out };
});

/** 실행 결과 적용: 현재 데이터로 하드 조건을 다시 검증한 뒤 배정을 교체한다 */
export const applyRun = onCall(RUN_OPTIONS, async (req) => {
  const uid = requireAdmin(req);
  const { sessionId, runId } = args(req.data);
  if (typeof sessionId !== 'string' || typeof runId !== 'string') {
    throw new HttpsError('invalid-argument', '세션 ID와 실행 ID가 필요합니다.');
  }

  const session = await loadSession(sessionId);
  const runSnap = await db().doc(`sessions/${sessionId}/runs/${runId}`).get();
  if (!runSnap.exists) throw new HttpsError('not-found', '실행 결과를 찾을 수 없습니다.');
  const run = runSnap.data() as RunDoc;

  const { data, current } = await loadData(sessionId, session.useBaseTimetable);
  const violations = validateAssignments(buildEngineInput(data), run.assignments);
  if (violations.length > 0) {
    throw new HttpsError(
      'failed-precondition',
      `실행 이후 자료가 바뀌어 이 결과를 적용할 수 없습니다. 자동 배정을 다시 실행하세요. (${violations
        .slice(0, 3)
        .map((v) => v.message)
        .join(' / ')}${violations.length > 3 ? ` 외 ${violations.length - 3}건` : ''})`,
    );
  }

  // 배치 한도(500)를 넘지 않게 나눠 쓴다. 좌석 ID가 문서 ID라 같은 좌석은 덮어쓴다.
  const firestore = db();
  const col = firestore.collection(`sessions/${sessionId}/assignments`);
  const keep = new Set(run.assignments.map((a) => a.seatId));
  await recordOp({
    label: '자동 배정 적용',
    sessionId,
    uid,
    email: (req.auth?.token.email as string | undefined) ?? null,
    refs: [session.ref, ...current.map((a) => col.doc(a.id)), ...run.assignments.map((a) => col.doc(a.seatId))],
  });
  type Op = (b: WriteBatch) => void;
  const ops: Op[] = [
    ...current.filter((a) => !keep.has(a.id)).map((a): Op => (b) => b.delete(col.doc(a.id))),
    ...run.assignments.map(({ seatId, ...a }): Op => (b) =>
      b.set(col.doc(seatId), { ...a, runId, updatedBy: uid, updatedAt: serverTimestamp() }),
    ),
  ];
  for (let i = 0; i < ops.length; i += 400) {
    const batch = firestore.batch();
    ops.slice(i, i + 400).forEach((op) => op(batch));
    await batch.commit();
  }

  await firestore.doc(`sessions/${sessionId}/runs/${runId}`).update({ applied: true, appliedAt: serverTimestamp() });
  await session.ref.update({
    ...(session.status === 'DRAFT' ? { status: 'AUTO_ASSIGNED' } : {}),
    assignmentStats: {
      runId,
      seatCount: run.metrics.seatCount,
      assignedCount: run.assignments.length,
      appliedAt: serverTimestamp(),
    },
    updatedBy: uid,
    updatedAt: serverTimestamp(),
    lastChangeReason: `자동 배정 적용 (${run.assignments.length}/${run.metrics.seatCount})`,
  });

  return { assigned: run.assignments.length, removed: current.filter((a) => !keep.has(a.id)).length };
});
