// 다중 시나리오(멀티버스): 최적화 목표(가중치)를 바꿔 서로 다른 관점의 전체 배정안을 만든다.
// 모든 안은 같은 하드 조건을 지키므로 어느 것을 적용해도 조건 위반은 없다.
import { runAssignment } from './engine';
import type { EngineInput, EngineResult, Settings } from './types';

export type ScenarioKey = 'BASE' | 'EQUITY' | 'NO_CONSECUTIVE' | 'SUBJECT_HALLWAY';

export interface Scenario {
  key: ScenarioKey;
  label: string;
  description: string;
  settings: Omit<Settings, 'useBaseTimetable'>;
}

export const SCENARIOS: Scenario[] = [
  {
    key: 'BASE',
    label: '기본안',
    description: 'PRD 기본 가중치 (기초시간표 일치 + 부담 형평성 + 연속 배정 감점)',
    settings: {},
  },
  {
    key: 'EQUITY',
    label: 'A안 · 형평성 극대화',
    description: '누적 업무부담이 낮은 교사를 강하게 우선하고, 기초시간표 일치보다 형평성을 앞세웁니다.',
    settings: {
      weights: { lowLoad: 60, highLoad: -80, lowLoadRatio: 0.3, highLoadRatio: 0.2, baseMatch: 25 },
      equityScoreTolerance: 60,
      maxEquityMoves: 5000,
    },
  },
  {
    key: 'NO_CONSECUTIVE',
    label: 'B안 · 연속 배정 배제',
    description: '같은 날 연달아 두 교시를 감독하는 배정을 가능한 한 모두 피합니다 (피할 수 없을 때만 허용).',
    settings: { weights: { consecutive: -1000 } },
  },
  {
    key: 'SUBJECT_HALLWAY',
    label: 'C안 · 출제 교사 복도 대기 우선',
    description: '시험 과목 담당 교사는 그 시험 시간에 교실 감독 대신 복도 대기에 우선 배정합니다 (문항 질의 대응).',
    settings: { weights: { examSubjectHallway: 60, examSubjectRoom: -60 } },
  },
];

export function scenarioInput(input: EngineInput, scenario: Scenario): EngineInput {
  const s = scenario.settings;
  return {
    ...input,
    settings: {
      ...input.settings,
      ...s,
      weights: { ...input.settings.weights, ...s.weights },
      roleWeights: { ...input.settings.roleWeights, ...s.roleWeights },
    },
  };
}

/** 기본안과 대안 시나리오를 모두 실행한다 */
export function runScenarios(input: EngineInput, keys: ScenarioKey[] = SCENARIOS.map((s) => s.key)): { scenario: Scenario; result: EngineResult }[] {
  return SCENARIOS.filter((s) => keys.includes(s.key)).map((scenario) => ({
    scenario,
    result: runAssignment(scenarioInput(input, scenario)),
  }));
}
