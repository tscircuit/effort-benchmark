import type {
  EffortComparisonRecord,
  EffortComparisonSummary,
  EffortEffectivenessReport,
} from "./types"

const formatSigned = (value: number | null, digits = 1) => {
  if (value === null) return "n/a"
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`
}

const formatTable = (rows: EffortComparisonSummary[]) => {
  const headers = [
    "Solver",
    "Improved",
    "Regressed",
    "Solve +",
    "Solve -",
    "Comparable",
    "Median ΔPenalty",
    "Avg ΔPenalty",
  ]

  const body = rows.map((row) => [
    row.solverName,
    `${row.improvedCount}/${row.comparableScenarioCount}`,
    `${row.regressedCount}/${row.comparableScenarioCount}`,
    String(row.solveUpgradeCount),
    String(row.solveRegressionCount),
    `${row.comparableScenarioCount}/${row.scenarioCount}`,
    formatSigned(row.medianPenaltyDelta),
    formatSigned(row.averagePenaltyDelta),
  ])

  const widths = headers.map((header, columnIndex) => {
    const maxBodyWidth = Math.max(
      ...body.map((cells) => cells[columnIndex].length),
      0,
    )
    return Math.max(header.length, maxBodyWidth)
  })

  const separator = `+${widths.map((width) => "-".repeat(width + 2)).join("+")}+`
  const headerLine = `| ${headers.map((header, i) => header.padEnd(widths[i])).join(" | ")} |`
  const bodyLines = body.map(
    (cells) =>
      `| ${cells.map((cell, i) => cell.padEnd(widths[i])).join(" | ")} |`,
  )

  return [separator, headerLine, separator, ...bodyLines, separator].join("\n")
}

const formatComparisonLine = (comparison: EffortComparisonRecord) =>
  [
    comparison.scenarioName,
    `status=${comparison.status}`,
    `Δpenalty=${formatSigned(comparison.penaltyDelta)}`,
    `ΔhardDrc=${formatSigned(comparison.hardDrcDelta, 0)}`,
    `ΔsoftDrc=${formatSigned(comparison.softDrcDelta, 0)}`,
    `Δvias=${formatSigned(comparison.viaDelta, 0)}`,
    `Δlength=${formatSigned(comparison.totalLengthDelta)}`,
  ].join(" ")

const formatTopList = (
  title: string,
  comparisons: EffortComparisonRecord[],
  limit = 10,
) => {
  const lines = comparisons.slice(0, limit).map(formatComparisonLine)
  return lines.length === 0
    ? `${title}\nnone`
    : `${title}\n${lines.join("\n")}`
}

const formatStatusMarker = (active: boolean) => (active ? "X" : "")

const formatStatusTable = (comparisons: EffortComparisonRecord[]) => {
  const headers = ["Circuit", "Improve", "Regression"]

  const body = [...comparisons]
    .sort((a, b) => a.scenarioName.localeCompare(b.scenarioName))
    .map((comparison) => [
      comparison.scenarioName,
      formatStatusMarker(comparison.status === "improved"),
      formatStatusMarker(comparison.status === "regressed"),
    ])

  const widths = headers.map((header, columnIndex) => {
    const maxBodyWidth = Math.max(
      ...body.map((cells) => cells[columnIndex].length),
      0,
    )
    return Math.max(header.length, maxBodyWidth)
  })

  const separator = `+${widths.map((width) => "-".repeat(width + 2)).join("+")}+`
  const headerLine = `| ${headers.map((header, i) => header.padEnd(widths[i])).join(" | ")} |`
  const bodyLines = body.map(
    (cells) =>
      `| ${cells.map((cell, i) => cell.padEnd(widths[i])).join(" | ")} |`,
  )

  return [
    "Circuit Status",
    separator,
    headerLine,
    separator,
    ...bodyLines,
    separator,
  ].join("\n")
}

export const createTextReport = (report: EffortEffectivenessReport) => {
  const table = formatTable(report.summary)
  return [
    `Benchmark Effort Effectiveness (${report.baselineEffort}x vs ${report.candidateEffort}x)`,
    "",
    table,
    "",
    `Delta = penalty_${report.candidateEffort}x - penalty_${report.baselineEffort}x (negative is better)`,
    "",
    `Dataset: ${report.datasetName}`,
    `Scenarios: ${report.scenarioCount}`,
    `Solvers: ${report.solverNames.join(", ")}`,
    "",
    formatStatusTable(report.comparisons),
    "",
  ].join("\n")
}

export const createJsonReport = (report: EffortEffectivenessReport) =>
  JSON.stringify(report, null, 2)
