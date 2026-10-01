import { useMemo, useState } from 'react';
import {
  BUNDLE_SHEETS,
  analyzeBundle,
  buildSampleSchool,
  isSetupEditable,
  sessionTerm,
  termKey,
  termLabel,
  termFields,
  type BaseTimetableDoc,
  type BundleKey,
  type RoomDoc,
  type SlotDoc,
  type TeacherDoc,
  type WithId,
} from '@sim/shared';
import { Modal } from '@/components/Modal';
import { Alert, Button, Card, DownloadButton, Spinner } from '@/components/ui';
import { RosterImportDialog, rememberTerm, type RosterKind } from '@/components/TermRoster';
import { useCollection } from '@/lib/data';
import { Readiness } from './Readiness';
import { bundleSheets, replacePreview, saveBundle, type SaveMode } from '@/lib/bundle';
import { errorMessage } from '@/lib/firebase';
import { termWhere, type ExamSession } from '@/lib/sessions';
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
  const [asking, setAsking] = useState(false);
  // 새 ID가 다른 학기 명단과 겹치지 않게 전체 ID를 본다
  const allTeachers = useCollection<TeacherDoc>('teachers');
  const allRooms = useCollection<RoomDoc>('rooms');
  const takenIds = useMemo(() => [...allTeachers.data, ...allRooms.data].map((x) => x.id), [allTeachers.data, allRooms.data]);

  const analysis = useMemo(
    () =>
      sheets
        ? analyzeBundle(sheets, {
            teachers,
            rooms,
            slots,
            useBaseTimetable: session.settings.useBaseTimetable,
            scheduleEditable: editable,
            takenIds,
          })
        : null,
    [sheets, teachers, rooms, slots, session.settings.useBaseTimetable, editable, takenIds],
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

  const ctx = { teachers, rooms, slots, timetable };
  const gone = analysis ? replacePreview(analysis.plan, ctx) : null;
  const goneCount = gone ? gone.teachers.length + gone.rooms.length + gone.slots.length + gone.timetable.length : 0;

  const save = async (mode: SaveMode) => {
    if (!analysis) return;
    setAsking(false);
    setBusy(true);
    setError(null);
    try {
      setDone(await saveBundle(session.id, analysis.plan, ctx, { autoPlace: autoPlace && editable, mode, term: termFields(sessionTerm(session)) }));
      // 교사·시험실·시험일정 탭이 이 학기를 바로 보여 주게
      rememberTerm(termKey(sessionTerm(session)));
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
            <Button
              onClick={() => (goneCount > 0 ? setAsking(true) : void save('merge'))}
              disabled={busy || !analysis || analysis.errorCount > 0 || !anything}
            >
              {busy ? '저장 중…' : analysis?.errorCount ? '오류를 고친 뒤 다시 올려 주세요' : '저장'}
            </Button>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              취소
            </Button>
          </div>
        </div>
      )}

      {asking && gone && (
        <Modal title="기존 자료를 어떻게 할까요?" onClose={() => setAsking(false)}>
          <div className="grid gap-4">
            <p>이미 입력된 자료 중 이번 파일에 없는 것이 있습니다.</p>
            <ul className="list-disc rounded-xl bg-bg py-3 pr-3 pl-8">
              {gone.teachers.length > 0 && <li>교사 {gone.teachers.length}명 ({gone.teachers.slice(0, 3).map((t) => t.name).join(', ')}{gone.teachers.length > 3 ? ' …' : ''})</li>}
              {gone.rooms.length > 0 && <li>시험실 {gone.rooms.length}개 ({gone.rooms.slice(0, 3).map((r) => r.name).join(', ')}{gone.rooms.length > 3 ? ' …' : ''})</li>}
              {gone.slots.length > 0 && <li>시험 {gone.slots.length}건</li>}
              {gone.timetable.length > 0 && <li>기초시간표 교사 {gone.timetable.length}명</li>}
            </ul>
            <div className="grid gap-2">
              <Button variant="secondary" className="h-auto justify-start py-3 text-left" onClick={() => void save('merge')}>
                <span>
                  <span className="block">기존 자료 유지 (추가·수정만)</span>
                  <span className="block text-sm font-normal text-muted">위 자료는 그대로 두고, 파일에 있는 내용만 새로 넣거나 고칩니다.</span>
                </span>
              </Button>
              <Button variant="danger" className="h-auto justify-start py-3 text-left" onClick={() => void save('replace')}>
                <span>
                  <span className="block">기존 자료 지우고 파일 내용으로 바꾸기</span>
                  <span className="block text-sm font-normal">
                    위 시험실·시험·기초시간표는 삭제합니다. 교사는 지난 기록을 지키기 위해 삭제하지 않고 "사용 안 함"으로 바꿉니다.
                  </span>
                </span>
              </Button>
              <Button variant="ghost" onClick={() => setAsking(false)}>
                취소
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </Modal>
  );
}

/**
 * 이 프로젝트 학교·학기의 교사·시험실 명단이 비어 있으면, 교사 관리·시험실 관리 탭에 저장된
 * 다른 학기(또는 학기 미지정) 명단을 불러오게 한다.
 */
function RosterLoadCard({ session, teachers, rooms }: { session: ExamSession; teachers: number; rooms: number }) {
  const allTeachers = useCollection<TeacherDoc>('teachers');
  const allRooms = useCollection<RoomDoc>('rooms');
  const [kind, setKind] = useState<RosterKind | null>(null);
  const term = sessionTerm(session);
  const others = (list: { term?: string }[]) => list.some((d) => d.term !== termKey(term));
  const canTeachers = teachers === 0 && others(allTeachers.data);
  const canRooms = rooms === 0 && others(allRooms.data);
  if (!canTeachers && !canRooms) return null;
  return (
    <Card>
      <h2 className="text-lg font-bold">저장된 명단 불러오기</h2>
      <p className="mt-1 text-muted">
        {termLabel(term)}에 {[canTeachers && '교사', canRooms && '시험실'].filter(Boolean).join('·')} 명단이 없습니다. 교사 관리·시험실 관리에 저장된
        다른 학기 명단을 불러와 시작할 수 있습니다.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {canTeachers && <Button onClick={() => setKind('teachers')}>교사 명단 불러오기</Button>}
        {canRooms && <Button onClick={() => setKind('rooms')}>시험실 불러오기</Button>}
      </div>
      {kind && (
        <RosterImportDialog kind={kind} target={term} all={kind === 'teachers' ? allTeachers.data : allRooms.data} onClose={() => setKind(null)} />
      )}
    </Card>
  );
}

/** 필요한 자료를 직접 불러오는 통합 양식 카드 (개요 탭용) */
export function BundleSection({ session }: { session: ExamSession }) {
  const teachers = useCollection<TeacherDoc>('teachers', termWhere(session));
  const rooms = useCollection<RoomDoc>('rooms', termWhere(session));
  const slots = useCollection<SlotDoc>(`sessions/${session.id}/slots`);
  const timetable = useCollection<BaseTimetableDoc>(`sessions/${session.id}/baseTimetable`);
  const all = [teachers, rooms, slots, timetable];
  if (all.some((x) => x.loading)) return <Spinner />;
  const error = all.find((x) => x.error)?.error;
  if (error) return <Alert>{error}</Alert>;
  return (
    <>
      <RosterLoadCard session={session} teachers={teachers.data.length} rooms={rooms.data.length} />
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
