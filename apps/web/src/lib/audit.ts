// 변경 이력(Audit Log) 읽기·설명 만들기
import { collection, limit, onSnapshot, orderBy, query, type Timestamp } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { AVAILABILITY_STATUS_LABEL, SEAT_ROLE_LABEL, STATUS_LABEL, type AvailabilityStatus, type SeatRole, type SessionStatus } from '@sim/shared';
import { db } from './firebase';

export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'STATUS';

export interface AuditLog {
  id: string;
  action: AuditAction;
  targetType: string;
  targetId: string;
  userId: string | null;
  lastEditor: string | null;
  reason: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt?: Timestamp;
  /** 학교 공통(교사·시험실·관리자) 기록인지 */
  scope: 'session' | 'school';
}

export const ACTION_LABEL: Record<AuditAction, string> = {
  CREATE: '추가',
  UPDATE: '수정',
  DELETE: '삭제',
  STATUS: '단계 변경',
};

export const TARGET_LABEL: Record<string, string> = {
  sessions: '시험 프로젝트',
  slots: '시험 일정',
  assignments: '감독 배정',
  availability: '불가시간',
  baseTimetable: '기초시간표',
  constraints: '예외 규칙',
  teachers: '교사',
  rooms: '시험실',
  admins: '관리자',
};

/** 최신 기록부터 실시간 구독 (path가 null이면 구독 안 함) */
export function useAuditLogs(path: string | null, scope: AuditLog['scope'], max = 300) {
  const [state, setState] = useState<{ data: AuditLog[]; loading: boolean; error: string | null }>({ data: [], loading: true, error: null });
  useEffect(() => {
    if (!path) {
      setState({ data: [], loading: false, error: null });
      return;
    }
    return onSnapshot(
      query(collection(db, path), orderBy('createdAt', 'desc'), limit(max)),
      (snap) => setState({ data: snap.docs.map((d) => ({ id: d.id, scope, ...(d.data() as Omit<AuditLog, 'id' | 'scope'>) })), loading: false, error: null }),
      (e) => setState({ data: [], loading: false, error: e.message }),
    );
  }, [path, scope, max]);
  return state;
}

const IGNORE = new Set(['updatedAt', 'updatedBy', 'createdAt', 'lastChangeReason', 'runId', 'score', 'reason']);

type Names = { teacher: (id: string) => string; room: (id: string) => string };

function fmt(key: string, v: unknown, names: Names): string {
  if (v === null || v === undefined || v === '') return '(없음)';
  if (key === 'teacherId' && typeof v === 'string') return names.teacher(v);
  if (key === 'roomId' && typeof v === 'string') return names.room(v);
  if (key === 'status' && typeof v === 'string') {
    return STATUS_LABEL[v as SessionStatus] ?? AVAILABILITY_STATUS_LABEL[v as AvailabilityStatus] ?? v;
  }
  if (key === 'role' && typeof v === 'string') return SEAT_ROLE_LABEL[v as SeatRole] ?? v;
  if (key === 'source' && typeof v === 'string') return ({ AUTO: '자동', MANUAL: '수동', TEACHER: '교사', ADMIN: '관리자' } as Record<string, string>)[v] ?? v;
  if (key === 'defaultRole' && typeof v === 'string') return ({ NORMAL: '일반', HALLWAY: '복도전담', EXCLUDED: '감독제외' } as Record<string, string>)[v] ?? v;
  if (key === 'rooms' && Array.isArray(v)) return `${v.length}실 (${v.map((p) => names.room((p as { roomId: string }).roomId)).join(', ')})`;
  if (key === 'entries' && Array.isArray(v)) return `수업 ${v.length}건`;
  if (key === 'homeroom' && v && typeof v === 'object') return `${(v as { grade: number }).grade}-${(v as { classNo: number }).classNo}`;
  if (typeof v === 'boolean') return v ? '예' : '아니오';
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 60);
  return String(v);
}

const FIELD_LABEL: Record<string, string> = {
  teacherId: '교사',
  roomId: '시험실',
  status: '상태',
  role: '역할',
  rooms: '시험실 배치',
  entries: '수업',
  name: '이름',
  email: '이메일',
  subject: '과목',
  homeroom: '담임',
  defaultRole: '감독구분',
  active: '사용',
  chiefCount: '정감독 수',
  assistantCount: '부감독 수',
  date: '날짜',
  period: '교시',
  startTime: '시작',
  endTime: '종료',
  grade: '학년',
  type: '유형',
  settings: '설정',
  examName: '시험명',
  adminNote: '관리자 메모',
  source: '입력',
};

/** 대상 이름: "10/12 1교시 1-1 정감독", "김국어 · 10/12 2교시" 등 */
export function targetText(log: AuditLog, names: Names): string {
  const d = (log.after ?? log.before ?? {}) as Record<string, unknown>;
  const when = d.date ? `${String(d.date).slice(5).replace('-', '/')} ${d.period ?? ''}교시` : '';
  switch (log.targetType) {
    case 'assignments':
      return `${when} ${names.room(String(d.roomId ?? ''))} ${SEAT_ROLE_LABEL[d.role as SeatRole] ?? ''}`.trim();
    case 'slots':
      return `${when} ${d.grade ?? ''}학년 ${d.subject ?? ''}`.trim();
    case 'availability':
      return `${names.teacher(String(d.teacherId ?? ''))} · ${when}`;
    case 'baseTimetable':
      return names.teacher(log.targetId);
    case 'teachers':
    case 'rooms':
      return String(d.name ?? log.targetId);
    case 'sessions':
      return String(d.examName ?? '');
    default:
      return log.targetId;
  }
}

/** 바뀐 내용 목록: "교사: 김국어 → 이수학" */
export function changes(log: AuditLog, names: Names): string[] {
  if (log.action === 'CREATE' || log.action === 'DELETE') {
    const d = (log.after ?? log.before ?? {}) as Record<string, unknown>;
    if (log.targetType === 'assignments' || log.targetType === 'availability') return [`교사: ${fmt('teacherId', d.teacherId, names)}`];
    return [];
  }
  const before = log.before ?? {};
  const after = log.after ?? {};
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((k) => !IGNORE.has(k) && JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map((k) => `${FIELD_LABEL[k] ?? k}: ${fmt(k, before[k], names)} → ${fmt(k, after[k], names)}`);
}
