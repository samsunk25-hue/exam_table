import { useState } from 'react';
import { EXAM_WRITER_RULE_LABEL, isSetupEditable, type ExamWriterRule } from '@sim/shared';
import { Alert, Card, Toggle, CardTitle } from '@/components/ui';
import { errorMessage } from '@/lib/firebase';
import { updateSessionSettings, type ExamSession } from '@/lib/sessions';
import { TimetableUpload } from './BundleCard';

/**
 * 배정 설정 (자동 배정 화면 위): 기초시간표는 올리기만 하면 반영되고(스위치 없음),
 * 시험 없는 학년 수업·출제 교사 규칙만 고른다.
 */
export function AssignSettingsCard({ session }: { session: ExamSession }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editable = isSetupEditable(session.status);

  const save = async (patch: Partial<ExamSession['settings']>) => {
    setSaving(true);
    setError(null);
    try {
      await updateSessionSettings(session.id, { ...session.settings, ...patch });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardTitle icon="⚙️">배정 설정</CardTitle>
      <p className="mt-1 text-muted">
        기초시간표를 올리면 시험 시간에 그 반을 원래 가르치던 교사에게 가점(+50)을 주고, 아래 수업 규칙에 씁니다. 올리지 않으면 이 둘 없이 배정합니다.
      </p>
      <TimetableUpload session={session} />
      <div className="mt-3">
        <Toggle
          label="시험 없는 학년은 수업 (수업 중인 교사는 감독 제외·수업 시간도 업무 점수)"
          hint="같은 시간에 시험을 보지 않는 학년은 수업한다고 보고, 그 시간 그 학년 수업이 있는 교사는 감독에서 빼고 수업 1시간을 0.8점으로 셉니다. 감독과 수업을 합쳐 3교시 연속은 배정하지 않습니다. 기본 켜짐."
          checked={session.settings.classDuringExam !== false}
          disabled={!editable || saving}
          onChange={(v) => void save({ classDuringExam: v })}
        />
      </div>
      <label className="mt-4 grid max-w-xl gap-1">
        <span className="font-semibold">출제 교사 (자기 과목 시험 시간)</span>
        <select
          aria-label="출제 교사 규칙"
          className="min-h-12 rounded-xl border border-line bg-surface px-3 disabled:bg-bg"
          value={session.settings.examWriter ?? 'NONE'}
          disabled={!editable || saving}
          onChange={(e) => void save({ examWriter: e.target.value as ExamWriterRule })}
        >
          {Object.entries(EXAM_WRITER_RULE_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <span className="text-sm text-muted">담당 교과가 시험 과목과 같은 교사를 출제 교사로 봅니다. 시험 중 문항 질의에 대응하도록 복도 대기를 맡깁니다.</span>
      </label>
      {!editable && <p className="mt-2 text-sm text-muted">교사 공개 이후에는 설정을 바꿀 수 없습니다.</p>}
      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}
    </Card>
  );
}
