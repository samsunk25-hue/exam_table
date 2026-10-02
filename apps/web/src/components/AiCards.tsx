import { useState } from 'react';
import { Alert, Button, Card, Spinner, CardTitle } from '@/components/ui';
import { callAiExplainDuties, errorMessage } from '@/lib/firebase';

/** AI 답(짧은 문단과 "- " 목록)을 그대로 보여 준다 */
export function AiText({ text }: { text: string }) {
  const blocks: { list: boolean; lines: string[] }[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const list = /^[-•]\s+/.test(line);
    const last = blocks[blocks.length - 1];
    if (last && last.list === list && list) last.lines.push(line.replace(/^[-•]\s+/, ''));
    else blocks.push({ list, lines: [list ? line.replace(/^[-•]\s+/, '') : line] });
  }
  return (
    <div className="grid gap-2 leading-relaxed">
      {blocks.map((b, i) =>
        b.list ? (
          <ul key={i} className="list-disc pl-5">
            {b.lines.map((l, j) => (
              <li key={j}>{l}</li>
            ))}
          </ul>
        ) : (
          <p key={i}>{b.lines[0]}</p>
        ),
      )}
    </div>
  );
}

/** 관리자: 교사를 골라 "왜 이렇게 배정됐나요?"를 AI가 쉬운 말로 (교사 문의에 답할 때) */
export function ExplainDutiesCard({ sessionId, teachers }: { sessionId: string; teachers: { id: string; name: string }[] }) {
  const [teacherId, setTeacherId] = useState('');
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ask = async () => {
    setBusy(true);
    setError(null);
    try {
      setText((await callAiExplainDuties({ sessionId, teacherId })).data.text);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="no-print">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle icon="🤖">교사별 배정 이유 (AI)</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="설명할 교사"
            className="min-h-12 rounded-xl border border-line bg-surface px-3"
            value={teacherId}
            onChange={(e) => {
              setTeacherId(e.target.value);
              setText(null);
            }}
          >
            <option value="">교사를 고르세요</option>
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <Button variant={text ? 'secondary' : 'primary'} onClick={() => void ask()} disabled={busy || !teacherId}>
            {busy ? 'AI가 살펴보는 중…' : text ? '다시 설명 듣기' : 'AI에게 설명 듣기'}
          </Button>
        </div>
      </div>
      {!text && !busy && !error && (
        <p className="mt-1 text-muted">교사가 "왜 이렇게 배정됐나요?"라고 물을 때, 그 교사의 감독 횟수·시간이 정해진 이유와 형평성을 AI가 쉬운 말로 정리해 줍니다. (관리자만 보입니다)</p>
      )}
      {busy && <Spinner />}
      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}
      {text && (
        <div className="mt-3 rounded-xl bg-bg p-4">
          <AiText text={text} />
        </div>
      )}
    </Card>
  );
}
