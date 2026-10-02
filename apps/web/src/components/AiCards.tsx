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

/** 교사: "왜 이렇게 배정됐나요?" — 내 감독 이유를 AI가 쉬운 말로 */
export function ExplainDutiesCard({ sessionId }: { sessionId: string }) {
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ask = async () => {
    setBusy(true);
    setError(null);
    try {
      setText((await callAiExplainDuties({ sessionId })).data.text);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="no-print">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle icon="🤖">왜 이렇게 배정됐나요?</CardTitle>
        <Button variant={text ? 'secondary' : 'primary'} onClick={() => void ask()} disabled={busy}>
          {busy ? 'AI가 살펴보는 중…' : text ? '다시 설명 듣기' : 'AI에게 설명 듣기'}
        </Button>
      </div>
      {!text && !busy && !error && (
        <p className="mt-1 text-muted">내 감독 횟수·시간이 정해진 이유와 다른 선생님들과 비교한 형평성을 AI가 쉬운 말로 설명해 드립니다.</p>
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
