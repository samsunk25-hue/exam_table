import { useState } from 'react';
import { Alert, Button } from '@/components/ui';
import { callAiAvailability, errorMessage } from '@/lib/firebase';

export interface AvailabilityTextResult {
  teacherId: string | null;
  cells: { date: string; period: number }[];
  reason: string;
}

/**
 * 문장으로 불가 시간 입력: "11/3 오전 출장" → AI가 표의 칸을 골라 준다.
 * 저장은 하지 않고 골라진 칸을 보여 주기만 하며, 제출은 기존 제출 버튼으로 한다.
 */
export function AvailabilityText({
  sessionId,
  teacherId,
  placeholder,
  onResult,
}: {
  sessionId: string;
  teacherId?: string;
  placeholder: string;
  onResult: (r: AvailabilityTextResult) => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const ask = async () => {
    setBusy(true);
    setError(null);
    setNotes([]);
    try {
      const { data } = await callAiAvailability({ sessionId, text: text.trim(), ...(teacherId ? { teacherId } : {}) });
      setNotes(data.notes);
      if (data.cells.length === 0) {
        setError('시험 시간 중에서 고를 칸을 찾지 못했습니다. 날짜와 교시를 조금 더 자세히 적어 주세요.');
        return;
      }
      if (!data.teacherId) return; // 관리자가 이름 없이 적은 경우: 안내(notes)만 보이고 글은 남겨 둔다
      onResult(data);
      setText('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          aria-label="문장으로 불가 시간 입력"
          className="min-h-12 flex-1 rounded-xl border border-line px-3"
          placeholder={placeholder}
          value={text}
          maxLength={1000}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && text.trim() && !busy) void ask();
          }}
        />
        <Button disabled={busy || !text.trim()} onClick={() => void ask()}>
          {busy ? 'AI가 읽는 중…' : '칸 고르기'}
        </Button>
      </div>
      {error && (
        <div className="mt-2">
          <Alert>{error}</Alert>
        </div>
      )}
      {notes.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-sm text-muted">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
