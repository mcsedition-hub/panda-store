import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AIOptions from './ai/AIOptions';
import { api } from './api';
import { modelSuggestions } from '../../addons/aso/frontend/modelSuggestions';
vi.mock('./api', () => ({ api: vi.fn() }));
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
  mockApi.mockReset();
});
afterEach(cleanup);

it('lets the owner refresh models and replace the key without reading a saved secret', async () => {
  mockApi.mockResolvedValue(catalog);
  render(<AIOptions workspaceId="one" owner disabled={false} onChange={vi.fn()} />);
  await screen.findByLabelText('Model');
  fireEvent.click(screen.getByRole('button', { name: 'AI settings' }));
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
  render(<AIOptions workspaceId="one" owner={false} disabled onChange={vi.fn()} />);
  await screen.findByLabelText('Model');
  fireEvent.click(screen.getByRole('button', { name: 'AI settings' }));
  expect(screen.queryByLabelText('API key')).toBeNull();
  expect(screen.getByText(/Ask the workspace owner/)).toBeTruthy();
});

it('does not adopt late connection responses after unmount', async () => {
  let resolve: (value: unknown) => void = () => {};
  mockApi.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const changed = vi.fn();
  const view = render(<AIOptions workspaceId="one" owner disabled={false} onChange={changed} />);
  view.unmount();
  resolve(catalog);
  await Promise.resolve();
  expect(changed.mock.calls).toEqual([[null, true]]);
});

const googleCatalog = {
  credentials_ready: true,
  providers: [
    {
      id: 'google',
      connected: true,
      models: [
        { id: 'gemini-4-argon', name: 'Argon', thinking: true },
        { id: 'gemini-3.8-flash', name: 'Flash', thinking: true },
        { id: 'gemini-3.1-pro-preview', name: 'Pro', thinking: true },
        { id: 'gemini-2.5-flash-lite', name: 'Lite', thinking: true },
        { id: 'gemini-pro-latest', name: 'Latest', thinking: true },
      ],
    },
    ...catalog.providers,
  ],
};

it('suggests available Gemini reasoning models and leaves other choices explicit', async () => {
  mockApi.mockResolvedValue(googleCatalog);
  const changed = vi.fn();
  render(
    <AIOptions
      workspaceId="one"
      owner
      disabled={false}
      onChange={changed}
      suggestions={modelSuggestions}
    />,
  );
  const model = (await screen.findByLabelText('Model')) as HTMLSelectElement;
  expect(Array.from(model.options, (option) => option.value)).toEqual([
    '',
    'gemini-3.8-flash',
    'gemini-4-argon',
  ]);
  expect(model.value).toBe('');
  expect(changed).toHaveBeenLastCalledWith({ provider: 'google', model: '' }, false);
  fireEvent.change(model, { target: { value: 'gemini-3.8-flash' } });
  expect(changed).toHaveBeenLastCalledWith(
    { provider: 'google', model: 'gemini-3.8-flash' },
    false,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Show other models' }));
  expect(screen.getByRole('option', { name: 'gemini-3.1-pro-preview' })).toBeTruthy();
  expect(screen.getByRole('option', { name: 'gemini-pro-latest' })).toBeTruthy();
  fireEvent.change(model, { target: { value: 'gemini-2.5-flash-lite' } });
  fireEvent.click(screen.getByRole('button', { name: 'Show suggested models' }));
  expect(model.value).toBe('');
  expect(changed).toHaveBeenLastCalledWith({ provider: 'google', model: '' }, false);
  fireEvent.change(screen.getByLabelText('AI provider'), { target: { value: 'openai' } });
  expect(screen.getByRole('option', { name: 'gpt-4.1-mini' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Show other models' })).toBeNull();
});

it('does not invent availability or thinking support for an older or limited catalog', async () => {
  mockApi.mockResolvedValue({
    credentials_ready: true,
    providers: [
      {
        id: 'google',
        connected: true,
        models: [
          { id: 'gemini-4-argon', name: 'Argon', thinking: false },
          { id: 'gemini-3.8-flash', name: 'Flash' },
          { id: 'gemini-2.5-flash', name: 'Older Flash', thinking: true },
        ],
      },
    ],
  });
  render(
    <AIOptions
      workspaceId="one"
      owner
      disabled={false}
      onChange={vi.fn()}
      suggestions={modelSuggestions}
    />,
  );
  const model = (await screen.findByLabelText('Model')) as HTMLSelectElement;
  expect(model.options.length).toBe(1);
  expect(screen.getByText(/No suggested models in this catalog/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Show other models' }));
  expect(screen.getByRole('option', { name: 'gemini-2.5-flash' })).toBeTruthy();
  expect(screen.queryByRole('group', { name: 'Suggested for ASO' })).toBeNull();
});
