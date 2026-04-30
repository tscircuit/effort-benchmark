import type { AnyCircuitElement, PcbTrace, PcbVia } from "circuit-json"
import type {
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "@tscircuit/capacity-autorouter"

type ConnectionPoint = SimpleRouteJson["connections"][number]["pointsToConnect"][number]
type Obstacle = SimpleRouteJson["obstacles"][number]

const getConnectionPointLayers = (point: ConnectionPoint): string[] =>
  "layers" in point && Array.isArray(point.layers) ? point.layers : [point.layer]

const firstFiniteNumber = (
  ...values: Array<number | undefined>
): number | undefined =>
  values.find((value) => typeof value === "number" && Number.isFinite(value))

const getViaDimensions = (
  srj: Pick<
    SimpleRouteJson,
    | "minViaDiameter"
    | "minViaHoleDiameter"
    | "minViaPadDiameter"
    | "min_via_hole_diameter"
    | "min_via_pad_diameter"
  >,
) => {
  const holeDiameter = firstFiniteNumber(
    srj.min_via_hole_diameter,
    srj.minViaHoleDiameter,
  )
  const padDiameter = Math.max(
    firstFiniteNumber(
      srj.min_via_pad_diameter,
      srj.minViaPadDiameter,
      srj.minViaDiameter,
    ) ?? 0.3,
    holeDiameter ?? 0,
  )

  return {
    padDiameter,
    holeDiameter: holeDiameter ?? padDiameter * 0.5,
  }
}

const convertSimplifiedPcbTraceToCircuitJson = (
  simplifiedTrace: SimplifiedPcbTrace,
  connectionName: string,
): PcbTrace => {
  const route = simplifiedTrace.route
    .map((segment: SimplifiedPcbTrace["route"][number]) => {
      if (segment.route_type === "wire") {
        return {
          route_type: "wire" as const,
          x: segment.x,
          y: segment.y,
          width: segment.width,
          layer: segment.layer,
          start_pcb_port_id: (segment as { start_pcb_port_id?: string })
            .start_pcb_port_id,
          end_pcb_port_id: (segment as { end_pcb_port_id?: string })
            .end_pcb_port_id,
        }
      }

      if (segment.route_type === "via") {
        return {
          route_type: "via" as const,
          x: segment.x,
          y: segment.y,
          from_layer: segment.from_layer,
          to_layer: segment.to_layer,
        }
      }

      return null
    })
    .filter(
      (
        segment:
          | {
              route_type: "wire"
              x: number
              y: number
              width: number
              layer: string
              start_pcb_port_id?: string
              end_pcb_port_id?: string
            }
          | {
              route_type: "via"
              x: number
              y: number
              from_layer: string
              to_layer: string
            }
          | null,
      ): segment is NonNullable<typeof segment> => segment !== null,
    )

  return {
    type: "pcb_trace",
    pcb_trace_id: simplifiedTrace.pcb_trace_id,
    source_trace_id: connectionName,
    route,
  }
}

const createSourceTraces = (
  srj: SimpleRouteJson,
): AnyCircuitElement[] => {
  const sourceTraces: AnyCircuitElement[] = []

  for (const connection of srj.connections) {
    const connectedPortIds = connection.pointsToConnect
      .filter((point: ConnectionPoint): point is ConnectionPoint & { pcb_port_id: string } =>
        Boolean(point.pcb_port_id),
      )
      .map((point: ConnectionPoint & { pcb_port_id: string }) => point.pcb_port_id)
    const netConnectionName =
      connection.netConnectionName ||
      connection.rootConnectionName ||
      connection.name

    const existingSourceTrace = sourceTraces.find(
      (element) =>
        element.type === "source_trace" &&
        element.source_trace_id === netConnectionName,
    )

    if (existingSourceTrace) {
      ;(existingSourceTrace as { connected_source_port_ids: string[] })
        .connected_source_port_ids = [
        ...new Set([
          ...(existingSourceTrace as { connected_source_port_ids: string[] })
            .connected_source_port_ids,
          ...connectedPortIds,
        ]),
      ]
      continue
    }

    sourceTraces.push({
      type: "source_trace",
      source_trace_id: netConnectionName,
      connected_source_port_ids: connectedPortIds,
      connected_source_net_ids: [],
    } as AnyCircuitElement)
  }

  return sourceTraces
}

const createPcbPorts = (srj: SimpleRouteJson): AnyCircuitElement[] => {
  const portMap = new Map<string, AnyCircuitElement>()

  for (const connection of srj.connections) {
    for (const point of connection.pointsToConnect) {
      if (!point.pcb_port_id) continue

      portMap.set(point.pcb_port_id, {
        type: "pcb_port",
        pcb_port_id: point.pcb_port_id,
        source_port_id: point.pcb_port_id,
        x: point.x,
        y: point.y,
        layers: getConnectionPointLayers(point),
      } as AnyCircuitElement)
    }
  }

  return [...portMap.values()]
}

const getPcbPortPositionMap = (srj: SimpleRouteJson) => {
  const portPositionMap = new Map<string, { x: number; y: number }>()

  for (const connection of srj.connections) {
    for (const point of connection.pointsToConnect) {
      if (!point.pcb_port_id) continue
      portPositionMap.set(point.pcb_port_id, { x: point.x, y: point.y })
    }
  }

  return portPositionMap
}

const getBestObstaclePcbPortId = (
  obstacleCenter: Obstacle["center"],
  candidatePortIds: string[],
  portPositionMap: Map<string, { x: number; y: number }>,
) => {
  let bestPortId: string | undefined
  let bestDistance = Number.POSITIVE_INFINITY

  for (const portId of candidatePortIds) {
    const position = portPositionMap.get(portId)
    if (!position) continue

    const distance = Math.hypot(
      position.x - obstacleCenter.x,
      position.y - obstacleCenter.y,
    )

    if (distance < bestDistance) {
      bestDistance = distance
      bestPortId = portId
    }
  }

  return bestPortId ?? candidatePortIds[0]
}

const createPcbPadElements = (srj: SimpleRouteJson): AnyCircuitElement[] => {
  const pads: AnyCircuitElement[] = []
  const addedSmtPadIds = new Set<string>()
  const addedPlatedHoleIds = new Set<string>()
  const portPositionMap = getPcbPortPositionMap(srj)

  for (const obstacle of srj.obstacles) {
    const smtPadId = obstacle.connectedTo.find((id: string) =>
      id.startsWith("pcb_smtpad_"),
    )
    const platedHoleId = obstacle.connectedTo.find((id: string) =>
      id.startsWith("pcb_plated_hole_"),
    )
    const candidatePortIds = obstacle.connectedTo.filter((id: string) =>
      id.startsWith("pcb_port_"),
    )
    const pcbPortId = getBestObstaclePcbPortId(
      obstacle.center,
      candidatePortIds,
      portPositionMap,
    )

    if (!smtPadId && !platedHoleId && !pcbPortId) continue
    if (obstacle.layers.length === 0) continue

    const { x, y } = obstacle.center
    const { width, height, layers } = obstacle
    const isMultiLayerObstacle = layers.length > 1

    if (isMultiLayerObstacle) {
      const id =
        platedHoleId ?? `pcb_plated_hole_${x.toFixed(3)}_${y.toFixed(3)}`
      if (addedPlatedHoleIds.has(id)) continue
      addedPlatedHoleIds.add(id)

      pads.push({
        type: "pcb_plated_hole",
        pcb_plated_hole_id: id,
        shape: Math.abs(width - height) < 0.001
          ? "circle"
          : "circular_hole_with_rect_pad",
        ...(Math.abs(width - height) < 0.001
          ? {
              outer_diameter: Math.max(width, height),
              hole_diameter: Math.max(Math.min(width, height) * 0.5, 0.1),
            }
          : {
              hole_shape: "circle",
              hole_diameter: Math.max(Math.min(width, height) * 0.5, 0.1),
              rect_pad_width: width,
              rect_pad_height: height,
              hole_offset_x: 0,
              hole_offset_y: 0,
            }),
        x,
        y,
        layers,
        ...(pcbPortId ? { pcb_port_id: pcbPortId } : {}),
      } as AnyCircuitElement)
      continue
    }

    const id = smtPadId ?? `pcb_smtpad_${x.toFixed(3)}_${y.toFixed(3)}`
    if (addedSmtPadIds.has(id)) continue
    addedSmtPadIds.add(id)

    pads.push({
      type: "pcb_smtpad",
      pcb_smtpad_id: id,
      layer: layers[0],
      shape: "rect",
      width,
      height,
      x,
      y,
      ...(pcbPortId ? { pcb_port_id: pcbPortId } : {}),
    } as AnyCircuitElement)
  }

  return pads
}

const extractViasFromRoutes = (
  routes: SimplifiedPcbTrace[],
  minViaDiameter = 0.3,
  minViaHoleDiameter = minViaDiameter * 0.5,
): PcbVia[] => {
  const vias: PcbVia[] = []
  const viaLocations = new Set<string>()

  for (const trace of routes) {
    for (const segment of trace.route) {
      if (segment.route_type !== "via") continue

      const outerDiameter = segment.via_diameter ?? minViaDiameter
      const holeDiameter = segment.via_hole_diameter ?? minViaHoleDiameter
      const locationKey = `${segment.x},${segment.y},${segment.from_layer},${segment.to_layer}`
      if (viaLocations.has(locationKey)) continue

      vias.push({
        type: "pcb_via",
        pcb_via_id: `via_${vias.length}`,
        pcb_trace_id: trace.pcb_trace_id,
        x: segment.x,
        y: segment.y,
        outer_diameter: outerDiameter,
        hole_diameter: holeDiameter,
        layers: [segment.from_layer, segment.to_layer],
      })
      viaLocations.add(locationKey)
    }
  }

  return vias
}

export const convertToCircuitJson = (
  srjWithPointPairs: SimpleRouteJson,
  routes: SimplifiedPcbTrace[],
  _minTraceWidth = 0.1,
  minViaDiameter?: number,
  minViaHoleDiameter?: number,
): AnyCircuitElement[] => {
  const viaDimensions = getViaDimensions(srjWithPointPairs)
  const resolvedMinViaDiameter = minViaDiameter ?? viaDimensions.padDiameter
  const resolvedMinViaHoleDiameter =
    minViaHoleDiameter ??
    srjWithPointPairs.min_via_hole_diameter ??
    srjWithPointPairs.minViaHoleDiameter ??
    (minViaDiameter !== undefined
      ? resolvedMinViaDiameter * 0.5
      : viaDimensions.holeDiameter)

  const circuitJson: AnyCircuitElement[] = []
  circuitJson.push(...createSourceTraces(srjWithPointPairs))
  circuitJson.push(...createPcbPorts(srjWithPointPairs))
  circuitJson.push(...createPcbPadElements(srjWithPointPairs))
  circuitJson.push(
    ...extractViasFromRoutes(
      routes,
      resolvedMinViaDiameter,
      resolvedMinViaHoleDiameter,
    ),
  )

  const connectionMap = new Map<string, string>()
  for (const connection of srjWithPointPairs.connections) {
    connectionMap.set(
      connection.name,
      connection.netConnectionName ||
        connection.rootConnectionName ||
        connection.name,
    )
  }

  for (const trace of routes) {
    const connectionName = connectionMap.get(trace.connection_name)
    circuitJson.push(
      convertSimplifiedPcbTraceToCircuitJson(
        trace,
        connectionName ?? trace.connection_name,
      ) as AnyCircuitElement,
    )
  }

  return circuitJson
}
