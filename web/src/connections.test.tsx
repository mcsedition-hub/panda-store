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
  await screen.findByText('No apps available to this key.');
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

it('loads account apps, imports a selected app and opens its metadata', async () => {
  mockApi.mockImplementation(async (path, options) => {
    if (options?.method === 'POST') return app;
    if (path.endsWith('/apps/'))
      return {
        apps: [{ external_id: '123', name: 'Running', bundle_id: app.bundle_id, locale: 'en-US' }],
      };
    return { connections: [connection], credentials_ready: true };
  });
  render(<Connections {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Import' }));
  await waitFor(() => expect(props.navigate).toHaveBeenCalledWith('app_catalog', 'app-one'));
  expect(props.refreshApps).toHaveBeenCalledOnce();
  expect(props.selectApp).toHaveBeenCalledWith(app);
  expect(mockApi.mock.calls.find(([, options]) => options?.method === 'POST')?.[0]).toContain(
    '/connections/connection-one/import/',
  );
});

it('keeps the saved connection visible when replacing a key is cancelled', async () => {
  mockApi.mockImplementation(async (path) =>
    path.endsWith('/apps/') ? { apps: [] } : { connections: [connection], credentials_ready: true },
  );
  render(<Connections {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Replace key' }));
  expect((screen.getByLabelText('Key ID') as HTMLInputElement).value).toBe('ABCDEFGHIJ');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await screen.findByLabelText('Account');
  expect(mockApi.mock.calls.every(([, options]) => !options?.method)).toBe(true);
});

it('disables import for a viewer and hides credential controls', async () => {
  mockApi.mockImplementation(async (path) =>
    path.endsWith('/apps/')
      ? {
          apps: [
            { external_id: '123', name: 'Running', bundle_id: app.bundle_id, locale: 'en-US' },
          ],
        }
      : { connections: [connection], credentials_ready: true },
  );
  render(<Connections {...props} workspace={{ ...props.workspace, role: 'viewer' }} />);
  expect(
    ((await screen.findByRole('button', { name: 'Import' })) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.queryByRole('button', { name: 'Replace key' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Connect Apple' })).toBeNull();
});

it('requires an explicit disconnect and refreshes imported apps afterwards', async () => {
  mockApi.mockImplementation(async (path, options) => {
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
