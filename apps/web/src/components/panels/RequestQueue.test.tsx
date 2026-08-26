import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Severity } from '@smart-er/core';
import { api } from '@/api/client';
import { useOpsStore } from '@/stores/opsStore';
import { request, vehicle } from '@/test/fixtures';
import { RequestQueue } from './RequestQueue';

const vehicleById = new Map([['AMB-01', vehicle('AMB-01')]]);

function seed(requests: ReturnType<typeof request>[]) {
  useOpsStore.setState({
    requests: Object.fromEntries(requests.map((entry) => [entry.id, entry])),
    selection: undefined,
  });
}

describe('RequestQueue', () => {
  beforeEach(() => seed([]));

  it('reports an empty queue as information, not a blank panel', () => {
    render(<RequestQueue vehicleById={vehicleById} />);
    expect(screen.getByText('No requests awaiting decision')).toBeInTheDocument();
  });

  it('shows the call sign, severity, destination and crew note', () => {
    seed([request('REQ-1')]);
    render(<RequestQueue vehicleById={vehicleById} />);

    expect(screen.getByText('AMB-01')).toBeInTheDocument();
    expect(screen.getByText('Critical')).toBeInTheDocument();
    expect(screen.getByText('City General Hospital')).toBeInTheDocument();
    expect(screen.getByText('Cardiac arrest, 62M')).toBeInTheDocument();
  });

  it('orders by arrival so an older call cannot starve behind a newer critical one', () => {
    const older = request('REQ-OLD', {
      vehicleId: 'AMB-02',
      severity: Severity.MEDIUM,
      createdAt: new Date(Date.now() - 120_000).toISOString(),
    });
    const newer = request('REQ-NEW', { severity: Severity.CRITICAL, createdAt: new Date().toISOString() });
    seed([newer, older]);

    render(<RequestQueue vehicleById={vehicleById} />);
    const rendered = screen.getAllByText(/AMB-0[12]/).map((node) => node.textContent);
    expect(rendered[0]).toBe('AMB-02');
  });

  it('approves through the API', async () => {
    const approve = vi.spyOn(api, 'approveRequest').mockResolvedValue(request('REQ-1'));
    seed([request('REQ-1')]);

    render(<RequestQueue vehicleById={vehicleById} />);
    await userEvent.click(screen.getByRole('button', { name: /approve/i }));

    await waitFor(() => expect(approve).toHaveBeenCalledWith('REQ-1'));
  });

  it('requires a reason before declining', async () => {
    const reject = vi.spyOn(api, 'rejectRequest').mockResolvedValue(request('REQ-1'));
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue(null);
    seed([request('REQ-1')]);

    render(<RequestQueue vehicleById={vehicleById} />);
    await userEvent.click(screen.getByRole('button', { name: /decline/i }));

    expect(prompt).toHaveBeenCalled();
    expect(reject).not.toHaveBeenCalled();

    prompt.mockReturnValue('Non-urgent transfer.');
    await userEvent.click(screen.getByRole('button', { name: /decline/i }));
    await waitFor(() => expect(reject).toHaveBeenCalledWith('REQ-1', 'Non-urgent transfer.'));
  });

  it('surfaces an API failure instead of failing silently', async () => {
    vi.spyOn(api, 'approveRequest').mockRejectedValue(new Error('No route to the destination is available.'));
    seed([request('REQ-1')]);

    render(<RequestQueue vehicleById={vehicleById} />);
    await userEvent.click(screen.getByRole('button', { name: /approve/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('No route to the destination is available.');
  });

  it('selects the unit when its row is clicked', async () => {
    seed([request('REQ-1')]);
    render(<RequestQueue vehicleById={vehicleById} />);

    await userEvent.click(screen.getByText('AMB-01'));
    expect(useOpsStore.getState().selection).toEqual({ kind: 'vehicle', id: 'AMB-01' });
  });
});
