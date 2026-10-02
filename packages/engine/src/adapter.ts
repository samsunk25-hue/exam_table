// Firestore 문서 → 배정 엔진 입력/결과 → 저장 형식 변환 (Firebase에 의존하지 않는 순수 함수)
import type { DutyKind, EngineInput, EngineResult, PinnedAssignment } from './types';
import {
  groupIdOf,
  type AvailabilityDoc,
  type BaseTimetableDoc,
  type ConstraintDoc,
  type Placement,
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
  examWriterRule?: 'NONE' | 'PREFER_HALLWAY' | 'NO_ROOM';
  classDuringExam?: boolean;
  skipSeats?: string[];
  extendedPreferred?: string[];
  extendedChief?: string[];
  extendedAssistant?: string[];
  /** 교사 ID → 같은 학년도 앞선 확정 시험의 종류별 감독 횟수 */
  priorCounts?: Record<string, Partial<Record<DutyKind, number>>>;
  pinned?: PinnedAssignment[];
}

const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

/**
 * 별도 시간(startTime/endTime)으로 운영하는 배치가 같은 날 다른 교시와 겹치면 그 교시들.
 * 다른 교시 시간은 그 교시 시험들의 시작·종료 시각에서 읽는다.
 */
export function overlappingPeriods(slots: SlotDoc[], slot: SlotDoc, p: Placement): number[] {
  if (!p.startTime && !p.endTime) return [];
  const start = p.startTime ?? slot.startTime;
  const end = p.endTime ?? slot.endTime;
  if (!start || !end) return [];
  const [s, e] = [toMin(start), toMin(end)];
  const out = new Set<number>();
  for (const o of slots) {
    if (o.date !== slot.date || o.period === slot.period || !o.startTime || !o.endTime) continue;
    if (toMin(o.startTime) < e && s < toMin(o.endTime)) out.add(o.period);
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * 별도시험장(연장 시간)은 교시마다 감독이 따로라서, 한 교시 감독이 맡는 시간: 그 교시 시작(첫 교시는 별도 시작)부터
 * 다음 겹치는 교시 시작 전까지(마지막은 별도 종료까지). 예) 09:00~10:10이 2교시(10:00~)와 겹치면 1교시 09:00~10:00, 2교시 10:00~10:10.
 * 별도 시간이 없으면 null.
 */
export function seatTimeRange(slots: SlotDoc[], slot: SlotDoc, p: Placement, period: number): { start: string; end: string } | null {
  const start = p.startTime ?? slot.startTime;
  const end = p.endTime ?? slot.endTime;
  if (!p.startTime && !p.endTime) return null;
  if (!start || !end) return null;
  if (p.roomType !== 'EXTENDED') return { start, end };
  const periods = [slot.period, ...overlappingPeriods(slots, slot, p)];
  const startOf = (q: number) => slots.find((o) => o.date === slot.date && o.period === q && o.startTime)?.startTime ?? null;
  const i = periods.indexOf(period);
  if (i < 0) return { start, end };
  const from = i === 0 ? start : (startOf(period) ?? start);
  const to = i === periods.length - 1 ? end : (startOf(periods[i + 1]!) ?? end);
  return { start: from, end: to };
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
      temporary: t.temporary === true,
      priorCounts: d.priorCounts?.[t.id],
    })),
    rooms: d.rooms.map((r) => ({
      id: r.id,
      name: r.name,
      chiefCount: r.chiefCount,
      assistantCount: r.assistantCount,
      spaceType: r.spaceType,
    })),
    slots: d.slots.map((s) => ({ id: s.id, date: s.date, period: s.period, grade: s.grade, subject: s.subject, type: s.type })),
    // 삭제된 시험실이 배치에 남아 있으면 건너뛴다 (기초 자료 점검에서 오류로 표시됨)
    groups: d.slots.flatMap((s) =>
      s.rooms
        .filter((p) => d.rooms.some((r) => r.id === p.roomId))
        .map((p) => ({
          id: groupIdOf(s.id, p.roomId),
          slotId: s.id,
          roomId: p.roomId,
          // 별도시험장에서 따로 정한 학년·과목
          grade: p.grade ?? s.grade,
          subject: p.subject?.trim() || undefined,
          classNo: p.classNo,
          roomType: p.roomType,
          alsoPeriods: overlappingPeriods(d.slots, s, p),
        })),
    ),
    availability: d.availability.map((a) => ({ teacherId: a.teacherId, date: a.date, period: a.period, status: a.status, reason: a.reason })),
    constraints: d.constraints,
    baseTimetable: d.baseTimetable.flatMap((doc) =>
      doc.entries.map((e) => ({ teacherId: doc.id, weekday: e.weekday, period: e.period, grade: e.grade, classNo: e.classNo, subject: e.subject ?? undefined })),
    ),
    settings: {
      useBaseTimetable: d.useBaseTimetable,
      examWriterRule: d.examWriterRule ?? 'NONE',
      classDuringExam: d.classDuringExam ?? false,
      skipSeats: d.skipSeats ?? [],
      extendedPreferred: d.extendedPreferred ?? [],
      extendedChief: d.extendedChief ?? [],
      extendedAssistant: d.extendedAssistant ?? [],
    },
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
      countGap: result.metrics.countGap,
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
