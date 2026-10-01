// 세션 워크플로 7단계 (PRD 4장). 웹과 Cloud Functions가 같은 규칙을 쓴다.

export const SESSION_STATUSES = [
  'DRAFT',
  'AUTO_ASSIGNED',
  'REVIEW',
  'PUBLISHED',
  'SWAP',
  'CONFIRMED',
  'LOCKED',
] as const;

export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const STATUS_LABEL: Record<SessionStatus, string> = {
  DRAFT: '초안 생성',
  AUTO_ASSIGNED: '자동 배정 완료',
  REVIEW: '관리자 검토',
  PUBLISHED: '교사 공개',
  SWAP: '교환 기간',
  CONFIRMED: '최종 확정',
  LOCKED: '변경 잠금',
};

export interface Transition {
  to: SessionStatus;
  label: string;
  /** 사유 입력 필수 여부 */
  requiresReason: boolean;
}

/** 허용되는 상태 전환. 확정(CONFIRMED) 이후 이전 단계로는 돌아갈 수 없다. */
export const TRANSITIONS: Record<SessionStatus, Transition[]> = {
  // 배정을 마치면 바로 공개할 수 있다 (검토 단계는 건너뛰어도 됨)
  DRAFT: [
    { to: 'PUBLISHED', label: '교사에게 공개', requiresReason: false },
    { to: 'AUTO_ASSIGNED', label: '자동 배정 완료로 표시', requiresReason: false },
  ],
  AUTO_ASSIGNED: [
    { to: 'PUBLISHED', label: '교사에게 공개', requiresReason: false },
    { to: 'REVIEW', label: '검토 시작', requiresReason: false },
    { to: 'DRAFT', label: '초안으로 되돌리기', requiresReason: false },
  ],
  REVIEW: [
    { to: 'PUBLISHED', label: '교사에게 공개', requiresReason: false },
    { to: 'AUTO_ASSIGNED', label: '검토 이전으로 되돌리기', requiresReason: false },
  ],
  PUBLISHED: [
    { to: 'SWAP', label: '교환 기간 시작', requiresReason: false },
    { to: 'CONFIRMED', label: '최종 확정', requiresReason: false },
    { to: 'REVIEW', label: '공개 취소', requiresReason: true },
  ],
  SWAP: [{ to: 'CONFIRMED', label: '최종 확정', requiresReason: false }],
  CONFIRMED: [{ to: 'LOCKED', label: '변경 잠금', requiresReason: false }],
  LOCKED: [{ to: 'CONFIRMED', label: '잠금 해제', requiresReason: true }],
};

export function findTransition(from: SessionStatus, to: SessionStatus): Transition | undefined {
  return TRANSITIONS[from].find((t) => t.to === to);
}

export function isSessionStatus(v: unknown): v is SessionStatus {
  return typeof v === 'string' && (SESSION_STATUSES as readonly string[]).includes(v);
}

/** 교사가 배정 결과를 볼 수 있는 단계 */
export function isPublished(s: SessionStatus): boolean {
  return SESSION_STATUSES.indexOf(s) >= SESSION_STATUSES.indexOf('PUBLISHED');
}

/** 기본 데이터(슬롯, 시험실 배치 등)를 수정할 수 있는 단계 */
export function isSetupEditable(s: SessionStatus): boolean {
  return s === 'DRAFT' || s === 'AUTO_ASSIGNED' || s === 'REVIEW';
}
