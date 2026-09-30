import { SESSION_STATUSES, STATUS_LABEL, type SessionStatus } from '@sim/shared';

export function StatusBadge({ status }: { status: SessionStatus }) {
  const locked = status === 'CONFIRMED' || status === 'LOCKED';
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-bold ${
        locked ? 'bg-mint-soft text-ink' : 'bg-primary-soft text-primary-strong'
      }`}
    >
      {SESSION_STATUSES.indexOf(status) + 1}. {STATUS_LABEL[status]}
    </span>
  );
}

/** 워크플로 7단계 진행 표시 */
export function StatusStepper({ status }: { status: SessionStatus }) {
  const current = SESSION_STATUSES.indexOf(status);
  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
      {SESSION_STATUSES.map((s, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'todo';
        return (
          <li
            key={s}
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
            {STATUS_LABEL[s]}
          </li>
        );
      })}
    </ol>
  );
}
