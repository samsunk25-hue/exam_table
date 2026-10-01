import { useEffect, useMemo, useState } from 'react';
import { nextId, parseTermKey, sessionTerm, termFields, termKey, termLabel, type RoomDoc, type TeacherDoc, type TermRef, type WithId } from '@sim/shared';
import { Modal } from '@/components/Modal';
import { toast } from '@/components/Toast';
import { Alert, Button } from '@/components/ui';
import { commitOps, ref, type BatchOp } from '@/lib/data';
import { errorMessage } from '@/lib/firebase';
import { useSessions } from '@/lib/sessions';

export type RosterKind = 'teachers' | 'rooms';
const KIND_LABEL: Record<RosterKind, string> = { teachers: '교사', rooms: '시험실' };
const STORAGE_KEY = 'sim.term';

type TermDoc = { term?: string };

/** 다음에 교사·시험실·시험일정 탭을 열 때 이 학기를 먼저 보여 준다 (예: 통합 양식을 올린 프로젝트의 학기) */
export function rememberTerm(key: string) {
  try {
    localStorage.setItem(STORAGE_KEY, key);
  } catch {
    /* 저장 못 해도 동작 */
  }
}

const byRecent = (a: TermRef, b: TermRef) => b.year - a.year || b.semester - a.semester || a.school.localeCompare(b.school, 'ko');

/**
 * 교사·시험실·시험일정 탭에서 쓰는 학교·학기 선택.
 * 목록 = 시험 프로젝트의 학기 + 자료에 있는 학기, 처음 값 = 마지막으로 고른 학기 또는 가장 최근 프로젝트의 학기.
 */
export function useTermChoice(docs: TermDoc[] = []) {
  const sessions = useSessions();
  const [chosen, setChosen] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const terms = useMemo(() => {
    const keys = new Set<string>();
    for (const s of sessions.data) keys.add(termKey(sessionTerm(s)));
    for (const d of docs) if (d.term) keys.add(d.term);
    return [...keys].flatMap((k) => parseTermKey(k) ?? []).sort(byRecent);
  }, [sessions.data, docs]);
  const latest = sessions.data[0] ? termKey(sessionTerm(sessions.data[0])) : terms[0] ? termKey(terms[0]) : null;
  const key = chosen && terms.some((t) => termKey(t) === chosen) ? chosen : latest;
  const current = key ? parseTermKey(key) : null;
  const choose = (k: string) => {
    setChosen(k);
    rememberTerm(k);
  };
  return { terms, current, key, choose, loading: sessions.loading };
}

export function TermPicker({ terms, value, onChange }: { terms: TermRef[]; value: string | null; onChange: (key: string) => void }) {
  if (!terms.length) return null;
  return (
    <label className="mb-4 flex flex-wrap items-center gap-3">
      <span className="font-semibold">학교·학기</span>
      <select
        aria-label="학교·학기"
        className="min-h-12 min-w-72 rounded-xl border border-line bg-surface px-4 font-semibold"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      >
        {terms.map((t) => (
          <option key={termKey(t)} value={termKey(t)}>
            {termLabel(t)}
          </option>
        ))}
      </select>
    </label>
  );
}

type Doc = WithId<TeacherDoc> | WithId<RoomDoc>;

/** 같은 대상인지 (중복으로 불러오지 않게): 교사는 이메일 또는 이름, 시험실은 실명 */
function sameKey(kind: RosterKind, d: Doc): string {
  if (kind === 'rooms') return d.name;
  const t = d as WithId<TeacherDoc>;
  return t.email ?? `name:${t.name}`;
}

/**
 * 다른 학기 명단을 이 학기로 불러온다.
 * - 다른 학기: 새 ID로 복사. 같은 학교·학년도면 누적 업무점수를 이어받고, 학년도가 다르면 0점·담임 비움(선택)
 * - 학기 미지정(예전 자료): 그대로 이 학기로 지정 (ID 유지 → 기존 배정 기록 연결)
 * 이 학기에 이미 있는 대상(이메일·이름·실명 기준)은 건너뛴다.
 */
export function RosterImportDialog({ kind, target, all, onClose }: { kind: RosterKind; target: TermRef; all: Doc[]; onClose: () => void }) {
  const targetKey = termKey(target);
  const legacy = all.filter((d) => !d.term);
  const sources = useMemo(() => {
    const keys = [...new Set(all.flatMap((d) => (d.term && d.term !== targetKey ? [d.term] : [])))];
    return keys.flatMap((k) => parseTermKey(k) ?? []).sort(byRecent);
  }, [all, targetKey]);
  const [source, setSource] = useState<string | null>(null);
  const [clearHomeroom, setClearHomeroom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const src = source === 'legacy' ? null : source ? parseTermKey(source) : null;
  const sameYear = Boolean(src && src.school === target.school && src.year === target.year);
  useEffect(() => setClearHomeroom(Boolean(src) && !sameYear), [src, sameYear]);

  const existing = new Set(all.filter((d) => d.term === targetKey).map((d) => sameKey(kind, d)));
  const picked = source === 'legacy' ? legacy : all.filter((d) => d.term === source);
  const fresh = picked.filter((d) => !existing.has(sameKey(kind, d)));

  const save = async () => {
    setBusy(true);
    setError(null);
    const tf = termFields(target);
    const ops: BatchOp[] = [];
    if (source === 'legacy') {
      for (const d of fresh) ops.push({ type: 'set', ref: ref(kind, d.id), data: { ...tf }, merge: true });
    } else {
      const ids = nextId(kind === 'teachers' ? 'T' : 'R', all.map((d) => d.id), fresh.length);
      fresh.forEach(({ id: _id, term: _t, school: _s, year: _y, semester: _m, ...d }, i) => {
        const data: Record<string, unknown> = { ...d, ...tf };
        if (kind === 'teachers') {
          if (!sameYear) data.cumulativeLoad = 0;
          if (clearHomeroom) data.homeroom = null;
        }
        ops.push({ type: 'set', ref: ref(kind, ids[i]!), data });
      });
    }
    try {
      await commitOps(ops, `${KIND_LABEL[kind]} 명단 불러오기`);
      toast(`${KIND_LABEL[kind]} ${fresh.length}${kind === 'teachers' ? '명을' : '개를'} ${termLabel(target)}(으)로 불러왔습니다.`);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Modal title={`다른 학기 ${KIND_LABEL[kind]} 불러오기`} onClose={onClose}>
      <div className="grid gap-4">
        <p>
          <b>{termLabel(target)}</b>(으)로 가져올 명단을 고르세요.
        </p>
        <div className="flex flex-wrap gap-2">
          {sources.map((t) => {
            const k = termKey(t);
            return (
              <Button key={k} variant={source === k ? 'primary' : 'secondary'} aria-pressed={source === k} onClick={() => setSource(k)}>
                {termLabel(t)} ({all.filter((d) => d.term === k).length})
              </Button>
            );
          })}
          {legacy.length > 0 && (
            <Button variant={source === 'legacy' ? 'primary' : 'secondary'} aria-pressed={source === 'legacy'} onClick={() => setSource('legacy')}>
              학기 미지정 (예전 자료 {legacy.length})
            </Button>
          )}
        </div>
        {sources.length === 0 && legacy.length === 0 && <p className="text-muted">불러올 다른 학기 명단이 없습니다.</p>}
        {source && (
          <div className="grid gap-2 rounded-xl bg-bg p-3">
            <p>
              {KIND_LABEL[kind]} {fresh.length}
              {kind === 'teachers' ? '명을' : '개를'} 불러옵니다
              {picked.length > fresh.length && ` (이 학기에 이미 있는 ${picked.length - fresh.length}건은 건너뜀)`}.
            </p>
            {source === 'legacy' && <p className="text-sm text-muted">예전 자료는 복사하지 않고 이 학기로 지정합니다 (지난 배정 기록이 그대로 연결됩니다).</p>}
            {kind === 'teachers' && src && (
              <>
                <p className="text-sm text-muted">
                  {sameYear ? '같은 학년도라서 누적 업무점수를 이어받습니다.' : '학년도가 달라 누적 업무점수는 0점부터 시작합니다.'}
                </p>
                <label className="flex min-h-12 cursor-pointer items-center gap-2">
                  <input type="checkbox" className="size-5 accent-primary" checked={clearHomeroom} onChange={(e) => setClearHomeroom(e.target.checked)} />
                  담임 정보 비우기 (새 학년도 담임을 다시 입력)
                </label>
              </>
            )}
          </div>
        )}
        {error && <Alert>{error}</Alert>}
        <div className="flex gap-2">
          <Button onClick={() => void save()} disabled={busy || !source || fresh.length === 0}>
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
