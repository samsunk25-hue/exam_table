import { useMemo, useState } from 'react';
import {
  BUNDLE_SHEETS,
  analyzeBundle,
  buildSampleSchool,
  isSetupEditable,
  type BaseTimetableDoc,
  type BundleKey,
  type RoomDoc,
  type SlotDoc,
  type TeacherDoc,
  type WithId,
} from '@sim/shared';
import { Modal } from '@/components/Modal';
import { Alert, Button, Card, DownloadButton, Spinner } from '@/components/ui';
import { useCollection } from '@/lib/data';
import { Readiness } from './Readiness';
import { bundleSheets, saveBundle } from '@/lib/bundle';
import { errorMessage } from '@/lib/firebase';
import type { ExamSession } from '@/lib/sessions';
import { downloadWorkbook, readWorkbook, type SheetData } from '@/lib/xlsx';

interface Props {
  session: ExamSession;
  editable: boolean;
  teachers: WithId<TeacherDoc>[];
  rooms: WithId<RoomDoc>[];
  slots: WithId<SlotDoc>[];
  timetable: WithId<BaseTimetableDoc>[];
}

const SHEET_OF: Record<BundleKey, string> = {
  teachers: BUNDLE_SHEETS.teachers,
  rooms: BUNDLE_SHEETS.rooms,
  slots: BUNDLE_SHEETS.slots,
  placements: BUNDLE_SHEETS.placements,
  timetable: '교사별 시간표',
};

function BundleImportDialog({ session, editable, teachers, rooms, slots, timetable, onClose }: Props & { onClose: () => void }) {
  const [sheets, setSheets] = useState<SheetData[] | null>(null);
  const [autoPlace, setAutoPlace] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string[] | null>(null);

  const analysis = useMemo(
    () =>
      sheets
        ? analyzeBundle(sheets, {
            teachers,
            rooms,
            slots,
            useBaseTimetable: session.settings.useBaseTimetable,
            scheduleEditable: editable,
          })
        : null,
    [sheets, teachers, rooms, slots, session.settings.useBaseTimetable, editable],
  );
  const anything = analysis?.sections.some((s) => s.present) ?? false;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      setSheets(await readWorkbook(file));
    } catch (e) {
      setError(`파일을 읽을 수 없습니다: ${errorMessage(e)}`);
    }
  };

  const save = async () => {
    if (!analysis) return;
    setBusy(true);
    setError(null);
    try {
      setDone(await saveBundle(session.id, analysis.plan, { rooms, slots, timetable }, { autoPlace: autoPlace && editable }));
    } catch (e) {
      setError(`저장 중 오류가 발생했습니다: ${errorMessage(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="기초 자료 통합 양식 업로드" onClose={onClose} wide>
      {done ? (
        <div className="grid gap-4">
          <Alert tone="info">
            <p className="font-semibold">저장했습니다.</p>
            <ul className="mt-1 list-disc pl-5">
              {done.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </Alert>
          <Button onClick={onClose}>닫기</Button>
        </div>
      ) : (
        <div className="grid gap-5">
          <label className="flex flex-col gap-1.5">
            <span className="font-semibold">통합 양식 파일 선택 (.xlsx)</span>
            <input
              type="file"
              accept=".xlsx,.xls"
              className="min-h-12 rounded-xl border border-dashed border-line bg-bg p-3 file:mr-3 file:min-h-10 file:rounded-lg file:border-0 file:bg-primary file:px-4 file:font-semibold file:text-white"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
          </label>

          {analysis && (
            <section className="grid gap-3">
              <h3 className="font-semibold">
                검증 결과 —{' '}
                <span className={analysis.errorCount ? 'text-alert' : ''}>오류 {analysis.errorCount}건</span>
              </h3>
              {analysis.sections.map((s) => {
                const r = s.result;
                const errorRows = r?.rows.filter((x) => x.errors.length) ?? [];
                const ok = r ? r.rows.filter((x) => x.value).length : 0;
                const failed = r && (r.errorCount > 0 || r.fileErrors.length > 0);
                return (
                  <div
                    key={s.key}
                    className={`rounded-xl border px-4 py-3 ${failed ? 'border-alert bg-alert-soft' : 'border-line'}`}
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-bold">
                        {s.label} <span className="text-sm font-normal text-muted">({SHEET_OF[s.key]} 시트)</span>
                      </span>
                      <span className="text-sm">
                        {!s.present ? '변경 없음' : failed ? `오류 ${r!.errorCount + r!.fileErrors.length}건` : `${ok}건 저장 예정`}
                      </span>
                    </div>
                    {s.notes.map((n) => (
                      <p key={n} className="mt-1 text-sm text-muted">
                        {n}
                      </p>
                    ))}
                    {r?.fileErrors.map((e) => (
                      <p key={e} className="mt-1 font-semibold text-[#c0392b]">
                        {e}
                      </p>
                    ))}
                    {errorRows.length > 0 && (
                      <ul className="mt-2 max-h-48 overflow-auto text-sm">
                        {errorRows.slice(0, 100).map((x, i) => (
                          <li key={i} className="border-t border-line py-1">
                            <span className="mr-2 text-muted">{x.label ?? `${x.rowNumber}행`}</span>
                            <span className="font-semibold text-[#c0392b]">{x.errors.join(' ')}</span>
                          </li>
                        ))}
                        {errorRows.length > 100 && <li className="py-1 text-muted">외 {errorRows.length - 100}건</li>}
                      </ul>
                    )}
                  </div>
                );
              })}
              {editable && (
                <label className="flex min-h-12 items-center gap-3">
                  <input type="checkbox" className="size-5 accent-primary" checked={autoPlace} onChange={(e) => setAutoPlace(e.target.checked)} />
                  <span>저장 후 시험실 배치가 없는 시험은 같은 학년 교실·복도로 자동 배치</span>
                </label>
              )}
              {!anything && <Alert>파일에서 저장할 내용을 찾지 못했습니다. 통합 양식의 시트 이름을 바꾸지 않았는지 확인해 주세요.</Alert>}
            </section>
          )}

          {error && <Alert>{error}</Alert>}

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void save()} disabled={busy || !analysis || analysis.errorCount > 0 || !anything}>
              {busy ? '저장 중…' : analysis?.errorCount ? '오류를 고친 뒤 다시 올려 주세요' : '저장'}
            </Button>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              취소
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** 필요한 자료를 직접 불러오는 통합 양식 카드 (개요 탭용) */
export function BundleSection({ session }: { session: ExamSession }) {
  const teachers = useCollection<TeacherDoc>('teachers');
  const rooms = useCollection<RoomDoc>('rooms');
  const slots = useCollection<SlotDoc>(`sessions/${session.id}/slots`);
  const timetable = useCollection<BaseTimetableDoc>(`sessions/${session.id}/baseTimetable`);
  const all = [teachers, rooms, slots, timetable];
  if (all.some((x) => x.loading)) return <Spinner />;
  const error = all.find((x) => x.error)?.error;
  if (error) return <Alert>{error}</Alert>;
  return (
    <>
      <Readiness session={session} slots={slots.data} rooms={rooms.data} teachers={teachers.data} timetable={timetable.data} />
      <BundleCard
        session={session}
        editable={isSetupEditable(session.status)}
        teachers={teachers.data}
        rooms={rooms.data}
        slots={slots.data}
        timetable={timetable.data}
      />
    </>
  );
}

export function BundleCard(props: Props) {
  const [importing, setImporting] = useState(false);
  const { session, teachers, rooms, slots, timetable } = props;

  const download = () =>
    downloadWorkbook(
      `기초자료_입력양식_${session.examName.replace(/\s+/g, '')}.xlsx`,
      bundleSheets({ teachers, rooms, slots, timetable, useBaseTimetable: session.settings.useBaseTimetable }),
    );

  // 교사 25명 중학교 예시: 3일 × 하루 3교시(1·2교시 시험 45분 + 휴식 15분, 3교시 자습)
  const downloadSample = () => {
    const firstMonday = (() => {
      const d = new Date();
      d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    })();
    const sample = buildSampleSchool(firstMonday);
    return downloadWorkbook(
      '기초자료_샘플_교사25명.xlsx',
      bundleSheets({ ...sample, useBaseTimetable: session.settings.useBaseTimetable, blankTeacherIds: true }),
    );
  };

  return (
    <Card>
      <h2 className="text-lg font-bold">기초 자료 한 번에 입력</h2>
      <p className="mt-1 text-muted">
        교사 · 시험실 · 시험 일정 · 시험실 배치{session.settings.useBaseTimetable ? ' · 교사별 기초시간표' : ''}를 엑셀 파일 하나에 작성해 한 번에 올립니다.
        현재 등록된 자료가 채워진 양식이 내려받아집니다.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <DownloadButton variant="primary" onDownload={download}>
          통합 양식 다운로드
        </DownloadButton>
        <Button variant="secondary" onClick={() => setImporting(true)}>
          통합 양식 업로드
        </Button>
        <DownloadButton onDownload={downloadSample}>샘플 양식 (교사 25명)</DownloadButton>
      </div>
      <p className="mt-2 text-sm text-muted">
        샘플: 교사 25명 · 3학년 × 4반 · 다음 주 월요일부터 3일, 하루 3교시(1·2교시 시험 45분 + 쉬는 시간 15분, 3교시 자습). 작성 방법을 보거나 연습용으로
        쓰세요. 그대로 올리면 가상 교사 25명이 실제로 등록됩니다.
      </p>
      {importing && <BundleImportDialog {...props} onClose={() => setImporting(false)} />}
    </Card>
  );
}
