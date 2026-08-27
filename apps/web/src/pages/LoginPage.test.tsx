import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { LoginPage } from './LoginPage';

/**
 * The sign-in screen is the one place a credential could leak into the
 * interface, so these tests are mostly about what must NOT be on it.
 */

beforeEach(() => {
  useAuthStore.setState({ status: 'idle', error: undefined });
  vi.restoreAllMocks();
});

function renderLogin() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
}

describe('sign-in screen', () => {
  it('shows no accounts, passwords or role picker', () => {
    const { container } = renderLogin();
    const text = container.textContent ?? '';

    expect(text).not.toMatch(/ChangeMe|smarter2024/i);
    expect(text).not.toMatch(/@smart-er\.example|@abc-ems|@bfes/i);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(text).not.toMatch(/demonstration account|default credential|password hint/i);
  });

  it('submits what was typed, with the remember choice', async () => {
    const login = vi.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ login });
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText('Email'), 'controller@smart-er.example');
    await user.type(screen.getByLabelText('Password'), 'quiet harbour lantern');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() =>
      expect(login).toHaveBeenCalledWith('controller@smart-er.example', 'quiet harbour lantern', false),
    );
  });

  it('passes remember through when it is ticked', async () => {
    const login = vi.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ login });
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText('Email'), 'controller@smart-er.example');
    await user.type(screen.getByLabelText('Password'), 'quiet harbour lantern');
    await user.click(screen.getByLabelText(/remember me/i));
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() =>
      expect(login).toHaveBeenCalledWith('controller@smart-er.example', 'quiet harbour lantern', true),
    );
  });

  it('offers the single sign-on buttons as unavailable rather than as live', () => {
    renderLogin();

    // The design calls for them; no identity provider is configured. A button
    // that looks live and silently does nothing is the worse of the two.
    const google = screen.getByRole('button', { name: /google/i });
    const microsoft = screen.getByRole('button', { name: /microsoft/i });

    expect(google).toBeDisabled();
    expect(microsoft).toBeDisabled();
    expect(google).toHaveAttribute('title', expect.stringMatching(/not configured/i));
  });

  it('explains that accounts are issued rather than self-registered', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByRole('button', { name: /sign up/i }));

    expect(screen.getByText(/issued by your organisation/i)).toBeInTheDocument();
    expect(screen.getByText(/no self-service sign-up/i)).toBeInTheDocument();
  });

  it('reveals the password only on request', async () => {
    const user = userEvent.setup();
    renderLogin();
    const field = screen.getByLabelText('Password');

    expect(field).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: /show password/i }));
    expect(field).toHaveAttribute('type', 'text');
  });

  it('surfaces the store error as an alert', () => {
    useAuthStore.setState({ status: 'error', error: 'Email address or password is not recognised.' });
    renderLogin();

    expect(screen.getByRole('alert')).toHaveTextContent(/not recognised/i);
  });

  it('links to recovery rather than to a mailbox', () => {
    renderLogin();
    expect(screen.getByRole('link', { name: /forgot password/i })).toHaveAttribute('href', '/forgot-password');
  });
});
