import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Connections from '../../addons/apple_store/frontend';
import AppCatalog from '../../addons/app_catalog/frontend';
import AppDetail from '../../addons/app_catalog/frontend/AppDetail';
import { api } from './api';
import type { MobileApp, ModuleProps } from './contracts';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  api: vi.fn(),
}));
const mockApi = vi.mocked(api);
const connection = {
  id: 'connection-one',
  name: 'Developer account',
  key_type: 'team',
  key_id: 'ABCDEFGHIJ',
  issuer_id: 'a15b7a52-bcae-49d3-a6c2-b34cf2d0edd5',
  last_checked_at: '2026-10-16T12:00:00Z',
};
const app = {
  id: 'app-one',
  name: 'Running',
  bundle_id: 'org.example.running',
  platform: 'ios',
  external_id: '123',
  is_demo: false,
  sync_provider: 'apple_store',
  metadata: {
    id: 'snapshot',
    source: 'apple_store.api',
    captured_at: '2026-10-16T12:00:00Z',
    data: {
      name: 'Running',
      locale: 'en-US',
      description: 'A running journal.',
      localizations: [
        {
          locale: 'en-US',
          name: 'Running',
          description: 'A running journal.',
          keywords: 'running',
        },
        {
          locale: 'fr-FR',
          name: 'Courir',
          description: 'Un journal de course.',
          keywords: 'course',
        },
      ],
    },
  },
} as MobileApp;
let props: ModuleProps;
beforeEach(() => {
  mockApi.mockReset();
  props = {
    workspace: { id: 'workspace-one', name: 'Example', role: 'owner' },
    apps: [app],
    selectedApp: app,
    selectApp: vi.fn(),
    navigate: vi.fn(),
    refreshApps: vi.fn().mockResolvedValue(undefined),
    demoMode: false,
  };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('connects an individual key from the UI without an issuer or browser storage', async () => {
  mockApi.mockImplementation(async (path, options) => {
    if (path.includes('/google-play/')) return { connections: [], credentials_ready: true };
    if (options?.method === 'POST') return { ...connection, key_type: 'individual', issuer_id: '' };
    if (path.endsWith('/apps/')) return { apps: [] };
    return { connections: [], credentials_ready: true };
  });
  // jsdom does not implement File.text; no real credential is used in this test.
  Object.defineProperty(File.prototype, 'text', {
    configurable: true,
    value: async () => 'test-key-only',
  });
  const storage = vi.spyOn(Storage.prototype, 'setItem');
  render(<Connections {...props} />);
  const button = await screen.findByRole('button', { name: 'Connect Apple' });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button);
  fireEvent.change(screen.getByLabelText('Connection name'), {
    target: { value: 'My developer account' },
  });
  fireEvent.change(screen.getByLabelText('Key type'), { target: { value: 'individual' } });
  expect(screen.queryByLabelText('Issuer ID')).toBeNull();
  fireEvent.change(screen.getByLabelText('Key ID'), { target: { value: 'ABCDEFGHIJ' } });
  fireEvent.change(screen.getByLabelText('API key (.p8)'), {
    target: { files: [new File(['test'], 'AuthKey.p8')] },
  });
  // Supply the selected file to jsdom's FormData implementation.
  const original = FormData.prototype.get;
  vi.spyOn(FormData.prototype, 'get').mockImplementation(function (this: FormData, name) {
    return name === 'private_key' ? new File(['test'], 'AuthKey.p8') : original.call(this, name);
  });
  fireEvent.submit(screen.getByLabelText('Connection name').closest('form')!);
  await screen.findByLabelText('Account');
  expect(mockApi.mock.calls.some(([path]) => path.endsWith('/apps/'))).toBe(false);
  const sent = mockApi.mock.calls.find(([, options]) => options?.method === 'POST');
  expect(sent?.[0]).toBe('/api/workspaces/workspace-one/apple_store/connections/');
  expect(JSON.parse(sent?.[1]?.body as string)).toMatchObject({
    key_type: 'individual',
    issuer_id: null,
    private_key: 'test-key-only',
  });
  expect(screen.queryByLabelText('API key (.p8)')).toBeNull();
  expect(storage).not.toHaveBeenCalled();
});

it('loads the catalogue only during import and imports exactly the selected app', async () => {
  mockApi.mockImplementation(async (path, options) => {
    if (path.includes('/google-play/')) return { connections: [], credentials_ready: true };
    if (options?.method === 'POST') return app;
    if (path.endsWith('/apps/'))
      return {
        apps: [{ external_id: '123', name: 'Running', bundle_id: app.bundle_id, locale: 'en-US' }],
      };
    return { connections: [connection], credentials_ready: true };
  });
  const view = render(<Connections {...props} />);
  await screen.findByLabelText('Account');
  expect(mockApi.mock.calls.some(([path]) => path.endsWith('/apps/'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Import an app' }));
  expect(props.navigate).toHaveBeenCalledWith('apple_store', undefined, 'import');
  view.rerender(<Connections {...props} apps={[]} page="import" />);
  await screen.findByRole('option', { name: /Running/ });
  expect(
    (screen.getByRole('button', { name: 'Import selected app' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(mockApi.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  fireEvent.change(screen.getByLabelText('Application'), { target: { value: '123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Import selected app' }));
  await waitFor(() => expect(props.navigate).toHaveBeenCalledWith('app_catalog', 'app-one'));
  expect(props.refreshApps).toHaveBeenCalledOnce();
  expect(props.selectApp).toHaveBeenCalledWith(app);
  expect(mockApi.mock.calls.find(([, options]) => options?.method === 'POST')?.[0]).toContain(
    '/connections/connection-one/import/',
  );
});

it('keeps the saved connection visible when replacing a key is cancelled', async () => {
  mockApi.mockImplementation(async (path) =>
    path.includes('/google-play/')
      ? { connections: [], credentials_ready: true }
      : path.endsWith('/apps/')
        ? { apps: [] }
        : { connections: [connection], credentials_ready: true },
  );
  render(<Connections {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Replace key' }));
  expect((screen.getByLabelText('Key ID') as HTMLInputElement).value).toBe('ABCDEFGHIJ');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await screen.findByLabelText('Account');
  expect(mockApi.mock.calls.every(([, options]) => !options?.method)).toBe(true);
});

it('hides import and credential controls for a viewer without loading the catalogue', async () => {
  mockApi.mockImplementation(async (path) =>
    path.includes('/google-play/')
      ? { connections: [], credentials_ready: true }
      : path.endsWith('/apps/')
        ? {
            apps: [
              { external_id: '123', name: 'Running', bundle_id: app.bundle_id, locale: 'en-US' },
            ],
          }
        : { connections: [connection], credentials_ready: true },
  );
  render(<Connections {...props} workspace={{ ...props.workspace, role: 'viewer' }} />);
  await screen.findByLabelText('Account');
  expect(screen.queryByRole('button', { name: 'Import an app' })).toBeNull();
  expect(mockApi.mock.calls.some(([path]) => path.endsWith('/apps/'))).toBe(false);
  expect(screen.queryByRole('button', { name: 'Replace key' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Connect Apple' })).toBeNull();
});

it('requires an explicit disconnect and refreshes imported apps afterwards', async () => {
  mockApi.mockImplementation(async (path, options) => {
    if (path.includes('/google-play/')) return { connections: [], credentials_ready: true };
    if (options?.method === 'DELETE') return undefined;
    return path.endsWith('/apps/')
      ? { apps: [] }
      : { connections: [connection], credentials_ready: true };
  });
  render(<Connections {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
  expect(mockApi.mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Confirm disconnect' }));
  await screen.findByText('No account connected');
  expect(props.refreshApps).toHaveBeenCalledOnce();
});

it('opens metadata from My apps and displays the chosen language', async () => {
  const view = render(<AppCatalog {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open Running' }));
  expect(props.navigate).toHaveBeenCalledWith('app_catalog', 'app-one');
  view.rerender(<AppCatalog {...props} detailAppId="app-one" />);
  expect(screen.getByText('A running journal.')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'fr-FR' } });
  expect(screen.getByText('Un journal de course.')).toBeTruthy();
});

it('starts the single-app import flow from My apps', () => {
  render(<AppCatalog {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Import an app' }));
  expect(props.navigate).toHaveBeenCalledWith('apple_store', undefined, 'import');
});

it('clears the chosen app when switching accounts and imports from the new account', async () => {
  mockApi.mockImplementation(async (path, options) => {
    if (options?.method === 'POST') return app;
    if (path.endsWith('/apps/'))
      return {
        apps: [{ external_id: '123', name: 'Running', bundle_id: app.bundle_id }],
      };
    return { connections: [connection, { ...connection, id: 'second', name: 'Second account' }] };
  });
  render(<Connections {...props} apps={[]} page="import" />);
  await screen.findByRole('option', { name: /Running/ });
  fireEvent.change(screen.getByLabelText('Application'), { target: { value: '123' } });
  fireEvent.change(screen.getByLabelText('Account'), { target: { value: 'second' } });
  await screen.findByRole('option', { name: /Running/ });
  expect((screen.getByLabelText('Application') as HTMLSelectElement).value).toBe('');
  expect(
    (screen.getByRole('button', { name: 'Import selected app' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.change(screen.getByLabelText('Application'), { target: { value: '123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Import selected app' }));
  await waitFor(() => expect(props.navigate).toHaveBeenCalledWith('app_catalog', app.id));
  const posts = mockApi.mock.calls.filter(([, options]) => options?.method === 'POST');
  expect(posts).toHaveLength(1);
  expect(posts[0][0]).toContain('/connections/second/import/');
});

it('finds apps on later catalogue pages and opens an imported app without another import', async () => {
  mockApi.mockImplementation(async (path) => {
    if (path.includes('?cursor='))
      return { apps: [{ external_id: '123', name: 'Running', bundle_id: app.bundle_id }] };
    if (path.endsWith('/apps/')) return { apps: [], next_cursor: 'next-page' };
    return { connections: [connection] };
  });
  render(<Connections {...props} page="import" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Load more apps' }));
  await screen.findByRole('option', { name: /Running/ });
  fireEvent.change(screen.getByLabelText('Search apps'), { target: { value: 'running' } });
  fireEvent.change(screen.getByLabelText('Application'), { target: { value: '123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Open app' }));
  expect(props.navigate).toHaveBeenCalledWith('app_catalog', app.id);
  expect(mockApi.mock.calls.some(([, options]) => options?.method)).toBe(false);
});

it('preserves metadata on sync failure and refreshes it after a successful retry', async () => {
  mockApi
    .mockRejectedValueOnce(new Error('Apple request limit reached.'))
    .mockResolvedValueOnce(app);
  render(<AppDetail {...props} app={app} />);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh metadata' }));
  expect((await screen.findByRole('alert')).textContent).toContain('request limit');
  expect(screen.getByText('A running journal.')).toBeTruthy();
  expect(props.refreshApps).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh metadata' }));
  await screen.findByText('Up to date.');
  expect(props.refreshApps).toHaveBeenCalledOnce();
});
