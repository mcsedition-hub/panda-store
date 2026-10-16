import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import { api, setCsrfToken } from './api';

vi.mock('./api', () => ({ api: vi.fn(), setCsrfToken: vi.fn() }));
vi.mock('./modules', () => ({ moduleViews: { app_catalog: () => <h1>Your apps</h1> } }));
const mockApi = vi.mocked(api);
const initial = { user: null, csrf_token: 'initial-token', demo_mode: true, setup_required: true };
const configured = {
  ...initial,
  user: { id: 'owner', username: 'northstar' },
  csrf_token: 'rotated-token',
  setup_required: false,
};

beforeEach(() => {
  vi.resetAllMocks();
  mockApi.mockImplementation(async (path) => {
    if (path === '/api/session/') return initial;
    if (path === '/api/setup/') return configured;
    if (path === '/api/workspaces/') return [{ id: 'local', name: 'Northstar', role: 'owner' }];
    if (path.endsWith('/modules/'))
      return [{ id: 'app_catalog', name: 'My apps', icon: 'applications', enabled: true }];
    if (path.endsWith('/apps/')) return [];
    throw new Error(`Unexpected request: ${path}`);
  });
});
afterEach(cleanup);

async function fillSetup() {
  fireEvent.change(await screen.findByLabelText('Organization name'), {
    target: { value: 'Northstar' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Continue →' }));
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'northstar' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'owner@example.test' } });
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'Papaya!ridge-93.rail' },
  });
  fireEvent.change(screen.getByLabelText('Confirm password'), {
    target: { value: 'Papaya!ridge-93.rail' },
  });
}

it('configures organization and owner once, then opens the console immediately', async () => {
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  await fillSetup();
  expect(mockApi.mock.calls.some(([path]) => path === '/api/setup/')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Create my workshop →' }));
  await screen.findByRole('heading', { name: 'Your apps' });
  expect(screen.queryByLabelText('Organization name')).toBeNull();
  const calls = mockApi.mock.calls.filter(([path]) => path === '/api/setup/');
  expect(calls).toHaveLength(1);
  expect(calls[0][1]?.method).toBe('POST');
  expect(JSON.parse(calls[0][1]?.body as string)).toEqual({
    organization_name: 'Northstar',
    username: 'northstar',
    email: 'owner@example.test',
    password: 'Papaya!ridge-93.rail',
    password_confirmation: 'Papaya!ridge-93.rail',
  });
  expect(setCsrfToken).toHaveBeenLastCalledWith('rotated-token');
});

it('preserves entered values when going back and rejects mismatched passwords before saving', async () => {
  render(<App />);
  await fillSetup();
  fireEvent.click(screen.getByRole('button', { name: '← Organization' }));
  expect((screen.getByLabelText('Organization name') as HTMLInputElement).value).toBe('Northstar');
  fireEvent.click(screen.getByRole('button', { name: 'Continue →' }));
  expect((screen.getByLabelText('Username') as HTMLInputElement).value).toBe('northstar');
  fireEvent.change(screen.getByLabelText('Confirm password'), {
    target: { value: 'Another-password' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create my workshop →' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Passwords do not match.');
  expect(mockApi.mock.calls.some(([path]) => path === '/api/setup/')).toBe(false);
});

it('keeps the form available for correction if setup fails', async () => {
  render(<App />);
  await fillSetup();
  mockApi.mockRejectedValueOnce(new Error('This password is too common.'));
  fireEvent.click(screen.getByRole('button', { name: 'Create my workshop →' }));
  expect((await screen.findByRole('alert')).textContent).toContain('This password is too common.');
  expect((screen.getByLabelText('Username') as HTMLInputElement).value).toBe('northstar');
  expect(
    (screen.getByRole('button', { name: 'Create my workshop →' }) as HTMLButtonElement).disabled,
  ).toBe(false);
});

it('opens the console on returning visits with an existing session', async () => {
  mockApi.mockResolvedValueOnce(configured);
  render(<App />);
  await screen.findByRole('heading', { name: 'Your apps' });
  expect(screen.queryByLabelText('Organization name')).toBeNull();
  expect(mockApi.mock.calls.some(([path]) => path === '/api/setup/')).toBe(false);
});

it('asks for sign-in, not setup, after a configured installation loses its session', async () => {
  mockApi.mockResolvedValue({ ...initial, setup_required: false });
  render(<App />);
  await screen.findByLabelText('Password');
  expect(screen.getByRole('button', { name: 'Enter the workshop →' })).toBeTruthy();
  expect(screen.queryByLabelText('Organization name')).toBeNull();
});
