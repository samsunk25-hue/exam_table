import type { AvailabilityDoc, RoomDoc, SlotDoc, TeacherDoc, WithId } from './model';

export function availabilityId(teacherId: string, date: string, period: number): string {
  return `${teacherId}_${date}_${period}`;
}

export interface ExamTime {
  date: string;
  period: number;
  startTime: string | null;
  endTime: string | null;
}

/** 시험 일정에 나오는 날짜·교시 목록 (중복 제거, 시간순) */
export function examTimes(slots: Pick<SlotDoc, 'date' | 'period' | 'startTime' | 'endTime'>[]): ExamTime[] {
  const map = new Map<string, ExamTime>();
  for (const s of slots) {
    const key = `${s.date}|${s.period}`;
    const prev = map.get(key);
    map.set(key, {
      date: s.date,
      period: s.period,
      startTime: prev?.startTime ?? s.startTime,
      endTime: prev?.endTime ?? s.endTime,
    });
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date) || a.period - b.period);
}

/** 날짜별로 묶기 */
export function groupByDate<T extends { date: string }>(list: T[]): [string, T[]][] {
  const out = new Map<string, T[]>();
  for (const x of list) out.set(x.date, [...(out.get(x.date) ?? []), x]);
  return [...out];
}

export interface TimeCapacity extends ExamTime {
  /** 필요한 감독 수 (배치된 시험실의 정·부감독 합) */
  need: number;
  /** 감독 가능한 교사 수 (불가시간 승인·대기 제외) */
  available: number;
  /** 승인된 불가 교사 수 */
  approvedOff: number;
  /** 승인 대기 중인 불가 교사 수 */
  pendingOff: number;
}

/**
 * 시간대별 인력 현황. 배정 엔진과 같게 승인·대기 불가시간을 모두 불가로 본다.
 * 복도대기 교사는 복도 좌석에만 배정되므로 교실 감독 인력에서 따로 계산하지 않고 합산한다 (개략치).
 */
export function capacityByTime(
  slots: WithId<SlotDoc>[],
  rooms: WithId<RoomDoc>[],
  teachers: WithId<TeacherDoc>[],
  availability: AvailabilityDoc[],
): TimeCapacity[] {
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const eligible = new Set(teachers.filter((t) => t.active && t.defaultRole !== 'EXCLUDED').map((t) => t.id));

  return examTimes(slots).map((time) => {
    const need = slots
      .filter((s) => s.date === time.date && s.period === time.period)
      .flatMap((s) => s.rooms)
      .reduce((n, p) => {
        const r = roomById.get(p.roomId);
        return n + (r ? r.chiefCount + r.assistantCount : 0);
      }, 0);
    const off = availability.filter(
      (a) => a.date === time.date && a.period === time.period && eligible.has(a.teacherId) && a.status !== 'REJECTED',
    );
    const offTeachers = new Set(off.map((a) => a.teacherId));
    return {
      ...time,
      need,
      available: eligible.size - offTeachers.size,
      approvedOff: new Set(off.filter((a) => a.status === 'APPROVED').map((a) => a.teacherId)).size,
      pendingOff: new Set(off.filter((a) => a.status === 'PENDING').map((a) => a.teacherId)).size,
    };
  });
}
