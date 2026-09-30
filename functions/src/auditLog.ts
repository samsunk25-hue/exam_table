export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'STATUS';

type Data = Record<string, unknown> | undefined;

export function actionOf(before: Data, after: Data): AuditAction {
  if (!before) return 'CREATE';
  if (!after) return 'DELETE';
  if (before.status !== after.status && 'status' in after) return 'STATUS';
  return 'UPDATE';
}

/**
 * 트리거는 행위자를 알 수 없으므로 보안 규칙이 강제하는 updatedBy를 사용한다.
 * 삭제는 마지막 수정자만 알 수 있어 lastEditor로 따로 남긴다.
 */
export function buildAuditLog(targetType: string, targetId: string, before: Data, after: Data) {
  const action = actionOf(before, after);
  return {
    action,
    targetType,
    targetId,
    userId: action === 'DELETE' ? null : ((after?.updatedBy as string | undefined) ?? null),
    lastEditor: action === 'DELETE' ? ((before?.updatedBy as string | undefined) ?? null) : null,
    reason: (after?.lastChangeReason as string | undefined) ?? null,
    before: before ?? null,
    after: after ?? null,
  };
}
