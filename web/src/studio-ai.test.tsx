import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Studio from '../../addons/studio/frontend';
import { api, ApiError } from './api';
import type { Brief, MobileApp, ModuleProps } from './contracts';

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
vi.mock('./workflows/WorkflowPanel', () => ({ default: () => <div>Live generation</div> }));
vi.mock('../../addons/studio/frontend/Research', () => ({
  default: ({ onUseInBrief }: { onUseInBrief: (id: string, pages: string[]) => Promise<void> }) => (
    <button onClick={() => void onUseInBrief('research-one', ['page-one'])}>
      Use selected observations
    </button>
  ),
}));
const mocked = vi.mocked(api);
const app = {
  id: 'app-one',
  name: 'MonTri',
  is_demo: false,
  metadata: { id: 'snapshot-one', data: { features: [] } },
} as unknown as MobileApp;
const props: ModuleProps = {
  workspace: { id: 'work-one', name: 'Workshop', role: 'owner' },
  apps: [app],
  selectedApp: app,
  selectApp: vi.fn(),
  navigate: vi.fn(),
  refreshApps: vi.fn(),
  demoMode: false,
};
const brief: Brief = {
  audience: 'iPhone owners',
  goal: 'Try the app',
  tone: 'Direct',
  product_facts: 'MonTri uses swipe gestures to sort photos.',
  language: 'English',
  duration_seconds: 30,
  research: 'research-one',
  research_page_ids: ['page-one'],
  research_sources: [
    {
      page_id: 'page-one',
      title: 'Selected source',
      url: 'https://public.example/',
      captured_at: '2026-10-17T12:00:00Z',
      finding: {
        observation: 'One gesture.',
        structure: 'Show one action.',
        idea_to_test: 'A focused demo.',
      },
    },
  ],
};
const queued = {
  id: 'gen-one',
  workflow_id: 'workflow-one',
  status: 'queued',
  provider: 'google',
  creatives: [],
};
beforeEach(() => {
  mocked.mockReset();
  mocked.mockImplementation(async (path, options) => {
    if (path.endsWith('brief/'))
      return options?.body ? { ...brief, ...JSON.parse(String(options.body)) } : brief;
    if (path.endsWith('ai-runs/')) return queued;
    if (path.endsWith('runs/')) return [];
    throw new Error(path);
  });
});
afterEach(cleanup);
async function configure() {
  fireEvent.click(screen.getByRole('button', { name: 'Scripts' }));
  await screen.findByLabelText('Product facts');
  fireEvent.click(screen.getByRole('button', { name: 'Choose Gemini' }));
  fireEvent.click(screen.getByLabelText('I checked these product facts for this app.'));
}
it('requires checked facts and a model, and sends the explicit brief and saved source IDs', async () => {
  render(<Studio {...props} />);
  await configure();
  fireEvent.change(screen.getByLabelText('Product facts'), {
    target: { value: 'MonTri sorts photos with swipes.' },
  });
  expect(
    (screen.getByLabelText('I checked these product facts for this app.') as HTMLInputElement)
      .checked,
  ).toBe(false);
  expect(
    (screen.getByRole('button', { name: 'Create scripts' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByLabelText('I checked these product facts for this app.'));
  fireEvent.click(screen.getByRole('button', { name: 'Create scripts' }));
  await screen.findByText('Live generation');
  const call = mocked.mock.calls.find(([path]) => path.endsWith('ai-runs/'))!;
  expect(JSON.parse(String(call[1]?.body))).toMatchObject({
    snapshot_id: 'snapshot-one',
    research_id: 'research-one',
    page_ids: ['page-one'],
    facts_confirmed: true,
    provider: 'google',
    model: 'gemini-3.8-flash',
    brief: { product_facts: 'MonTri sorts photos with swipes.', duration_seconds: 30 },
  });
});
it('saves a research selection and keeps the edited brief when moving from Research to Scripts', async () => {
  render(<Studio {...props} />);
  await configure();
  fireEvent.change(screen.getByLabelText('Audience'), {
    target: { value: 'Parents sorting family photos' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Research' }));
  fireEvent.click(screen.getByRole('button', { name: 'Use selected observations' }));
  await waitFor(() =>
    expect((screen.getByLabelText('Audience') as HTMLInputElement).value).toBe(
      'Parents sorting family photos',
    ),
  );
  const save = mocked.mock.calls.find(([, options]) => options?.method === 'PUT')!;
  expect(JSON.parse(String(save[1]?.body))).toMatchObject({
    audience: 'Parents sorting family photos',
    research: 'research-one',
    research_page_ids: ['page-one'],
  });
});
it('reuses an uncertain paid start without changing the request or resaving the brief', async () => {
  const implementation = mocked.getMockImplementation()!;
  let starts = 0;
  mocked.mockImplementation(async (path, options) => {
    if (path.endsWith('ai-runs/') && ++starts === 1) throw new ApiError('Lost response', 0);
    return implementation(path, options);
  });
  render(<Studio {...props} />);
  await configure();
  fireEvent.click(screen.getByRole('button', { name: 'Create scripts' }));
  await screen.findByText('Lost response');
  expect((screen.getByLabelText('Product facts') as HTMLTextAreaElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Retry same request' }));
  await screen.findByText('Live generation');
  const calls = mocked.mock.calls.filter(([path]) => path.endsWith('ai-runs/'));
  expect(calls[0][1]?.body).toBe(calls[1][1]?.body);
  expect(mocked.mock.calls.filter(([, options]) => options?.method === 'PUT')).toHaveLength(1);
});
it('does not start paid generation after leaving while the brief save is pending', async () => {
  const implementation = mocked.getMockImplementation()!;
  let resolve!: (value: Brief) => void;
  mocked.mockImplementation(async (path, options) =>
    options?.method === 'PUT'
      ? new Promise<Brief>((done) => {
          resolve = done;
        })
      : implementation(path, options),
  );
  const view = render(<Studio {...props} />);
  await configure();
  fireEvent.click(screen.getByRole('button', { name: 'Create scripts' }));
  await waitFor(() => expect(resolve).toBeDefined());
  view.unmount();
  resolve(brief);
  await new Promise((done) => setTimeout(done, 0));
  expect(mocked.mock.calls.some(([path]) => path.endsWith('ai-runs/'))).toBe(false);
});
