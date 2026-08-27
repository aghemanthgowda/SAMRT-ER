import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { JunctionState, TrafficLevel } from '@smart-er/core';
import { corridor, junction, junctionRuntime, route, vehicle, vehicleState } from '@/test/fixtures';
import { DemoMap } from './DemoMap';

function renderMap(overrides: Partial<React.ComponentProps<typeof DemoMap>> = {}) {
  const onSelect = vi.fn();
  const junctions = [junction('J1'), junction('J2'), junction('J3')];

  render(
    <DemoMap
      junctions={junctions}
      junctionStates={
        new Map([
          ['J1', junctionRuntime('J1', JunctionState.RELEASED)],
          ['J2', junctionRuntime('J2', JunctionState.GREEN)],
          ['J3', junctionRuntime('J3', JunctionState.PREPARING)],
        ])
      }
      roadSegments={[
        { id: 'J1-J2', fromJunctionId: 'J1', toJunctionId: 'J2', traffic: TrafficLevel.NORMAL, blocked: false },
        { id: 'J2-J3', fromJunctionId: 'J2', toJunctionId: 'J3', traffic: TrafficLevel.HEAVY, blocked: false },
      ]}
      routes={[route('RTE-1')]}
      corridors={[corridor('COR-1')]}
      vehicles={[vehicleState('AMB-01')]}
      vehicleById={new Map([['AMB-01', vehicle('AMB-01')]])}
      facilities={[]}
      incidents={[]}
      conflicts={[]}
      hiddenVehicleIds={new Set()}
      onSelect={onSelect}
      {...overrides}
    />,
  );
  return { onSelect };
}

describe('DemoMap', () => {
  it('labels itself as schematic so it is never mistaken for real geography', () => {
    renderMap();
    expect(
      screen.getByText(/Schematic map — add a Google Maps API key for real geography/i),
    ).toBeInTheDocument();
  });

  it('renders every junction with its code', () => {
    renderMap();
    expect(screen.getByText('J1')).toBeInTheDocument();
    expect(screen.getByText('J2')).toBeInTheDocument();
    expect(screen.getByText('J3')).toBeInTheDocument();
  });

  it('renders the vehicle call sign on the map', () => {
    renderMap();
    expect(screen.getByText('AMB-01')).toBeInTheDocument();
  });

  it('selects a junction when it is clicked', async () => {
    const { onSelect } = renderMap();
    await userEvent.click(screen.getByText('J2'));
    expect(onSelect).toHaveBeenCalledWith({ kind: 'junction', id: 'J2' });
  });

  it('selects a vehicle when its marker is clicked', async () => {
    const { onSelect } = renderMap();
    await userEvent.click(screen.getByText('AMB-01'));
    expect(onSelect).toHaveBeenCalledWith({ kind: 'vehicle', id: 'AMB-01' });
  });

  it('provides an accessible label for the schematic', () => {
    renderMap();
    expect(screen.getByRole('img', { name: /schematic junction network/i })).toBeInTheDocument();
  });

  it('renders without junctions rather than crashing', () => {
    renderMap({ junctions: [], junctionStates: new Map(), routes: [], vehicles: [] });
    expect(screen.getByRole('img', { name: /schematic junction network/i })).toBeInTheDocument();
  });
});
