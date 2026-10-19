import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AISettings from './AISettings';
import AIOptions from './AIOptions';
import { api } from '../api';
import { setLanguage } from '../i18n';
vi.mock('../api', () => ({ api: vi.fn() }));
const mockApi = vi.mocked(api);
const catalog = {
  credentials_ready: true,
  providers: [
    {
      id: 'openai',
      name: 'OpenAI',
      connected: true,
      revision: 'revision-one',
      models: [{ id: 'gpt-4.1-mini', name: 'Mini' }],
    },
  ],
};
beforeEach(() => {
  setLanguage('en');
  mockApi.mockReset();
});
afterEach(() => {
  cleanup();
  setLanguage('en');
});

it('disconnects a provider and clears its connection controls', async () => {
  mockApi.mockResolvedValueOnce(catalog).mockResolvedValue({
    ...catalog,
    providers: [{ ...catalog.providers[0], connected: false, revision: null, models: [] }],
  });
  render(<AISettings workspaceId="one" owner />);
  fireEvent.click(await screen.findByRole('button', { name: 'Disconnect provider' }));
  await screen.findByText('Provider disconnected.');
  expect(mockApi).toHaveBeenLastCalledWith(
    '/api/workspaces/one/ai/openai/',
    expect.objectContaining({
      method: 'DELETE',
      body: JSON.stringify({ revision: 'revision-one' }),
    }),
  );
  expect(screen.queryByRole('button', { name: 'Refresh models' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Connect provider' })).toBeTruthy();
});

it('makes a newly connected provider available when returning to a module', async () => {
  let connected = false;
  mockApi.mockImplementation(async (_, options) => {
    if (options?.method === 'PUT') connected = true;
    return connected ? catalog : { credentials_ready: true, providers: [] };
  });
  const view = render(<AISettings workspaceId="one" owner />);
  fireEvent.change(await screen.findByLabelText('API key'), {
    target: { value: 'test-key-not-real' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Connect provider' }));
  await screen.findByText('Connection checked. Available models updated.');
  const changed = vi.fn();
  view.rerender(<AIOptions workspaceId="one" disabled={false} onChange={changed} />);
  const model = await screen.findByLabelText('Model');
  fireEvent.change(model, { target: { value: 'gpt-4.1-mini' } });
  expect(changed).toHaveBeenLastCalledWith({ provider: 'openai', model: 'gpt-4.1-mini' }, false);
  expect(screen.queryByLabelText('API key')).toBeNull();
});

it('clears unsaved keys when switching workspaces or losing owner access', async () => {
  mockApi.mockResolvedValue(catalog);
  const view = render(<AISettings workspaceId="one" owner />);
  fireEvent.change(await screen.findByLabelText('API key'), {
    target: { value: 'not-a-real-secret' },
  });
  view.rerender(<AISettings workspaceId="two" owner />);
  expect(((await screen.findByLabelText('API key')) as HTMLInputElement).value).toBe('');
  expect(mockApi).toHaveBeenLastCalledWith('/api/workspaces/two/ai/', expect.anything());
  fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'another-test-secret' } });
  view.rerender(<AISettings workspaceId="two" owner={false} />);
  await screen.findByText(/Ask the workspace owner/);
  expect(screen.queryByLabelText('API key')).toBeNull();
  expect(mockApi.mock.calls.every(([, options]) => !options?.method)).toBe(true);
});

it('ignores a late connection mutation from a previous workspace', async () => {
  let finish: (value: unknown) => void = () => {};
  mockApi.mockImplementation(async (path, options) => {
    if (options?.method)
      return new Promise((resolve) => {
        finish = resolve;
      });
    if (path.includes('/two/')) return { credentials_ready: true, providers: [] };
    return catalog;
  });
  const view = render(<AISettings workspaceId="one" owner />);
  fireEvent.click(await screen.findByRole('button', { name: 'Refresh models' }));
  view.rerender(<AISettings workspaceId="two" owner />);
  await screen.findByLabelText('API key');
  await act(async () => finish(catalog));
  expect(screen.queryByRole('button', { name: 'Replace key' })).toBeNull();
  expect(screen.queryByText('Connection checked. Available models updated.')).toBeNull();
  expect(
    (screen.getByRole('button', { name: 'Reload AI connections' }) as HTMLButtonElement).disabled,
  ).toBe(false);
});

const zaiCatalog = {
  credentials_ready: true,
  providers: [
    {
      id: 'zai',
      name: 'Z.ai (GLM)',
      connected: true,
      revision: 'zai-one',
      models: [
        { id: 'glm-4.7-flash', name: 'glm-4.7-flash', vision: false, listed_free: true },
        { id: 'glm-4.6v-flash', name: 'glm-4.6v-flash', vision: true, listed_free: true },
        { id: 'glm-5.3', name: 'glm-5.3', vision: false, listed_free: false },
      ],
    },
  ],
};

it('connects Z.ai explicitly and explains its connection check and standard key', async () => {
  mockApi.mockImplementation(async (_, options) =>
    options?.method === 'PUT'
      ? zaiCatalog
      : {
          credentials_ready: true,
          providers: [{ ...zaiCatalog.providers[0], connected: false, revision: null, models: [] }],
        },
  );
  render(<AISettings workspaceId="one" owner />);
  await screen.findByLabelText('Provider');
  fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'zai' } });
  expect(screen.getByText(/Create a Standard API Key/)).toBeTruthy();
  expect(screen.getByText(/Connecting or refreshing sends a short check/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('API key'), {
    target: { value: 'test-zai-key-not-real' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Connect provider' }));
  await screen.findByText('Connection checked. Supported GLM models updated.');
  expect(mockApi).toHaveBeenCalledWith(
    '/api/workspaces/one/ai/zai/',
    expect.objectContaining({ method: 'PUT' }),
  );
  expect((screen.getByLabelText('API key') as HTMLInputElement).value).toBe('');
});

it('lets the owner refresh models and replace the key without reading a saved secret', async () => {
  mockApi.mockResolvedValue(catalog);
  render(<AISettings workspaceId="one" owner />);
  await screen.findByLabelText('Provider');
  expect((screen.getByLabelText('API key') as HTMLInputElement).value).toBe('');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh models' }));
  await screen.findByText('Connection checked. Available models updated.');
  const refresh = mockApi.mock.calls.find(([, options]) => options?.method === 'POST')!;
  expect(JSON.parse(refresh[1]!.body as string)).toEqual({ revision: 'revision-one' });
  fireEvent.change(screen.getByLabelText('API key'), {
    target: { value: 'test-new-key-not-real' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Replace key' }));
  await waitFor(() =>
    expect((screen.getByLabelText('API key') as HTMLInputElement).value).toBe(''),
  );
  const save = mockApi.mock.calls.find(([, options]) => options?.method === 'PUT')!;
  expect(JSON.parse(save[1]!.body as string)).toEqual({
    api_key: 'test-new-key-not-real',
    revision: 'revision-one',
  });
});

it('does not expose connection mutations to viewers or editors', async () => {
  mockApi.mockResolvedValue(catalog);
  render(<AISettings workspaceId="one" owner={false} />);
  await screen.findByText(/Ask the workspace owner/);
  expect(screen.queryByLabelText('API key')).toBeNull();
  expect(screen.getByText(/Ask the workspace owner/)).toBeTruthy();
});

it('recovers a failed catalog read without reporting unavailable credential storage or writing a connection', async () => {
  mockApi.mockRejectedValue(new Error('Cannot reach Panda Store.'));
  render(<AISettings workspaceId="one" owner />);
  await screen.findByText(/AI connections could not be loaded/);
  expect(screen.queryByText(/Credential storage is unavailable/)).toBeNull();
  expect(screen.queryByLabelText('API key')).toBeNull();
  mockApi.mockResolvedValue(catalog);
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading AI connections' }));
  await screen.findByLabelText('Provider');
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByLabelText('API key')).toBeTruthy();
  expect(mockApi.mock.calls.every(([, options]) => !options?.method)).toBe(true);
});

it('reloads a changed connection before an explicit retry with its current revision', async () => {
  mockApi.mockImplementation(async (_, options) => {
    if (options?.method) throw new Error('This connection changed. Reload AI settings.');
    return catalog;
  });
  render(<AISettings workspaceId="one" owner />);
  await screen.findByLabelText('Provider');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh models' }));
  await screen.findByText('This connection changed. Reload AI settings.');
  const updated = {
    ...catalog,
    providers: [{ ...catalog.providers[0], revision: 'revision-two' }],
  };
  mockApi.mockResolvedValue(updated);
  fireEvent.click(screen.getByRole('button', { name: 'Reload AI connections' }));
  await screen.findByRole('button', { name: 'Refresh models' });
  expect(mockApi.mock.calls.filter(([, options]) => options?.method)).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh models' }));
  await screen.findByText('Connection checked. Available models updated.');
  const writes = mockApi.mock.calls.filter(([, options]) => options?.method);
  expect(JSON.parse(String(writes[1][1]?.body))).toEqual({ revision: 'revision-two' });
});
