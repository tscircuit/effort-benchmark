#!/usr/bin/env bun

import * as readline from "node:readline"
import { runTask } from "./runner"
import type {
  EffortWorkerResultMessage,
  EffortWorkerTaskMessage,
} from "./types"

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
})

for await (const line of rl) {
  const trimmed = line.trim()
  if (!trimmed) continue

  let message: EffortWorkerTaskMessage
  try {
    message = JSON.parse(trimmed) as EffortWorkerTaskMessage
  } catch (error) {
    console.error(
      `[effort-worker] Failed to parse task message: ${error instanceof Error ? error.message : String(error)}`,
    )
    continue
  }

  try {
    const result = await runTask(message.task)
    const payload: EffortWorkerResultMessage = {
      taskId: message.taskId,
      result,
    }
    process.stdout.write(`${JSON.stringify(payload)}\n`)
  } catch (error) {
    const payload: EffortWorkerResultMessage = {
      taskId: message.taskId,
      result: {
        solverName: message.task.solverName,
        scenarioName: message.task.scenarioName,
        effort: message.task.effort,
        elapsedTimeMs: 0,
        didSolve: false,
        didTimeout: false,
        relaxedDrcPassed: false,
        routeQuality: null,
        error: error instanceof Error ? error.message : String(error),
      },
    }
    process.stdout.write(`${JSON.stringify(payload)}\n`)
  }
}
