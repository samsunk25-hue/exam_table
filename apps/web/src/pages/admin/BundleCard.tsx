import { useMemo, useState } from 'react';
import {
  BUNDLE_SHEETS,
  SLOT_FIELDS,
  TEACHER_FIELDS,
  analyzeBundle,
  buildSampleSchool,
  isSetupEditable,
  sessionTerm,
  termKey,
  termLabel,
  termFields,
  timetableTableRows,
  type BaseTimetableDoc,
  type BundleKey,
  type RoomDoc,
  type SlotDoc,
  type TeacherDoc,
  type WithId,
} from '@sim/shared';
import { Modal } from '@/components/Modal';
import { Alert, Button, Card, DownloadButton, Spinner, CardTitle } from '@/components/ui';
import { RosterImportDialog, rememberTerm, type RosterKind } from '@/components/TermRoster';
import { useCollection } from '@/lib/data';
import { Readiness } from './Readiness';
import { bundleSheets, replacePreview, saveBundle, type SaveMode } from '@/lib/bundle';
import { callAiExtract, errorMessage, type AiPart, type AiSlotRow, type AiTeacherRow, type AiTimetableRow } from '@/lib/firebase';
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
  timetable: BUNDLE_SHEETS.timetable,
};

function BundleImportDialog({
  session,
  editable,
  teachers,
  rooms,
  slots,
  timetable,
  onClose,
  initialSheets,
  notes,
}: Props & { onClose: () => void; /** AI가 문서에서 읽은 자료 (파일 선택 없이 바로 검증) */ initialSheets?: SheetData[]; notes?: string[] }) {
  const [sheets, setSheets] = useState<SheetData[] | null>(initialSheets ?? null);
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
      setDone(await saveBundle(session.id, analysis.plan, ctx, { autoPlace: editable, mode, term: termFields(sessionTerm(session)) }));
      // 교사·시험실·시험일정 탭이 이 학기를 바로 보여 주게
      rememberTerm(termKey(sessionTerm(session)));
    } catch (e) {
      setError(`저장 중 오류가 발생했습니다: ${errorMessage(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={initialSheets ? 'AI가 읽은 자료 확인·저장' : '기초 자료 통합 양식 업로드'} onClose={onClose} wide>
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
          {initialSheets ? (
            <Alert tone="info">
              <p className="font-semibold">AI가 문서에서 읽은 내용입니다. 아래 검증 결과를 확인하고 저장하세요.</p>
              {notes && notes.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-sm">
                  {notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
              <p className="mt-1 text-sm">잘못 읽은 부분은 저장한 뒤 준비 단계의 시험 일정·교사 명단에서 고치거나, 되돌리기로 취소할 수 있습니다.</p>
            </Alert>
          ) : (
          <label className="flex flex-col gap-1.5">
            <span className="font-semibold">통합 양식 파일 선택 (.xlsx)</span>
            <input
              type="file"
              accept=".xlsx,.xls"
              className="min-h-12 rounded-xl border border-dashed border-line bg-bg p-3 file:mr-3 file:min-h-10 file:cursor-pointer file:rounded-lg file:border-0 file:bg-primary file:px-4 file:font-semibold file:text-white file:transition-colors hover:border-primary hover:bg-primary-soft hover:file:bg-primary-strong active:file:scale-[0.98] cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-primary"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
          </label>
          )}

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


const MAX_BYTES = 7 * 1024 * 1024;
const TYPE_OF: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', txt: 'text/plain', csv: 'text/csv' };

const toBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

/** "월1 1-3 국어" → 수업 한 칸 (못 읽으면 null) */
function parseLesson(text: string) {
  const m = text.trim().match(/^([월화수목금])\s*(\d{1,2})(?:교시)?\s+(\d)\s*-\s*(\d{1,2})(?:\s+(.+))?$/);
  if (!m) return null;
  return { weekday: '월화수목금'.indexOf(m[1]!) + 1, period: Number(m[2]), grade: Number(m[3]), classNo: Number(m[4]), subject: m[5]?.trim() || null };
}

/** AI가 읽은 표 → 통합 양식 시트 (기존 검증·저장 과정을 그대로 쓴다). 기초시간표는 전체 시간표 한 장 */
function toSheets(slots: AiSlotRow[], teachers: AiTeacherRow[], timetable: AiTimetableRow[]): { sheets: SheetData[]; ttTeachers: number; lessons: number; skipped: string[] } {
  const sheets: SheetData[] = [];
  const skipped: string[] = [];
  let lessons = 0;
  let ttTeachers = 0;
  if (slots.length) {
    sheets.push({
      name: BUNDLE_SHEETS.slots,
      rows: [SLOT_FIELDS.map((f) => f.label), ...slots.map((s) => [s.date, s.period, s.startTime ?? null, s.endTime ?? null, s.grade, s.subject, s.type])],
    });
  }
  if (teachers.length) {
    const labels = TEACHER_FIELDS.map((f) => f.label);
    const at = (key: string) => TEACHER_FIELDS.findIndex((f) => f.key === key);
    sheets.push({
      name: BUNDLE_SHEETS.teachers,
      rows: [
        labels,
        ...teachers.map((t) => {
          const row: (string | number | null)[] = labels.map(() => null);
          row[at('name')] = t.name;
          row[at('email')] = t.email ?? null;
          row[at('subject')] = t.subject ?? null;
          row[at('homeroomGrade')] = t.homeroomGrade ?? null;
          row[at('homeroomClass')] = t.homeroomClass ?? null;
          return row;
        }),
      ],
    });
  }
  const tt = timetable.flatMap((t) => {
    const entries = t.lessons.flatMap((l) => {
      const e = parseLesson(l);
      if (!e) skipped.push(`${t.teacher} "${l}"`);
      return e ? [e] : [];
    });
    return entries.length ? [{ name: t.teacher.trim(), entries }] : [];
  });
  for (const t of tt) {
    lessons += t.entries.length;
    ttTeachers++;
  }
  if (tt.length) sheets.push({ name: BUNDLE_SHEETS.timetable, rows: timetableTableRows(tt) });
  return { sheets, ttTeachers, lessons, skipped };
}

/** 학교 문서(PDF·사진·글)를 AI로 읽어 시험 일정·교사 명단·기초시간표 자료로 만든다 */
function AiExtractDialog({ year, onClose, onRead }: { year: number; onClose: () => void; onRead: (r: { sheets: SheetData[]; notes: string[] }) => void }) {
  const [parts, setParts] = useState<Set<AiPart>>(new Set(['schedule', 'teachers', 'timetable']));
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = files.reduce((s, f) => s + f.size, 0);

  const read = async () => {
    setError(null);
    const ext = (f: File) => f.name.split('.').pop()?.toLowerCase() ?? '';
    const isExcel = (f: File) => ext(f) === 'xlsx' || ext(f) === 'xls';
    const bad = files.find((f) => !TYPE_OF[ext(f)] && !isExcel(f));
    if (bad) return setError(`"${bad.name}"은(는) 읽을 수 없는 형식입니다. 엑셀·PDF·사진(PNG·JPG)·글(TXT·CSV)로 올려 주세요. 한글(HWP)은 PDF로 저장해서 올리세요.`);
    if (total > MAX_BYTES) return setError('파일이 너무 큽니다 (모두 합쳐 7MB까지). 필요한 쪽만 PDF로 저장하거나 사진 크기를 줄여 주세요.');
    if (!parts.size) return setError('읽을 자료를 하나 이상 골라 주세요.');
    if (!files.length && !text.trim()) return setError('파일을 고르거나 내용을 붙여 넣어 주세요.');
    setBusy(true);
    try {
      // 엑셀은 브라우저에서 시트별 표 글로 바꿔 보낸다 (AI는 엑셀 파일을 직접 읽지 못함)
      const cell = (c: unknown) => (c instanceof Date ? c.toISOString().slice(0, 10) : String(c ?? ''));
      const excelText = (
        await Promise.all(
          files.filter(isExcel).map(async (f) =>
            (await readWorkbook(f))
              .map((sh) => `[${f.name} · ${sh.name} 시트]\n${sh.rows.map((r) => r.map(cell).join('\t')).join('\n')}`)
              .join('\n\n'),
          ),
        )
      ).join('\n\n');
      const payload = await Promise.all(
        files.filter((f) => !isExcel(f)).map(async (f) => ({ name: f.name, mediaType: TYPE_OF[ext(f)]!, data: await toBase64(f) })),
      );
      const allText = [excelText, text.trim()].filter(Boolean).join('\n\n');
      const { data } = await callAiExtract({ parts: [...parts], files: payload, text: allText || undefined, year });
      const timetable = data.timetable ?? [];
      if (!data.slots.length && !data.teachers.length && !timetable.length) {
        setError(`읽어 낸 자료가 없습니다.${data.notes.length ? ` (${data.notes.join(' / ')})` : ''}`);
        setBusy(false);
        return;
      }
      const out = toSheets(data.slots, data.teachers, timetable);
      const read = [
        parts.has('schedule') && `시험 ${data.slots.length}건`,
        parts.has('teachers') && `교사 ${data.teachers.length}명`,
        parts.has('timetable') && `기초시간표 교사 ${out.ttTeachers}명(수업 ${out.lessons}건)`,
      ].filter(Boolean);
      onRead({
        sheets: out.sheets,
        notes: [
          `${read.join(' · ')}을 읽었습니다.`,
          ...(out.lessons ? ['기초시간표는 저장하면 이 프로젝트의 기초시간표 전체가 읽은 내용으로 바뀝니다. 일부 교사만 읽혔다면 저장 전에 확인하세요.'] : []),
          ...(out.skipped.length ? [`읽지 못한 수업 ${out.skipped.length}칸: ${out.skipped.slice(0, 5).join(', ')}${out.skipped.length > 5 ? ' …' : ''}`] : []),
          ...data.notes,
        ],
      });
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Modal title="학교 문서에서 AI로 읽기" onClose={() => !busy && onClose()} wide>
      <div className="grid gap-4">
        <p className="text-muted">
          교육계획서의 시험 시간표, 업무 분장표·담임 배정표, 교사별·학급별 시간표 같은 문서를 올리면 AI가 시험 일정, 교사 명단(담당 교과·담임반), 기초시간표를 읽어
          통합 양식처럼 채워 줍니다. 저장 전에 검증 결과를 확인할 수 있습니다.
        </p>
        <fieldset>
          <legend className="mb-2 font-semibold">
            무엇을 읽을까요? <span className="font-normal text-muted">(여러 개 고를 수 있고, 문서에 없는 자료는 비워 둡니다)</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['schedule', '시험 일정'],
                ['teachers', '교사 명단'],
                ['timetable', '기초시간표'],
              ] as const
            ).map(([k, l]) => (
              <Button
                key={k}
                variant={parts.has(k) ? 'primary' : 'secondary'}
                aria-pressed={parts.has(k)}
                onClick={() => {
                  const next = new Set(parts);
                  if (next.has(k)) next.delete(k);
                  else next.add(k);
                  setParts(next);
                }}
              >
                {parts.has(k) ? '✓ ' : ''}
                {l}
              </Button>
            ))}
          </div>
        </fieldset>
        <label className="flex flex-col gap-1.5">
          <span className="font-semibold">문서 파일 (엑셀·PDF·사진, 여러 개 가능)</span>
          <input
            type="file"
            multiple
            accept=".xlsx,.xls,.pdf,.png,.jpg,.jpeg,.webp,.txt,.csv"
            className="min-h-12 rounded-xl border border-dashed border-line bg-bg p-3 file:mr-3 file:min-h-10 file:cursor-pointer file:rounded-lg file:border-0 file:bg-primary file:px-4 file:font-semibold file:text-white file:transition-colors hover:border-primary hover:bg-primary-soft hover:file:bg-primary-strong active:file:scale-[0.98] cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-primary"
            onChange={(e) => setFiles([...(e.target.files ?? [])].slice(0, 4))}
          />
          <span className="text-sm text-muted">한글(HWP) 파일은 "PDF로 저장"한 뒤 올리세요. 최대 4개, 합쳐서 7MB까지{files.length ? ` · 지금 ${(total / 1024 / 1024).toFixed(1)}MB` : ''}.</span>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="font-semibold">또는 내용 붙여 넣기</span>
          <textarea
            aria-label="문서 내용 붙여 넣기"
            rows={4}
            className="rounded-xl border border-line p-3"
            placeholder="예: 10월 12일(월) 1교시 1학년 국어 2학년 수학 …  /  김민준 국어 1-1 담임 …"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        {error && <Alert>{error}</Alert>}
        <div className="flex gap-2">
          <Button onClick={() => void read()} disabled={busy}>
            {busy ? 'AI가 읽는 중… (30초~2분)' : 'AI로 읽기'}
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            취소
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** 필요한 자료를 직접 불러오는 통합 양식 카드 (개요 탭용) */
/** 교사 명단·시험실 화면에서 바로: 통합 양식(엑셀) 올리기 */
export function BundleUploadButton({ session }: { session: ExamSession }) {
  const [open, setOpen] = useState(false);
  const termTeachers = useCollection<TeacherDoc>('teachers', termWhere(session));
  const rooms = useCollection<RoomDoc>('rooms', termWhere(session));
  const slots = useCollection<SlotDoc>(`sessions/${session.id}/slots`);
  const timetable = useCollection<BaseTimetableDoc>(`sessions/${session.id}/baseTimetable`);
  const editable = isSetupEditable(session.status);
  const ready = ![termTeachers, rooms, slots, timetable].some((x) => x.loading);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} disabled={!editable || !ready}>
        엑셀(통합 양식) 올리기
      </Button>
      {open && (
        <BundleImportDialog
          session={session}
          editable={editable}
          teachers={termTeachers.data.filter((t) => !t.temporary)}
          rooms={rooms.data}
          slots={slots.data}
          timetable={timetable.data}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export function BundleSection({ session }: { session: ExamSession }) {
  const termTeachers = useCollection<TeacherDoc>('teachers', termWhere(session));
  // 통합 양식·점검은 정식 교사만 (임시 감독자 제외)
  const teachers = { ...termTeachers, data: termTeachers.data.filter((t) => !t.temporary) };
  const rooms = useCollection<RoomDoc>('rooms', termWhere(session));
  const slots = useCollection<SlotDoc>(`sessions/${session.id}/slots`);
  const timetable = useCollection<BaseTimetableDoc>(`sessions/${session.id}/baseTimetable`);
  const all = [teachers, rooms, slots, timetable];
  if (all.some((x) => x.loading)) return <Spinner />;
  const error = all.find((x) => x.error)?.error;
  if (error) return <Alert>{error}</Alert>;
  return (
    <>
      {/* 진행 단계 바로 아래: 기초 자료 한 번에 입력 → 기초 자료 점검 (지난 학기 명단은 프로젝트를 만들 때 자동으로 이어받음) */}
      <BundleCard
        session={session}
        editable={isSetupEditable(session.status)}
        teachers={teachers.data}
        rooms={rooms.data}
        slots={slots.data}
        timetable={timetable.data}
      />
      <Readiness session={session} slots={slots.data} rooms={rooms.data} teachers={teachers.data} timetable={timetable.data} />
    </>
  );
}

export function BundleCard(props: Props) {
  const [importing, setImporting] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiResult, setAiResult] = useState<{ sheets: SheetData[]; notes: string[] } | null>(null);
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
      <CardTitle icon="📦">기초 자료 한 번에 입력</CardTitle>
      <p className="mt-1 text-muted">
        교사 · 시험실 · 시험 일정 · 시험실 배치{session.settings.useBaseTimetable ? ' · 전체 기초시간표' : ''}를 엑셀 파일 하나에 작성해 한 번에 올립니다.
        현재 등록된 자료가 채워진 양식이 내려받아집니다.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <DownloadButton variant="primary" onDownload={download}>
          통합 양식 다운로드
        </DownloadButton>
        <Button variant="secondary" onClick={() => setImporting(true)}>
          통합 양식 업로드
        </Button>
        <Button variant="secondary" onClick={() => setAiOpen(true)} disabled={!props.editable}>
          📄 학교 문서에서 AI로 읽기
        </Button>
        {/* 샘플 설명은 샘플 버튼 바로 오른쪽에 */}
        <div className="flex min-w-0 flex-1 basis-80 flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
          <span className="shrink-0">
            <DownloadButton onDownload={downloadSample}>샘플 양식 (교사 25명)</DownloadButton>
          </span>
          <p className="min-w-0 text-sm text-muted">
            교사 25명과 기초시간표 · 3학년 × 3반(교실마다 정·부감독) · 다음 주 월요일부터 3일, 하루 3교시(1·2교시 시험 45분 + 쉬는 시간 15분, 3교시 자습). 작성 방법을 보거나
            연습용으로 쓰세요. 그대로 올리면 가상 교사 25명이 실제로 등록됩니다.
          </p>
        </div>
      </div>
      {importing && <BundleImportDialog {...props} onClose={() => setImporting(false)} />}
      {aiOpen && (
        <AiExtractDialog
          year={session.year}
          onClose={() => setAiOpen(false)}
          onRead={(r) => {
            setAiOpen(false);
            setAiResult(r);
          }}
        />
      )}
      {aiResult && <BundleImportDialog {...props} initialSheets={aiResult.sheets} notes={aiResult.notes} onClose={() => setAiResult(null)} />}
    </Card>
  );
}
