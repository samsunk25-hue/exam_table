// Firestore 문서 → 배정 엔진 입력/결과 → 저장 형식 변환 (Firebase에 의존하지 않는 순수 함수)
import type { EngineInput, EngineResult, PinnedAssignment } from './types';
import {
  groupIdOf,
  type AvailabilityDoc,
  type BaseTimetableDoc,
  type ConstraintDoc,
  type RoomDoc,
  type RunDoc,
  type SlotDoc,
  type TeacherDoc,
  type WithId,
} from '@sim/shared';

export interface SessionData {
  teachers: WithId<TeacherDoc>[];
  rooms: WithId<RoomDoc>[];
  slots: WithId<SlotDoc>[];
  availability: AvailabilityDoc[];
  constraints: ConstraintDoc[];
  baseTimetable: WithId<BaseTimetableDoc>[];
  useBaseTimetable: boolean;
  pinned?: PinnedAssignment[];
}

export function buildEngineInput(d: SessionData): EngineInput {
  return {
    teachers: d.teachers.map((t) => ({
      id: t.id,
      name: t.name,
      subject: t.subject ?? undefined,
      homeroom: t.homeroom,
      defaultRole: t.defaultRole,
      active: t.active,
      priorLoad: t.cumulativeLoad ?? 0,
    })),
    rooms: d.rooms.map((r) => ({
      id: r.id,
      name: r.name,
      chiefCount: r.chiefCount,
      assistantCount: r.assistantCount,
      spaceType: r.spaceType,
    })),
    slots: d.slots.map((s) => ({ id: s.id, date: s.date, period: s.period, grade: s.grade, subject: s.subject, type: s.type })),
    // 삭제된 시험실이 배치에 남아 있으면 건너뛴다 (기본 설정 점검에서 오류로 표시됨)
    groups: d.slots.flatMap((s) =>
      s.rooms
        .filter((p) => d.rooms.some((r) => r.id === p.roomId))
        .map((p) => ({
          id: groupIdOf(s.id, p.roomId),
          slotId: s.id,
          roomId: p.roomId,
          grade: s.grade,
          classNo: p.classNo,
          roomType: p.roomType,
        })),
    ),
    availability: d.availability.map((a) => ({ teacherId: a.teacherId, date: a.date, period: a.period, status: a.status, reason: a.reason })),
    constraints: d.constraints,
    baseTimetable: d.baseTimetable.flatMap((doc) =>
      doc.entries.map((e) => ({ teacherId: doc.id, weekday: e.weekday, period: e.period, grade: e.grade, classNo: e.classNo, subject: e.subject ?? undefined })),
    ),
    settings: { useBaseTimetable: d.useBaseTimetable },
    pinned: d.pinned,
  };
}

/** 엔진 결과 → runs 문서 본문 */
export function toRunDoc(
  result: EngineResult,
  meta: {
    createdBy: string;
    useBaseTimetable: boolean;
    keepManual: boolean;
    elapsedMs: number;
    batchId?: string;
    scenario?: { key: string; label: string; description: string };
  },
): RunDoc {
  const seatById = new Map(result.seats.map((s) => [s.id, s]));
  const loads: RunDoc['loads'] = {};
  for (const [tid, total] of Object.entries(result.metrics.loads)) {
    loads[tid] = [result.metrics.sessionLoads[tid] ?? 0, total];
  }
  return {
    createdBy: meta.createdBy,
    batchId: meta.batchId ?? '',
    scenario: meta.scenario?.key ?? 'BASE',
    scenarioLabel: meta.scenario?.label ?? '기본안',
    scenarioDescription: meta.scenario?.description ?? '',
    settings: { useBaseTimetable: meta.useBaseTimetable, keepManual: meta.keepManual },
    metrics: {
      seatCount: result.metrics.seatCount,
      assignedCount: result.metrics.assignedCount,
      successRate: result.metrics.successRate,
      stdDev: result.metrics.stdDev,
      maxMinGap: result.metrics.maxMinGap,
      consecutiveCount: result.metrics.consecutiveCount,
      subjectInRoom: result.metrics.subjectInRoom,
    },
    loads,
    assignments: result.assignments.map((a) => {
      const seat = seatById.get(a.seatId)!;
      return {
        seatId: a.seatId,
        slotId: a.slotId,
        groupId: a.groupId,
        roomId: a.roomId,
        role: a.role,
        weight: a.weight,
        teacherId: a.teacherId,
        score: a.score,
        reason: a.reason,
        source: a.source,
        date: seat.date,
        period: seat.period,
      };
    }),
    unassigned: result.unassigned.map((u) => ({
      seatId: u.seat.id,
      slotId: u.seat.slotId,
      roomId: u.seat.roomId,
      role: u.seat.role,
      date: u.seat.date,
      period: u.seat.period,
      message: u.message,
    })),
    rejectedPinned: result.rejectedPinned.map((v) => v.message),
    applied: false,
    elapsedMs: meta.elapsedMs,
  };
}
