import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { nextId, parseTermKey, sessionTerm, termFields, termKey, termLabel, type RoomDoc, type TeacherDoc, type TermRef, type WithId } from '@sim/shared';
import { Modal } from '@/components/Modal';
import { toast } from '@/components/Toast';
import { Alert, Button } from '@/components/ui';
import { commitOps, ref, useCollection, type BatchOp } from '@/lib/data';
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
    // 보이는(숨기지 않은) 프로젝트가 있는 학기만. 프로젝트가 하나도 없을 때만 명단의 학기를 쓴다
    const keys = new Set<string>();
    for (const s of sessions.data) if (!s.hidden) keys.add(termKey(sessionTerm(s)));
    if (!keys.size) for (const d of docs) if (d.term) keys.add(d.term);
    return [...keys].flatMap((k) => parseTermKey(k) ?? []).sort(byRecent);
  }, [sessions.data, docs]);
  const visible = sessions.data.filter((s) => !s.hidden);
  const latest = visible[0] ? termKey(sessionTerm(visible[0])) : terms[0] ? termKey(terms[0]) : null;
  // 프로젝트는 없고 명단만 있는 학기 (예: 가입 신청으로 생긴 학교·학기) — 교사·시험실 관리에서만 따로 고른다
  const otherTerms = useMemo(() => {
    const shown = new Set(terms.map(termKey));
    return [...new Set(docs.flatMap((d) => (d.term && !shown.has(d.term) ? [d.term] : [])))].flatMap((k) => parseTermKey(k) ?? []).sort(byRecent);
  }, [docs, terms]);
  const valid = (k: string) => terms.some((t) => termKey(t) === k) || otherTerms.some((t) => termKey(t) === k);
  const key = chosen && valid(chosen) ? chosen : latest;
  const current = key ? parseTermKey(key) : null;
  const choose = (k: string) => {
    setChosen(k);
    rememberTerm(k);
  };
  return { terms, otherTerms, current, key, choose, loading: sessions.loading };
}

type TermChoice = ReturnType<typeof useTermChoice>;
const TermContext = createContext<TermChoice | null>(null);

/** 관리자 화면 전체가 같은 학교·학기를 보게 한다 (머리글에서 한 번 고름) */
export function TermProvider({ children }: { children: ReactNode }) {
  const teachers = useCollection<TermDoc>('teachers');
  const rooms = useCollection<TermDoc>('rooms');
  const docs = useMemo(() => [...teachers.data, ...rooms.data], [teachers.data, rooms.data]);
  const choice = useTermChoice(docs);
  return <TermContext.Provider value={choice}>{children}</TermContext.Provider>;
}

export function useTerm(): TermChoice {
  const c = useContext(TermContext);
  if (!c) throw new Error('TermProvider 안에서 사용해야 합니다.');
  return c;
}

/** 대시보드의 학교·학기 선택 (교사 관리·시험실 관리도 이 선택을 따른다) */
export function TermSelect() {
  const c = useTerm();
  if (!c.terms.length) return null;
  return (
    <select
      aria-label="학교·학기"
      title="학교·학기 (교사 관리·시험실 관리에도 적용)"
      className="min-h-12 min-w-64 rounded-xl border border-line bg-surface px-4 font-semibold"
      value={c.key ?? ''}
      onChange={(e) => c.choose(e.target.value)}
    >
      {c.terms.map((t) => (
        <option key={termKey(t)} value={termKey(t)}>
          {termLabel(t)}
        </option>
      ))}
    </select>
  );
}

/** 교사·시험실 관리: 프로젝트 없는 명단(학교·학기)으로 바꾸는 버튼 */
export function OtherTermLinks() {
  const c = useTerm();
  if (!c.otherTerms.length) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted">프로젝트 없는 명단:</span>
      {c.otherTerms.map((t) => (
        <Button key={termKey(t)} variant={c.key === termKey(t) ? 'primary' : 'secondary'} onClick={() => c.choose(termKey(t))}>
          {termLabel(t)}
        </Button>
      ))}
    </div>
  );
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

/**
 * 명단 복사 작업: 다른 학기 대상은 새 ID로 복사(같은 학교·학년도면 누적점수 유지, 아니면 0점·담임 비움 선택),
 * 학기 미지정 예전 자료는 ID 그대로 이 학기로 지정한다. (불러오기 창과 새 프로젝트 만들기가 함께 쓴다)
 */
export function rosterCopyOps(o: {
  kind: RosterKind;
  all: Doc[];
  chosen: Doc[];
  legacy: boolean;
  target: TermRef;
  sameYear: boolean;
  clearHomeroom: boolean;
}): BatchOp[] {
  const tf = termFields(o.target);
  if (o.legacy) return o.chosen.map((d): BatchOp => ({ type: 'set', ref: ref(o.kind, d.id), data: { ...tf }, merge: true }));
  const ids = nextId(o.kind === 'teachers' ? 'T' : 'R', o.all.map((d) => d.id), o.chosen.length);
  return o.chosen.map(({ id: _id, term: _t, school: _s, year: _y, semester: _m, ...d }, i): BatchOp => {
    const data: Record<string, unknown> = { ...d, ...tf };
    if (o.kind === 'teachers') {
      if (!o.sameYear) data.cumulativeLoad = 0;
      if (o.clearHomeroom) data.homeroom = null;
    }
    return { type: 'set', ref: ref(o.kind, ids[i]!), data };
  });
}

/** 가장 최근 다른 학기(같은 학교) 명단: 새 프로젝트를 만들 때 이어받을 후보 */
export function latestRoster(everything: Doc[], target: TermRef): { term: TermRef; docs: Doc[] } | null {
  const all = everything.filter((d) => !(d as { temporary?: boolean }).temporary);
  const key = termKey(target);
  if (all.some((d) => d.term === key)) return null; // 이미 이 학기 명단이 있으면 가져올 필요 없음
  const terms = [...new Set(all.flatMap((d) => (d.term && d.term !== key ? [d.term] : [])))]
    .flatMap((k) => parseTermKey(k) ?? [])
    .filter((t) => t.school === target.school.trim())
    .sort(byRecent);
  const src = terms[0];
  return src ? { term: src, docs: all.filter((d) => d.term === termKey(src)) } : null;
}

/** 목록에 보여 줄 설명 (교사: 이름 교과 이메일, 시험실: 실명 학년-반) */
function describe(kind: RosterKind, d: Doc): string {
  if (kind === 'rooms') {
    const r = d as WithId<RoomDoc>;
    return `${r.name}${r.grade ? ` · ${r.grade}학년` : ''}`;
  }
  const t = d as WithId<TeacherDoc>;
  return [t.name, t.subject, t.email].filter(Boolean).join(' · ');
}

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
 * 이 학기에 이미 있는 대상(이메일·이름·실명 기준)은 건너뛴다. 목록에서 체크한 것만 가져온다.
 */
export function RosterImportDialog({ kind, target, all: everything, onClose }: { kind: RosterKind; target: TermRef; all: Doc[]; onClose: () => void }) {
  // 임시 감독자는 그 시험에만 쓰므로 불러오지 않는다
  const all = everything.filter((d) => !(d as { temporary?: boolean }).temporary);
  const targetKey = termKey(target);
  const legacy = all.filter((d) => !d.term);
  const sources = useMemo(() => {
    const keys = [...new Set(all.flatMap((d) => (d.term && d.term !== targetKey ? [d.term] : [])))];
    return keys.flatMap((k) => parseTermKey(k) ?? []).sort(byRecent);
  }, [all, targetKey]);
  // 학기별 시험 이름 (같은 학기의 시험들은 교사·시험실 명단을 함께 쓴다)
  const sessions = useSessions();
  const examsOf = (k: string) =>
    sessions.data.filter((x) => termKey(sessionTerm(x)) === k).map((x) => x.examName);
  const sameTermExams = examsOf(targetKey);
  const [source, setSource] = useState<string | null>(null);
  const [clearHomeroom, setClearHomeroom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 가져올 대상 (처음에는 모두 체크)
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  const src = source === 'legacy' ? null : source ? parseTermKey(source) : null;
  const sameYear = Boolean(src && src.school === target.school && src.year === target.year);
  useEffect(() => setClearHomeroom(Boolean(src) && !sameYear), [src, sameYear]);

  const existing = new Set(all.filter((d) => d.term === targetKey).map((d) => sameKey(kind, d)));
  const picked = source === 'legacy' ? legacy : all.filter((d) => d.term === source);
  const fresh = picked.filter((d) => !existing.has(sameKey(kind, d)));
  const freshKey = fresh.map((d) => d.id).join(',');
  // 다른 학기를 고르면 그 학기 대상을 모두 체크한 상태로 시작
  useEffect(() => {
    setChecked(new Set(freshKey ? freshKey.split(',') : []));
    setSearch('');
  }, [freshKey]);
  const chosen = fresh.filter((d) => checked.has(d.id));
  const q = search.trim().toLowerCase();
  const shown = [...fresh]
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
    .filter((d) => !q || describe(kind, d).toLowerCase().includes(q));
  const toggle = (id: string, on: boolean) => {
    const next = new Set(checked);
    if (on) next.add(id);
    else next.delete(id);
    setChecked(next);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    const ops = rosterCopyOps({ kind, all, chosen, legacy: source === 'legacy', target, sameYear, clearHomeroom });
    try {
      await commitOps(ops, `${KIND_LABEL[kind]} 명단 불러오기`);
      toast(`${KIND_LABEL[kind]} ${chosen.length}${kind === 'teachers' ? '명을' : '개를'} ${termLabel(target)}(으)로 불러왔습니다.`);
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
        {sameTermExams.length > 1 && (
          <p className="rounded-xl bg-bg p-3 text-muted">
            같은 학기의 시험({sameTermExams.join(', ')})은 이 {KIND_LABEL[kind]} 명단을 함께 씁니다. 따로 불러오지 않아도 됩니다.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {sources.map((t) => {
            const k = termKey(t);
            return (
              <Button key={k} variant={source === k ? 'primary' : 'secondary'} aria-pressed={source === k} onClick={() => setSource(k)}>
                {termLabel(t)} ({all.filter((d) => d.term === k).length})
                {examsOf(k).length > 0 && <span className="ml-1 font-normal text-muted">· {examsOf(k).join(', ')}</span>}
              </Button>
            );
          })}
          {legacy.length > 0 && (
            <Button variant={source === 'legacy' ? 'primary' : 'secondary'} aria-pressed={source === 'legacy'} onClick={() => setSource('legacy')}>
              학기 미지정 (예전 자료 {legacy.length})
            </Button>
          )}
        </div>
        {sources.length === 0 && legacy.length === 0 && (
          <p className="text-muted">다른 학기에 저장된 {KIND_LABEL[kind]} 명단이 없어 불러올 것이 없습니다. 이 학기 명단은 그대로 쓰면 됩니다.</p>
        )}
        {source && (
          <div className="grid gap-2 rounded-xl bg-bg p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">
                {fresh.length}
                {kind === 'teachers' ? '명' : '개'} 중 {chosen.length}
                {kind === 'teachers' ? '명' : '개'} 선택
                {picked.length > fresh.length && (
                  <span className="font-normal text-muted"> (이 학기에 이미 있는 {picked.length - fresh.length}건은 제외)</span>
                )}
              </p>
              <div className="flex gap-1">
                <Button variant="ghost" onClick={() => setChecked(new Set([...checked, ...shown.map((d) => d.id)]))}>
                  {q ? '검색 결과 모두 선택' : '모두 선택'}
                </Button>
                <Button variant="ghost" onClick={() => setChecked(new Set([...checked].filter((id) => !shown.some((d) => d.id === id))))}>
                  {q ? '검색 결과 선택 해제' : '모두 해제'}
                </Button>
              </div>
            </div>
            {fresh.length > 8 && (
              <input
                type="search"
                aria-label="불러올 명단 검색"
                placeholder={kind === 'teachers' ? '이름·교과·이메일 검색' : '실명 검색'}
                className="min-h-12 rounded-xl border border-line bg-surface px-4"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            )}
            <ul className="grid max-h-72 gap-1 overflow-y-auto rounded-xl border border-line bg-surface p-2 sm:grid-cols-2">
              {shown.map((d) => (
                <li key={d.id}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 hover:bg-bg">
                    <input
                      type="checkbox"
                      className="size-5 accent-primary"
                      aria-label={`${d.name} 가져오기`}
                      checked={checked.has(d.id)}
                      onChange={(e) => toggle(d.id, e.target.checked)}
                    />
                    <span className="font-semibold">{d.name}</span>
                    <span className="truncate text-sm text-muted">{describe(kind, d).slice(d.name.length)}</span>
                  </label>
                </li>
              ))}
              {shown.length === 0 && <li className="p-2 text-muted">검색 결과가 없습니다.</li>}
            </ul>
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
          <Button onClick={() => void save()} disabled={busy || !source || chosen.length === 0}>
            {busy ? '불러오는 중…' : `${chosen.length ? `${chosen.length}${kind === 'teachers' ? '명' : '개'} ` : ''}불러오기`}
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            취소
          </Button>
        </div>
      </div>
    </Modal>
  );
}
