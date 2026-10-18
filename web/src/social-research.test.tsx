import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SocialResearch, { type SocialSession } from '../../addons/studio/frontend/SocialResearch';
import { browserCommand } from '../../addons/studio/frontend/browserBridge';
import { api, ApiError } from './api';
import type { MobileApp, Workspace } from './contracts';

vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  api: vi.fn(),
}));
vi.mock('../../addons/studio/frontend/browserBridge', () => ({ browserCommand: vi.fn() }));
vi.mock('./ai/AIOptions', () => ({
  default: ({
    onChange,
  }: {
    onChange: (choice: { provider: string; model: string }, loading: boolean) => void;
  }) => (
    <button onClick={() => onChange({ provider: 'openai', model: 'gpt-4.1-mini' }, false)}>
      Choose research model
    </button>
  ),
}));
vi.mock('./workflows/WorkflowPanel', () => ({ default: () => <p>Workflow progress</p> }));
const mockedApi = vi.mocked(api);
const mockedBrowser = vi.mocked(browserCommand);
function browserReplies(
  reply: (command: string, payload?: Record<string, unknown>) => Promise<unknown>,
) {
  mockedBrowser.mockImplementation(async (command, payload) =>
    command === 'ping' ? { version: '0.1.5' } : reply(command, payload),
  );
}
const workspace: Workspace = { id: 'work', name: 'Workshop', role: 'owner' };
const app = {
  id: 'app',
  name: 'Runner',
  metadata: { id: 'snapshot', data: { features: ['Plan a run.'] } },
} as MobileApp;
const onGenerated = vi.fn();
function session(status = 'ready'): SocialSession {
  return {
    id: 'session',
    status,
    error: '',
    topic: 'Running apps',
    created_at: '2026-10-17T12:00:00Z',
    workflow_id: 'workflow',
    inputs: { min_views: 10000, min_likes: 500 },
    plan: {
      strategy: 'Find runner content',
      queries: [{ platform: 'tiktok', query: 'beginner running app', reason: 'Same niche' }],
    },
    posts: [],
    events: [],
  };
}
function qualified(id: string, format = 'video') {
  return {
    id,
    url: `https://www.tiktok.com/@a/video/${id}`,
    captured_at: '2026-10-17T12:00:00Z',
    frame_count: 3,
    evidence: {
      title: `Post ${id}`,
      caption: 'A short run',
      format,
      coverage: 'Partial frames, no audio.',
      author: 'runner',
      published_at: '',
    },
    metrics: {
      views: { value: 25000, raw: '25K', approximate: true },
      likes: { value: 1000, raw: '1K', approximate: true },
    },
    qualification: { status: 'qualified', reasons: [], like_rate: 0.04 },
    analysis: { format, structure: 'One step.' },
  };
}
beforeEach(() => {
  mockedApi.mockReset();
  mockedBrowser.mockReset();
  onGenerated.mockReset();
  mockedBrowser.mockResolvedValue({ version: '0.1.5' });
});
afterEach(cleanup);
function setup(saved: SocialSession) {
  let current = saved;
  mockedApi.mockImplementation(async (path, options) => {
    if (path.endsWith('/apps/app/social-research/')) return [saved];
    if (path.endsWith('/references/')) return { posts: [] };
    if (!options?.method) return current;
    const body = JSON.parse(String(options.body));
    if (body.action)
      return (current = {
        ...current,
        status:
          body.action === 'finish'
            ? 'analyzing'
            : body.action === 'stop'
              ? 'stopped'
              : 'collecting',
      });
    if (path.endsWith('/captures/'))
      return (current = {
        ...current,
        status: 'collecting',
        posts: [
          ...(current.posts || []),
          { ...qualified(String((current.posts?.length || 0) + 1)), url: body.url },
        ],
      });
    throw new Error(path);
  });
}
it('opens a dedicated browser tab, searches, saves evidence and only then starts analysis', async () => {
  setup(session());
  browserReplies(async (command) =>
    command === 'search'
      ? { candidates: [{ url: 'https://www.tiktok.com/@a/video/1' }], blocked_reason: '' }
      : command === 'read'
        ? { url: 'https://www.tiktok.com/@a/video/1', metrics: {}, frames: [] }
        : {},
  );
  render(<SocialResearch workspace={workspace} app={app} onGenerated={onGenerated} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Search in my browser' }));
  await screen.findByText('Collected posts saved. Checking performance and relevance.');
  expect(mockedBrowser.mock.calls.map(([command]) => command)).toEqual([
    'ping',
    'ping',
    'open',
    'search',
    'read',
  ]);
  expect(mockedBrowser.mock.calls.find(([command]) => command === 'read')?.[1]).toEqual({
    session: 'session',
    url: 'https://www.tiktok.com/@a/video/1',
  });
  const writes = mockedApi.mock.calls.filter(([, options]) => options?.method === 'POST');
  const captureIndex = writes.findIndex(([path]) => path.endsWith('captures/'));
  const finishIndex = writes.findIndex(
    ([, options]) => JSON.parse(String(options?.body)).action === 'finish',
  );
  expect(captureIndex).toBeGreaterThan(-1);
  expect(finishIndex).toBeGreaterThan(captureIndex);
});
it.each(['0.1.0', '0.1.3', '0.1.4'])(
  'explains how to reload connector %s before collection',
  async (version) => {
    setup(session());
    mockedBrowser.mockResolvedValue({ version });
    render(<SocialResearch workspace={workspace} app={app} onGenerated={onGenerated} />);
    await screen.findByText('Update Panda SMM Browser to 0.1.5');
    expect(
      (screen.getByRole('button', { name: 'Search in my browser' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    mockedBrowser.mockResolvedValue({ version: '0.1.5' });
    fireEvent.click(screen.getByRole('button', { name: 'Check connection' }));
    await screen.findByText('Browser connected');
    expect(
      (screen.getByRole('button', { name: 'Search in my browser' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  },
);
it('reports login blocks and keeps evidence for resumption without claiming completion', async () => {
  setup(session());
  browserReplies(async (command) =>
    command === 'search'
      ? { candidates: [], blocked_reason: 'Sign in to TikTok, then resume.' }
      : {},
  );
  render(<SocialResearch workspace={workspace} app={app} onGenerated={onGenerated} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Search in my browser' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Sign in to TikTok');
  expect(
    mockedApi.mock.calls.some(([, o]) => o?.body && JSON.parse(String(o.body)).action === 'finish'),
  ).toBe(false);
});
it('keeps partial collection resumable when one platform is unavailable', async () => {
  const saved = session();
  saved.plan.queries!.push(
    { platform: 'tiktok', query: 'running tips', reason: 'Same niche' },
    { platform: 'google', query: 'running app site:instagram.com/reel', reason: 'Find posts' },
  );
  setup(saved);
  browserReplies(async (command, payload) =>
    command === 'search'
      ? payload?.platform === 'tiktok'
        ? { candidates: [], blocked_reason: 'Platform unavailable' }
        : { candidates: [{ url: 'https://www.instagram.com/reel/run123' }], blocked_reason: '' }
      : command === 'read'
        ? { url: 'https://www.instagram.com/reel/run123', metrics: {}, frames: [] }
        : {},
  );
  render(<SocialResearch workspace={workspace} app={app} onGenerated={onGenerated} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Search in my browser' }));
  await screen.findByText(/Collection paused/);
  expect(
    mockedBrowser.mock.calls
      .filter(([command]) => command === 'search')
      .map(([, p]) => p?.platform),
  ).toEqual(['tiktok', 'google']);
  expect(mockedBrowser).toHaveBeenCalledWith(
    'read',
    expect.objectContaining({
      url: 'https://www.instagram.com/reel/run123',
    }),
  );
  const writes = mockedApi.mock.calls.filter(([, options]) => options?.method === 'POST');
  expect(
    writes.some(
      ([, options]) => JSON.parse(String(options?.body)).message === 'TikTok: Platform unavailable',
    ),
  ).toBe(true);
  expect(writes.some(([path]) => path.endsWith('/captures/'))).toBe(true);
  expect(writes.some(([, options]) => JSON.parse(String(options?.body)).action === 'finish')).toBe(
    false,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Analyze collected posts' }));
  await screen.findByText('Collected posts saved. Checking performance and relevance.');
});
it('does not offer adaptation when fewer than three references qualify', async () => {
  setup({
    ...session('completed'),
    posts: [
      qualified('1'),
      {
        ...qualified('2'),
        qualification: { status: 'unqualified', reasons: ['Views missing'], like_rate: null },
      },
    ],
  });
  render(<SocialResearch workspace={workspace} app={app} onGenerated={onGenerated} />);
  await screen.findByText(/2 more qualified/);
  expect(screen.getAllByLabelText('Use this reference')).toHaveLength(1);
  expect(
    (screen.getByRole('button', { name: /Create three adaptations/ }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
it('keeps collecting other networks when a post is blocked and records the block', async () => {
  setup(session());
  browserReplies(async (command, payload) =>
    command === 'search'
      ? {
          candidates: [
            { url: 'https://www.tiktok.com/@a/video/1' },
            { url: 'https://www.tiktok.com/@b/video/2' },
            { url: 'https://www.instagram.com/p/photo123' },
          ],
          blocked_reason: '',
        }
      : command === 'read'
        ? String(payload?.url).includes('tiktok.com')
          ? { blocked_reason: 'A verification challenge needs your attention.' }
          : { url: payload?.url, metrics: {}, frames: [] }
        : {},
  );
  render(<SocialResearch workspace={workspace} app={app} onGenerated={onGenerated} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Search in my browser' }));
  await screen.findByText(/Collection paused/);
  expect(
    mockedApi.mock.calls.some(
      ([, options]) => options?.body && JSON.parse(String(options.body)).action === 'finish',
    ),
  ).toBe(false);
  expect(
    mockedBrowser.mock.calls
      .filter(([command]) => command === 'read')
      .map(([, payload]) => payload?.url),
  ).toEqual(['https://www.tiktok.com/@a/video/1', 'https://www.instagram.com/p/photo123']);
  expect(
    mockedApi.mock.calls.some(
      ([, options]) =>
        options?.body &&
        JSON.parse(String(options.body)).message ===
          'TikTok: A verification challenge needs your attention.',
    ),
  ).toBe(true);
});
it('persists browser failures in the session history before stopping', async () => {
  setup(session());
  browserReplies(async (command) => {
    if (command === 'search') throw new Error('The research tab closed.');
    return {};
  });
  render(<SocialResearch workspace={workspace} app={app} onGenerated={onGenerated} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Search in my browser' }));
  await screen.findByText('The research tab closed.');
  await waitFor(() =>
    expect(
      mockedApi.mock.calls.some(
        ([, options]) => options?.body && JSON.parse(String(options.body)).action === 'stop',
      ),
    ).toBe(true),
  );
  expect(
    mockedApi.mock.calls.some(
      ([, options]) =>
        options?.body && JSON.parse(String(options.body)).message === 'The research tab closed.',
    ),
  ).toBe(true);
});
it('does not turn a requested stop into an error or a second stop request', async () => {
  setup(session());
  let finishSearch!: (value: unknown) => void;
  browserReplies(async (command) =>
    command === 'search'
      ? new Promise((resolve) => {
          finishSearch = resolve;
        })
      : {},
  );
  render(<SocialResearch workspace={workspace} app={app} onGenerated={onGenerated} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Search in my browser' }));
  await waitFor(() => expect(finishSearch).toBeDefined());
  fireEvent.click(screen.getByRole('button', { name: 'Stop research' }));
  await screen.findByText(/Collection paused/);
  await act(async () => {
    finishSearch({ candidates: [], blocked_reason: '' });
  });
  expect(screen.queryByRole('alert')).toBeNull();
  expect(
    mockedApi.mock.calls.filter(
      ([, options]) => options?.body && JSON.parse(String(options.body)).action === 'stop',
    ),
  ).toHaveLength(1);
  expect(
    (screen.getByRole('button', { name: 'Resume browser research' }) as HTMLButtonElement).disabled,
  ).toBe(false);
});

it('checks a disconnected browser before changing a saved research session', async () => {
  setup({ ...session('stopped'), posts: [qualified('1')] });
  mockedBrowser
    .mockResolvedValueOnce({ version: '0.1.5' })
    .mockRejectedValue(
      new Error('Browser connector was reloaded. Refresh Panda Store and resume research.'),
    );
  render(<SocialResearch workspace={workspace} app={app} onGenerated={onGenerated} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Resume browser research' }));
  await screen.findByRole('alert');
  expect(screen.getByText('Browser connector needed')).toBeTruthy();
  expect(mockedApi.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  mockedBrowser.mockResolvedValue({ version: '0.1.5' });
  fireEvent.click(screen.getByRole('button', { name: 'Check connection' }));
  await screen.findByText('Browser connected');
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('Post 1 ↗')).toBeTruthy();
});

it('resumes after a captcha without recapturing an existing reference', async () => {
  setup({ ...session('stopped'), posts: [qualified('1')] });
  let blocked = true;
  browserReplies(async (command, payload) =>
    command === 'search'
      ? {
          candidates: [
            { url: 'https://www.tiktok.com/@a/video/1' },
            { url: 'https://www.tiktok.com/@a/video/2' },
          ],
          blocked_reason: '',
        }
      : command === 'read'
        ? blocked
          ? { blocked_reason: 'A verification challenge needs your attention.' }
          : { url: payload?.url, metrics: {}, frames: [] }
        : {},
  );
  render(<SocialResearch workspace={workspace} app={app} onGenerated={onGenerated} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Resume browser research' }));
  await screen.findByRole('alert');
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Resume browser research' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  expect(screen.getByText('References · 1 qualified / 1 collected')).toBeTruthy();
  blocked = false;
  fireEvent.click(screen.getByRole('button', { name: 'Resume browser research' }));
  await screen.findByText('Collected posts saved. Checking performance and relevance.');
  expect(
    mockedBrowser.mock.calls
      .filter(([command]) => command === 'read')
      .map(([, payload]) => payload?.url),
  ).toEqual(['https://www.tiktok.com/@a/video/2', 'https://www.tiktok.com/@a/video/2']);
  expect(mockedApi.mock.calls.filter(([path]) => path.endsWith('/captures/'))).toHaveLength(1);
  expect(screen.getByText('References · 2 qualified / 2 collected')).toBeTruthy();
});

it('reloads saved research after a connection failure without starting a new search', async () => {
  mockedApi.mockRejectedValue(new ApiError('Cannot reach Panda Store.', 0));
  render(<SocialResearch workspace={workspace} app={app} onGenerated={onGenerated} />);
  await screen.findByText(/Saved research could not be loaded/);
  setup(session('stopped'));
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading research' }));
  await screen.findByRole('button', { name: 'Resume browser research' });
  expect(screen.queryByRole('alert')).toBeNull();
  expect(mockedApi.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
});
it('keeps the exact adaptation request after an uncertain response and uses three chosen references', async () => {
  const saved = {
    ...session('completed'),
    posts: [qualified('1'), qualified('2', 'carousel'), qualified('3')],
  };
  setup(saved);
  const normal = mockedApi.getMockImplementation()!;
  let first = true;
  mockedApi.mockImplementation(async (path, options) => {
    if (path.endsWith('/adapt/')) {
      if (first) {
        first = false;
        throw new ApiError('Response lost', 0);
      }
      return { id: 'generation', status: 'queued', creatives: [] };
    }
    return normal(path, options);
  });
  render(<SocialResearch workspace={workspace} app={app} onGenerated={onGenerated} />);
  for (const input of await screen.findAllByLabelText('Use this reference')) fireEvent.click(input);
  fireEvent.click(screen.getByRole('button', { name: /Create three adaptations/ }));
  await screen.findByText('Response lost');
  fireEvent.click(screen.getByRole('button', { name: 'Retry adaptation start' }));
  await waitFor(() => expect(onGenerated).toHaveBeenCalledOnce());
  const calls = mockedApi.mock.calls.filter(([path]) => path.endsWith('/adapt/'));
  expect(calls[0][1]?.body).toBe(calls[1][1]?.body);
  expect(JSON.parse(String(calls[0][1]?.body)).post_ids).toEqual(['1', '2', '3']);
});
it('viewers can inspect evidence but cannot collect or generate', async () => {
  setup({ ...session('completed'), posts: [qualified('1'), qualified('2'), qualified('3')] });
  render(
    <SocialResearch
      workspace={{ ...workspace, role: 'viewer' }}
      app={app}
      onGenerated={onGenerated}
    />,
  );
  await screen.findByText('References · 3 qualified / 3 collected');
  expect(screen.queryByRole('button', { name: /Create three adaptations/ })).toBeNull();
  expect(screen.queryByText('App context and new research')).toBeNull();
});

it('combines saved references with the current session and sends the chosen order', async () => {
  setup({ ...session('completed'), posts: [qualified('1', 'text')] });
  const normal = mockedApi.getMockImplementation()!;
  mockedApi.mockImplementation(async (path, options) => {
    if (path.endsWith('/references/'))
      return {
        posts: [
          { ...qualified('2', 'carousel'), research_id: 'older', research_topic: 'Photo sorting' },
          { ...qualified('3', 'ugc'), research_id: 'oldest', research_topic: 'Swipe apps' },
        ],
      };
    if (path.endsWith('/adapt/')) return { id: 'combined', status: 'queued', creatives: [] };
    return normal(path, options);
  });
  render(<SocialResearch workspace={workspace} app={app} onGenerated={onGenerated} />);
  await screen.findByText(/2 additional qualified reference\(s\) · 3 available/);
  expect(screen.queryByText(/more qualified reference\(s\) needed/)).toBeNull();
  expect(screen.getByText('From research: Photo sorting')).toBeTruthy();
  for (const input of screen.getAllByLabelText('Use this reference')) fireEvent.click(input);
  fireEvent.click(screen.getByRole('button', { name: /Create three adaptations/ }));
  await waitFor(() => expect(onGenerated).toHaveBeenCalledOnce());
  const call = mockedApi.mock.calls.find(([path]) => path.endsWith('/adapt/'))!;
  expect(call[0]).toContain('/social-research/session/adapt/');
  expect(JSON.parse(String(call[1]?.body)).post_ids).toEqual(['1', '2', '3']);
  expect(mockedBrowser.mock.calls.map(([command]) => command)).toEqual(['ping']);
});

it('ignores a late saved-reference response after switching research sessions', async () => {
  const first = { ...session('completed'), posts: [qualified('1')] };
  const second = { ...session('completed'), id: 'second', topic: 'Other topic', posts: [] };
  let resolveFirst!: (value: unknown) => void;
  mockedApi.mockImplementation(async (path) => {
    if (path.endsWith('/apps/app/social-research/')) return [first, second];
    if (path.endsWith('/session/references/'))
      return new Promise((resolve) => {
        resolveFirst = resolve;
      });
    if (path.endsWith('/references/')) return { posts: [] };
    return path.endsWith('/second/') ? second : first;
  });
  render(<SocialResearch workspace={workspace} app={app} onGenerated={onGenerated} />);
  await screen.findByText('Loading saved references…');
  fireEvent.change(screen.getByLabelText('Research session'), { target: { value: 'second' } });
  await screen.findByText(/3 more qualified reference/);
  resolveFirst({ posts: [qualified('stale')] });
  await waitFor(() => expect(screen.queryByText('Post stale')).toBeNull());
  expect(screen.queryByLabelText('Use this reference')).toBeNull();
});

it('starts browser collection automatically after the requested plan and reuses saved app facts', async () => {
  mockedApi.mockImplementation(async (path, options) => {
    if (path.endsWith('/apps/app/social-research/')) return options?.method ? session('ready') : [];
    const body = options?.body ? JSON.parse(String(options.body)) : {};
    return { ...session(), status: body.action === 'stop' ? 'stopped' : 'collecting' };
  });
  browserReplies(async (command) =>
    command === 'search' ? { candidates: [], blocked_reason: 'Platform unavailable' } : {},
  );
  render(
    <SocialResearch
      workspace={workspace}
      app={app}
      onGenerated={onGenerated}
      initialBrief={{
        audience: 'New runners',
        product_facts: 'The app helps plan a short run.',
        goal: 'Try the app',
        tone: 'Clear',
      }}
    />,
  );
  await screen.findByText('Browser connected');
  expect((screen.getByLabelText('Confirmed app features') as HTMLTextAreaElement).value).toBe(
    'The app helps plan a short run.',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Choose research model' }));
  fireEvent.click(screen.getByLabelText('I checked these features for this app.'));
  fireEvent.click(screen.getByRole('button', { name: 'Start social research' }));
  await screen.findByText('TikTok: Platform unavailable');
  expect(mockedBrowser.mock.calls.filter(([command]) => command === 'open')).toHaveLength(1);
  expect(mockedBrowser.mock.calls.filter(([command]) => command === 'search')).toHaveLength(1);
});

it('shares the twelve-post budget across networks even when the first search returns many posts', async () => {
  setup(session());
  browserReplies(async (command, payload) =>
    command === 'search'
      ? {
          candidates: [
            ...Array.from({ length: 15 }, (_, index) => ({
              url: `https://www.instagram.com/p/post${index}`,
            })),
            { url: 'https://www.tiktok.com/@a/video/1' },
          ],
          blocked_reason: '',
        }
      : command === 'read'
        ? { url: payload?.url, metrics: {}, frames: [] }
        : {},
  );
  render(<SocialResearch workspace={workspace} app={app} onGenerated={onGenerated} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Search in my browser' }));
  await screen.findByText('Collected posts saved. Checking performance and relevance.');
  const reads = mockedBrowser.mock.calls.filter(([command]) => command === 'read');
  expect(reads).toHaveLength(12);
  expect(reads[1][1]?.url).toBe('https://www.tiktok.com/@a/video/1');
});
