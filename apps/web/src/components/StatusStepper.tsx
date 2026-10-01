import type { SessionStatus } from '@sim/shared';

/**
 * 화면에 보이는 진행 단계는 4개로 단순화한다 (내부 상태 7개는 그대로).
 * 초안 = 초안·자동배정 완료 / 검토 / 공개 = 교사 공개·교환 기간 / 확정 = 최종 확정·변경 잠금
 */
const STEPS = [
  { label: '초안', statuses: ['DRAFT', 'AUTO_ASSIGNED'] },
  { label: '검토', statuses: ['REVIEW'] },
  { label: '공개', statuses: ['PUBLISHED', 'SWAP'] },
  { label: '확정', statuses: ['CONFIRMED', 'LOCKED'] },
] as const;

export const stepOf = (status: SessionStatus) => STEPS.findIndex((s) => (s.statuses as readonly string[]).includes(status));

/** 단계 안의 세부 표시 (예: 자동 배정 완료, 변경 잠금) */
function detail(status: SessionStatus): string | null {
  if (status === 'AUTO_ASSIGNED') return '배정 완료';
  if (status === 'DRAFT') return '배정 전';
  if (status === 'LOCKED') return '변경 잠금';
  return null;
}

export function StatusBadge({ status }: { status: SessionStatus }) {
  const i = stepOf(status);
  const d = detail(status);
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-bold ${i === 3 ? 'bg-mint-soft text-ink' : 'bg-primary-soft text-primary-strong'}`}
    >
      {STEPS[i]!.label}
      {d && <span className="ml-1 font-normal">· {d}</span>}
    </span>
  );
}

/** 진행 단계 표시 (초안 → 검토 → 공개 → 확정) */
export function StatusStepper({ status }: { status: SessionStatus }) {
  const current = stepOf(status);
  const d = detail(status);
  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {STEPS.map((s, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'todo';
        return (
          <li
            key={s.label}
            aria-current={state === 'current' ? 'step' : undefined}
            className={`rounded-xl border px-3 py-2 text-sm ${
              state === 'current'
                ? 'border-primary bg-primary-soft font-bold text-primary-strong'
                : state === 'done'
                  ? 'border-line bg-surface text-ink'
                  : 'border-dashed border-line text-muted'
            }`}
          >
            <span className="mr-1">{state === 'done' ? '✓' : `${i + 1}.`}</span>
            {s.label}
            {state === 'current' && d && <span className="ml-1 font-normal">({d})</span>}
          </li>
        );
      })}
    </ol>
  );
}
