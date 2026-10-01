import { availabilityId, type AvailabilityDoc, type AvailabilityStatus, type WithId } from '@sim/shared';
import { commitOps, ref, type BatchOp } from './data';

export type Availability = WithId<AvailabilityDoc>;

export interface Cell {
  date: string;
  period: number;
}

export const cellKey = (c: Cell) => `${c.date}|${c.period}`;

const path = (sid: string) => `sessions/${sid}/availability`;

/**
 * 불가시간 제출. 교사는 승인 대기로, 관리자 대리 입력은 바로 승인으로 저장한다.
 * 문서 ID가 교사·날짜·교시로 정해져 있어 같은 칸을 다시 제출하면 덮어쓴다.
 */
export function submitAvailability(sid: string, teacherId: string, cells: Cell[], reason: string, asAdmin: boolean) {
  const ops: BatchOp[] = cells.map((c) => ({
    type: 'set',
    ref: ref(path(sid), availabilityId(teacherId, c.date, c.period)),
    data: {
      teacherId,
      date: c.date,
      period: c.period,
      available: false,
      reason,
      source: asAdmin ? 'ADMIN' : 'TEACHER',
      status: asAdmin ? 'APPROVED' : 'PENDING',
      adminNote: null,
    } satisfies AvailabilityDoc,
  }));
  return commitOps(ops, asAdmin ? '불가시간 대리 입력' : '불가시간 제출');
}

export function deleteAvailability(sid: string, ids: string[]) {
  return commitOps(ids.map((id) => ({ type: 'delete', ref: ref(path(sid), id) })), '불가시간 취소');
}

/** 관리자 승인/반려. merge로 상태와 메모만 바꾼다. */
export function reviewAvailability(sid: string, ids: string[], status: AvailabilityStatus, adminNote: string | null = null) {
  return commitOps(ids.map((id) => ({ type: 'set', ref: ref(path(sid), id), data: { status, adminNote }, merge: true })), `불가시간 ${status === 'APPROVED' ? '승인' : status === 'REJECTED' ? '반려' : '승인 취소'}`);
}

export function sortAvailability(list: Availability[], nameOf: (id: string) => string): Availability[] {
  return [...list].sort(
    (a, b) =>
      a.date.localeCompare(b.date) || a.period - b.period || nameOf(a.teacherId).localeCompare(nameOf(b.teacherId), 'ko'),
  );
}
