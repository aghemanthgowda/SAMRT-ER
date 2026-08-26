// Domain model ---------------------------------------------------------------
export * from './types/enums.js';
export type * from './types/domain.js';
export type * from './types/events.js';

// Geometry -------------------------------------------------------------------
export * from './geo/geometry.js';

// Road network ---------------------------------------------------------------
export { RoadGraph, TRAFFIC_DELAY_FACTOR, JUNCTION_DELAY_SECONDS } from './graph/roadGraph.js';
export type { GraphEdge } from './graph/roadGraph.js';

// Routing --------------------------------------------------------------------
export type {
  RouteProvider,
  RouteRequestInput,
  RouteMatrixProvider,
  RouteMatrixInput,
  RouteMatrixCell,
} from './routing/RouteProvider.js';
export { GraphRouteProvider } from './routing/GraphRouteProvider.js';
export type { GraphRouteProviderOptions, JunctionReservation } from './routing/GraphRouteProvider.js';
export { DEFAULT_COST_WEIGHTS, rankCandidates, scoreCandidate } from './routing/costModel.js';
export type { CostContext, CostWeights } from './routing/costModel.js';

// Priority -------------------------------------------------------------------
export {
  SEVERITY_WEIGHT,
  VEHICLE_KIND_WEIGHT,
  explainPriority,
  priorityForRequest,
  priorityScore,
} from './priority/priority.js';
export type { PriorityInput } from './priority/priority.js';

// Conflict -------------------------------------------------------------------
export {
  activeReservations,
  detectConflicts,
  occupiedWindows,
  sharedJunctions,
} from './conflict/conflictEngine.js';
export type { ConflictDetectionOptions, PlannedArrival } from './conflict/conflictEngine.js';
export { orderContenders, resolveConflict } from './conflict/resolution.js';
export type { ResolutionInput, ResolutionOutcome } from './conflict/resolution.js';

// Corridor -------------------------------------------------------------------
export {
  DEFAULT_CORRIDOR_TUNING,
  advanceCorridor,
  heldJunctionIds,
  planCorridor,
  predictJunctionArrivals,
  releaseCorridor,
  timeSlotAllocation,
} from './corridor/corridorEngine.js';
export type {
  CorridorAdvanceInput,
  CorridorAdvanceResult,
  CorridorPlanInput,
  CorridorTuning,
  JunctionArrival,
} from './corridor/corridorEngine.js';

// Safety ---------------------------------------------------------------------
export {
  MIN_AMBER_SECONDS,
  MIN_GREEN_SECONDS,
  failSafeAspect,
  validateBatch,
  validateSignalCommand,
} from './safety/safetyValidator.js';
export type { SafetyContext, SafetyVerdict } from './safety/safetyValidator.js';

// Public impact --------------------------------------------------------------
export { computePublicImpact, impactLevel, projectedImpactScore } from './impact/trafficImpact.js';
export type { ImpactInput } from './impact/trafficImpact.js';

// Hardware abstraction -------------------------------------------------------
export type {
  EmergencyButton,
  GpsFix,
  GpsProvider,
  HardwareBundle,
  HardwareStatusProvider,
  JunctionController,
  SignalController,
  VehicleTelemetry,
  VehicleTelemetryProvider,
  Watchdog,
} from './hardware/interfaces.js';
export {
  SimpleWatchdog,
  SimulatedEmergencyButton,
  SimulatedGpsProvider,
  SimulatedHardwareStatusProvider,
  SimulatedJunctionController,
  SimulatedSignalController,
  createSimulatedHardware,
} from './hardware/simulated.js';
export type { SimulatedHardwareBundle, SimulatedHardwareOptions } from './hardware/simulated.js';

// Utilities ------------------------------------------------------------------
export { formatClock, formatDistance, formatEta, isoAdd, isoNow, secondsBetween, secondsUntil } from './util/time.js';
export { nextId, resetIds } from './util/id.js';
export { SeededRandom } from './util/random.js';
export { SimulationClock, SystemClock } from './util/clock.js';
export type { Clock } from './util/clock.js';
