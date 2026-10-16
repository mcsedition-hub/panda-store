import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Studio from '../../addons/studio/frontend';
import { api } from './api';
import type { Creative, MobileApp, ModuleProps, Run } from './contracts';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  api: vi.fn(),
}));
const mockApi = vi.mocked(api);
const app = { id: 'app-one', name: 'Runclub', metadata: null } as MobileApp;
const props: ModuleProps = {
  workspace: { id: 'workspace-one', name: 'Atelier', role: 'owner' },
  apps: [app],
  selectedApp: app,
  selectApp: vi.fn(),
  navigate: vi.fn(),
  refreshApps: vi.fn(),
  demoMode: true,
};
const brief = { audience: 'Beginners', goal: 'Discover Runclub', tone: 'Simple' };
const creatives: Creative[] = [1, 2, 3].map((variant) => ({
  id: `creative-${variant}`,
  variant,
  angle: `Angle ${variant}`,
  hook: 'A hook',
  script: 'A script',
  cta: 'Discover',
  approved: false,
  updated_at: '2026-10-16T12:00:00Z',
}));
const run: Run = {
  id: 'run-one',
  status: 'succeeded',
  provider: 'demo_templates',
  error: '',
  created_at: '2026-10-16T12:00:00Z',
  completed_at: null,
  creatives,
};

beforeEach(() => {
  mockApi.mockReset();
});
afterEach(cleanup);

it('saves the brief before generation, then lets the user edit and approve separately', async () => {
  mockApi.mockImplementation(async (path, options) => {
    if (path.endsWith('brief/')) return brief;
    if (path.endsWith('runs/')) return options?.method === 'POST' ? run : [];
    if (path.includes('creatives/')) {
      const body = JSON.parse(options?.body as string);
      return { ...creatives[0], ...body };
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  render(<Studio {...props} />);
  const audience = await screen.findByLabelText('Audience');
  fireEvent.change(audience, { target: { value: 'Weekend runners' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create three directions →' }));
  const hook = await screen.findByLabelText('Hook — Angle 1');
  expect(screen.getAllByRole('article')).toHaveLength(3);
  const mutations = mockApi.mock.calls.filter(([, options]) => options?.method);
  expect(mutations[0][1]?.method).toBe('PUT');
  expect(JSON.parse(mutations[0][1]?.body as string).audience).toBe('Weekend runners');
  expect(mutations[1][1]?.method).toBe('POST');
  expect(JSON.parse(mutations[1][1]?.body as string).request_id).toMatch(/^[\da-f-]{36}$/);
  fireEvent.change(hook, { target: { value: 'My own angle' } });
  const approve = screen.getAllByRole('button', {
    name: 'Approve script',
  })[0] as HTMLButtonElement;
  expect(approve.disabled).toBe(true);
  fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]);
  await screen.findByText('Changes saved.');
  expect(approve.disabled).toBe(false);
  fireEvent.click(approve);
  await screen.findByText('Script approved.');
  expect(screen.getByRole('link', { name: 'Export scripts ↓' }).getAttribute('href')).toBe(
    '/api/workspaces/workspace-one/studio/runs/run-one/export/',
  );
});

it('does not generate if saving the brief fails', async () => {
  mockApi.mockImplementation(async (path, options) => {
    if (options?.method === 'PUT') throw new Error('Could not save');
    return path.endsWith('brief/') ? brief : [];
  });
  render(<Studio {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Create three directions →' }));
  await screen.findByRole('alert');
  expect(mockApi.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
});

it('does not expose stale editable content when loading fails', async () => {
  mockApi.mockRejectedValue(new Error('Access unavailable'));
  render(<Studio {...props} />);
  await screen.findByRole('alert');
  await waitFor(() => expect(screen.queryByLabelText('Audience')).toBeNull());
  expect(screen.queryByRole('button', { name: 'Create three directions →' })).toBeNull();
});

it('prevents writes in a read-only workspace', async () => {
  mockApi.mockImplementation(async (path) => (path.endsWith('brief/') ? brief : [run]));
  render(<Studio {...props} workspace={{ ...props.workspace, role: 'viewer' }} />);
  const button = (await screen.findByRole('button', {
    name: 'Create three directions →',
  })) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect((screen.getByLabelText('Hook — Angle 1') as HTMLTextAreaElement).disabled).toBe(true);
});
