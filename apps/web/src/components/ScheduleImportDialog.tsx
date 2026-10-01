import { useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { slotIdOf, type RoomDoc, type SlotDoc, type WithId } from '@sim/shared';
import { dateLabel } from '@/components/AvailabilityGrid';
import { parseYmd, ymd } from '@/components/Calendar';
import { Modal } from '@/components/Modal';
import { toast } from '@/components/Toast';
import { Alert, Button, Spinner } from '@/components/ui';
import { commitOps, ref, type BatchOp } from '@/lib/data';
import { db, errorMessage } from '@/lib/firebase';
import { undoable } from '@/lib/undo';
import { sessionTitle, updateSessionSettings, useSessions, type ExamSession } from '@/lib/sessions';

type Slot = WithId<SlotDoc>;

const shiftDate = (date: string, days: number) => {
  const d = parseYmd(date);
  d.setDate(d.getDate() + days);
  return ymd(d);
};
const dayDiff = (a: string, b: string) => Math.round((parseYmd(b).getTime() - parseYmd(a).getTime()) / 86_400_000);

/**
 * 다른 시험 프로젝트의 시험 시간표(날짜·교시·시간·과목·시험실 배치)와 교시별 기본 시간을 가져온다.
 * 시작일을 바꾸면 모든 날짜를 같은 간격만큼 옮긴다. 이 프로젝트의 기존 시험은 지우고 바꾼다.
 */
export function ScheduleImportDialog({
  session,
  slots,
  rooms,
  onClose,
}: {
  session: ExamSession;
  slots: Slot[];
  rooms: WithId<RoomDoc>[];
  onClose: () => void;
}) {
  const { data: sessions, loading } = useSessions();
  const others = sessions.filter((s) => s.id !== session.id);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [source, setSource] = useState<Slot[] | null>(null);
  const [firstDate, setFirstDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picked = others.find((s) => s.id === sourceId) ?? null;

  useEffect(() => {
    if (!sourceId) return;
    setSource(null);
    getDocs(collection(db, `sessions/${sourceId}/slots`))
      .then((snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as SlotDoc) }));
        setSource(list);
        setFirstDate([...list].map((s) => s.date).sort()[0] ?? '');
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [sourceId]);

  const srcDates = source ? [...new Set(source.map((s) => s.date))].sort() : [];
  const offset = srcDates[0] && firstDate ? dayDiff(srcDates[0], firstDate) : 0;
  const newDates = srcDates.map((d) => shiftDate(d, offset));
  const weekend = newDates.filter((d) => [0, 6].includes(parseYmd(d).getDay()));

  const save = async () => {
    if (!source || !picked) return;
    setBusy(true);
    setError(null);
    try {
      const roomIds = new Set(rooms.map((r) => r.id));
      const ops: BatchOp[] = slots.map((s) => ({ type: 'delete', ref: ref(`sessions/${session.id}/slots`, s.id) }));
      let dropped = 0;
      for (const { id: _id, ...s } of source) {
        const date = shiftDate(s.date, offset);
        // 지금은 없는 시험실 배치는 뺀다
        const placements = s.rooms.filter((p) => roomIds.has(p.roomId));
        dropped += s.rooms.length - placements.length;
        const data: SlotDoc = { ...s, date, rooms: placements };
        ops.push({ type: 'set', ref: ref(`sessions/${session.id}/slots`, slotIdOf(date, s.period, s.grade)), data: { ...data } });
      }
      await undoable('다른 프로젝트 시험 시간표 불러오기', async () => {
        await commitOps(ops);
        if (picked.settings.periodTimes && Object.keys(picked.settings.periodTimes).length) {
          await updateSessionSettings(session.id, { ...session.settings, periodTimes: picked.settings.periodTimes });
        }
      });
      toast(`시험 ${source.length}건을 불러왔습니다${dropped ? ` (없어진 시험실 배치 ${dropped}개 제외)` : ''}.`);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Modal title="다른 프로젝트 시험 시간표 불러오기" onClose={onClose} wide>
      <div className="grid gap-5">
        <section>
          <h3 className="mb-2 font-bold">1. 가져올 프로젝트</h3>
          {loading ? (
            <Spinner />
          ) : others.length === 0 ? (
            <p className="text-muted">불러올 다른 시험 프로젝트가 없습니다.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {others.map((s) => (
                <Button key={s.id} variant={s.id === sourceId ? 'primary' : 'secondary'} aria-pressed={s.id === sourceId} onClick={() => setSourceId(s.id)}>
                  {sessionTitle(s)}
                  <span className="text-sm font-normal opacity-80">{s.schoolName}</span>
                </Button>
              ))}
            </div>
          )}
        </section>

        {sourceId && !source && !error && <Spinner />}
        {source && source.length === 0 && <Alert>이 프로젝트에는 시험 일정이 없습니다.</Alert>}
        {source && source.length > 0 && (
          <>
            <section>
              <h3 className="mb-2 font-bold">2. 시작일 (필요하면 바꾸기)</h3>
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-sm text-muted">첫 시험일</span>
                  <input type="date" aria-label="첫 시험일" className="min-h-12 rounded-xl border border-line px-3" value={firstDate} onChange={(e) => setFirstDate(e.target.value || srcDates[0]!)} />
                </label>
                <span className="pb-3 text-sm text-muted">
                  {offset === 0 ? '날짜를 그대로 씁니다.' : `모든 날짜를 ${Math.abs(offset)}일 ${offset > 0 ? '뒤로' : '앞으로'} 옮깁니다.`}
                </span>
              </div>
            </section>
            <section>
              <h3 className="mb-2 font-bold">3. 불러올 내용</h3>
              <p>
                시험 {source.length}건 · {newDates.length}일:{' '}
                {newDates.map((d) => (
                  <span key={d} className="mr-1 inline-block rounded-lg bg-primary-soft px-2 py-1 text-sm font-semibold text-primary-strong">
                    {dateLabel(d)}
                  </span>
                ))}
              </p>
              <p className="mt-1 text-sm text-muted">시험 시간·과목·자습·시험실 배치와 교시별 기본 시간을 함께 가져옵니다.</p>
            </section>
            {weekend.length > 0 && <Alert>주말에 걸린 날짜가 있습니다: {weekend.map(dateLabel).join(', ')}. 시작일을 확인하세요.</Alert>}
            {slots.length > 0 && <Alert>이 프로젝트의 기존 시험 {slots.length}건은 지우고 불러온 내용으로 바꿉니다.</Alert>}
          </>
        )}
        {error && <Alert>{error}</Alert>}
        <div className="flex gap-2">
          <Button onClick={() => void save()} disabled={busy || !source?.length}>
            {busy ? '불러오는 중…' : '불러오기'}
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            취소
          </Button>
        </div>
      </div>
    </Modal>
  );
}
