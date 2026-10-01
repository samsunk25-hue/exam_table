import { Link } from 'react-router';
import { useMemo, useState, type FormEvent } from 'react';
import { SPACE_TYPE_LABEL, nextId, termFields, termLabel, type RoomDoc, type SpaceType, type TermRef, type WithId } from '@sim/shared';
import { Modal } from '@/components/Modal';
import { RosterImportDialog, useTerm } from '@/components/TermRoster';
import { Alert, Button, Card, Field, Select, Spinner, Table, Td, Empty } from '@/components/ui';
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

function RoomForm({
  room,
  all,
  takenIds,
  term,
  onClose,
}: {
  room: Room | null;
  all: Room[];
  takenIds: string[];
  term: TermRef;
  onClose: () => void;
}) {
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
      const id = room?.id ?? nextId('R', takenIds)[0]!;
      await commitOps([{ type: 'set', ref: ref('rooms', id), data: { ...data, ...termFields(term) } }], room ? '시험실 수정' : '시험실 추가');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await commitOps([{ type: 'delete', ref: ref('rooms', room!.id) }], '시험실 삭제');
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
  const everyone = useCollection<RoomDoc>('rooms');
  const { loading, error } = everyone;
  const choice = useTerm(); // 머리글에서 고른 학교·학기
  // 선택한 학교·학기 시험실만 보여 준다
  const data = useMemo(() => everyone.data.filter((r) => r.term === choice.key), [everyone.data, choice.key]);
  const legacy = everyone.data.filter((r) => !r.term).length;
  const takenIds = useMemo(() => everyone.data.map((r) => r.id), [everyone.data]);
  const [editing, setEditing] = useState<Room | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const rooms = useMemo(() => sortRooms(data), [data]);
  const seats = data.reduce((s, r) => s + r.chiefCount + r.assistantCount, 0);

  return (
    <>
      <div className="mb-4">
        <h2 className="text-xl font-bold">시험실</h2>
        <p className="text-muted">{`${choice.current ? `${termLabel(choice.current)} · ` : ''}시험실 ${data.length}개 · 한 교시에 필요한 감독 ${seats}명 (모든 시험실 사용 시)`}</p>
      </div>

      {!choice.loading && !choice.current && (
        <div className="mb-4">
          <Alert tone="info">먼저 대시보드에서 시험 프로젝트를 만드세요. 프로젝트의 학교·학기별로 시험실을 따로 관리합니다.</Alert>
        </div>
      )}
      {legacy > 0 && choice.current && (
        <div className="mb-4">
          <Alert tone="info">학기가 지정되지 않은 예전 시험실 {legacy}개가 있습니다. "다른 학기에서 불러오기"로 이 학기에 넣을 수 있습니다.</Alert>
        </div>
      )}


      {!loading && !error && choice.current && (
        <ClassroomSetupCard key={choice.key} rooms={data} term={termFields(choice.current)} takenIds={takenIds} />
      )}

      {choice.current && (
        <div className="mb-4 flex flex-wrap gap-2">
          <Button onClick={() => setEditing('new')}>+ 특별실 추가</Button>
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

      <Card>
        {loading && <Spinner />}
        {error && <Alert>{error}</Alert>}
        {!loading && data.length === 0 && (
          <Empty icon="🏫" title="이 학기에 등록된 시험실이 없습니다">
            위에서 학년별 학급 수만 넣으면 교실이 한 번에 만들어집니다. 다른 학기 시험실은 "다른 학기에서 불러오기"로 가져옵니다.
          </Empty>
        )}
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

      {editing && choice.current && (
        <RoomForm room={editing === 'new' ? null : editing} all={data} takenIds={takenIds} term={choice.current} onClose={() => setEditing(null)} />
      )}
      {importing && choice.current && <RosterImportDialog kind="rooms" target={choice.current} all={everyone.data} onClose={() => setImporting(false)} />}
    </>
  );
}
