import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AIOptions from './ai/AIOptions';
import { api } from './api';
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
