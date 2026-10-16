import { cleanup, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import { api, setCsrfToken } from './api';

vi.mock('./api', () => ({ api: vi.fn(), setCsrfToken: vi.fn() }));
vi.mock('./modules', () => ({
  moduleViews: { app_catalog: () => <h1>Your apps</h1> },
}));
const mockApi = vi.mocked(api);
const anonymous = { user: null, csrf_token: 'initial-token', demo_mode: true, local_access: true };
const opened = {
  ...anonymous,
  user: { id: 'local', username: 'demo' },
  csrf_token: 'rotated-token',
};

beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

it('opens the real console directly in local mode without showing login or logout', async () => {
  mockApi.mockImplementation(async (path) => {
    if (path === '/api/session/') return anonymous;
    if (path === '/api/session/local/') return opened;
    if (path === '/api/workspaces/') return [{ id: 'local', name: 'My workshop', role: 'owner' }];
    if (path.endsWith('/modules/'))
      return [{ id: 'app_catalog', name: 'Apps', icon: 'applications', enabled: true }];
    if (path.endsWith('/apps/')) return [];
    throw new Error(`Unexpected request: ${path}`);
  });
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  await screen.findByRole('heading', { name: 'Your apps' });
  expect(screen.queryByLabelText('Password')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  expect(screen.getByText('Local workspace')).toBeTruthy();
  const entries = mockApi.mock.calls.filter(([path]) => path === '/api/session/local/');
  expect(entries).toHaveLength(1);
  expect(entries[0][1]?.method).toBe('POST');
  expect(setCsrfToken).toHaveBeenLastCalledWith('rotated-token');
});

it('keeps account login when local access is disabled', async () => {
  mockApi.mockResolvedValue({ ...anonymous, local_access: false });
  render(<App />);
  await screen.findByLabelText('Password');
  expect(mockApi.mock.calls.some(([path]) => path === '/api/session/local/')).toBe(false);
});

it('shows a retryable startup error if the local workspace is unavailable', async () => {
  mockApi.mockImplementation(async (path) => {
    if (path === '/api/session/') return anonymous;
    throw new Error('The local workspace is not ready.');
  });
  render(<App />);
  expect((await screen.findByRole('alert')).textContent).toContain(
    'The local workspace is not ready.',
  );
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  expect(screen.queryByLabelText('Password')).toBeNull();
});
