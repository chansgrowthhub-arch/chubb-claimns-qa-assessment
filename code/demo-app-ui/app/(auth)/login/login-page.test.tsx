import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LoginPage from './page';
import { useAuthStore } from '@/src/features/auth/stores/use-auth-store';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const VALID_EMAIL = 'claimant@demo.com';
const VALID_PASSWORD = 'Claimant123!';

const claimantLoginResponse = {
  userId: 'user-1',
  email: VALID_EMAIL,
  name: 'Claire Claimant',
  role: 'CLAIMANT',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function fillAndSubmitLoginForm(email = VALID_EMAIL, password = VALID_PASSWORD) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/email/i), email);
  await user.type(screen.getByLabelText(/^password$/i), password);
  await user.click(screen.getByRole('button', { name: /log in/i }));
}

describe('LoginPage', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    useAuthStore.setState({ user: null, isAuthenticated: false });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('submits credentials to the BFF login endpoint with cookies enabled', async () => {
    fetchMock.mockResolvedValue(jsonResponse(claimantLoginResponse));
    render(<LoginPage />);

    await fillAndSubmitLoginForm();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/login',
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
          body: JSON.stringify({ email: VALID_EMAIL, password: VALID_PASSWORD }),
        })
      );
    });
  });

  it('stores the authenticated user in the auth store on success', async () => {
    fetchMock.mockResolvedValue(jsonResponse(claimantLoginResponse));
    render(<LoginPage />);

    await fillAndSubmitLoginForm();

    await waitFor(() => {
      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(true);
      expect(state.user).toEqual(claimantLoginResponse);
    });
  });

  it('shows "Invalid email or password" on a 401 without storing a user', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'Invalid' }, 401));
    render(<LoginPage />);

    await fillAndSubmitLoginForm(VALID_EMAIL, 'WrongPassword1');

    expect(await screen.findByText(/invalid email or password/i)).toBeInTheDocument();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('shows a network error message when the BFF is unreachable', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<LoginPage />);

    await fillAndSubmitLoginForm();

    expect(await screen.findByText(/network error, please try again/i)).toBeInTheDocument();
  });

  it('blocks submission and shows a validation message for a malformed email', async () => {
    render(<LoginPage />);

    await fillAndSubmitLoginForm('not-an-email', VALID_PASSWORD);

    expect(await screen.findByText(/invalid email format/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires a password before submitting', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByLabelText(/email/i), VALID_EMAIL);
    await user.click(screen.getByRole('button', { name: /log in/i }));

    expect(await screen.findByText(/password is required/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('announces the session-expired message when redirected with session_expired=true', async () => {
    window.history.replaceState({}, '', '/login?session_expired=true');
    render(<LoginPage />);

    expect(
      await screen.findByText(/your session has expired/i)
    ).toBeInTheDocument();
  });
});
