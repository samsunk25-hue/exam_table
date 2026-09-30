import { useCallback, useMemo, useState, type FormEvent } from 'react';
import {
  DEFAULT_ROLE_LABEL,
  TEACHER_FIELDS,
  nextId,
  parseTeachers,
  type Cell,
  type ColumnMapping,
  type DefaultRole,
  type TeacherDoc,
  type TeacherImport,
  type WithId,
} from '@sim/shared';
import { ImportWizard } from '@/components/ImportWizard';
import { Modal } from '@/components/Modal';
import { Alert, Button, Card, DownloadButton, Field, PageTitle, Select, Spinner, Table, Td } from '@/components/ui';
import { commitOps, ref, useCollection, type BatchOp } from '@/lib/data';
import { errorMessage } from '@/lib/firebase';
import { downloadTemplate } from '@/lib/xlsx';

type Teacher = WithId<TeacherDoc>;

function homeroomText(t: Pick<TeacherDoc, 'homeroom'>) {
  return t.homeroom ? `${t.homeroom.grade}-${t.homeroom.classNo}` : '';
}

function sortTeachers(list: Teacher[]): Teacher[] {
  return [...list].sort(
    (a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'ko') || a.id.localeCompare(b.id),
  );
}

function downloadTeacherTemplate(teachers: Teacher[]) {
  const rows =
    teachers.length > 0
      ? sortTeachers(teachers).map((t) => [
          t.id,
          t.name,
          t.email ?? '',
          t.subject ?? '',
          t.homeroom?.grade ?? '',
          t.homeroom?.classNo ?? '',
          DEFAULT_ROLE_LABEL[t.defaultRole],
          t.active ? 'Y' : 'N',
        ])
      : [
          ['', '김국어', 'kim@school.kr', '국어', 1, 1, '일반', 'Y'],
          ['', '박영어', 'park@school.kr', '영어', '', '', '복도대기', 'Y'],
        ];
  return downloadTemplate('교사명단_양식.xlsx', TEACHER_FIELDS, rows, [
    '* 교사ID가 있으면 해당 교사를 수정하고, 없으면 이메일 → 이름 순으로 기존 교사를 찾습니다. 못 찾으면 새로 등록합니다.',
    '* 업로드로 교사가 삭제되지는 않습니다. 삭제나 사용 중지는 화면에서 하세요.',
  ]);
}

async function saveImported(values: TeacherImport[], existing: Teacher[]): Promise<string> {
  const newIds = nextId('T', existing.map((t) => t.id), values.filter((v) => v.id === null).length);
  let n = 0;
  const ops: BatchOp[] = values.map(({ id, ...data }) =>
    id
      ? { type: 'set', ref: ref('teachers', id), data, merge: true }
      : { type: 'set', ref: ref('teachers', newIds[n++]!), data: { ...data, cumulativeLoad: 0 } },
  );
  await commitOps(ops);
  return `저장했습니다. 신규 ${n}명, 수정 ${values.length - n}명.`;
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

function TeacherForm({ teacher, all, onClose }: { teacher: Teacher | null; all: Teacher[]; onClose: () => void }) {
  const [f, setF] = useState<FormState>({
    name: teacher?.name ?? '',
    email: teacher?.email ?? '',
    subject: teacher?.subject ?? '',
    grade: teacher?.homeroom ? String(teacher.homeroom.grade) : '',
    classNo: teacher?.homeroom ? String(teacher.homeroom.classNo) : '',
    defaultRole: teacher?.defaultRole ?? 'NORMAL',
    active: teacher?.active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (patch: Partial<FormState>) => setF({ ...f, ...patch });

  const validate = (): string | null => {
    const email = f.email.trim().toLowerCase();
    if (!f.name.trim()) return '이름을 입력해 주세요.';
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
    };
    try {
      if (teacher) await commitOps([{ type: 'set', ref: ref('teachers', teacher.id), data, merge: true }]);
      else {
        const [id] = nextId('T', all.map((t) => t.id));
        await commitOps([{ type: 'set', ref: ref('teachers', id!), data: { ...data, cumulativeLoad: 0 } }]);
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
      await commitOps([{ type: 'delete', ref: ref('teachers', teacher!.id) }]);
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
        <div className="grid grid-cols-2 gap-3">
          <Field label="담임학년" type="number" min={1} max={6} value={f.grade} onChange={(e) => set({ grade: e.target.value })} />
          <Field label="담임반" type="number" min={1} max={30} value={f.classNo} onChange={(e) => set({ classNo: e.target.value })} />
        </div>
        <Select
          label="기본역할"
          value={f.defaultRole}
          onChange={(e) => set({ defaultRole: e.target.value as DefaultRole })}
          options={Object.entries(DEFAULT_ROLE_LABEL).map(([value, label]) => ({ value, label }))}
        />
        <label className="flex min-h-12 items-center gap-3">
          <input type="checkbox" className="size-5 accent-primary" checked={f.active} onChange={(e) => set({ active: e.target.checked })} />
          <span className="font-semibold">사용 (감독 배정 대상)</span>
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
  const { data, loading, error } = useCollection<TeacherDoc>('teachers');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Teacher | 'new' | null>(null);
  const [importing, setImporting] = useState(false);

  const teachers = useMemo(() => sortTeachers(data), [data]);
  const shown = teachers.filter((t) => {
    const q = search.trim().toLowerCase();
    return !q || [t.name, t.email, t.subject, homeroomText(t)].some((v) => v?.toLowerCase().includes(q));
  });
  const existing = useMemo(() => data.map((t) => ({ id: t.id, name: t.name, email: t.email })), [data]);
  const analyze = useCallback(
    (rows: Cell[][], mapping: ColumnMapping) => parseTeachers(rows, mapping, existing),
    [existing],
  );

  const activeCount = data.filter((t) => t.active).length;
  const noEmail = data.filter((t) => t.active && !t.email).length;

  return (
    <>
      <PageTitle sub={`사용 중 ${activeCount}명 / 전체 ${data.length}명`}>교사 관리</PageTitle>

      <div className="mb-4 flex flex-wrap gap-2">
        <Button onClick={() => setImporting(true)}>엑셀 업로드</Button>
        <DownloadButton onDownload={() => downloadTeacherTemplate(data)}>
          {data.length ? '현재 명단 양식 다운로드' : '양식 다운로드'}
        </DownloadButton>
        <Button variant="secondary" onClick={() => setEditing('new')}>
          + 교사 추가
        </Button>
      </div>

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
        {!loading && data.length === 0 && <p className="py-6 text-muted">등록된 교사가 없습니다. 양식을 내려받아 명단을 올려 주세요.</p>}
        {shown.length > 0 && (
          <Table head={['이름', '이메일', '담당교과', '담임', '기본역할', '누적점수', '']}>
            {shown.map((t) => (
              <tr key={t.id} className={t.active ? '' : 'text-muted'}>
                <Td className="font-bold">
                  {t.name}
                  {!t.active && <span className="ml-2 text-sm font-normal">(사용 안 함)</span>}
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

      {editing && <TeacherForm teacher={editing === 'new' ? null : editing} all={data} onClose={() => setEditing(null)} />}
      {importing && (
        <ImportWizard
          title="교사 명단 업로드"
          fields={TEACHER_FIELDS}
          analyze={analyze}
          notice="교사ID → 이메일 → 이름 순으로 기존 교사를 찾아 수정하고, 없으면 새로 등록합니다. 업로드로 삭제되는 교사는 없습니다."
          previewHead={['구분', '이름', '이메일', '교과', '담임', '역할', '사용']}
          previewRow={(v) => [
            v.id ? `수정 (${v.id})` : '신규',
            v.name,
            v.email ?? '',
            v.subject ?? '',
            homeroomText(v),
            DEFAULT_ROLE_LABEL[v.defaultRole],
            v.active ? 'Y' : 'N',
          ]}
          summary={(vs) => (
            <Alert tone="info">
              신규 {vs.filter((v) => !v.id).length}명, 수정 {vs.filter((v) => v.id).length}명을 저장합니다.
            </Alert>
          )}
          onSave={(vs) => saveImported(vs, data)}
          onClose={() => setImporting(false)}
        />
      )}
    </>
  );
}
