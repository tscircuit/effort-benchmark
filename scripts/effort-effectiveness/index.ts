#!/usr/bin/env bun

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import * as os from "node:os"
import * as readline from "node:readline"
import type { SimpleRouteJson } from "@tscircuit/capacity-autorouter"
import { createJsonReport, createTextReport } from "./report"
import { loadScenarios } from "../load-scenarios"
import type {
  EffortBenchmarkTask,
  EffortComparisonRecord,
  EffortComparisonStatus,
  EffortComparisonSummary,
  EffortEffectivenessReport,
  EffortWorkerResult,
  EffortWorkerResultMessage,
  EffortWorkerTaskMessage,
} from "./types"
import { getSolverNames } from "../lib/solver-names"
import {
  formatRouteQualityBreakdown,
  ROUTE_QUALITY_FORMULA,
} from "./quality"

type EffortBenchmarkOptions = {
  solverName?: string
  scenarioLimit?: number
  concurrency: number
  compareEfforts: [number, number]
}

type WorkerTaskAssignment = {
  request: EffortWorkerTaskMessage
  startedAtMs: number
  timeout: ReturnType<typeof setTimeout>
}

type WorkerSlot = {
  id: number
  child: ChildProcessWithoutNullStreams
  stdoutReader: readline.Interface
  stderrReader: readline.Interface
  currentTask: WorkerTaskAssignment | null
}

type WorkerExecutionResult = {
  result: EffortWorkerResult
  restartWorker: boolean
}

const DEFAULT_TASK_TIMEOUT_PER_EFFORT_MS = 60 * 1000
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30 * 1000
const DEFAULT_TERMINATE_TIMEOUT_MS = 5 * 1000
const PENALTY_EPSILON = 1e-6

const formatTime = (timeMs: number | null) => {
  if (timeMs === null) return "n/a"
  return `${(timeMs / 1000).toFixed(1)}s`
}

const formatDurationLabel = (timeMs: number) =>
  timeMs < 1000 ? `${timeMs}ms` : formatTime(timeMs)

const parseCompareEffortsArg = (rawValue: string): [number, number] => {
  const parts = rawValue
    .split(",")
    .map((part) => Number.parseInt(part.trim(), 10))

  if (
    parts.length !== 2 ||
    parts.some((part) => !Number.isFinite(part) || part < 1)
  ) {
    throw new Error("--compare-efforts must look like 1,20")
  }

  if (parts[0] === parts[1]) {
    throw new Error("--compare-efforts requires two different effort values")
  }

  return [parts[0], parts[1]]
}

const parseArgs = (): EffortBenchmarkOptions => {
  const args = process.argv.slice(2)
  const defaultConcurrency =
    typeof os.availableParallelism === "function"
      ? os.availableParallelism()
      : os.cpus().length
  const options: EffortBenchmarkOptions = {
    concurrency: defaultConcurrency,
    compareEfforts: [1, 20],
  }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]

    if (arg === "--solver") {
      options.solverName = args[i + 1]
      i += 1
      continue
    }
    if (arg === "--scenario-limit") {
      options.scenarioLimit = Number.parseInt(args[i + 1], 10)
      i += 1
      continue
    }
    if (arg === "--concurrency") {
      const rawConcurrency = args[i + 1]
      options.concurrency =
        rawConcurrency === "auto"
          ? defaultConcurrency
          : Number.parseInt(rawConcurrency, 10)
      i += 1
      continue
    }
    if (arg === "--compare-efforts") {
      options.compareEfforts = parseCompareEffortsArg(args[i + 1] ?? "")
      i += 1
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  if (!Number.isFinite(options.concurrency) || options.concurrency < 1) {
    throw new Error("--concurrency must be a positive integer")
  }

  if (
    options.scenarioLimit !== undefined &&
    (!Number.isFinite(options.scenarioLimit) || options.scenarioLimit < 1)
  ) {
    throw new Error("--scenario-limit must be a positive integer")
  }

  return options
}

const getPercentile = (values: number[], percentile: number): number | null => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = (sorted.length - 1) * percentile
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) return sorted[lower]
  const weight = index - lower
  return sorted[lower] + (sorted[upper] - sorted[lower]) * weight
}

const getAverage = (values: number[]) =>
  values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length

const getTaskTimeoutPerEffortMs = () => {
  const rawTimeout =
    Bun.env.BENCHMARK_TASK_TIMEOUT_PER_EFFORT_MS?.trim() ??
    Bun.env.BENCHMARK_TASK_TIMEOUT_MS?.trim()
  if (!rawTimeout) return DEFAULT_TASK_TIMEOUT_PER_EFFORT_MS

  const parsedTimeout = Number.parseInt(rawTimeout, 10)
  if (!Number.isFinite(parsedTimeout) || parsedTimeout < 1) {
    throw new Error(
      "BENCHMARK_TASK_TIMEOUT_PER_EFFORT_MS must be a positive integer",
    )
  }

  return parsedTimeout
}

const getHeartbeatIntervalMs = () => {
  const rawInterval = Bun.env.BENCHMARK_HEARTBEAT_INTERVAL_MS?.trim()
  if (!rawInterval) return DEFAULT_HEARTBEAT_INTERVAL_MS

  const parsedInterval = Number.parseInt(rawInterval, 10)
  if (!Number.isFinite(parsedInterval) || parsedInterval < 0) {
    throw new Error(
      "BENCHMARK_HEARTBEAT_INTERVAL_MS must be a non-negative integer",
    )
  }

  return parsedInterval
}

const getTerminateTimeoutMs = () => {
  const rawTimeout = Bun.env.BENCHMARK_TERMINATE_TIMEOUT_MS?.trim()
  if (!rawTimeout) return DEFAULT_TERMINATE_TIMEOUT_MS

  const parsedTimeout = Number.parseInt(rawTimeout, 10)
  if (!Number.isFinite(parsedTimeout) || parsedTimeout < 1) {
    throw new Error("BENCHMARK_TERMINATE_TIMEOUT_MS must be a positive integer")
  }

  return parsedTimeout
}

const withScenarioEffort = (
  scenario: SimpleRouteJson,
  effort: number,
): SimpleRouteJson & { effort: number } =>
  ({
    ...scenario,
    effort,
  }) as SimpleRouteJson & { effort: number }

const createChildProcess = () =>
  spawn(process.execPath, ["scripts/effort-effectiveness/worker.ts"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  })

const createWorkerSlot = (id: number): WorkerSlot => {
  const child = createChildProcess()
  child.stdout.setEncoding("utf8")
  child.stderr.setEncoding("utf8")

  return {
    id,
    child,
    stdoutReader: readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    }),
    stderrReader: readline.createInterface({
      input: child.stderr,
      crlfDelay: Infinity,
    }),
    currentTask: null,
  }
}

const terminateWorker = async (slot: WorkerSlot, context: string) => {
  const terminateTimeoutMs = getTerminateTimeoutMs()
  const closeInterfaces = () => {
    slot.stdoutReader.close()
    slot.stderrReader.close()
  }

  if (slot.child.killed || slot.child.exitCode !== null) {
    closeInterfaces()
    return
  }

  await new Promise<void>((resolve) => {
    let settled = false
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null

    const finish = () => {
      if (settled) return
      settled = true
      if (timeoutHandle) clearTimeout(timeoutHandle)
      slot.child.removeListener("close", onClose)
      closeInterfaces()
      resolve()
    }

    const onClose = () => finish()

    timeoutHandle = setTimeout(() => {
      console.warn(
        `[effort-benchmark] Child termination exceeded ${formatDurationLabel(terminateTimeoutMs)} while ${context}; continuing`,
      )
      finish()
    }, terminateTimeoutMs)

    slot.child.once("close", onClose)
    try {
      slot.child.kill("SIGKILL")
    } catch {
      finish()
    }
  })
}

const replaceWorker = async (slot: WorkerSlot) => {
  const previousWorker: WorkerSlot = {
    id: slot.id,
    child: slot.child,
    stdoutReader: slot.stdoutReader,
    stderrReader: slot.stderrReader,
    currentTask: slot.currentTask,
  }
  slot.currentTask = null
  const nextWorker = createWorkerSlot(slot.id)
  slot.child = nextWorker.child
  slot.stdoutReader = nextWorker.stdoutReader
  slot.stderrReader = nextWorker.stderrReader
  await terminateWorker(previousWorker, `replacing worker ${slot.id}`)
}

const createFailedResult = (
  task: EffortBenchmarkTask,
  elapsedTimeMs: number,
  error: string,
  didTimeout = false,
): EffortWorkerResult => ({
  solverName: task.solverName,
  scenarioName: task.scenarioName,
  effort: task.effort,
  elapsedTimeMs,
  didSolve: false,
  didTimeout,
  relaxedDrcPassed: false,
  routeQuality: null,
  error,
})

const getTaskTimeoutMs = (
  task: EffortBenchmarkTask,
) => {
  const baseTimeoutMs = getTaskTimeoutPerEffortMs()
  return baseTimeoutMs + baseTimeoutMs * task.effort
}

const executeTaskOnWorker = (
  slot: WorkerSlot,
  request: EffortWorkerTaskMessage,
): Promise<WorkerExecutionResult> =>
  new Promise((resolve) => {
    const taskTimeoutMs = getTaskTimeoutMs(request.task)
    const startedAtMs = performance.now()
    let settled = false

    const finish = (result: EffortWorkerResult, restartWorker: boolean) => {
      if (settled) return
      settled = true
      if (slot.currentTask) {
        clearTimeout(slot.currentTask.timeout)
        slot.currentTask = null
      }
      slot.stdoutReader.removeListener("line", onLine)
      slot.stderrReader.removeListener("line", onStderrLine)
      slot.child.removeListener("error", onError)
      slot.child.removeListener("exit", onExit)
      resolve({ result, restartWorker })
    }

    const getElapsedTimeMs = () =>
      Math.max(0, Math.round(performance.now() - startedAtMs))

    const onLine = (line: string) => {
      let message: EffortWorkerResultMessage
      try {
        message = JSON.parse(line) as EffortWorkerResultMessage
      } catch {
        return
      }

      if (message.taskId !== request.taskId) return
      finish(message.result, false)
    }

    const onStderrLine = (line: string) => {
      console.error(`[effort-worker ${slot.id}] ${line}`)
    }

    const onError = (error: Error) => {
      finish(
        createFailedResult(
          request.task,
          getElapsedTimeMs(),
          `Child process error: ${error.message}`,
        ),
        true,
      )
    }

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      finish(
        createFailedResult(
          request.task,
          getElapsedTimeMs(),
          `Child process exited unexpectedly (code=${code ?? "null"}, signal=${signal ?? "null"})`,
        ),
        true,
      )
    }

    const timeout = setTimeout(() => {
      finish(
        createFailedResult(
          request.task,
          taskTimeoutMs,
          `Timed out after ${formatDurationLabel(taskTimeoutMs)}`,
          true,
        ),
        true,
      )
    }, taskTimeoutMs)

    slot.currentTask = {
      request,
      startedAtMs,
      timeout,
    }

    slot.stdoutReader.on("line", onLine)
    slot.stderrReader.on("line", onStderrLine)
    slot.child.once("error", onError)
    slot.child.once("exit", onExit)

    try {
      slot.child.stdin.write(`${JSON.stringify(request)}\n`)
    } catch (error) {
      finish(
        createFailedResult(
          request.task,
          getElapsedTimeMs(),
          `Worker dispatch failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
        true,
      )
    }
  })

const runTasks = async (
  tasks: EffortBenchmarkTask[],
  concurrency: number,
) => {
  const workerCount = Math.min(concurrency, tasks.length)
  const heartbeatIntervalMs = getHeartbeatIntervalMs()
  const queue = tasks.map((task, index) => ({ taskId: index + 1, task }))
  const results = new Array<EffortWorkerResult>(queue.length)
  let completedTaskCount = 0

  const workers = Array.from({ length: workerCount }, (_, index) =>
    createWorkerSlot(index + 1),
  )

  const heartbeat =
    heartbeatIntervalMs > 0
      ? setInterval(() => {
          const activeWorkers = workers
            .filter((worker) => worker.currentTask)
            .map((worker) => {
              const currentTask = worker.currentTask
              if (!currentTask) return null
              const elapsedTimeMs = Math.max(
                0,
                Math.round(performance.now() - currentTask.startedAtMs),
              )
              return `worker ${worker.id}: ${currentTask.request.task.scenarioName}@${currentTask.request.task.effort}x ${formatDurationLabel(elapsedTimeMs)}`
            })
            .filter(Boolean)

          console.log(
            `[effort-benchmark] heartbeat ${completedTaskCount}/${tasks.length} complete, ${queue.length} queued, ${activeWorkers.length} running`,
          )

          if (activeWorkers.length > 0) {
            console.log(`[effort-benchmark] active ${activeWorkers.join(" | ")}`)
          }
        }, heartbeatIntervalMs)
      : null

  const runWorkerLoop = async (slot: WorkerSlot) => {
    while (queue.length > 0) {
      const request = queue.shift()
      if (!request) return

      const { result, restartWorker } = await executeTaskOnWorker(
        slot,
        request,
      )
      results[request.taskId - 1] = result
      completedTaskCount += 1

      const status = result.didTimeout
        ? "timed out"
        : result.didSolve
          ? "solved"
          : "failed"
      const suffix = result.error ? ` (${result.error})` : ""
      const routeQualitySuffix = result.routeQuality
        ? ` | ${formatRouteQualityBreakdown(result.routeQuality)}`
        : ""
      console.log(
        `[${result.solverName}] ${status} ${result.scenarioName}@${result.effort}x ${formatTime(result.elapsedTimeMs)}${suffix}${routeQualitySuffix}`,
      )

      if (restartWorker) {
        console.warn(
          `[effort-benchmark] Restarting worker ${slot.id} after ${result.scenarioName}@${result.effort}x`,
        )
        await replaceWorker(slot)
      }
    }
  }

  try {
    await Promise.all(workers.map((worker) => runWorkerLoop(worker)))
  } finally {
    if (heartbeat) clearInterval(heartbeat)
    for (const worker of workers) {
      await terminateWorker(worker, `shutting down worker ${worker.id}`)
    }
  }

  return results
}

const createComparisonRecord = (
  baselineResult: EffortWorkerResult,
  candidateResult: EffortWorkerResult,
  baselineEffort: number,
  candidateEffort: number,
): EffortComparisonRecord => {
  const baselineQuality = baselineResult.routeQuality
  const candidateQuality = candidateResult.routeQuality
  const penaltyDelta =
    baselineQuality && candidateQuality
      ? candidateQuality.penalty - baselineQuality.penalty
      : null
  const hardDrcDelta =
    baselineQuality && candidateQuality
      ? candidateQuality.hardDrcErrorCount - baselineQuality.hardDrcErrorCount
      : null
  const softDrcDelta =
    baselineQuality && candidateQuality
      ? candidateQuality.softDrcErrorCount - baselineQuality.softDrcErrorCount
      : null
  const viaDelta =
    baselineQuality && candidateQuality
      ? candidateQuality.viaCount - baselineQuality.viaCount
      : null
  const layerChangeDelta =
    baselineQuality && candidateQuality
      ? candidateQuality.layerChangeCount - baselineQuality.layerChangeCount
      : null
  const bendDelta =
    baselineQuality && candidateQuality
      ? candidateQuality.bendCount - baselineQuality.bendCount
      : null
  const totalLengthDelta =
    baselineQuality && candidateQuality
      ? candidateQuality.totalLength - baselineQuality.totalLength
      : null

  let status: EffortComparisonStatus
  if (!baselineResult.didSolve && !candidateResult.didSolve) {
    status = "both_unsolved"
  } else if (!baselineResult.didSolve && candidateResult.didSolve) {
    status = "solve_upgrade"
  } else if (baselineResult.didSolve && !candidateResult.didSolve) {
    status = "solve_regression"
  } else if (!baselineQuality || !candidateQuality) {
    status = "metric_error"
  } else if ((hardDrcDelta ?? 0) < 0) {
    status = "improved"
  } else if ((hardDrcDelta ?? 0) > 0) {
    status = "regressed"
  } else if ((penaltyDelta ?? 0) < -PENALTY_EPSILON) {
    status = "improved"
  } else {
    status = "regressed"
  }

  return {
    solverName: baselineResult.solverName,
    scenarioName: baselineResult.scenarioName,
    baselineEffort,
    candidateEffort,
    baselineResult,
    candidateResult,
    status,
    penaltyDelta,
    hardDrcDelta,
    softDrcDelta,
    viaDelta,
    layerChangeDelta,
    bendDelta,
    totalLengthDelta,
    elapsedTimeDeltaMs: candidateResult.elapsedTimeMs - baselineResult.elapsedTimeMs,
  }
}

const summarizeComparisons = (
  solverName: string,
  comparisons: EffortComparisonRecord[],
  baselineEffort: number,
  candidateEffort: number,
): EffortComparisonSummary => {
  const comparable = comparisons.filter((comparison) =>
    ["improved", "regressed", "same"].includes(comparison.status),
  )
  const penaltyDeltas = comparable.flatMap((comparison) =>
    comparison.penaltyDelta === null ? [] : [comparison.penaltyDelta],
  )
  const viaDeltas = comparable.flatMap((comparison) =>
    comparison.viaDelta === null ? [] : [comparison.viaDelta],
  )
  const lengthDeltas = comparable.flatMap((comparison) =>
    comparison.totalLengthDelta === null ? [] : [comparison.totalLengthDelta],
  )
  const elapsedDeltas = comparisons.map(
    (comparison) => comparison.elapsedTimeDeltaMs,
  )

  return {
    solverName,
    baselineEffort,
    candidateEffort,
    scenarioCount: comparisons.length,
    comparableScenarioCount: comparable.length,
    improvedCount: comparisons.filter((comparison) => comparison.status === "improved")
      .length,
    regressedCount: comparisons.filter(
      (comparison) => comparison.status === "regressed",
    ).length,
    sameCount: comparisons.filter((comparison) => comparison.status === "same")
      .length,
    solveUpgradeCount: comparisons.filter(
      (comparison) => comparison.status === "solve_upgrade",
    ).length,
    solveRegressionCount: comparisons.filter(
      (comparison) => comparison.status === "solve_regression",
    ).length,
    bothUnsolvedCount: comparisons.filter(
      (comparison) => comparison.status === "both_unsolved",
    ).length,
    metricErrorCount: comparisons.filter(
      (comparison) => comparison.status === "metric_error",
    ).length,
    hardDrcImprovedCount: comparable.filter(
      (comparison) => (comparison.hardDrcDelta ?? 0) < 0,
    ).length,
    hardDrcRegressedCount: comparable.filter(
      (comparison) => (comparison.hardDrcDelta ?? 0) > 0,
    ).length,
    softDrcImprovedCount: comparable.filter(
      (comparison) => (comparison.softDrcDelta ?? 0) < 0,
    ).length,
    softDrcRegressedCount: comparable.filter(
      (comparison) => (comparison.softDrcDelta ?? 0) > 0,
    ).length,
    medianPenaltyDelta: getPercentile(penaltyDeltas, 0.5),
    averagePenaltyDelta: getAverage(penaltyDeltas),
    medianViaDelta: getPercentile(viaDeltas, 0.5),
    medianLengthDelta: getPercentile(lengthDeltas, 0.5),
    medianElapsedTimeDeltaMs: getPercentile(elapsedDeltas, 0.5),
  }
}

const main = async () => {
  const {
    solverName,
    scenarioLimit,
    concurrency,
    compareEfforts,
  } = parseArgs()
  const datasetName = "dataset01"
  const [baselineEffort, candidateEffort] = compareEfforts
  const availableSolvers = getSolverNames()
  const solvers =
    solverName && solverName !== "all" ? [solverName] : availableSolvers

  if (solverName && solverName !== "all" && !availableSolvers.includes(solverName)) {
    throw new Error(
      `Unknown solver "${solverName}". Available: ${availableSolvers.join(", ")}`,
    )
  }

  const scenarios = await loadScenarios({ scenarioLimit })
  if (scenarios.length === 0) {
    throw new Error(`No benchmark scenarios found for dataset "${datasetName}"`)
  }

  const tasks = solvers.flatMap((solver) =>
    scenarios.flatMap(([scenarioName, scenario]) =>
      [baselineEffort, candidateEffort].map(
        (effort) =>
          ({
            solverName: solver,
            scenarioName,
            scenario: withScenarioEffort(scenario, effort),
            effort,
          }) satisfies EffortBenchmarkTask,
      ),
    ),
  )

  console.log(
    `Running ${tasks.length} effort benchmark tasks across ${concurrency} workers (${solvers.length} solver${solvers.length === 1 ? "" : "s"}, ${scenarios.length} scenario${scenarios.length === 1 ? "" : "s"}, dataset: ${datasetName}, efforts: ${baselineEffort}x/${candidateEffort}x)`,
  )
  console.log(`Board quality formula: ${ROUTE_QUALITY_FORMULA}`)

  const runs = await runTasks(tasks, concurrency)
  const comparisons = solvers.flatMap((solver) => {
    const resultByScenarioAndEffort = new Map<string, EffortWorkerResult>()
    for (const run of runs.filter((result) => result.solverName === solver)) {
      resultByScenarioAndEffort.set(`${run.scenarioName}::${run.effort}`, run)
    }

    return scenarios.map(([scenarioName]) => {
      const baselineResult = resultByScenarioAndEffort.get(
        `${scenarioName}::${baselineEffort}`,
      )
      const candidateResult = resultByScenarioAndEffort.get(
        `${scenarioName}::${candidateEffort}`,
      )

      if (!baselineResult || !candidateResult) {
        throw new Error(
          `Missing comparison result for ${solver} ${scenarioName} (${baselineEffort}x vs ${candidateEffort}x)`,
        )
      }

      return createComparisonRecord(
        baselineResult,
        candidateResult,
        baselineEffort,
        candidateEffort,
      )
    })
  })

  const summary = solvers.map((solver) =>
    summarizeComparisons(
      solver,
      comparisons.filter((comparison) => comparison.solverName === solver),
      baselineEffort,
      candidateEffort,
    ),
  )

  const report: EffortEffectivenessReport = {
    version: 1,
    datasetName,
    scenarioCount: scenarios.length,
    solverNames: solvers,
    baselineEffort,
    candidateEffort,
    summary,
    runs,
    comparisons,
  }

  await Bun.write(
    "benchmark-effort-effectiveness.txt",
    createTextReport(report),
  )
  await Bun.write(
    "benchmark-effort-effectiveness.json",
    createJsonReport(report),
  )

  console.log(createTextReport(report))
  console.log(
    "Results written to benchmark-effort-effectiveness.txt and benchmark-effort-effectiveness.json",
  )
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Effort benchmark failed: ${message}`)
  process.exit(1)
})
