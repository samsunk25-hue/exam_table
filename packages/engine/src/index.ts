export * from './types';
export { runAssignment } from './engine';
export { buildEngineInput, overlappingPeriods, toRunDoc, type SessionData } from './adapter';
export { findSwapChains, type SwapChain, type SwapMove, type SwapRequest, type SwapOptions } from './swap';
export { SCENARIOS, runScenarios, scenarioInput, type Scenario, type ScenarioKey } from './scenarios';
export { validateAssignments, seatCandidates, type SeatCandidate } from './validate';
export {
  DEFAULT_WEIGHTS,
  DEFAULT_ROLE_WEIGHTS,
  ROLE_LABEL,
  EXCLUSION_LABEL,
  buildSeats,
  weekdayOf,
} from './context';
