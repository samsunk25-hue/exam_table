import { useSearchParams } from 'react-router';
import { useMemo, useState } from 'react';
import type { RoomDoc, TeacherDoc } from '@sim/shared';
import { Alert, Button, Card, DownloadButton, Spinner, Table, Td } from '@/components/ui';
import { UndoHistory } from '@/components/UndoHistory';
import { ACTION_LABEL, TARGET_LABEL, changes, targetText, useAuditLogs, type AuditLog } from '@/lib/audit';
import { useCollection } from '@/lib/data';
import { sessionTitle } from '@/lib/sessions';
import { downloadWorkbook } from '@/lib/xlsx';
import { useCurrentSession } from './SessionPage';

function when(log: AuditLog) {
  const d = log.createdAt?.toDate();
  if (!d) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 변경 이력: 이 시험 프로젝트 / 학교 공통(교사·시험실·관리자) */
export function SessionHistoryPage() {
  const session = useCurrentSession();
  // 교사 명단·시험실에서 오면 학교 공통 기록으로 연다 (?scope=school)
  const [params] = useSearchParams();
  const [scope, setScope] = useState<'session' | 'school'>(params.get('scope') === 'school' ? 'school' : 'session');
  const [type, setType] = useState<string>('ALL');
  const logs = useAuditLogs(scope === 'session' ? `sessions/${session.id}/auditLogs` : 'auditLogs', scope);
  const users = useCollection<{ email: string }>('users');
  const teachers = useCollection<TeacherDoc>('teachers');
  const rooms = useCollection<RoomDoc>('rooms');

  const names = useMemo(() => {
    const t = new Map(teachers.data.map((x) => [x.id, x.name]));
    const r = new Map(rooms.data.map((x) => [x.id, x.name]));
    return { teacher: (id: string) => t.get(id) ?? id, room: (id: string) => r.get(id) ?? id };
  }, [teachers.data, rooms.data]);
  const who = useMemo(() => {
    const m = new Map(users.data.map((u) => [u.id, u.email]));
    return (log: AuditLog) =>
      log.userId ? (log.userId === 'system' ? '시스템' : m.get(log.userId) ?? log.userId) : log.lastEditor ? `${m.get(log.lastEditor) ?? log.lastEditor} (마지막 수정자)` : '알 수 없음';
  }, [users.data]);

  const types = [...new Set(logs.data.map((l) => l.targetType))];
  const shown = logs.data.filter((l) => type === 'ALL' || l.targetType === type);

  const download = () =>
    downloadWorkbook(`${sessionTitle(session)}_변경이력${scope === 'school' ? '_학교공통' : ''}.xlsx`, [
      {
        name: '변경 이력',
        rows: [
          ['시각', '누가', '종류', '대상', '변경', '바뀐 내용', '사유'],
          ...shown.map((l) => [
            l.createdAt?.toDate().toLocaleString('ko-KR') ?? '',
            who(l),
            TARGET_LABEL[l.targetType] ?? l.targetType,
            targetText(l, names),
            ACTION_LABEL[l.action],
            changes(l, names).join(' / '),
            l.reason ?? '',
          ]),
        ],
        widths: [20, 26, 12, 30, 10, 60, 30],
      },
    ]);

  return (
    <div className="grid gap-6">
      <Card>
        <UndoHistory
          key={scope}
          sessionId={scope === 'session' ? session.id : null}
          title={scope === 'session' ? '작업 기록·되돌리기 (이 시험 프로젝트)' : '작업 기록·되돌리기 (학교 공통: 교사·시험실)'}
        />
      </Card>
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant={scope === 'session' ? 'primary' : 'secondary'} onClick={() => (setScope('session'), setType('ALL'))}>
            이 시험 프로젝트
          </Button>
          <Button variant={scope === 'school' ? 'primary' : 'secondary'} onClick={() => (setScope('school'), setType('ALL'))}>
            학교 공통 (교사·시험실·관리자)
          </Button>
          <span className="mx-1 hidden h-8 w-px bg-line sm:block" />
          <DownloadButton onDownload={download} disabled={shown.length === 0}>
            엑셀로 받기
          </DownloadButton>
        </div>
        {types.length > 1 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {['ALL', ...types].map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={type === t}
                onClick={() => setType(t)}
                className={`min-h-10 cursor-pointer rounded-full px-4 text-sm font-semibold ${type === t ? 'bg-ink text-white' : 'border border-line hover:border-primary'}`}
              >
                {t === 'ALL' ? '전체' : (TARGET_LABEL[t] ?? t)} {t === 'ALL' ? logs.data.length : logs.data.filter((l) => l.targetType === t).length}
              </button>
            ))}
          </div>
        )}
        <p className="mt-3 text-sm text-muted">
          모든 변경은 서버가 자동으로 기록하며 고치거나 지울 수 없습니다. 감독 배정은 자동 배정 한 번에 수백 건이 바뀌므로 교사 공개 이후의 변경부터 한 건씩 기록합니다
          (그 전의 적용 내역은 "시험 프로젝트" 기록에 남습니다). 최근 300건까지 표시합니다.
        </p>
      </Card>

      <Card>
        {logs.loading && <Spinner />}
        {logs.error && <Alert>{logs.error}</Alert>}
        {!logs.loading && shown.length === 0 && <p className="text-muted">기록이 없습니다.</p>}
        {shown.length > 0 && (
          <Table head={['시각', '누가', '무엇을', '어떻게', '사유']}>
            {shown.map((l) => {
              const list = changes(l, names);
              return (
                <tr key={l.id}>
                  <Td className="whitespace-nowrap text-muted">{when(l)}</Td>
                  <Td className="text-sm">{who(l)}</Td>
                  <Td>
                    <div className="text-sm text-muted">{TARGET_LABEL[l.targetType] ?? l.targetType}</div>
                    <div className="font-semibold">{targetText(l, names)}</div>
                  </Td>
                  <Td>
                    <span
                      className={`rounded-full px-2 py-0.5 text-sm font-semibold ${
                        l.action === 'DELETE' ? 'bg-alert-soft' : l.action === 'CREATE' ? 'bg-mint-soft' : 'bg-primary-soft text-primary-strong'
                      }`}
                    >
                      {ACTION_LABEL[l.action]}
                    </span>
                    {list.length > 0 && (
                      <ul className="mt-1 text-sm">
                        {list.slice(0, 4).map((c) => (
                          <li key={c}>{c}</li>
                        ))}
                        {list.length > 4 && <li className="text-muted">외 {list.length - 4}건</li>}
                      </ul>
                    )}
                  </Td>
                  <Td className="text-sm">{l.reason ?? ''}</Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </div>
  );
}
