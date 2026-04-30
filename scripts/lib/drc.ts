import {
  checkDifferentNetViaSpacing,
  checkEachPcbTraceNonOverlapping,
  checkSameNetViaSpacing,
} from "@tscircuit/checks"

type CircuitJson = Parameters<typeof checkEachPcbTraceNonOverlapping>[0]
type TraceError = ReturnType<typeof checkEachPcbTraceNonOverlapping>[number]
type SameNetViaError = ReturnType<typeof checkSameNetViaSpacing>[number]
type DifferentNetViaError = ReturnType<
  typeof checkDifferentNetViaSpacing
>[number]

export type DrcError = TraceError | SameNetViaError | DifferentNetViaError

export type GetDrcErrorsOptions = {
  viaClearance?: number
  traceClearance?: number
}

export const MIN_VIA_TO_VIA_CLEARANCE = 0.1

export const RELAXED_DRC_OPTIONS: GetDrcErrorsOptions = {
  traceClearance: 0.1,
  viaClearance: MIN_VIA_TO_VIA_CLEARANCE,
}

export const getDrcErrors = (
  circuitJson: CircuitJson,
  options: GetDrcErrorsOptions = {},
) => ({
  errors: [
    ...checkEachPcbTraceNonOverlapping(circuitJson, {
      minClearance: options.traceClearance,
    }),
    ...checkSameNetViaSpacing(circuitJson, {
      minClearance: Math.max(
        options.viaClearance ?? MIN_VIA_TO_VIA_CLEARANCE,
        MIN_VIA_TO_VIA_CLEARANCE,
      ),
    }),
    ...checkDifferentNetViaSpacing(circuitJson, {
      minClearance: Math.max(
        options.viaClearance ?? MIN_VIA_TO_VIA_CLEARANCE,
        MIN_VIA_TO_VIA_CLEARANCE,
      ),
    }),
  ] as DrcError[],
})
