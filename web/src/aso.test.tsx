import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ASO from '../../addons/aso/frontend';
import { api } from './api';
import type { MobileApp, ModuleProps } from './contracts';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  api: vi.fn(),
}));
vi.mock('./workflows/WorkflowPanel', () => ({ default: () => <div>Workflow activity</div> }));
const mockApi = vi.mocked(api);
const app = {
  id: 'one',
  name: 'Panda',
  platform: 'ios',
  metadata: {
    id: 'snapshot-one',
    captured_at: '2026-10-16T12:00:00Z',
    source: 'apple_store.api',
    data: { locale: 'en-US', localizations: [{ locale: 'en-US' }, { locale: 'fr-CA' }] },
  },
} as MobileApp;
const props: ModuleProps = {
  workspace: { id: 'workspace-one', name: 'Workshop', role: 'owner' },
  apps: [app],
  selectedApp: app,
  selectApp: vi.fn(),
  navigate: vi.fn(),
  refreshApps: vi.fn(),
  demoMode: false,
};
const check = {
  id: 'keywords.cleanup',
  field: 'keywords',
  title: 'Keyword repetition and separators',
  status: 'recommendation',
  basis: 'recommendation',
  observation: 'sort: already in subtitle',
  action: 'Review the proposed cleanup.',
  observed: 'sort,photos',
  replacement: 'photos',
  sources: [
    {
      id: 'apple',
      publisher: 'Apple',
      title: 'App Store search',
      url: 'https://developer.apple.com/app-store/search/',
      reviewed_on: '2026-10-16',
    },
  ],
};
const run = {
  id: 'audit-one',
  workflow_id: 'workflow-one',
  locale: 'en-US',
  status: 'succeeded',
  snapshot_id: 'snapshot-one',
  captured_at: '2026-10-16T12:00:00Z',
  created_at: '2026-10-16T12:01:00Z',
  report: { checks: [check], counts: { recommendation: 1 } },
};
function mockData(handler: (path: string, options?: RequestInit) => Promise<unknown>) {
  mockApi.mockImplementation(async (path, options) =>
    path.endsWith('/ai/') ? { providers: [], credentials_ready: true } : handler(path, options),
  );
}
beforeEach(() => {
  mockApi.mockReset();
});
afterEach(cleanup);

it('sends the chosen locale and exact snapshot, and shows a sourced copyable proposal', async () => {
  mockData(async (_path, options) => (options?.method === 'POST' ? run : []));
  render(<ASO {...props} />);
  await screen.findByText('Review your store listing');
  fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'fr-CA' } });
  mockData(async (_path, options) =>
    options?.method === 'POST' ? { ...run, locale: 'fr-CA' } : [],
  );
  fireEvent.click(screen.getByRole('button', { name: 'Run audit' }));
  await screen.findByText('sort: already in subtitle');
  const post = mockApi.mock.calls.find(([, options]) => options?.method === 'POST')!;
  expect(JSON.parse(post[1]!.body as string)).toMatchObject({
    locale: 'fr-CA',
    snapshot_id: 'snapshot-one',
  });
  expect(screen.getByRole('link', { name: /Apple · App Store search/ }).getAttribute('href')).toBe(
    check.sources[0].url,
  );
  expect((screen.getByLabelText('Proposed keywords') as HTMLTextAreaElement).readOnly).toBe(true);
  expect(screen.queryByRole('button', { name: /Publish/ })).toBeNull();
  expect(screen.getByText(/No changes have been sent to Apple/)).toBeTruthy();
});

it('keeps languages separate and marks audits of older imports', async () => {
  mockData(async () => [{ ...run, snapshot_id: 'older' }]);
  render(<ASO {...props} />);
  await screen.findByText(/This audit uses an earlier import/);
  fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'fr-CA' } });
  expect(screen.queryByText('sort: already in subtitle')).toBeNull();
  expect(screen.getByText('Review your store listing')).toBeTruthy();
});

it('prevents viewer actions and unsupported store audits', async () => {
  mockData(async () => []);
  const view = render(<ASO {...props} workspace={{ ...props.workspace, role: 'viewer' }} />);
  await screen.findByText('Review your store listing');
  expect((screen.getByRole('button', { name: 'Run audit' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  view.rerender(<ASO {...props} selectedApp={{ ...app, id: 'android', platform: 'android' }} />);
  await screen.findByText(/Audits currently support App Store/);
  expect(screen.queryByRole('button', { name: 'Run audit' })).toBeNull();
});

it('does not leak a late audit response after changing workspace', async () => {
  let resolvePost: (value: unknown) => void = () => {};
  mockData(async (_path, options) =>
    options?.method === 'POST'
      ? new Promise((resolve) => {
          resolvePost = resolve;
        })
      : [],
  );
  const view = render(<ASO {...props} />);
  await screen.findByText('Review your store listing');
  fireEvent.click(screen.getByRole('button', { name: 'Run audit' }));
  view.rerender(<ASO {...props} workspace={{ ...props.workspace, id: 'other' }} />);
  await screen.findByText('Review your store listing');
  resolvePost(run);
  await waitFor(() => expect(screen.queryByText('sort: already in subtitle')).toBeNull());
});

it('blocks new runs if audit history cannot be loaded', async () => {
  mockData(async () => {
    throw new Error('Access unavailable');
  });
  render(<ASO {...props} />);
  await screen.findByRole('alert');
  expect((screen.getByRole('button', { name: 'Run audit' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
});

it('requires an explicit model and sends it with the AI audit; labels AI proposals distinctly', async () => {
  const aiRun = {
    ...run,
    ai: { provider: 'openai', model: 'gpt-4.1-mini' },
    report: {
      ...run.report,
      checks: [
        {
          ...check,
          field: 'subtitle',
          basis: 'editorial_hypothesis',
          replacement: 'Sort photos your way',
        },
      ],
    },
  };
  mockApi.mockImplementation(async (path, options) =>
    path.endsWith('/ai/')
      ? {
          providers: [
            {
              id: 'openai',
              name: 'OpenAI',
              connected: true,
              revision: 'rev',
              models: [{ id: 'gpt-4.1-mini', name: 'Mini' }],
            },
          ],
          credentials_ready: true,
        }
      : options?.method === 'POST'
        ? aiRun
        : [],
  );
  render(<ASO {...props} />);
  await screen.findByLabelText('Model');
  expect((screen.getByRole('button', { name: 'Run audit' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'gpt-4.1-mini' } });
  fireEvent.click(screen.getByRole('button', { name: 'Run audit' }));
  await screen.findByText('AI proposal · Review');
  const post = mockApi.mock.calls.find(([, options]) => options?.method === 'POST')!;
  expect(JSON.parse(post[1]!.body as string)).toMatchObject({
    provider: 'openai',
    model: 'gpt-4.1-mini',
    locale: 'en-US',
  });
  expect(screen.getByRole('heading', { name: 'Recommendations' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Add to draft' })).toBeTruthy();
  expect(screen.getByLabelText('Proposed text')).toBeTruthy();
});
