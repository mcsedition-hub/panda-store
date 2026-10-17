import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Research, { type ResearchRun } from '../../addons/studio/frontend/Research';
import { api } from './api';
import type { MobileApp, Workspace } from './contracts';

vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  api: vi.fn(),
}));
vi.mock('./ai/AIOptions', () => ({
  default: ({ onChange }: { onChange: (choice: unknown, loading: boolean) => void }) => (
    <button onClick={() => onChange({ provider: 'google', model: 'gemini-3.8-flash' }, false)}>
      Choose Gemini
    </button>
  ),
}));
vi.mock('./workflows/WorkflowPanel', () => ({ default: () => <div>Live workflow</div> }));
const mocked = vi.mocked(api);
const workspace: Workspace = { id: 'work-one', name: 'Workshop', role: 'owner' };
const app = {
  id: 'app-one',
  name: 'MonTri',
  metadata: { id: 'snapshot-one', data: { locale: 'en-US' } },
} as MobileApp;
const run: ResearchRun = {
  id: 'run-one',
  workflow_id: 'flow-one',
  status: 'succeeded',
  error: '',
  topic: 'Photo cleanup apps',
  market: 'en-US',
  snapshot_id: 'snapshot-one',
  created_at: '2026-10-17T12:00:00Z',
  ai: { provider: 'google', model: 'gemini-3.8-flash' },
  pages: [
    {
      id: 'page-one',
      source: {
        title: 'Example app',
        url: 'https://public.example/',
        kind: 'discovered',
        domain: '',
      },
      title: 'Example app',
      final_url: 'https://public.example/',
      status: 'observed',
      reason: 'Two stills; no video.',
      text: 'Keep the best photos.',
      captured_at: '2026-10-17T12:00:00Z',
      images: { top: '/api/top/', scroll: '/api/scroll/' },
      trace: [{ action: 'scroll', at: '2026-10-17T12:00:00Z', y: 723 }],
    },
  ],
  discovery: {
    queries: ['photo cleanup competitors'],
    sources: [
      { url: 'https://public.example/', title: 'Example app', kind: 'discovered', domain: '' },
    ],
    warnings: [],
    search_widget: '<div>Search suggestions</div>',
  },
  report: {
    findings: [
      {
        page_id: 'page-one',
        content_type: 'unknown',
        observation: 'A short opening about photo selection.',
        hook_quote: 'Keep the best photos.',
        structure: 'A short title above the screenshot.',
        idea_to_test: 'Test one task per message.',
        evidence_quotes: ['Keep the best photos.'],
        metrics: [],
      },
    ],
    withheld: [],
    coverage: { observed: 1, attempted: 4, references_observed: 0, references_expected: 3 },
    calls: [],
  },
};
beforeEach(() => {
  mocked.mockReset();
});
afterEach(cleanup);

it('passes only explicitly selected retained observations into the brief', async () => {
  mocked.mockImplementation(async (path) =>
    path.endsWith('research-capabilities/')
      ? { browser_installed: true }
      : path.endsWith('/research/')
        ? [run]
        : run,
  );
  const useInBrief = vi.fn().mockResolvedValue(undefined);
  render(<Research workspace={workspace} app={app} onUseInBrief={useInBrief} />);
  await screen.findByLabelText('Select for brief');
  expect(
    (screen.getByRole('button', { name: 'Use observations in brief' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(screen.getByLabelText('Select for brief'));
  fireEvent.click(screen.getByRole('button', { name: 'Use 1 observation in brief' }));
  await waitFor(() => expect(useInBrief).toHaveBeenCalledWith('run-one', ['page-one']));
});
function read(path: string) {
  if (path.endsWith('research-capabilities/')) return { browser_installed: true };
  if (path.endsWith('/research/')) return [];
  return run;
}
async function configure() {
  await screen.findByText('No research yet.');
  fireEvent.change(screen.getByLabelText('Research topic'), {
    target: { value: 'Photo cleanup apps' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Choose Gemini' }));
}

it('requires a topic and explicit model and freezes the imported snapshot', async () => {
  mocked.mockImplementation(async (path, options) =>
    options?.method === 'POST' ? run : read(path),
  );
  render(<Research workspace={workspace} app={app} />);
  expect(
    (screen.getByRole('button', { name: 'Start research' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  await configure();
  fireEvent.click(screen.getByRole('button', { name: 'Start research' }));
  await screen.findByText('Live workflow');
  const [, options] = mocked.mock.calls.find(([, o]) => o?.method === 'POST')!;
  expect(JSON.parse(options!.body as string)).toMatchObject({
    snapshot_id: 'snapshot-one',
    provider: 'google',
    model: 'gemini-3.8-flash',
    topic: 'Photo cleanup apps',
  });
});

it('reuses the request ID after a lost start response', async () => {
  let attempts = 0;
  mocked.mockImplementation(async (path, options) => {
    if (options?.method === 'POST') {
      attempts++;
      if (attempts === 1) throw new Error('Connection lost');
      return run;
    }
    return read(path);
  });
  render(<Research workspace={workspace} app={app} />);
  await configure();
  fireEvent.click(screen.getByRole('button', { name: 'Start research' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Start research' }));
  await screen.findByText('Live workflow');
  const calls = mocked.mock.calls.filter(([, o]) => o?.method === 'POST');
  expect(JSON.parse(calls[0][1]!.body as string).request_id).toBe(
    JSON.parse(calls[1][1]!.body as string).request_id,
  );
});

it('shows partial coverage, evidence frames and sandboxed search suggestions', async () => {
  mocked.mockImplementation(async (path) => (path.endsWith('/research/') ? [run] : read(path)));
  render(<Research workspace={workspace} app={app} />);
  await screen.findByText('1 / 4 pages captured');
  expect(screen.getByText('0 / 3 cross-domain references')).toBeTruthy();
  expect(screen.getByText('No performance metrics retained.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'After scrolling' }));
  expect(screen.getByRole('img').getAttribute('src')).toBe('/api/scroll/');
  const widget = screen.getByTitle('Google Search suggestions');
  expect(widget.getAttribute('sandbox')).not.toContain('allow-scripts');
  expect(widget.getAttribute('sandbox')).not.toContain('allow-same-origin');
  expect(widget.getAttribute('srcdoc')).toContain("default-src 'none'");
});

it('keeps blocked sources visible without fabricating findings', async () => {
  const blocked = {
    ...run,
    pages: [{ ...run.pages![0], status: 'unavailable', reason: 'Login required.', images: {} }],
    report: {
      ...run.report!,
      findings: [],
      coverage: { observed: 0, attempted: 1, references_observed: 0, references_expected: 3 },
    },
  };
  mocked.mockImplementation(async (path) =>
    path.endsWith('/research/')
      ? [blocked]
      : path.endsWith('research-capabilities/')
        ? { browser_installed: true }
        : blocked,
  );
  render(<Research workspace={workspace} app={app} />);
  await screen.findByText('Unavailable');
  expect(screen.getAllByText('Login required.').length).toBeGreaterThan(0);
  expect(screen.queryByText('Idea to test')).toBeNull();
});

it('prevents research without the browser or write access', async () => {
  mocked.mockImplementation(async (path) =>
    path.endsWith('research-capabilities/') ? { browser_installed: false } : [],
  );
  const view = render(<Research workspace={workspace} app={app} />);
  await configure();
  expect(
    (screen.getByRole('button', { name: 'Start research' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  view.rerender(<Research workspace={{ ...workspace, role: 'viewer' }} app={app} />);
  expect((screen.getByLabelText('Research topic') as HTMLTextAreaElement).disabled).toBe(true);
});

it('ignores a start response after leaving the research workspace', async () => {
  let resolve: (value: ResearchRun) => void = () => {};
  mocked.mockImplementation(async (path, options) =>
    options?.method === 'POST'
      ? new Promise<ResearchRun>((done) => {
          resolve = done;
        })
      : read(path),
  );
  const view = render(<Research workspace={workspace} app={app} />);
  await configure();
  fireEvent.click(screen.getByRole('button', { name: 'Start research' }));
  await waitFor(() => expect(mocked.mock.calls.some(([, o]) => o?.method === 'POST')).toBe(true));
  view.unmount();
  resolve(run);
  await Promise.resolve();
  expect(screen.queryByText('Live workflow')).toBeNull();
});
