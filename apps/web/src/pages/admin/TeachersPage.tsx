import { Link } from 'react-router';
import { useMemo, useState, type FormEvent } from 'react';
import {
  DEFAULT_ROLE_LABEL,
  SELECTABLE_ROLES,
  nextId,
  parseTermKey,
  termFields,
  termKey,
  termLabel,
  type DefaultRole,
  type TeacherDoc,
  type TermRef,
  type WithId,
} from '@sim/shared';
import { Modal } from '@/components/Modal';
import { RosterImportDialog, useTerm } from '@/components/TermRoster';
import { Alert, Button, Card, Field, Select, Spinner, Table, Td, Empty } from '@/components/ui';
import { commitOps, ref, useCollection } from '@/lib/data';
import { errorMessage } from '@/lib/firebase';
import { BundleUploadButton } from './BundleCard';
import { useCurrentSession } from './SessionPage';
import { TempStaffCard } from './TempStaffCard';

type Teacher = WithId<TeacherDoc>;

function homeroomText(t: Pick<TeacherDoc, 'homeroom'>) {
  return t.homeroom ? `${t.homeroom.grade}-${t.homeroom.classNo}` : '';
}

function sortTeachers(list: Teacher[]): Teacher[] {
  return [...list].sort(
    (a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'ko') || a.id.localeCompare(b.id),
  );
}

interface FormState {
  name: string;
  email: string;
  subject: string;
  grade: string;
  classNo: string;
  defaultRole: DefaultRole;
  active: boolean;
}

const NEW_TERM = '__new';

function TeacherForm({
  teacher,
  everyone,
  terms,
  takenIds,
  term,
  onClose,
}: {
  teacher: Teacher | null;
  /** 모든 학교·학기 교사 (옮길 학교·학기에서 이메일·담임 중복 검사) */
  everyone: Teacher[];
  /** 고를 수 있는 학교·학기 */
  terms: TermRef[];
  takenIds: string[];
  term: TermRef;
  onClose: () => void;
}) {
  // 소속 학교·학기: 바꾸면 그 학교·학기 명단으로 옮긴다
  const [target, setTarget] = useState(termKey(term));
  const [custom, setCustom] = useState<TermRef>({ school: '', year: term.year, semester: term.semester });
  const targetTerm: TermRef = target === NEW_TERM ? { ...custom, school: custom.school.trim() } : (parseTermKey(target) ?? term);
  const moving = Boolean(teacher) && termKey(targetTerm) !== termKey(term);
  const otherSchoolOrYear = targetTerm.school !== term.school || targetTerm.year !== term.year;
  const all = everyone.filter((t) => t.term === termKey(targetTerm));
  const [f, setF] = useState<FormState>({
    name: teacher?.name ?? '',
    email: teacher?.email ?? '',
    subject: teacher?.subject ?? '',
    grade: teacher?.homeroom ? String(teacher.homeroom.grade) : '',
    classNo: teacher?.homeroom ? String(teacher.homeroom.classNo) : '',
    // 예전 "감독제외"는 일반 + 사용 안 함으로 보여준다
    defaultRole: teacher?.defaultRole === 'HALLWAY' ? 'HALLWAY' : 'NORMAL',
    active: (teacher?.active ?? true) && teacher?.defaultRole !== 'EXCLUDED',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (patch: Partial<FormState>) => setF({ ...f, ...patch });

  const validate = (): string | null => {
    const email = f.email.trim().toLowerCase();
    if (!f.name.trim()) return '이름을 입력해 주세요.';
    if (target === NEW_TERM && !custom.school.trim()) return '옮길 학교명을 입력해 주세요.';
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '이메일 형식이 아닙니다.';
    const dup = all.find((t) => t.id !== teacher?.id && email && t.email === email);
    if (dup) return `${dup.name} 교사가 이미 이 이메일을 사용 중입니다.`;
    if (Boolean(f.grade) !== Boolean(f.classNo)) return '담임학년과 담임반은 함께 입력해 주세요.';
    if (f.grade && f.active) {
      const same = all.find(
        (t) => t.id !== teacher?.id && t.active && t.homeroom?.grade === Number(f.grade) && t.homeroom.classNo === Number(f.classNo),
      );
      if (same) return `${f.grade}-${f.classNo}반 담임은 이미 ${same.name} 교사입니다.`;
    }
    return null;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = validate();
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    const data = {
      name: f.name.trim(),
      email: f.email.trim().toLowerCase() || null,
      subject: f.subject.trim() || null,
      homeroom: f.grade ? { grade: Number(f.grade), classNo: Number(f.classNo) } : null,
      defaultRole: f.defaultRole,
      active: f.active,
      ...termFields(targetTerm),
      // 다른 학교나 학년도로 옮기면 누적 업무점수는 그 학교·학년도 기준으로 새로 센다
      ...(moving && otherSchoolOrYear ? { cumulativeLoad: 0 } : {}),
    };
    try {
      if (teacher)
        await commitOps(
          [{ type: 'set', ref: ref('teachers', teacher.id), data, merge: true }],
          moving ? `교사 이동: ${data.name} → ${termLabel(targetTerm)}` : '교사 수정',
        );
      else {
        const [id] = nextId('T', takenIds);
        await commitOps([{ type: 'set', ref: ref('teachers', id!), data: { ...data, cumulativeLoad: 0 } }], '교사 추가');
      }
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await commitOps([{ type: 'delete', ref: ref('teachers', teacher!.id) }], '교사 삭제');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal title={teacher ? `교사 수정 (${teacher.id})` : '교사 추가'} onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} className="grid gap-4">
        <Field label="이름" required value={f.name} onChange={(e) => set({ name: e.target.value })} />
        <Field
          label="이메일"
          type="email"
          hint="로그인에 쓰는 Google 계정. 비우면 교사 화면을 쓸 수 없습니다."
          value={f.email}
          onChange={(e) => set({ email: e.target.value })}
        />
        <Field label="담당교과" value={f.subject} onChange={(e) => set({ subject: e.target.value })} />
        <div className="grid gap-2 rounded-xl bg-bg p-3">
          <label className="grid gap-1">
            <span className="font-semibold">소속 학교·학기</span>
            <select
              aria-label="소속 학교·학기"
              className="min-h-12 rounded-xl border border-line bg-surface px-3"
              value={target}
              onChange={(e) => {
                setTarget(e.target.value);
                // 다른 학교로 옮기면 담임 정보는 비운다 (그 학교 반이 아니므로)
                const next = e.target.value === NEW_TERM ? null : parseTermKey(e.target.value);
                if (!next || next.school !== term.school) set({ grade: '', classNo: '' });
              }}
            >
              {terms.map((t) => (
                <option key={termKey(t)} value={termKey(t)}>
                  {termLabel(t)}
                  {termKey(t) === termKey(term) ? ' (현재)' : ''}
                </option>
              ))}
              <option value={NEW_TERM}>다른 학교·학기 직접 입력…</option>
            </select>
          </label>
          {target === NEW_TERM && (
            <div className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr]">
              <Field label="학교명" value={custom.school} onChange={(e) => setCustom({ ...custom, school: e.target.value })} />
              <Field label="학년도" type="number" value={custom.year} onChange={(e) => setCustom({ ...custom, year: Number(e.target.value) })} />
              <Select
                label="학기"
                value={String(custom.semester)}
                onChange={(e) => setCustom({ ...custom, semester: Number(e.target.value) })}
                options={[
                  { value: '1', label: '1학기' },
                  { value: '2', label: '2학기' },
                ]}
              />
            </div>
          )}
          {moving && (
            <p className="text-sm text-alert">
              저장하면 {termLabel(targetTerm)} 명단으로 옮겨집니다. 지금 학기 시험 프로젝트의 배정·불가시간에서는 빠지니, 배정된 감독이 있으면 시간표 편집에서 다시
              채워 주세요.{otherSchoolOrYear ? ' 다른 학교·학년도라 누적 업무점수는 0점부터 다시 셉니다.' : ''}
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="담임학년" type="number" min={1} max={6} value={f.grade} onChange={(e) => set({ grade: e.target.value })} />
          <Field label="담임반" type="number" min={1} max={30} value={f.classNo} onChange={(e) => set({ classNo: e.target.value })} />
        </div>
        <Select
          label="감독구분 (정·부감독은 자동 배정이 정합니다)"
          value={f.defaultRole}
          onChange={(e) => set({ defaultRole: e.target.value as DefaultRole })}
          options={SELECTABLE_ROLES.map((value) => ({
            value,
            label: `${DEFAULT_ROLE_LABEL[value]} — ${value === 'HALLWAY' ? '복도에만 배정' : '교실·복도 모두 가능'}`,
          }))}
        />
        <label className="flex min-h-12 items-start gap-3">
          <input type="checkbox" className="mt-1 size-5 accent-primary" checked={f.active} onChange={(e) => set({ active: e.target.checked })} />
          <span>
            <span className="font-semibold">사용 (감독 배정 대상)</span>
            <span className="block text-sm text-muted">끄면 감독 배정과 교사 화면 로그인에서 빠집니다 (관리자·전출·휴직 등). 지난 기록은 남습니다.</span>
          </span>
        </label>
        {error && <Alert>{error}</Alert>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>
            저장
          </Button>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            취소
          </Button>
          {teacher &&
            (confirmDelete ? (
              <Button type="button" variant="danger" onClick={() => void remove()} disabled={busy}>
                정말 삭제
              </Button>
            ) : (
              <Button type="button" variant="ghost" className="ml-auto" onClick={() => setConfirmDelete(true)}>
                삭제
              </Button>
            ))}
        </div>
        {confirmDelete && (
          <p className="text-sm text-muted">
            지난 시험의 배정 기록이 있는 교사는 삭제 대신 "사용"을 끄는 것을 권장합니다.
          </p>
        )}
      </form>
    </Modal>
  );
}

export function TeachersPage() {
  const everyone = useCollection<TeacherDoc>('teachers');
  const { loading, error } = everyone;
  const choice = useTerm(); // 이 프로젝트의 학교·학기
  const session = useCurrentSession();
  // 선택한 학교·학기 명단만 보여 준다
  const data = useMemo(() => everyone.data.filter((t) => t.term === choice.key), [everyone.data, choice.key]);
  const legacy = everyone.data.filter((t) => !t.term).length;
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Teacher | 'new' | null>(null);
  const [importing, setImporting] = useState(false);

  const teachers = useMemo(() => sortTeachers(data), [data]);
  const shown = teachers.filter((t) => {
    const q = search.trim().toLowerCase();
    return !q || [t.name, t.email, t.subject, homeroomText(t)].some((v) => v?.toLowerCase().includes(q));
  });

  const activeCount = data.filter((t) => t.active).length;
  const noEmail = data.filter((t) => t.active && !t.email).length;

  return (
    <>
      <div className="mb-4">
        <h2 className="text-xl font-bold">교사 명단</h2>
        <p className="text-muted">{choice.current ? `${termLabel(choice.current)} · 사용 중 ${activeCount}명 / 전체 ${data.length}명` : '교사 명단'}</p>
      </div>

      {!choice.loading && !choice.current && (
        <div className="mb-4">
          <Alert tone="info">먼저 대시보드에서 시험 프로젝트를 만드세요. 프로젝트의 학교·학기별로 교사 명단을 따로 관리합니다.</Alert>
        </div>
      )}
      {legacy > 0 && choice.current && (
        <div className="mb-4">
          <Alert tone="info">학기가 지정되지 않은 예전 교사 {legacy}명이 있습니다. "다른 학기에서 불러오기"로 이 학기에 넣을 수 있습니다.</Alert>
        </div>
      )}


      {choice.current && (
        <div className="mb-4 flex flex-wrap gap-2">
          <Button onClick={() => setEditing('new')}>+ 교사 추가</Button>
          <BundleUploadButton session={session} />
          {/* 다른 학기 명단이나 학기 미지정 예전 자료가 있을 때만 */}
          {everyone.data.some((x) => x.term !== choice.key) && (
            <Button variant="secondary" onClick={() => setImporting(true)}>
              다른 학기에서 불러오기
            </Button>
          )}
          {/* 작업 기록은 ④ 변경 이력 한 곳에서 (학교 공통 보기로 연다) */}
          <Link to="../history?scope=school" relative="path" className="inline-flex min-h-12 items-center rounded-xl px-4 font-semibold text-ink hover:bg-bg">
            ↶ 작업 기록·되돌리기
          </Link>
        </div>
      )}

      {noEmail > 0 && (
        <div className="mb-4">
          <Alert tone="info">이메일이 없는 교사 {noEmail}명은 교사 화면(내 시간표, 불가시간 제출)을 쓸 수 없습니다.</Alert>
        </div>
      )}

      <Card>
        <input
          type="search"
          placeholder="이름·이메일·교과·담임반 검색"
          className="mb-3 min-h-12 w-full rounded-xl border border-line px-4 outline-none focus:border-primary"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {loading && <Spinner />}
        {error && <Alert>{error}</Alert>}
        {!loading && data.length === 0 && (
          <Empty icon="👩‍🏫" title="이 학기에 등록된 교사가 없습니다">
            위의 "엑셀(통합 양식) 올리기"나 "+ 교사 추가"로 넣으세요. 다른 학기 명단은 "다른 학기에서 불러오기"로 가져옵니다.
          </Empty>
        )}
        {shown.length > 0 && (
          <Table head={['이름', '이메일', '담당교과', '담임', '감독구분', '누적점수', '']}>
            {shown.map((t) => (
              <tr key={t.id} className={t.active ? '' : 'text-muted'}>
                <Td className="font-bold">
                  {t.name}
                  {!t.active && <span className="ml-2 text-sm font-normal">(사용 안 함)</span>}
                  {t.temporary && <span className="ml-2 rounded-full bg-bg px-2 py-0.5 text-xs font-normal text-muted">임시 감독자{t.note ? ` · ${t.note}` : ''}</span>}
                </Td>
                <Td>{t.email ?? <span className="text-alert">없음</span>}</Td>
                <Td>{t.subject}</Td>
                <Td>{homeroomText(t)}</Td>
                <Td>{DEFAULT_ROLE_LABEL[t.defaultRole]}</Td>
                <Td>{t.cumulativeLoad ?? 0}</Td>
                <Td>
                  <Button variant="ghost" onClick={() => setEditing(t)}>
                    수정
                  </Button>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <div className="mt-6">
        <TempStaffCard session={session} />
      </div>

      {editing && choice.current && (
        <TeacherForm
          teacher={editing === 'new' ? null : editing}
          everyone={everyone.data}
          terms={choice.terms}
          takenIds={everyone.data.map((t) => t.id)}
          term={choice.current}
          onClose={() => setEditing(null)}
        />
      )}
      {importing && choice.current && <RosterImportDialog kind="teachers" target={choice.current} all={everyone.data} onClose={() => setImporting(false)} />}
    </>
  );
}
