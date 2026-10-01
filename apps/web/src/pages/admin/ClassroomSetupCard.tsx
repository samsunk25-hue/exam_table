import { useMemo, useState } from 'react';
import { classroomName, configFromRooms, planClassrooms, type ClassroomConfig, type RoomDoc, type TermFields, type WithId } from '@sim/shared';
import { Alert, Button, Card } from '@/components/ui';
import { commitOps, ref, type BatchOp } from '@/lib/data';
import { errorMessage } from '@/lib/firebase';
import { toast } from '@/components/Toast';

const MAX_GRADES = 6;
const MAX_CLASSES = 20;

function NumberStepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 font-semibold">{label}</span>
      <button
        type="button"
        aria-label={`${label} 줄이기`}
        className="size-12 cursor-pointer rounded-xl border border-line text-xl hover:border-primary hover:bg-primary-soft disabled:opacity-40"
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
      >
        −
      </button>
      <input
        type="number"
        aria-label={label}
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || 0)))}
        className="min-h-12 w-16 rounded-xl border border-line text-center text-lg font-bold"
      />
      <button
        type="button"
        aria-label={`${label} 늘리기`}
        className="size-12 cursor-pointer rounded-xl border border-line text-xl hover:border-primary hover:bg-primary-soft disabled:opacity-40"
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
      >
        +
      </button>
    </div>
  );
}

/** 학년별 학급 수 입력 → 시험 치는 교실 체크 → 교실·복도 시험실 자동 생성 */
export function ClassroomSetupCard({ rooms, term, takenIds }: { rooms: WithId<RoomDoc>[]; term: TermFields; takenIds: string[] }) {
  const initial = useMemo(() => configFromRooms(rooms), [rooms]);
  const [config, setConfig] = useState<ClassroomConfig>(initial);
  const [open, setOpen] = useState(rooms.length === 0);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const plan = useMemo(() => planClassrooms(config, rooms, takenIds), [config, rooms, takenIds]);
  const examRooms = plan.upsert.filter((r) => r.spaceType === 'CLASSROOM').length;
  const set = (patch: Partial<ClassroomConfig>) => {
    setConfig({ ...config, ...patch });
    setConfirming(false);
  };

  const setCount = (gradeIdx: number, n: number) => {
    const classCounts = [...config.classCounts];
    classCounts[gradeIdx] = n;
    set({ classCounts });
  };
  const toggle = (key: string) => {
    const skipped = new Set(config.skipped);
    if (skipped.has(key)) skipped.delete(key);
    else skipped.add(key);
    set({ skipped });
  };
  const toggleGrade = (grade: number, on: boolean) => {
    const skipped = new Set(config.skipped);
    for (let c = 1; c <= config.classCounts[grade - 1]!; c++) {
      if (on) skipped.delete(classroomName(grade, c));
      else skipped.add(classroomName(grade, c));
    }
    set({ skipped });
  };

  const apply = async () => {
    if (plan.remove.length > 0 && !confirming) return setConfirming(true);
    setBusy(true);
    setError(null);
    const ops: BatchOp[] = [
      ...plan.upsert.map(({ id, ...data }): BatchOp => ({ type: 'set', ref: ref('rooms', id), data: { ...data, ...term } })),
      ...plan.remove.map((r): BatchOp => ({ type: 'delete', ref: ref('rooms', r.id) })),
    ];
    try {
      await commitOps(ops, '교실·복도 시험실 설정');
      toast(`시험실을 설정했습니다. 교실 ${examRooms}개${config.hallways ? ' + 복도' : ''} (신규 ${plan.created}, 삭제 ${plan.remove.length})`);
      setConfirming(false);
      setOpen(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mb-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">학급 교실 한 번에 만들기</h2>
          <p className="text-muted">학년별 학급 수를 입력하고, 시험을 치는 교실만 체크하세요.</p>
        </div>
        {!open && (
          <Button
            variant="secondary"
            onClick={() => {
              setConfig(initial);
              setOpen(true);
            }}
          >
            학급 수·교실 설정
          </Button>
        )}
      </div>

      {open && (
        <div className="mt-4 grid gap-5">
          <div className="grid gap-3">
            {config.classCounts.map((n, i) => (
              <NumberStepper key={i} label={`${i + 1}학년`} value={n} min={0} max={MAX_CLASSES} onChange={(v) => setCount(i, v)} />
            ))}
            <div className="flex flex-wrap gap-2">
              {config.classCounts.length < MAX_GRADES && (
                <Button variant="ghost" onClick={() => set({ classCounts: [...config.classCounts, 0] })}>
                  + 학년 추가
                </Button>
              )}
              {config.classCounts.length > 1 && (
                <Button variant="ghost" onClick={() => set({ classCounts: config.classCounts.slice(0, -1) })}>
                  − 마지막 학년 빼기
                </Button>
              )}
            </div>
          </div>

          {config.classCounts.some((n) => n > 0) && (
            <section>
              <h3 className="mb-2 font-semibold">시험 치는 교실 (체크 해제하면 시험실에서 뺍니다)</h3>
              <div className="grid gap-3">
                {config.classCounts.map((n, i) => {
                  const grade = i + 1;
                  if (n === 0) return null;
                  const allOn = Array.from({ length: n }, (_, c) => !config.skipped.has(classroomName(grade, c + 1))).every(Boolean);
                  return (
                    <div key={grade} className="rounded-xl border border-line p-3">
                      <label className="mb-2 flex min-h-10 cursor-pointer items-center gap-2 font-bold">
                        <input type="checkbox" className="size-5 accent-primary" checked={allOn} onChange={(e) => toggleGrade(grade, e.target.checked)} />
                        {grade}학년 전체
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {Array.from({ length: n }, (_, c) => {
                          const key = classroomName(grade, c + 1);
                          const on = !config.skipped.has(key);
                          return (
                            <button
                              key={key}
                              type="button"
                              aria-pressed={on}
                              onClick={() => toggle(key)}
                              className={`min-h-12 min-w-16 cursor-pointer rounded-xl px-3 font-bold transition-colors ${
                                on ? 'bg-primary text-white hover:bg-primary-strong' : 'border border-dashed border-line bg-bg text-muted line-through hover:border-primary'
                              }`}
                            >
                              {key}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex min-h-12 cursor-pointer items-center gap-3">
              <input type="checkbox" className="size-5 accent-primary" checked={config.hallways} onChange={(e) => set({ hallways: e.target.checked })} />
              <span className="font-semibold">학년별 복도 감독 자리 만들기</span>
            </label>
            <label className="flex items-center gap-2">
              <span className="font-semibold">교실당 정감독</span>
              <input
                type="number"
                min={0}
                max={5}
                className="min-h-12 w-16 rounded-xl border border-line text-center"
                value={config.chiefCount}
                onChange={(e) => set({ chiefCount: Math.max(0, Number(e.target.value) || 0) })}
              />
            </label>
            <label className="flex items-center gap-2">
              <span className="font-semibold">교실당 부감독</span>
              <input
                type="number"
                min={0}
                max={5}
                className="min-h-12 w-16 rounded-xl border border-line text-center"
                value={config.assistantCount}
                onChange={(e) => set({ assistantCount: Math.max(0, Number(e.target.value) || 0) })}
              />
            </label>
          </div>

          {confirming && (
            <Alert>
              체크 해제되었거나 학급 수에서 빠진 시험실 {plan.remove.length}개({plan.remove.map((r) => r.name).join(', ')})를 삭제합니다. 계속하려면
              다시 "적용"을 누르세요.
            </Alert>
          )}
          {error && <Alert>{error}</Alert>}

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void apply()} disabled={busy || config.chiefCount + config.assistantCount === 0}>
              {busy ? '적용 중…' : confirming ? '삭제하고 적용' : `적용 (교실 ${examRooms}개)`}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setConfig(initial);
                setConfirming(false);
                if (rooms.length) setOpen(false);
              }}
              disabled={busy}
            >
              취소
            </Button>
            <span className="text-sm text-muted">특별실(별도시험장 등)은 아래 "+ 특별실 추가"로 따로 등록합니다.</span>
          </div>
        </div>
      )}
    </Card>
  );
}
