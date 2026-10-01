import { useState } from 'react';
import { toast } from '@/components/Toast';
import { Alert, Button, Card, Spinner, CardTitle } from '@/components/ui';
import { callAiExplainDuties, callAiFairnessReport, callApplyChanges, errorMessage } from '@/lib/firebase';

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

type Move = { seatId: string; from: string; to: string; label: string; effect: string };

/** 관리자: AI 공정성 점검 리포트 + 조건을 지키는 감독 옮기기 제안 (바로 적용) */
export function FairnessReportCard({ sessionId, canApply }: { sessionId: string; canApply: boolean }) {
  const [report, setReport] = useState<{ text: string; moves: Move[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const { data } = await callAiFairnessReport({ sessionId });
      setReport({ text: data.text, moves: data.moves });
      setApplied(new Set());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const apply = async (m: Move) => {
    try {
      await callApplyChanges({ sessionId, changes: [{ seatId: m.seatId, teacherId: m.to }], label: 'AI 공정성 제안' });
      setApplied(new Set([...applied, m.seatId]));
      toast(`옮겼습니다: ${m.label}`);
    } catch (e) {
      toast(errorMessage(e), 'alert');
    }
  };
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle icon="🤖">AI 공정성 점검 리포트</CardTitle>
        <Button variant={report ? 'secondary' : 'primary'} onClick={() => void run()} disabled={busy}>
          {busy ? 'AI가 점검하는 중…' : report ? '다시 점검' : '리포트 만들기'}
        </Button>
      </div>
      {!report && !busy && !error && (
        <p className="mt-1 text-muted">업무 점수 편차, 부담이 몰린 교사, 피로 위험을 점검하고, 조건을 지키며 부담을 나누는 옮기기 방법을 제안합니다.</p>
      )}
      {busy && <Spinner />}
      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}
      {report && (
        <div className="mt-3 grid gap-4">
          <div className="rounded-xl bg-bg p-4">
            <AiText text={report.text} />
          </div>
          {report.moves.length > 0 && (
            <div>
              <h3 className="mb-2 font-bold">옮기기 제안 (불가시간·동시간 등 조건을 지킴)</h3>
              <ul className="grid gap-2">
                {report.moves.map((m) => (
                  <li key={m.seatId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3">
                    <div>
                      <div className="font-semibold">{m.label}</div>
                      <div className="text-sm text-muted">학년도 누적: {m.effect}</div>
                    </div>
                    {applied.has(m.seatId) ? (
                      <span className="font-semibold text-[#1e8449]">✓ 적용됨</span>
                    ) : canApply ? (
                      <Button variant="secondary" onClick={() => void apply(m)} aria-label={`제안 적용: ${m.label}`}>
                        적용
                      </Button>
                    ) : (
                      <span className="text-sm text-muted">시간표 편집에서 바꾸세요</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
