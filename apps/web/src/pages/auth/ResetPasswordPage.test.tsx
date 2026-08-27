import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { api } from '@/api/client';
import { ResetPasswordPage } from './ResetPasswordPage';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'passwordPolicy').mockResolvedValue({ minLength: 12 });
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/login" element={<p>Sign in</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('completing a recovery', () => {
  it('refuses to render a form with no token', () => {
    renderAt('/reset-password');

    expect(screen.getByText(/link not valid/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/new password/i)).not.toBeInTheDocument();
  });

  it('submits the token from the URL with the new password', async () => {
    const reset = vi.spyOn(api, 'resetPassword').mockResolvedValue({ status: 'reset' });
    const user = userEvent.setup();
    renderAt('/reset-password?token=abc123');

    await user.type(screen.getByLabelText('New password'), 'quiet harbour lantern');
    await user.type(screen.getByLabelText(/confirm new password/i), 'quiet harbour lantern');
    await user.click(screen.getByRole('button', { name: /set new password/i }));

    await waitFor(() => expect(reset).toHaveBeenCalledWith('abc123', 'quiet harbour lantern'));
    expect(await screen.findByText(/password changed/i)).toBeInTheDocument();
  });

  it('will not submit until both fields match', async () => {
    const user = userEvent.setup();
    renderAt('/reset-password?token=abc123');

    await user.type(screen.getByLabelText('New password'), 'quiet harbour lantern');
    await user.type(screen.getByLabelText(/confirm new password/i), 'quiet harbour lantpen');

    expect(screen.getByText(/both fields must match/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /set new password/i })).toBeDisabled();
  });

  it('will not submit a password shorter than the policy the server published', async () => {
    const user = userEvent.setup();
    renderAt('/reset-password?token=abc123');
    await waitFor(() => expect(api.passwordPolicy).toHaveBeenCalled());

    await user.type(screen.getByLabelText('New password'), 'short');
    await user.type(screen.getByLabelText(/confirm new password/i), 'short');

    expect(screen.getByRole('button', { name: /set new password/i })).toBeDisabled();
  });

  it('shows the server refusal for a link that has already been used', async () => {
    vi.spyOn(api, 'resetPassword').mockRejectedValue(new Error('This reset link is no longer valid. Request a new one.'));
    const user = userEvent.setup();
    renderAt('/reset-password?token=stale');

    await user.type(screen.getByLabelText('New password'), 'quiet harbour lantern');
    await user.type(screen.getByLabelText(/confirm new password/i), 'quiet harbour lantern');
    await user.click(screen.getByRole('button', { name: /set new password/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/no longer valid/i));
    expect(screen.queryByText(/password changed/i)).not.toBeInTheDocument();
  });

  it('never renders the token itself', async () => {
    const { container } = renderAt('/reset-password?token=SECRET-TOKEN-VALUE');
    await waitFor(() => expect(api.passwordPolicy).toHaveBeenCalled());

    expect(container.textContent).not.toContain('SECRET-TOKEN-VALUE');
    expect(container.innerHTML).not.toContain('SECRET-TOKEN-VALUE');
  });
});
