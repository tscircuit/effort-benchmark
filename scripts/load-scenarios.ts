import type { SimpleRouteJson } from "@tscircuit/capacity-autorouter"

type DatasetModule = Record<string, unknown>

const toSimpleRouteJson = (value: unknown): SimpleRouteJson | null => {
  if (!value || typeof value !== "object") return null

  const asRecord = value as Record<string, unknown>
  const unwrappedValue =
    asRecord.default && typeof asRecord.default === "object"
      ? asRecord.default
      : value
  const unwrappedRecord = unwrappedValue as Record<string, unknown>
  const candidate =
    (unwrappedRecord.simpleRouteJson &&
      typeof unwrappedRecord.simpleRouteJson === "object" &&
      unwrappedRecord.simpleRouteJson) ||
    (unwrappedRecord.simple_route_json &&
      typeof unwrappedRecord.simple_route_json === "object" &&
      unwrappedRecord.simple_route_json) ||
    unwrappedValue

  if (!candidate || typeof candidate !== "object") return null

  return "bounds" in candidate ? (candidate as SimpleRouteJson) : null
}

export const loadScenarios = async (opts: { scenarioLimit?: number } = {}) => {
  const datasetModule =
    (await import("@tscircuit/autorouting-dataset-01")) as DatasetModule

  const scenarios = Object.entries(datasetModule)
    .map(([name, value]) => [name, toSimpleRouteJson(value)] as const)
    .filter((entry): entry is [string, SimpleRouteJson] => Boolean(entry[1]))
    .filter(([name]) => /^circuit\d+$/.test(name))
    .sort(([a], [b]) => a.localeCompare(b))

  return opts.scenarioLimit
    ? scenarios.slice(0, opts.scenarioLimit)
    : scenarios
}
