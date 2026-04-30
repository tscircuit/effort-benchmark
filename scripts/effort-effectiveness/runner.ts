import * as autorouterModule from "@tscircuit/capacity-autorouter"
import type {
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "@tscircuit/capacity-autorouter"
import { computeRouteQualityMetrics } from "./quality"
import type { EffortBenchmarkTask, EffortWorkerResult } from "./types"
import { convertToCircuitJson } from "../lib/convert-to-circuit-json"
import { getDrcErrors, RELAXED_DRC_OPTIONS } from "../lib/drc"

type SolverInstance = {
  solved?: boolean
  failed?: boolean
  srjWithPointPairs?: SimpleRouteJson
  solve?: () => void | Promise<void>
  solveAsync?: () => Promise<void>
  getOutputSimplifiedPcbTraces?: () => SimplifiedPcbTrace[]
}

type SolverOptions = {
  effort: number
}

const getSolverConstructor = (solverName: string) => {
  const ctor = (autorouterModule as Record<string, unknown>)[solverName]
  if (typeof ctor !== "function") {
    throw new Error(`Solver "${solverName}" was not found`)
  }

  return ctor as new (
    srj: SimpleRouteJson,
    opts?: SolverOptions,
  ) => SolverInstance
}

const createFailedResult = (
  task: EffortBenchmarkTask,
  elapsedTimeMs: number,
  error: string,
): EffortWorkerResult => ({
  solverName: task.solverName,
  scenarioName: task.scenarioName,
  effort: task.effort,
  elapsedTimeMs,
  didSolve: false,
  didTimeout: false,
  relaxedDrcPassed: false,
  routeQuality: null,
  error,
})

export const runTask = async (
  task: EffortBenchmarkTask,
): Promise<EffortWorkerResult> => {
  const SolverConstructor = getSolverConstructor(task.solverName)
  const solver = new SolverConstructor(task.scenario, { effort: task.effort })
  const start = performance.now()
  let solveError: string | undefined

  try {
    if (typeof solver.solveAsync === "function") {
      await solver.solveAsync()
    } else if (typeof solver.solve === "function") {
      await solver.solve()
    } else {
      throw new Error("Solver does not implement solve() or solveAsync()")
    }
  } catch (error) {
    solver.solved = false
    solveError = error instanceof Error ? error.message : String(error)
  }

  const elapsedTimeMs = performance.now() - start
  const didSolve = Boolean(solver.solved)

  if (!didSolve) {
    return createFailedResult(
      task,
      elapsedTimeMs,
      solveError ?? "Solver did not report success",
    )
  }

  try {
    const scoredSrj = solver.srjWithPointPairs ?? task.scenario
    const traces = solver.failed
      ? []
      : (solver.getOutputSimplifiedPcbTraces?.() ?? [])
    const circuitJson = convertToCircuitJson(
      scoredSrj,
      traces,
      scoredSrj.minTraceWidth,
      scoredSrj.minViaDiameter,
    )
    const { errors } = getDrcErrors(circuitJson, RELAXED_DRC_OPTIONS)

    return {
      solverName: task.solverName,
      scenarioName: task.scenarioName,
      effort: task.effort,
      elapsedTimeMs,
      didSolve,
      didTimeout: false,
      relaxedDrcPassed: errors.length === 0,
      routeQuality: computeRouteQualityMetrics(scoredSrj, traces),
    }
  } catch (error) {
    return createFailedResult(
      task,
      elapsedTimeMs,
      error instanceof Error ? error.message : String(error),
    )
  }
}
