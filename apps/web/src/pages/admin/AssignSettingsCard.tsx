import { useState } from 'react';
import { EXAM_WRITER_RULE_LABEL, isSetupEditable, type BaseTimetableDoc, type ExamWriterRule, type SlotDoc, type TeacherDoc } from '@sim/shared';
import { Link } from 'react-router';
import { Alert, Card, Toggle, CardTitle } from '@/components/ui';
import { useCollection } from '@/lib/data';
import { errorMessage } from '@/lib/firebase';
import { termWhere, updateSessionSettings, type ExamSession } from '@/lib/sessions';
import { TimetableUpload } from './BundleCard';

/**
 * 배정 설정 (자동 배정 화면 위): 기초시간표는 올리기만 하면 반영되고(스위치 없음),
 * 시험 없는 학년 수업·출제 교사 규칙만 고른다.
 */
export function AssignSettingsCard({ session }: { session: ExamSession }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editable = isSetupEditable(session.status);
  const slots = useCollection<SlotDoc>(`sessions/${session.id}/slots`);
  const teachers = useCollection<TeacherDoc>('teachers', termWhere(session));
  const timetable = useCollection<BaseTimetableDoc>(`sessions/${session.id}/baseTimetable`);
  const classOn = session.settings.classDuringExam !== false;
  const noTimetable = !timetable.loading && timetable.data.every((d) => d.entries.length === 0);
  // 별도시험장(연장)이 배치된 시험이 있을 때만 우선 교사를 고른다
  const hasExtended = slots.data.some((x) => x.rooms.some((p) => p.roomType === 'EXTENDED'));
  // 예전 설정(정·부 모두)은 두 목록 모두에 보이고, 고치면 두 목록으로 나눠 저장한다
  const old = session.settings.extendedPreferred ?? [];
  const lists = {
    chief: [...new Set([...old, ...(session.settings.extendedChief ?? [])])],
    assistant: [...new Set([...old, ...(session.settings.extendedAssistant ?? [])])],
  };
  const setList = (key: 'chief' | 'assistant', ids: string[]) => {
    const next = { ...lists, [key]: ids };
    return save({ extendedChief: next.chief, extendedAssistant: next.assistant, extendedPreferred: [] });
  };
  const nameOf = (id: string) => teachers.data.find((t) => t.id === id)?.name ?? id;

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
      <TimetableUpload session={session} />
      <div className="mt-3">
        <Toggle
          label="시험 없는 학년은 수업 (수업 중인 교사는 감독 제외·수업 시간도 업무 점수)"
          hint="같은 시간에 시험을 보지 않는 학년은 수업한다고 보고, 그 시간 그 학년 수업이 있는 교사는 감독에서 빼고 수업 1시간을 0.8점으로 셉니다. 감독과 수업을 합쳐 3교시 연속은 배정하지 않습니다. 기본 켜짐."
          checked={classOn}
          disabled={!editable || saving}
          onChange={(v) => void save({ classDuringExam: v })}
        />
        {/* 켰는데 기초시간표가 없으면 누가 수업하는지 알 수 없다 */}
        {classOn && noTimetable && (
          <div className="mt-2">
            <Alert tone="info">
              누가 수업하는지 알려면 기초시간표가 필요합니다.{' '}
              <Link to={`/admin/sessions/${session.id}`} className="font-semibold text-primary-strong underline underline-offset-4">
                준비 › 기초 자료 한 번에 입력에서 기초시간표를 올려 주세요 →
              </Link>
            </Alert>
          </div>
        )}
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
      {hasExtended && (
        <div className="mt-4 grid max-w-2xl gap-2">
          <span className="font-semibold">별도시험장 감독 우선 교사</span>
          {(
            [
              ['chief', '정감독(연장)'],
              ['assistant', '부감독'],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="flex flex-wrap items-center gap-2">
              <span className="w-28 shrink-0 text-sm font-semibold text-muted">{label}</span>
              {lists[key].map((id) => (
                <span key={id} className="inline-flex min-h-10 items-center gap-1 rounded-full bg-primary-soft pl-3 font-semibold text-primary-strong">
                  {nameOf(id)}
                  <button
                    type="button"
                    aria-label={`${label} ${nameOf(id)} 빼기`}
                    disabled={!editable || saving}
                    className="min-h-10 min-w-10 cursor-pointer rounded-full hover:bg-primary/15"
                    onClick={() => void setList(key, lists[key].filter((x) => x !== id))}
                  >
                    ✕
                  </button>
                </span>
              ))}
              <select
                aria-label={`별도시험장 ${label} 우선 교사 추가`}
                className="min-h-12 rounded-xl border border-line bg-surface px-3 disabled:bg-bg"
                value=""
                disabled={!editable || saving}
                onChange={(e) => e.target.value && void setList(key, [...lists[key], e.target.value])}
              >
                <option value="">+ 교사 추가</option>
                {[...teachers.data]
                  .filter((t) => t.active && !lists[key].includes(t.id))
                  .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.subject ? ` (${t.subject})` : ''}
                    </option>
                  ))}
              </select>
            </div>
          ))}
          <span className="text-sm text-muted">
            고른 교사를 별도시험장의 그 자리(정감독=연장 감독, 부감독)에 먼저 배정합니다 (불가시간·같은 시간 다른 감독은 그대로 지킴). 자동 배정을 다시 실행하면 반영됩니다.
          </span>
        </div>
      )}
      {!editable && <p className="mt-2 text-sm text-muted">교사 공개 이후에는 설정을 바꿀 수 없습니다.</p>}
      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}
    </Card>
  );
}
