import {
  checkDifferentNetViaSpacing,
  checkEachPcbTraceNonOverlapping,
  checkSameNetViaSpacing,
} from "@tscircuit/checks"
import type {
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "@tscircuit/capacity-autorouter"
import type { RouteQualityMetrics } from "./types"
import { convertToCircuitJson } from "../lib/convert-to-circuit-json"

type CircuitJson = Parameters<typeof checkEachPcbTraceNonOverlapping>[0]
type RouteSegment = NonNullable<SimpleRouteJson["traces"]>[number]["route"][number]

const MIN_VIA_CLEARANCE = 0.1
const PREFERRED_VIA_CLEARANCE = 0.2
const PREFERRED_TRACE_CLEARANCE = 0.15

export const ROUTE_QUALITY_WEIGHTS = {
  hardDrcErrorCount: 10_000,
  softDrcErrorCount: 50,
  viaCount: 12,
  bendCount: 1,
  totalLength: 0.25,
} as const

export const ROUTE_QUALITY_FORMULA =
  "penalty = hardDrcErrorCount*10000 + softDrcErrorCount*50 + viaCount*12 + bendCount + totalLength*0.25 (lower is better)"

const getDrcErrorCount = (
  circuitJson: CircuitJson,
  options?: {
    traceClearance?: number
    viaClearance?: number
  },
) =>
  checkEachPcbTraceNonOverlapping(circuitJson, {
    minClearance: options?.traceClearance,
  }).length +
  checkSameNetViaSpacing(circuitJson, {
    minClearance: options?.viaClearance ?? MIN_VIA_CLEARANCE,
  }).length +
  checkDifferentNetViaSpacing(circuitJson, {
    minClearance: options?.viaClearance ?? MIN_VIA_CLEARANCE,
  }).length

const getDistance = (
  a: { x: number; y: number },
  b: { x: number; y: number },
) => Math.hypot(a.x - b.x, a.y - b.y)

const getSegmentPoint = (segment: RouteSegment) => {
  if ("x" in segment && "y" in segment) {
    return { x: segment.x, y: segment.y }
  }

  if ("end" in segment) {
    return segment.end
  }

  return null
}

const countViaSegments = (srj: SimpleRouteJson) =>
  (srj.traces ?? []).flatMap((trace: SimplifiedPcbTrace) =>
    trace.route.filter(
      (
        segment: SimplifiedPcbTrace["route"][number],
      ): segment is Extract<
        (typeof trace.route)[number],
        { route_type: "via" }
      > => segment.route_type === "via",
    ),
  ).length

const countBends = (srj: SimpleRouteJson) => {
  let bends = 0

  for (const trace of srj.traces ?? []) {
    for (let i = 1; i < trace.route.length - 1; i++) {
      const previous = trace.route[i - 1]
      const current = trace.route[i]
      const next = trace.route[i + 1]

      if (
        previous.route_type !== "wire" ||
        current.route_type !== "wire" ||
        next.route_type !== "wire"
      ) {
        continue
      }

      const vx1 = current.x - previous.x
      const vy1 = current.y - previous.y
      const vx2 = next.x - current.x
      const vy2 = next.y - current.y

      if (Math.abs(vx1 * vy2 - vy1 * vx2) > 1e-6) {
        bends += 1
      }
    }
  }

  return bends
}

const getTotalLength = (srj: SimpleRouteJson) => {
  let totalLength = 0

  for (const trace of srj.traces ?? []) {
    for (let i = 1; i < trace.route.length; i++) {
      const previousPoint = getSegmentPoint(trace.route[i - 1])
      const currentPoint = getSegmentPoint(trace.route[i])

      if (previousPoint !== null && currentPoint !== null) {
        totalLength += getDistance(previousPoint, currentPoint)
      }
    }
  }

  return totalLength
}

export const createScoredRouteJson = (
  srj: SimpleRouteJson,
  traces: SimplifiedPcbTrace[],
): SimpleRouteJson => ({
  ...srj,
  traces,
})

export const formatRouteQualityBreakdown = (
  metrics: RouteQualityMetrics,
): string => {
  return [
    `hardDrc=${metrics.hardDrcErrorCount}`,
    `softDrc=${metrics.softDrcErrorCount}`,
    `vias=${metrics.viaCount}`,
    `bends=${metrics.bendCount}`,
    `length=${metrics.totalLength.toFixed(1)}`,
  ].join(", ")
}

export const computeRouteQualityMetrics = (
  srj: SimpleRouteJson,
  traces: SimplifiedPcbTrace[],
): RouteQualityMetrics => {
  const scoredSrj = createScoredRouteJson(srj, traces)
  const circuitJson = convertToCircuitJson(
    scoredSrj,
    traces,
    scoredSrj.minTraceWidth,
    scoredSrj.minViaDiameter,
  )
  const hardDrcErrorCount = getDrcErrorCount(circuitJson, {
    viaClearance: MIN_VIA_CLEARANCE,
  })
  const softDrcErrorCount = getDrcErrorCount(circuitJson, {
    traceClearance: PREFERRED_TRACE_CLEARANCE,
    viaClearance: PREFERRED_VIA_CLEARANCE,
  })
  const viaCount = countViaSegments(scoredSrj)
  const bendCount = countBends(scoredSrj)
  const totalLength = getTotalLength(scoredSrj)

  return {
    hardDrcErrorCount,
    softDrcErrorCount,
    viaCount,
    bendCount,
    totalLength,
    penalty:
      hardDrcErrorCount * ROUTE_QUALITY_WEIGHTS.hardDrcErrorCount +
      softDrcErrorCount * ROUTE_QUALITY_WEIGHTS.softDrcErrorCount +
      viaCount * ROUTE_QUALITY_WEIGHTS.viaCount +
      bendCount * ROUTE_QUALITY_WEIGHTS.bendCount +
      totalLength * ROUTE_QUALITY_WEIGHTS.totalLength,
  }
}
