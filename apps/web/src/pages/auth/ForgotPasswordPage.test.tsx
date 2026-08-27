import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { api } from '@/api/client';
import { ForgotPasswordPage } from './ForgotPasswordPage';

beforeEach(() => {
  vi.restoreAllMocks();
});

function renderPage() {
  return render(
    <MemoryRouter>
      <ForgotPasswordPage />
    </MemoryRouter>,
  );
}

describe('requesting a recovery link', () => {
  it('posts the address and confirms without saying whether it exists', async () => {
    const forgot = vi.spyOn(api, 'forgotPassword').mockResolvedValue({ status: 'accepted' });
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/email address/i), 'controller@smart-er.example');
    await user.click(screen.getByRole('button', { name: /send recovery link/i }));

    await waitFor(() => expect(screen.getByText(/check your inbox/i)).toBeInTheDocument());
    expect(forgot).toHaveBeenCalledWith('controller@smart-er.example');

    // The wording must stay conditional: a definite "we sent you an email"
    // confirms the account exists to anyone who can type an address.
    expect(screen.getByText(/if an account exists/i)).toBeInTheDocument();
  });

  it('gives the same confirmation for an address with no account', async () => {
    vi.spyOn(api, 'forgotPassword').mockResolvedValue({ status: 'accepted' });
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/email address/i), 'nobody@nowhere.example');
    await user.click(screen.getByRole('button', { name: /send recovery link/i }));

    await waitFor(() => expect(screen.getByText(/if an account exists/i)).toBeInTheDocument());
    expect(screen.queryByText(/no account/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/not found/i)).not.toBeInTheDocument();
  });

  it('will not submit an empty address', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /send recovery link/i })).toBeDisabled();
  });

  it('reports a failure to reach the server instead of claiming it sent something', async () => {
    vi.spyOn(api, 'forgotPassword').mockRejectedValue(new Error('Network request failed'));
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/email address/i), 'controller@smart-er.example');
    await user.click(screen.getByRole('button', { name: /send recovery link/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/network request failed/i));
    expect(screen.queryByText(/check your inbox/i)).not.toBeInTheDocument();
  });
});
