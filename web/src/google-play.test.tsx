import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import GooglePlay from '../../addons/apple_store/frontend/GooglePlay';
import ImportApp from '../../addons/apple_store/frontend/ImportApp';
import AppDetail from '../../addons/app_catalog/frontend/AppDetail';
import { api } from './api';
import type { MobileApp, ModuleProps } from './contracts';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  api: vi.fn(),
}));
const mockApi = vi.mocked(api);
const connection = {
  id: 'google-one',
  name: 'Developer',
  client_email: 'test@demo.iam.gserviceaccount.com',
  project_id: 'demo',
  verified_package: 'com.example.app',
  revision: 'revision-one',
  last_checked_at: '2026-10-18T00:00:00Z',
};
const app = {
  id: 'android-one',
  name: 'Running',
  platform: 'android',
  external_id: 'com.example.app',
  bundle_id: 'com.example.app',
  is_demo: false,
  sync_provider: 'google_play',
  metadata: {
    id: 'snapshot',
    source: 'google_play.api',
    captured_at: '2026-10-18T00:00:00Z',
    data: {
      name: 'Running',
      locale: 'en-US',
      short_description: 'Plan your runs.',
      description: 'A running journal.',
      localizations: [
        {
          locale: 'en-US',
          name: 'Running',
          short_description: 'Plan your runs.',
          description: 'A running journal.',
        },
        {
          locale: 'fr-FR',
          name: 'Courir',
          short_description: 'Planifiez vos courses.',
          description: 'Un journal de course.',
        },
      ],
    },
  },
} as MobileApp;
let props: ModuleProps;
beforeEach(() => {
  mockApi.mockReset();
  props = {
    workspace: { id: 'workspace', name: 'Test', role: 'owner' },
    apps: [app],
    selectedApp: app,
    selectApp: vi.fn(),
    navigate: vi.fn(),
    refreshApps: vi.fn().mockResolvedValue(undefined),
    demoMode: false,
    availableModules: ['apple_store', 'aso', 'studio'],
  };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('connects a dedicated service account and clears the key form without browser storage', async () => {
  mockApi.mockImplementation(async (path, options) => {
    if (options?.method === 'POST') return connection;
    if (path.endsWith('/apps/')) return { apps: [] };
    return { connections: [], credentials_ready: true };
  });
  Object.defineProperty(File.prototype, 'text', {
    configurable: true,
    value: async () => '{"type":"test-only"}',
  });
  const original = FormData.prototype.get;
  vi.spyOn(FormData.prototype, 'get').mockImplementation(function (this: FormData, name) {
    return name === 'service_account' ? new File(['test'], 'key.json') : original.call(this, name);
  });
  const storage = vi.spyOn(Storage.prototype, 'setItem');
  render(<GooglePlay {...props} />);
  const connect = await screen.findByRole('button', { name: 'Connect Google Play' });
  await waitFor(() => expect((connect as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(connect);
  fireEvent.change(screen.getByLabelText('Google connection name'), {
    target: { value: 'Developer' },
  });
  fireEvent.change(screen.getByLabelText('Package name to verify'), {
    target: { value: 'com.example.app' },
  });
  const dedicated = screen.getByRole('checkbox', { name: /dedicated to Panda Store/ });
  expect((dedicated as HTMLInputElement).required).toBe(true);
  fireEvent.click(dedicated);
  fireEvent.submit(screen.getByLabelText('Google connection name').closest('form')!);
  await screen.findByLabelText('Google Play account');
  const sent = mockApi.mock.calls.find(([, options]) => options?.method === 'POST')!;
  expect(screen.queryByRole('button', { name: 'Connect Google Play' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Add a Google Play account' })).toBeTruthy();
  expect(sent[0]).toBe('/api/workspaces/workspace/apple_store/google-play/connections/');
  expect(JSON.parse(sent[1]!.body as string)).toEqual({
    name: 'Developer',
    package_name: 'com.example.app',
    service_account_json: '{"type":"test-only"}',
    dedicated_account: true,
    revision: null,
  });
  expect(screen.queryByLabelText('Service account JSON')).toBeNull();
  expect(storage).not.toHaveBeenCalled();
});

it('imports a package and opens the Android listing', async () => {
  mockApi.mockImplementation(async (path, options) =>
    options?.method === 'POST'
      ? app
      : path.endsWith('/apps/')
        ? { apps: [] }
        : { connections: [connection], credentials_ready: true },
  );
  render(<ImportApp {...props} apps={[]} />);
  fireEvent.change(screen.getByLabelText('Store'), { target: { value: 'google' } });
  await screen.findByLabelText('Package name');
  fireEvent.click(await screen.findByRole('button', { name: 'Import selected app' }));
  await waitFor(() => expect(props.navigate).toHaveBeenCalledWith('app_catalog', app.id));
  expect(props.refreshApps).toHaveBeenCalledOnce();
  const sent = mockApi.mock.calls.find(([, options]) => options?.method === 'POST')!;
  expect(sent[0]).toContain('/google-play/connections/google-one/import/');
  expect(JSON.parse(sent[1]!.body as string)).toEqual({ package_name: 'com.example.app' });
});

it('retains the entered package after an import failure and allows retry', async () => {
  let attempts = 0;
  mockApi.mockImplementation(async (_, options) => {
    if (options?.method === 'POST') {
      if (++attempts === 1) throw new Error('Google Play denied access.');
      return app;
    }
    return { connections: [connection] };
  });
  render(<ImportApp {...props} />);
  fireEvent.change(screen.getByLabelText('Store'), { target: { value: 'google' } });
  const field = await screen.findByLabelText('Package name');
  expect((field as HTMLInputElement).value).toBe('');
  fireEvent.change(field, { target: { value: 'com.example.newapp' } });
  fireEvent.click(screen.getByRole('button', { name: 'Import selected app' }));
  await screen.findByRole('alert');
  expect((field as HTMLInputElement).value).toBe('com.example.newapp');
  expect(props.navigate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Import selected app' }));
  await waitFor(() => expect(props.navigate).toHaveBeenCalledWith('app_catalog', app.id));
  const posts = mockApi.mock.calls.filter(([, options]) => options?.method === 'POST');
  expect(posts).toHaveLength(2);
  expect(JSON.parse(posts[1][1]!.body as string)).toEqual({ package_name: 'com.example.newapp' });
});

it('reconnects a retained app after its previous account was disconnected', async () => {
  mockApi.mockImplementation(async (_, options) =>
    options?.method === 'POST' ? app : { connections: [connection] },
  );
  render(<ImportApp {...props} apps={[{ ...app, sync_provider: '' }]} />);
  fireEvent.change(screen.getByLabelText('Store'), { target: { value: 'google' } });
  fireEvent.change(await screen.findByLabelText('Package name'), {
    target: { value: app.external_id },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Import selected app' }));
  await waitFor(() => expect(props.navigate).toHaveBeenCalledWith('app_catalog', app.id));
  expect(mockApi.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
});

it('keeps the connection usable after a rejected replacement key', async () => {
  mockApi.mockImplementation(async (path, options) => {
    if (options?.method === 'PUT') throw new Error('Google rejected this key.');
    return path.endsWith('/apps/')
      ? { apps: [] }
      : { connections: [connection], credentials_ready: true };
  });
  Object.defineProperty(File.prototype, 'text', {
    configurable: true,
    value: async () => 'test-key',
  });
  const original = FormData.prototype.get;
  vi.spyOn(FormData.prototype, 'get').mockImplementation(function (this: FormData, name) {
    return name === 'service_account' ? new File(['test'], 'key.json') : original.call(this, name);
  });
  render(<GooglePlay {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Replace Google key' }));
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.submit(screen.getByLabelText('Google connection name').closest('form')!);
  expect((await screen.findByRole('alert')).textContent).toContain('rejected');
  const sent = mockApi.mock.calls.find(([, options]) => options?.method === 'PUT')!;
  expect(JSON.parse(sent[1]!.body as string).revision).toBe(connection.revision);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(await screen.findByLabelText('Google Play account')).toBeTruthy();
});

it('shows only account information to a viewer without loading apps', async () => {
  mockApi.mockImplementation(async (path) =>
    path.endsWith('/apps/')
      ? { apps: [app] }
      : { connections: [connection], credentials_ready: true },
  );
  render(<GooglePlay {...props} workspace={{ ...props.workspace, role: 'viewer' }} />);
  await screen.findByLabelText('Google Play account');
  expect(mockApi.mock.calls.some(([path]) => path.endsWith('/apps/'))).toBe(false);
  expect(screen.queryByLabelText('Package name')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Import Google Play app' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Connect Google Play' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Replace Google key' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Disconnect Google Play' })).toBeNull();
});

it('disconnects only after confirmation and refreshes the retained apps', async () => {
  mockApi.mockImplementation(async (path, options) =>
    options?.method === 'DELETE'
      ? undefined
      : path.endsWith('/apps/')
        ? { apps: [app] }
        : { connections: [connection], credentials_ready: true },
  );
  render(<GooglePlay {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Disconnect Google Play' }));
  expect(mockApi.mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Confirm Google disconnect' }));
  await screen.findByText('No Google Play account connected');
  expect(props.refreshApps).toHaveBeenCalledOnce();
});

it('shows Android fields and refreshes through the Google endpoint', async () => {
  mockApi.mockResolvedValue(app);
  render(<AppDetail {...props} app={app} />);
  expect(screen.getByText('Short description')).toBeTruthy();
  expect(screen.queryByText('Subtitle')).toBeNull();
  expect(screen.queryByText('Keywords')).toBeNull();
  expect(screen.getByRole('button', { name: 'Open ASO' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Open SMM' })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'fr-FR' } });
  expect(screen.getByText('Planifiez vos courses.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh metadata' }));
  await screen.findByText('Up to date.');
  expect(mockApi.mock.calls[0][0]).toBe(
    '/api/workspaces/workspace/apple_store/google-play/apps/android-one/sync/',
  );
});
