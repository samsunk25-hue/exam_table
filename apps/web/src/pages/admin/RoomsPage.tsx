import { useMemo, useState, type FormEvent } from 'react';
import { SPACE_TYPE_LABEL, nextId, type RoomDoc, type SpaceType, type WithId } from '@sim/shared';
import { BundleHint } from '@/components/BundleHint';
import { Modal } from '@/components/Modal';
import { Alert, Button, Card, Field, PageTitle, Select, Spinner, Table, Td } from '@/components/ui';
import { commitOps, ref, useCollection } from '@/lib/data';
import { errorMessage } from '@/lib/firebase';
import { ClassroomSetupCard } from './ClassroomSetupCard';

type Room = WithId<RoomDoc>;

const SPACE_ORDER: Record<SpaceType, number> = { CLASSROOM: 0, HALLWAY: 1, SEPARATE: 2 };

export function sortRooms<T extends RoomDoc>(list: T[]): T[] {
  return [...list].sort(
    (a, b) =>
      (a.grade ?? 99) - (b.grade ?? 99) ||
      SPACE_ORDER[a.spaceType] - SPACE_ORDER[b.spaceType] ||
      (a.classNo ?? 99) - (b.classNo ?? 99) ||
      a.name.localeCompare(b.name, 'ko'),
  );
}

function RoomForm({ room, all, onClose }: { room: Room | null; all: Room[]; onClose: () => void }) {
  const [f, setF] = useState({
    name: room?.name ?? '',
    // 새로 추가하는 것은 대부분 특별실 (교실·복도는 학급 수 설정으로 만든다)
    spaceType: room?.spaceType ?? ('SEPARATE' as SpaceType),
    grade: room?.grade ? String(room.grade) : '',
    classNo: room?.classNo ? String(room.classNo) : '',
    chiefCount: String(room?.chiefCount ?? 1),
    assistantCount: String(room?.assistantCount ?? 0),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const name = f.name.trim();
    const chief = Number(f.chiefCount);
    const assistant = Number(f.assistantCount);
    const classNo = f.spaceType === 'CLASSROOM' && f.classNo ? Number(f.classNo) : null;
    const grade = f.grade ? Number(f.grade) : null;
    const problem = !name
      ? '실명을 입력해 주세요.'
      : all.some((r) => r.id !== room?.id && r.name === name)
        ? '같은 실명의 시험실이 이미 있습니다.'
        : chief + assistant === 0
          ? '정감독수와 부감독수가 모두 0입니다.'
          : classNo !== null && grade === null
            ? '반을 입력한 교실은 학년도 입력해야 합니다.'
            : null;
    if (problem) return setError(problem);

    setBusy(true);
    setError(null);
    const data: RoomDoc = { name, spaceType: f.spaceType, grade, classNo, chiefCount: chief, assistantCount: assistant };
    try {
      const id = room?.id ?? nextId('R', all.map((r) => r.id))[0]!;
      await commitOps([{ type: 'set', ref: ref('rooms', id), data: { ...data } }]);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await commitOps([{ type: 'delete', ref: ref('rooms', room!.id) }]);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal title={room ? '시험실 수정' : '특별실 추가'} onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} className="grid gap-4">
        <Field label="실명" required value={f.name} onChange={(e) => set({ name: e.target.value })} />
        <Select
          label="공간유형"
          value={f.spaceType}
          onChange={(e) => set({ spaceType: e.target.value as SpaceType })}
          options={Object.entries(SPACE_TYPE_LABEL).map(([value, label]) => ({ value, label }))}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field label="학년" type="number" min={1} max={6} value={f.grade} onChange={(e) => set({ grade: e.target.value })} />
          {f.spaceType === 'CLASSROOM' && (
            <Field label="반" type="number" min={1} max={30} value={f.classNo} onChange={(e) => set({ classNo: e.target.value })} />
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="정감독수" type="number" min={0} max={5} required value={f.chiefCount} onChange={(e) => set({ chiefCount: e.target.value })} />
          <Field label="부감독수" type="number" min={0} max={5} required value={f.assistantCount} onChange={(e) => set({ assistantCount: e.target.value })} />
        </div>
        {error && <Alert>{error}</Alert>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>
            저장
          </Button>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            취소
          </Button>
          {room &&
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
        {confirmDelete && <p className="text-sm text-muted">시험 일정에 배치된 시험실을 지우면 해당 배치는 점검에서 오류로 표시됩니다.</p>}
      </form>
    </Modal>
  );
}

export function RoomsPage() {
  const { data, loading, error } = useCollection<RoomDoc>('rooms');
  const [editing, setEditing] = useState<Room | 'new' | null>(null);
  const rooms = useMemo(() => sortRooms(data), [data]);
  const seats = data.reduce((s, r) => s + r.chiefCount + r.assistantCount, 0);

  return (
    <>
      <PageTitle sub={`시험실 ${data.length}개 · 한 교시에 필요한 감독 ${seats}명 (모든 시험실 사용 시)`}>시험실 관리</PageTitle>

      <BundleHint what="시험실 목록" />

      {!loading && !error && <ClassroomSetupCard rooms={data} />}

      <div className="mb-4 flex flex-wrap gap-2">
        <Button onClick={() => setEditing('new')}>+ 특별실 추가</Button>
      </div>

      <Card>
        {loading && <Spinner />}
        {error && <Alert>{error}</Alert>}
        {!loading && data.length === 0 && <p className="py-6 text-muted">등록된 시험실이 없습니다. 위에서 학급 수를 입력해 교실을 만드세요.</p>}
        {rooms.length > 0 && (
          <Table head={['실명', '공간유형', '학년', '반', '정감독', '부감독', '']}>
            {rooms.map((r) => (
              <tr key={r.id}>
                <Td className="font-bold">{r.name}</Td>
                <Td>{SPACE_TYPE_LABEL[r.spaceType]}</Td>
                <Td>{r.grade ?? ''}</Td>
                <Td>{r.classNo ?? ''}</Td>
                <Td>{r.chiefCount}</Td>
                <Td>{r.assistantCount}</Td>
                <Td>
                  <Button variant="ghost" onClick={() => setEditing(r)}>
                    수정
                  </Button>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {editing && <RoomForm room={editing === 'new' ? null : editing} all={data} onClose={() => setEditing(null)} />}
    </>
  );
}
