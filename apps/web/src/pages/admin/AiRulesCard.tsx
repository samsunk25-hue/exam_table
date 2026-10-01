import { useState } from 'react';
import { nextId, type ConstraintDoc, type TeacherDoc } from '@sim/shared';
import { toast } from '@/components/Toast';
import { Alert, Button, Card, CardTitle } from '@/components/ui';
import { commitOps, ref, useCollection } from '@/lib/data';
import { callAiRules, errorMessage } from '@/lib/firebase';
import type { ExamSession } from '@/lib/sessions';

const EFFECT = (c: ConstraintDoc) =>
  c.priority === 'HARD' ? { text: '금지', cls: 'bg-alert-soft text-alert' } : (c.penalty ?? -50) < 0 ? { text: '피하기', cls: 'bg-bg text-ink' } : { text: '우선', cls: 'bg-mint-soft text-ink' };

/** 규칙 한 줄 설명 (AI 규칙은 label, 예전 규칙은 종류로) */
function describe(c: ConstraintDoc, name: (id: string) => string): string {
  if (c.label) return c.label;
  const who = c.teacherId === '*' ? '모든 교사' : name(c.teacherId);
  if (c.type === 'HOMEROOM_EXCLUDE') return `${who}: 자기 반 감독 제외`;
  if (c.type === 'SUBJECT_EXCLUDE') return `${who}: ${c.target} 시험 감독 제외`;
  if (c.type === 'SLOT_EXCLUDE') return `${who}: ${c.target} 감독 제외`;
  return `${who}: 규칙`;
}

/**
 * 글로 쓰는 고려사항: 관리자가 문장으로 적으면 AI가 배정 규칙(금지·피하기·우선)으로 바꾼다.
 * 미리보기에서 고른 것만 저장하고, 저장한 규칙은 자동 배정·수동 편집 후보에 바로 반영된다.
 */
export function AiRulesCard({ session, editable }: { session: ExamSession; editable: boolean }) {
  const path = `sessions/${session.id}/constraints`;
  const saved = useCollection<ConstraintDoc>(path);
  const teachers = useCollection<TeacherDoc>('teachers');
  const name = (id: string) => teachers.data.find((t) => t.id === id)?.name ?? id;
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ rules: ConstraintDoc[]; notes: string[]; pick: boolean[] } | null>(null);

  const ask = async () => {
    setBusy(true);
    setError(null);
    try {
      const { data } = await callAiRules({ sessionId: session.id, text: text.trim() });
      setPreview({ rules: data.rules, notes: data.notes, pick: data.rules.map(() => true) });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!preview) return;
    const chosen = preview.rules.filter((_, i) => preview.pick[i]);
    if (!chosen.length) return;
    const ids = nextId('C', saved.data.map((c) => c.id), chosen.length);
    try {
      await commitOps(
        chosen.map((c, i) => ({ type: 'set' as const, ref: ref(path, ids[i]!), data: { ...c, sourceText: text.trim() } })),
        `고려사항 규칙 ${chosen.length}개 추가`,
      );
      toast(`규칙 ${chosen.length}개를 저장했습니다. 다음 자동 배정부터 반영됩니다.`);
      setPreview(null);
      setText('');
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const remove = async (c: ConstraintDoc & { id: string }) => {
    try {
      await commitOps([{ type: 'delete', ref: ref(path, c.id) }], `규칙 삭제: ${describe(c, name)}`);
    } catch (e) {
      toast(errorMessage(e), 'alert');
    }
  };

  return (
    <Card>
      <CardTitle icon="✨">글로 쓰는 고려사항 (AI)</CardTitle>
      <p className="mt-1 text-muted">
        미리 정해 둔 설정에 없는 사정을 문장으로 적으면 AI가 배정 규칙으로 바꿉니다. 저장 전에 미리보기로 확인합니다. (관리자 관리 &gt; 내 AI 키 필요)
      </p>
      {editable && (
        <>
          <textarea
            aria-label="고려사항"
            rows={4}
            className="mt-3 w-full rounded-xl border border-line p-3"
            placeholder={'예) 김국어 선생님은 11/3 1교시에 병원 진료라 빼 주세요.\n이수학 선생님은 3학년 정감독을 가급적 피해 주세요.\n복도 감독은 체육과 선생님께 먼저 맡겨 주세요.'}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <Button className="mt-2" disabled={busy || !text.trim()} onClick={() => void ask()}>
            {busy ? 'AI가 읽는 중…' : 'AI로 규칙 만들기'}
          </Button>
        </>
      )}
      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}

      {preview && (
        <section aria-label="규칙 미리보기" className="mt-4 rounded-xl border border-primary p-4">
          <h3 className="font-bold">미리보기 — 저장할 규칙을 고르세요</h3>
          {preview.rules.length === 0 && <p className="mt-2 text-muted">만들 수 있는 규칙이 없습니다.</p>}
          <ul className="mt-2 grid gap-2">
            {preview.rules.map((c, i) => (
              <li key={i}>
                <label className="flex min-h-11 cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={preview.pick[i]}
                    onChange={(e) => setPreview({ ...preview, pick: preview.pick.map((p, j) => (j === i ? e.target.checked : p)) })}
                  />
                  <span className={`rounded-full px-2 py-0.5 text-sm font-semibold ${EFFECT(c).cls}`}>{EFFECT(c).text}</span>
                  {describe(c, name)}
                </label>
              </li>
            ))}
          </ul>
          {preview.notes.length > 0 && (
            <div className="mt-3">
              <Alert tone="info">
                {preview.notes.map((n, i) => (
                  <p key={i}>{n}</p>
                ))}
              </Alert>
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <Button disabled={!preview.pick.some(Boolean)} onClick={() => void apply()}>
              고른 규칙 저장
            </Button>
            <Button variant="ghost" onClick={() => setPreview(null)}>
              취소
            </Button>
          </div>
        </section>
      )}

      {saved.data.length > 0 && (
        <section aria-label="저장된 규칙" className="mt-4">
          <h3 className="font-bold">저장된 규칙 {saved.data.length}개</h3>
          <ul className="mt-2 grid gap-1">
            {saved.data.map((c) => (
              <li key={c.id} className="flex min-h-11 items-center gap-3">
                <span className={`rounded-full px-2 py-0.5 text-sm font-semibold ${EFFECT(c).cls}`}>{EFFECT(c).text}</span>
                <span className="flex-1" title={c.sourceText}>
                  {describe(c, name)}
                </span>
                {editable && (
                  <button
                    type="button"
                    aria-label={`${describe(c, name)} 삭제`}
                    className="size-10 cursor-pointer rounded-lg text-lg hover:bg-alert-soft"
                    onClick={() => void remove(c)}
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </Card>
  );
}
