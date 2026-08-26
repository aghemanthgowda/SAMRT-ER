import { beforeEach, describe, expect, it } from 'vitest';
import { JunctionState, RequestStatus, VehicleStatus } from '@smart-er/core';
import { useOpsStore } from './opsStore';
import { conflict, corridor, junctionRuntime, request, route, vehicleState } from '@/test/fixtures';

function reset() {
  useOpsStore.setState({
    vehicles: {},
    requests: {},
    routes: {},
    corridors: {},
    conflicts: {},
    incidents: {},
    junctions: [],
    junctionStates: {},
    roadSegments: [],
    devices: {},
    facilities: [],
    timeline: [],
    notifications: [],
    selection: undefined,
    hiddenVehicleIds: new Set(),
    loaded: false,
  });
}

describe('operations store', () => {
  beforeEach(reset);

  it('keys entities by id so a single update does not rebuild the collection', () => {
    useOpsStore.setState({
      vehicles: { 'AMB-01': vehicleState('AMB-01'), 'FIRE-01': vehicleState('FIRE-01') },
    });

    const before = useOpsStore.getState().vehicles['FIRE-01'];
    useOpsStore.setState((state) => ({
      vehicles: { ...state.vehicles, 'AMB-01': vehicleState('AMB-01', { etaSeconds: 120 }) },
    }));

    // The untouched entity keeps its identity, so its row will not re-render.
    expect(useOpsStore.getState().vehicles['FIRE-01']).toBe(before);
    expect(useOpsStore.getState().vehicles['AMB-01']!.etaSeconds).toBe(120);
  });

  it('tracks selection and clears it', () => {
    useOpsStore.getState().select({ kind: 'junction', id: 'J2' });
    expect(useOpsStore.getState().selection).toEqual({ kind: 'junction', id: 'J2' });

    useOpsStore.getState().select(undefined);
    expect(useOpsStore.getState().selection).toBeUndefined();
  });

  it('toggles map visibility per vehicle', () => {
    const { toggleVehicleVisibility } = useOpsStore.getState();

    toggleVehicleVisibility('AMB-01');
    expect(useOpsStore.getState().hiddenVehicleIds.has('AMB-01')).toBe(true);

    toggleVehicleVisibility('AMB-01');
    expect(useOpsStore.getState().hiddenVehicleIds.has('AMB-01')).toBe(false);
  });

  it('holds corridor, route and conflict state together for a running unit', () => {
    useOpsStore.setState({
      vehicles: { 'AMB-01': vehicleState('AMB-01', { activeRouteId: 'RTE-1', corridorId: 'COR-1' }) },
      requests: { 'REQ-1': request('REQ-1', { status: RequestStatus.APPROVED }) },
      routes: { 'RTE-1': route('RTE-1') },
      corridors: { 'COR-1': corridor('COR-1') },
      conflicts: { 'CFL-1': conflict('CFL-1') },
      junctionStates: { J2: junctionRuntime('J2', JunctionState.GREEN) },
    });

    const state = useOpsStore.getState();
    expect(state.vehicles['AMB-01']!.status).toBe(VehicleStatus.ACTIVE);
    expect(state.routes['RTE-1']!.junctionIds).toEqual(['J1', 'J2', 'J3']);
    expect(state.corridors['COR-1']!.activeJunctionId).toBe('J2');
    expect(state.junctionStates.J2!.state).toBe(JunctionState.GREEN);
  });

  it('never lets the corridor hold more than one junction green at a time', () => {
    useOpsStore.setState({ corridors: { 'COR-1': corridor('COR-1') } });
    const allocations = useOpsStore.getState().corridors['COR-1']!.allocations;

    expect(allocations.filter((a) => a.state === JunctionState.GREEN)).toHaveLength(1);
    expect(allocations.filter((a) => a.state === JunctionState.PREPARING)).toHaveLength(1);
    expect(allocations.filter((a) => a.state === JunctionState.RELEASED)).toHaveLength(1);
  });
});
