import { useState, type FormEvent } from 'react';
import { nextId, sessionTerm, termFields, type TeacherDoc } from '@sim/shared';
import { toast } from '@/components/Toast';
import { Alert, Button, Card, CardTitle } from '@/components/ui';
import { commitOps, ref, useCollection } from '@/lib/data';
import { errorMessage } from '@/lib/firebase';
import type { ExamSession } from '@/lib/sessions';

/** 임시 감독자 한 명을 교사 명단(이 시험 전용)에 넣고 id를 돌려준다 */
export async function addTempStaff(session: ExamSession, existingIds: string[], name: string, note: string): Promise<string> {
  const [id] = nextId('T', existingIds);
  await commitOps(
    [
      {
        type: 'set',
        ref: ref('teachers', id!),
        data: {
          name: name.trim(),
          email: null,
          subject: null,
          homeroom: null,
          defaultRole: 'NORMAL',
          active: true,
          cumulativeLoad: 0,
          temporary: true,
          onlySession: session.id,
          note: note.trim() || null,
          ...termFields(sessionTerm(session)),
        },
      },
    ],
    `임시 감독자 추가: ${name.trim()}`,
  );
  return id!;
}

/** 미배정 자리에서 바로: 명단에 없는 사람 이름을 적어 임시 감독자로 넣고 이 자리에 배정 */
export function TempQuickAssign({ session, busy, onAssign }: { session: ExamSession; busy: boolean; onAssign: (teacherId: string, name: string) => Promise<void> }) {
  const all = useCollection<TeacherDoc>('teachers');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [working, setWorking] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setWorking(true);
    try {
      const id = await addTempStaff(session, all.data.map((t) => t.id), name, note);
      await onAssign(id, name.trim());
    } catch (err) {
      toast(errorMessage(err), 'alert');
    } finally {
      setWorking(false);
    }
  };
  return (
    <form onSubmit={(e) => void submit(e)} aria-label="임시 감독자 직접 입력" className="rounded-xl bg-bg p-3">
      <p className="font-semibold">명단에 없는 사람으로 채우기 (임시 감독자)</p>
      <p className="text-sm text-muted">이름을 적으면 이번 시험 임시 감독자로 추가하고 바로 이 자리에 배정합니다.</p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <input aria-label="임시 감독자 이름 직접 입력" placeholder="이름" className="min-h-12 w-36 rounded-xl border border-line bg-surface px-4" value={name} onChange={(e) => setName(e.target.value)} />
        <input aria-label="임시 감독자 메모 직접 입력" placeholder="메모 (선택, 예: 강사)" className="min-h-12 w-48 rounded-xl border border-line bg-surface px-4" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button type="submit" disabled={busy || working || !name.trim()}>
          {working ? '넣는 중…' : '추가하고 배정'}
        </Button>
      </div>
    </form>
  );
}

/**
 * 임시 감독자: 교사 명단에 없는 사람(학부모·강사 등)을 이 시험에만 추가한다.
 * 자동 배정은 교사가 모자랄 때만 쓰고, 다른 프로젝트·다음 학기 명단에는 나타나지 않는다.
 */
export function TempStaffCard({ session }: { session: ExamSession }) {
  const all = useCollection<TeacherDoc>('teachers');
  const temps = all.data.filter((t) => t.onlySession === session.id);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await addTempStaff(session, all.data.map((t) => t.id), name, note);
      toast(`${name.trim()}님을 이번 시험 임시 감독자로 추가했습니다.`);
      setName('');
      setNote('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: string, n: string) => {
    try {
      await commitOps([{ type: 'delete', ref: ref('teachers', id) }], `임시 감독자 삭제: ${n}`);
      toast(`${n}님을 뺐습니다.`);
    } catch (err) {
      toast(errorMessage(err), 'alert');
    }
  };

  return (
    <Card>
      <CardTitle icon="🙋">임시 감독자 (이번 시험만)</CardTitle>
      <p className="mt-1 text-muted">
        교사 명단에 없는 사람(학부모·강사 등)을 이름만으로 추가합니다. 자동 배정은 교사가 모자랄 때만 임시 감독자를 쓰고, 다른 시험·다음 학기 명단에는 나오지 않습니다.
      </p>
      <form onSubmit={(e) => void add(e)} className="mt-3 flex flex-wrap items-end gap-2">
        <label className="grid gap-1">
          <span className="text-sm font-semibold">이름</span>
          <input aria-label="임시 감독자 이름" className="min-h-12 w-40 rounded-xl border border-line px-4" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="grid gap-1">
          <span className="text-sm font-semibold">메모 (선택)</span>
          <input aria-label="임시 감독자 메모" placeholder="예: 학부모, 강사" className="min-h-12 w-48 rounded-xl border border-line px-4" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <Button type="submit" disabled={busy || !name.trim()}>
          + 추가
        </Button>
      </form>
      {error && (
        <div className="mt-2">
          <Alert>{error}</Alert>
        </div>
      )}
      {temps.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {temps.map((t) => (
            <li key={t.id} className="inline-flex min-h-11 items-center gap-1 rounded-xl bg-bg pl-3 font-semibold">
              {t.name}
              {t.note && <span className="text-sm font-normal text-muted">({t.note})</span>}
              <button type="button" aria-label={`${t.name} 빼기`} className="size-10 cursor-pointer rounded-lg text-lg hover:bg-alert-soft" onClick={() => void remove(t.id, t.name)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
