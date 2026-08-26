import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ConflictStatus } from '@smart-er/core';
import { useOpsStore } from '@/stores/opsStore';
import { conflict } from '@/test/fixtures';
import { ConflictMonitor } from './ConflictMonitor';

function seed(conflicts: ReturnType<typeof conflict>[]) {
  useOpsStore.setState({
    conflicts: Object.fromEntries(conflicts.map((entry) => [entry.id, entry])),
    selection: undefined,
  });
}

describe('ConflictMonitor', () => {
  beforeEach(() => seed([]));

  it('says nothing is contended rather than showing an empty box', () => {
    render(<ConflictMonitor />);
    expect(screen.getByText('No junction conflicts')).toBeInTheDocument();
    expect(screen.getByText(/same junction inside one clearance window/)).toBeInTheDocument();
  });

  it('shows the contended junction, both units, and the resolution', () => {
    seed([conflict('CFL-1')]);
    render(<ConflictMonitor />);

    expect(screen.getByText('J2')).toBeInTheDocument();
    expect(screen.getByText('AMB-01 / FIRE-01')).toBeInTheDocument();
    expect(screen.getByText('Rerouted')).toBeInTheDocument();
  });

  it('renders the full decision explanation, not a summary', () => {
    const entry = conflict('CFL-1');
    seed([entry]);
    render(<ConflictMonitor />);
    expect(screen.getByText(entry.explanation)).toBeInTheDocument();
  });

  it('reports the ETA change and the time saved', () => {
    seed([conflict('CFL-1')]);
    render(<ConflictMonitor />);

    expect(screen.getByText(/ETA 05:40 → 05:15/)).toBeInTheDocument();
    expect(screen.getByText('saved 25s')).toBeInTheDocument();
  });

  it('labels each resolution strategy distinctly', () => {
    seed([
      conflict('CFL-1', { status: ConflictStatus.RESOLVED_TIME_SLOT }),
      conflict('CFL-2', { status: ConflictStatus.RESOLVED_PRIORITY_HOLD }),
      conflict('CFL-3', { status: ConflictStatus.DETECTED }),
    ]);
    render(<ConflictMonitor />);

    expect(screen.getByText('Time-slotted')).toBeInTheDocument();
    expect(screen.getByText('Held')).toBeInTheDocument();
    expect(screen.getByText('Detected')).toBeInTheDocument();
  });
});
