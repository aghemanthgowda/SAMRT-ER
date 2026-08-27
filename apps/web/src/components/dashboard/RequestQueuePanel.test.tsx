import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Severity } from '@smart-er/core';
import { api } from '@/api/client';
import { useOpsStore } from '@/stores/opsStore';
import { request, vehicle } from '@/test/fixtures';
import { RequestQueuePanel } from './RequestQueuePanel';

const vehicleById = new Map([
  ['AMB-01', vehicle('AMB-01')],
  ['AMB-02', vehicle('AMB-02')],
]);

function seed(requests: ReturnType<typeof request>[]) {
  useOpsStore.setState({
    requests: Object.fromEntries(requests.map((entry) => [entry.id, entry])),
    selection: undefined,
  });
}

function renderQueue(compact = false) {
  return render(
    <MemoryRouter>
      <RequestQueuePanel vehicleById={vehicleById} compact={compact} />
    </MemoryRouter>,
  );
}

describe('RequestQueuePanel', () => {
  beforeEach(() => seed([]));

  it('reports an empty queue as information, not a blank panel', () => {
    renderQueue();
    expect(screen.getByText('No requests awaiting decision')).toBeInTheDocument();
  });

  it('shows the call sign, severity, destination and crew note', () => {
    seed([request('REQ-1')]);
    renderQueue();

    expect(screen.getByText('AMB-01')).toBeInTheDocument();
    expect(screen.getByText('Critical')).toBeInTheDocument();
    expect(screen.getByText('City General Hospital')).toBeInTheDocument();
    expect(screen.getByText('Cardiac arrest, 62M')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  it('orders by arrival so an older call cannot starve behind a newer critical one', () => {
    const older = request('REQ-OLD', {
      vehicleId: 'AMB-02',
      severity: Severity.MEDIUM,
      createdAt: new Date(Date.now() - 120_000).toISOString(),
    });
    const newer = request('REQ-NEW', { severity: Severity.CRITICAL, createdAt: new Date().toISOString() });
    seed([newer, older]);

    renderQueue();
    const rendered = screen.getAllByText(/^AMB-0[12]$/).map((node) => node.textContent);
    expect(rendered[0]).toBe('AMB-02');
  });

  it('shows how long a request has been waiting', () => {
    seed([request('REQ-1', { createdAt: new Date(Date.now() - 120_000).toISOString() })]);
    renderQueue();
    expect(screen.getByText(/2 min ago/)).toBeInTheDocument();
  });

  it('accepts through the API', async () => {
    const approve = vi.spyOn(api, 'approveRequest').mockResolvedValue(request('REQ-1'));
    seed([request('REQ-1')]);

    renderQueue();
    await userEvent.click(screen.getByRole('button', { name: /accept/i }));

    await waitFor(() => expect(approve).toHaveBeenCalledWith('REQ-1'));
  });

  it('requires a reason before rejecting', async () => {
    const reject = vi.spyOn(api, 'rejectRequest').mockResolvedValue(request('REQ-1'));
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue(null);
    seed([request('REQ-1')]);

    renderQueue();
    await userEvent.click(screen.getByRole('button', { name: /reject/i }));

    expect(prompt).toHaveBeenCalled();
    expect(reject).not.toHaveBeenCalled();

    prompt.mockReturnValue('Non-urgent transfer.');
    await userEvent.click(screen.getByRole('button', { name: /reject/i }));
    await waitFor(() => expect(reject).toHaveBeenCalledWith('REQ-1', 'Non-urgent transfer.'));
  });

  it('surfaces an API failure instead of failing silently', async () => {
    vi.spyOn(api, 'approveRequest').mockRejectedValue(new Error('No route to the destination is available.'));
    seed([request('REQ-1')]);

    renderQueue();
    await userEvent.click(screen.getByRole('button', { name: /accept/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('No route to the destination is available.');
  });

  it('selects the unit when its row is clicked', async () => {
    seed([request('REQ-1')]);
    renderQueue();

    await userEvent.click(screen.getByText('City General Hospital'));
    expect(useOpsStore.getState().selection).toEqual({ kind: 'vehicle', id: 'AMB-01' });
  });

  it('truncates in compact mode and says how many are hidden', () => {
    seed(
      Array.from({ length: 7 }, (_, index) =>
        request(`REQ-${index}`, { createdAt: new Date(Date.now() - index * 1000).toISOString() }),
      ),
    );
    renderQueue(true);
    expect(screen.getByText('3 more awaiting decision')).toBeInTheDocument();
  });
});
