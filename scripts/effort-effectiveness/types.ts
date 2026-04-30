import type { SimpleRouteJson } from "@tscircuit/capacity-autorouter"

export type EffortBenchmarkTask = {
  solverName: string
  scenarioName: string
  scenario: SimpleRouteJson
  effort: number
}

export type RouteQualityMetrics = {
  hardDrcErrorCount: number
  softDrcErrorCount: number
  viaCount: number
  layerChangeCount: number
  bendCount: number
  totalLength: number
  penalty: number
}

export type EffortWorkerTaskMessage = {
  taskId: number
  task: EffortBenchmarkTask
}

export type EffortWorkerResult = {
  solverName: string
  scenarioName: string
  effort: number
  elapsedTimeMs: number
  didSolve: boolean
  didTimeout: boolean
  relaxedDrcPassed: boolean
  routeQuality: RouteQualityMetrics | null
  error?: string
}

export type EffortWorkerResultMessage = {
  taskId: number
  result: EffortWorkerResult
}

export type EffortComparisonStatus =
  | "improved"
  | "regressed"
  | "same"
  | "solve_upgrade"
  | "solve_regression"
  | "both_unsolved"
  | "metric_error"

export type EffortComparisonRecord = {
  solverName: string
  scenarioName: string
  baselineEffort: number
  candidateEffort: number
  baselineResult: EffortWorkerResult
  candidateResult: EffortWorkerResult
  status: EffortComparisonStatus
  penaltyDelta: number | null
  hardDrcDelta: number | null
  softDrcDelta: number | null
  viaDelta: number | null
  layerChangeDelta: number | null
  bendDelta: number | null
  totalLengthDelta: number | null
  elapsedTimeDeltaMs: number
}

export type EffortComparisonSummary = {
  solverName: string
  baselineEffort: number
  candidateEffort: number
  scenarioCount: number
  comparableScenarioCount: number
  improvedCount: number
  regressedCount: number
  sameCount: number
  solveUpgradeCount: number
  solveRegressionCount: number
  bothUnsolvedCount: number
  metricErrorCount: number
  hardDrcImprovedCount: number
  hardDrcRegressedCount: number
  softDrcImprovedCount: number
  softDrcRegressedCount: number
  medianPenaltyDelta: number | null
  averagePenaltyDelta: number | null
  medianViaDelta: number | null
  medianLengthDelta: number | null
  medianElapsedTimeDeltaMs: number | null
}

export type EffortEffectivenessReport = {
  version: 1
  datasetName: string
  scenarioCount: number
  solverNames: string[]
  baselineEffort: number
  candidateEffort: number
  summary: EffortComparisonSummary[]
  runs: EffortWorkerResult[]
  comparisons: EffortComparisonRecord[]
}
