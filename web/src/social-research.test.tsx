import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SocialResearch, { type SocialSession } from '../../addons/studio/frontend/SocialResearch';
import { browserCommand } from '../../addons/studio/frontend/browserBridge';
import { api, ApiError } from './api';
import type { MobileApp, Workspace } from './contracts';
import { setLanguage } from './i18n';

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
    command === 'ping' ? { version: '0.1.7' } : reply(command, payload),
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
      platform: 'tiktok',
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
  setLanguage('en');
  mockedApi.mockReset();
  mockedBrowser.mockReset();
  onGenerated.mockReset();
  mockedBrowser.mockResolvedValue({ version: '0.1.7' });
});
afterEach(() => {
  cleanup();
  setLanguage('en');
});
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
it('opens a fresh search from completed research, keeps history and only starts on submission', async () => {
  const saved = { ...session('completed'), posts: [qualified('1')] };
  setup(saved);
  const normal = mockedApi.getMockImplementation()!;
  mockedApi.mockImplementation(async (path, options) => {
    if (path.endsWith('/apps/app/social-research/') && options?.method === 'POST') {
      return {
        ...session('planning'),
        id: 'new-session',
        topic: JSON.parse(String(options.body)).topic,
      };
    }
    return normal(path, options);
  });
  const initialBrief = {
    audience: 'Runners',
    product_facts: 'Plan a short run.',
    goal: 'Try the app',
    tone: 'Clear',
  };
  const view = render(
    <SocialResearch
      workspace={workspace}
      app={app}
      onGenerated={onGenerated}
      initialBrief={initialBrief}
    />,
  );
  await screen.findByText('References · 1 qualified / 1 collected');
  fireEvent.click(screen.getByRole('button', { name: 'Choose research model', hidden: true }));
  fireEvent.click(screen.getByLabelText('I checked these features for this app.'));
  view.rerender(
    <SocialResearch
      workspace={workspace}
      app={app}
      onGenerated={onGenerated}
      initialBrief={initialBrief}
      newResearchRequest={1}
    />,
  );
  await screen.findByText(
    'Prepare a new search below. Your previous research and scripts stay in history.',
  );
  const topic = screen.getByLabelText('Research topic');
  expect(document.activeElement).toBe(topic);
  expect(screen.getByText('App context and new research').closest('details')?.open).toBe(true);
  expect(
    (screen.getByLabelText('I checked these features for this app.') as HTMLInputElement).checked,
  ).toBe(false);
  expect((screen.getByLabelText('Research session') as HTMLSelectElement).value).toBe('');
  expect(screen.getByRole('option', { name: /Running apps/ }).getAttribute('value')).toBe(saved.id);
  expect(screen.queryByText('Post 1 ↗')).toBeNull();
  expect(mockedApi.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  fireEvent.change(topic, { target: { value: 'Running habits on Instagram' } });
  fireEvent.click(screen.getByLabelText('I checked these features for this app.'));
  fireEvent.click(screen.getByRole('button', { name: 'Start social research' }));
  await screen.findByText('Workflow progress');
  const writes = mockedApi.mock.calls.filter(([, options]) => options?.method === 'POST');
  expect(writes).toHaveLength(1);
  expect(writes[0][0]).toContain('/apps/app/social-research/');
  expect(JSON.parse(String(writes[0][1]?.body))).toMatchObject({
    request_id: expect.any(String),
    topic: 'Running habits on Instagram',
    provider: 'openai',
    model: 'gpt-4.1-mini',
    brief: { audience: 'Runners', product_facts: 'Plan a short run.' },
  });
  expect(screen.getByRole('option', { name: /Running apps/ }).getAttribute('value')).toBe(saved.id);
});

it.each(['planning', 'collecting', 'analyzing'])(
  'keeps the current research while %s is active',
  async (status) => {
    setup(session(status));
    const availability = vi.fn();
    const view = render(
      <SocialResearch
        workspace={workspace}
        app={app}
        onGenerated={onGenerated}
        onNewResearchAvailabilityChange={availability}
      />,
    );
    await screen.findByRole('heading', { name: 'Running apps' });
    expect(availability).toHaveBeenLastCalledWith(false);
    view.rerender(
      <SocialResearch
        workspace={workspace}
        app={app}
        onGenerated={onGenerated}
        onNewResearchAvailabilityChange={availability}
        newResearchRequest={1}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Running apps' })).toBeTruthy();
    expect(mockedApi.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  },
);

it.each([false, true])(
  'ignores late saved-session responses after opening a new search (failure: %s)',
  async (fail) => {
    let resolveHistory!: (value: SocialSession) => void;
    let rejectHistory!: (reason: Error) => void;
    const availability = vi.fn();
    mockedApi.mockImplementation(async (path) =>
      path.endsWith('/apps/app/social-research/')
        ? [session('completed')]
        : new Promise<SocialSession>((resolve, reject) => {
            resolveHistory = resolve;
            rejectHistory = reject;
          }),
    );
    const view = render(
      <SocialResearch
        workspace={workspace}
        app={app}
        onGenerated={onGenerated}
        onNewResearchAvailabilityChange={availability}
      />,
    );
    await waitFor(() => expect(availability).toHaveBeenLastCalledWith(true));
    view.rerender(
      <SocialResearch
        workspace={workspace}
        app={app}
        onGenerated={onGenerated}
        onNewResearchAvailabilityChange={availability}
        newResearchRequest={1}
      />,
    );
    await act(async () => {
      if (fail) rejectHistory(new Error('Late history error'));
      else resolveHistory(session('completed'));
    });
    expect((screen.getByLabelText('Research session') as HTMLSelectElement).value).toBe('');
    expect(screen.queryByRole('heading', { name: 'Running apps' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  },
);

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
it.each(['0.1.0', '0.1.3', '0.1.4', '0.1.5', '0.1.6'])(
  'explains how to reload connector %s before collection',
  async (version) => {
    setup(session());
    mockedBrowser.mockResolvedValue({ version });
    render(<SocialResearch workspace={workspace} app={app} onGenerated={onGenerated} />);
    await screen.findByText('Update Panda SMM Browser to 0.1.8');
    expect(
      (screen.getByRole('button', { name: 'Search in my browser' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    mockedBrowser.mockResolvedValue({ version: '0.1.7' });
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

it.each([
  'The post content did not become ready. Open it in the browser and resume.',
  'The requested page did not become ready. Check the research tab and resume.',
  'The platform returned an error. Retry in the research tab, then resume.',
])(
  'skips an unavailable post, continues on the same platform and analyzes saved evidence: %s',
  async (reason) => {
    setup(session());
    const unavailable = 'https://www.tiktok.com/@a/video/1';
    const accessible = 'https://www.tiktok.com/@b/video/2';
    browserReplies(async (command, payload) =>
      command === 'search'
        ? { candidates: [{ url: unavailable }, { url: accessible }], blocked_reason: '' }
        : command === 'read'
          ? payload?.url === unavailable
            ? { blocked_reason: reason }
            : { url: accessible, metrics: {}, frames: [] }
          : {},
    );
    render(<SocialResearch workspace={workspace} app={app} onGenerated={onGenerated} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Search in my browser' }));
    await screen.findByText('Collected posts saved. Checking performance and relevance.');
    expect(
      mockedBrowser.mock.calls
        .filter(([command]) => command === 'read')
        .map(([, payload]) => payload?.url),
    ).toEqual([unavailable, accessible]);
    const writes = mockedApi.mock.calls.filter(([, options]) => options?.method === 'POST');
    expect(
      writes
        .filter(([path]) => path.endsWith('/captures/'))
        .map(([, options]) => JSON.parse(String(options?.body)).url),
    ).toEqual([accessible]);
    expect(
      writes.some(([, options]) => {
        const body = JSON.parse(String(options?.body));
        return (
          body.action === 'event' &&
          body.url === unavailable &&
          body.message === 'Skipped a post whose content could not be loaded.'
        );
      }),
    ).toBe(true);
    expect(writes.some(([, options]) => JSON.parse(String(options?.body)).action === 'stop')).toBe(
      false,
    );
    expect(screen.queryByRole('alert')).toBeNull();
  },
);

it.each([false, true])(
  'limits unavailable-post attempts and analyzes only saved evidence (existing posts: %s)',
  async (hasSavedPosts) => {
    setup({ ...session(), posts: hasSavedPosts ? [qualified('saved')] : [] });
    browserReplies(async (command) =>
      command === 'search'
        ? {
            candidates: Array.from({ length: 30 }, (_, i) => ({
              url: `https://www.tiktok.com/@a/video/${i + 1}`,
            })),
            blocked_reason: '',
          }
        : command === 'read'
          ? {
              blocked_reason:
                'The post content did not become ready. Open it in the browser and resume.',
            }
          : {},
    );
    render(<SocialResearch workspace={workspace} app={app} onGenerated={onGenerated} />);
    fireEvent.click(
      await screen.findByRole('button', {
        name: hasSavedPosts ? 'Resume browser research' : 'Search in my browser',
      }),
    );
    await screen.findByText(
      hasSavedPosts
        ? 'Collected posts saved. Checking performance and relevance.'
        : /No direct social posts were collected/,
    );
    expect(mockedBrowser.mock.calls.filter(([command]) => command === 'read')).toHaveLength(24);
    const writes = mockedApi.mock.calls.filter(([, options]) => options?.method === 'POST');
    expect(writes.some(([path]) => path.endsWith('/captures/'))).toBe(false);
    expect(
      writes.some(([, options]) => JSON.parse(String(options?.body)).action === 'finish'),
    ).toBe(hasSavedPosts);
  },
);

it('shows pending AI checks in French and can analyze saved evidence without a browser connection', async () => {
  setLanguage('fr');
  setup({
    ...session('stopped'),
    posts: ['1', '2'].map((id) => ({
      ...qualified(id),
      qualification: { status: 'metrics_pass', reasons: [], like_rate: 0.04 },
      analysis: {},
    })),
  });
  mockedBrowser.mockRejectedValue(
    new Error('Install the Panda SMM Browser connector, then refresh this page.'),
  );
  render(<SocialResearch workspace={workspace} app={app} onGenerated={onGenerated} />);
  await screen.findByRole('heading', { name: 'Références · 2 collectées' });
  expect(screen.getByText('2 en attente d’analyse IA · 0 qualifiées · 0 écartées')).toBeTruthy();
  expect(screen.queryAllByRole('article')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Voir les autres références (2)' }));
  expect(screen.getAllByText('Seuils atteints · en attente d’analyse IA')).toHaveLength(2);
  expect(screen.queryByText(/Répondez à toute demande de connexion/)).toBeNull();
  expect(screen.queryByLabelText('Utiliser cette référence')).toBeNull();
  const analyze = screen.getByRole('button', { name: 'Analyser les publications collectées' });
  await waitFor(() => expect((analyze as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(analyze);
  await screen.findByText(
    'L’analyse IA est en cours. Elle vérifie la pertinence pour votre application et les preuves capturées.',
  );
  expect(
    mockedApi.mock.calls
      .filter(([, options]) => options?.method === 'POST')
      .map(([, options]) => JSON.parse(String(options?.body)).action),
  ).toEqual(['finish']);
  expect(mockedBrowser.mock.calls.map(([command]) => command)).toEqual(['ping']);
});

it('waits through a transient post navigation and saves the eventual capture once', async () => {
  setup(session());
  let reads = 0;
  browserReplies(async (command) => {
    if (command === 'search')
      return { candidates: [{ url: 'https://www.tiktok.com/@a/video/1' }], blocked_reason: '' };
    if (command === 'read') {
      if (++reads === 1)
        throw new Error('The research tab is navigating. Wait for the page, then resume.');
      return { url: 'https://www.tiktok.com/@a/video/1', metrics: {}, frames: [] };
    }
    return {};
  });
  render(<SocialResearch workspace={workspace} app={app} onGenerated={onGenerated} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Search in my browser' }));
  await screen.findByText('Waiting for the social page to finish loading…');
  await screen.findByText(
    'Collected posts saved. Checking performance and relevance.',
    {},
    { timeout: 3000 },
  );
  expect(reads).toBe(2);
  expect(mockedApi.mock.calls.filter(([path]) => path.endsWith('/captures/'))).toHaveLength(1);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('stopping while a page settles prevents a delayed retry or capture', async () => {
  setup(session());
  browserReplies(async (command) => {
    if (command === 'search')
      throw new Error('The research tab is navigating. Wait for the page, then resume.');
    return {};
  });
  render(<SocialResearch workspace={workspace} app={app} onGenerated={onGenerated} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Search in my browser' }));
  await screen.findByText('Waiting for the social page to finish loading…');
  fireEvent.click(screen.getByRole('button', { name: 'Stop research' }));
  await screen.findByText(/Collection paused/);
  await waitFor(
    () =>
      expect(
        (screen.getByRole('button', { name: 'Resume browser research' }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    { timeout: 3000 },
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1100));
  });
  expect(mockedBrowser.mock.calls.filter(([command]) => command === 'search')).toHaveLength(1);
  expect(mockedApi.mock.calls.some(([path]) => path.endsWith('/captures/'))).toBe(false);
});

it('opens connection instructions directly from the launch blocker and allows closing them', async () => {
  setLanguage('fr');
  mockedBrowser.mockRejectedValue(new Error('Connector not installed'));
  mockedApi.mockResolvedValue([]);
  render(<SocialResearch workspace={workspace} app={ideaApp()} onGenerated={onGenerated} />);
  const help = await screen.findByRole('button', {
    name: 'Afficher les instructions de connexion',
  });
  expect(screen.queryByRole('dialog')).toBeNull();
  const dialog = screen.getByRole('dialog', { hidden: true }) as HTMLDialogElement;
  // jsdom has no native modal implementation; modal behavior is also checked in Chrome.
  dialog.showModal = () => {
    dialog.open = true;
  };
  dialog.close = () => {
    dialog.open = false;
  };
  fireEvent.click(help);
  expect(screen.getByRole('dialog', { name: 'Connecter votre navigateur Chrome' })).toBe(dialog);
  expect(
    within(dialog).getByRole('button', { name: 'Téléchargez le connecteur de navigateur' }),
  ).toBeTruthy();
  expect(within(dialog).getByText('chrome://extensions')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Fermer les instructions' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Afficher les instructions de connexion' }),
  ).toBeTruthy();
  expect(mockedApi.mock.calls.every(([, options]) => !options?.method)).toBe(true);
});

it('translates platform-prefixed errors and saved browser activity in French', async () => {
  setLanguage('fr');
  const message = 'TikTok: The platform returned an error. Retry in the research tab, then resume.';
  setup({
    ...session('stopped'),
    error: message,
    events: [
      { at: '2026-10-18T12:00:00Z', message, url: '' },
      { at: '2026-10-18T12:00:01Z', message: 'Searching TikTok: fridge recipes', url: '' },
      { at: '2026-10-18T12:00:02Z', message: 'TikTok: 3 direct post links found.', url: '' },
    ],
  });
  browserReplies(async () => ({
    candidates: [],
    blocked_reason: 'The requested page did not become ready. Check the research tab and resume.',
  }));
  render(<SocialResearch workspace={workspace} app={app} onGenerated={onGenerated} />);
  expect((await screen.findByRole('alert')).textContent).toBe(
    'TikTok: La plateforme a renvoyé une erreur. Réessayez dans l’onglet de recherche, puis reprenez.',
  );
  expect(screen.getByText('Recherche sur TikTok : fridge recipes')).toBeTruthy();
  expect(screen.getByText('TikTok : 3 liens directs de publications trouvés.')).toBeTruthy();
  fireEvent.click(
    screen.getByRole('button', { name: 'Reprendre la recherche dans le navigateur' }),
  );
  await waitFor(() =>
    expect(
      screen
        .getAllByRole('alert')
        .some((alert) => alert.textContent?.includes('TikTok: La page demandée')),
    ).toBe(true),
  );
  expect(screen.queryByText(message, { exact: false })).toBeNull();
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
    90000,
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
it.each([1, 2, 3])('creates adaptations from %i selected qualified references', async (count) => {
  setup({
    ...session('completed'),
    posts: [
      ...Array.from({ length: count }, (_, index) => qualified(String(index + 1))),
      {
        ...qualified('excluded'),
        qualification: { status: 'unqualified', reasons: ['Views missing'], like_rate: null },
      },
    ],
  });
  const normal = mockedApi.getMockImplementation()!;
  mockedApi.mockImplementation(async (path, options) =>
    path.endsWith('/adapt/')
      ? { id: 'adaptation', status: 'queued', creatives: [] }
      : normal(path, options),
  );
  render(<SocialResearch workspace={workspace} app={app} onGenerated={onGenerated} />);
  await screen.findByText(`References · ${count} qualified / ${count + 1} collected`);
  expect(screen.getAllByLabelText('Use this reference')).toHaveLength(count);
  const start = screen.getByRole('button', {
    name: /Create (?:[123] )?adaptation/,
  }) as HTMLButtonElement;
  expect(start.disabled).toBe(true);
  expect(screen.queryByText(/more qualified reference/)).toBeNull();
  for (const input of screen.getAllByLabelText('Use this reference')) {
    fireEvent.click(input);
    expect(start.disabled).toBe(false);
  }
  expect(start.textContent).toBe(`Create ${count} adaptation${count === 1 ? '' : 's'}`);
  fireEvent.click(start);
  await waitFor(() => expect(onGenerated).toHaveBeenCalledOnce());
  const calls = mockedApi.mock.calls.filter(([path]) => path.endsWith('/adapt/'));
  expect(calls).toHaveLength(1);
  expect(JSON.parse(String(calls[0][1]?.body)).post_ids).toEqual(
    Array.from({ length: count }, (_, index) => String(index + 1)),
  );
});

it('limits selection to three references and allows replacing or deselecting them', async () => {
  setup({ ...session('completed'), posts: ['1', '2', '3', '4'].map((id) => qualified(id)) });
  render(<SocialResearch workspace={workspace} app={app} onGenerated={onGenerated} />);
  await screen.findByText('References · 4 qualified / 4 collected');
  const inputs = screen.getAllByLabelText('Use this reference') as HTMLInputElement[];
  inputs.slice(0, 3).forEach((input) => fireEvent.click(input));
  expect(inputs[3].disabled).toBe(true);
  expect(inputs[0].disabled).toBe(false);
  fireEvent.click(inputs[0]);
  expect(inputs[3].disabled).toBe(false);
  fireEvent.click(inputs[3]);
  expect(inputs[0].disabled).toBe(true);
  inputs.filter((input) => input.checked).forEach((input) => fireEvent.click(input));
  expect(
    (screen.getByRole('button', { name: /Create (?:[123] )?adaptation/ }) as HTMLButtonElement)
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
    .mockResolvedValueOnce({ version: '0.1.7' })
    .mockRejectedValue(
      new Error('Browser connector was reloaded. Refresh Panda Store and resume research.'),
    );
  render(<SocialResearch workspace={workspace} app={app} onGenerated={onGenerated} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Resume browser research' }));
  await screen.findByRole('alert');
  expect(screen.getByText('Refresh Panda Store to reconnect')).toBeTruthy();
  expect(mockedApi.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  mockedBrowser.mockResolvedValue({ version: '0.1.7' });
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
  fireEvent.click(screen.getByRole('button', { name: /Create (?:[123] )?adaptation/ }));
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
  expect(screen.queryByRole('button', { name: /Create (?:[123] )?adaptation/ })).toBeNull();
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
  fireEvent.click(screen.getByRole('button', { name: /Create (?:[123] )?adaptation/ }));
  await waitFor(() => expect(onGenerated).toHaveBeenCalledOnce());
  const call = mockedApi.mock.calls.find(([path]) => path.endsWith('/adapt/'))!;
  expect(call[0]).toContain('/social-research/session/adapt/');
  expect(JSON.parse(String(call[1]?.body)).post_ids).toEqual(['1', '2', '3']);
  expect(mockedBrowser.mock.calls.map(([command]) => command)).toEqual(['ping']);
});

it('filters current and reusable references by network while keeping selections across filters', async () => {
  const instagram = {
    ...qualified('2'),
    url: 'https://www.instagram.com/reel/run123',
    evidence: { ...qualified('2').evidence, platform: 'instagram' },
  };
  const facebook = {
    ...qualified('3'),
    url: 'https://www.facebook.com/watch/?v=123',
    evidence: { ...qualified('3').evidence, platform: 'facebook' },
    research_id: 'older',
    research_topic: 'Older running research',
  };
  setup({ ...session('completed'), posts: [qualified('1'), instagram] });
  const normal = mockedApi.getMockImplementation()!;
  mockedApi.mockImplementation(async (path, options) => {
    if (path.endsWith('/references/')) return { posts: [facebook] };
    if (path.endsWith('/adapt/')) return { id: 'combined', status: 'queued', creatives: [] };
    return normal(path, options);
  });
  render(<SocialResearch workspace={workspace} app={app} onGenerated={onGenerated} />);
  await screen.findByText('3 of 3 references shown');
  const filters = within(screen.getByRole('group', { name: 'Filter references by platform' }));
  expect(screen.getByText('References · 2 qualified / 2 collected')).toBeTruthy();
  fireEvent.click(filters.getByRole('button', { name: 'Instagram 1' }));
  expect(screen.getAllByRole('article')).toHaveLength(1);
  expect(screen.queryByText('Post 1 ↗')).toBeNull();
  expect(screen.getByText('Post 2 ↗')).toBeTruthy();
  expect(screen.queryByText('Post 3 ↗')).toBeNull();
  fireEvent.click(screen.getByLabelText('Use this reference'));
  fireEvent.click(filters.getByRole('button', { name: 'Facebook 1' }));
  expect(screen.getByText('From research: Older running research')).toBeTruthy();
  expect(screen.getByText(/1 selected outside this filter/)).toBeTruthy();
  fireEvent.click(screen.getByLabelText('Use this reference'));
  fireEvent.click(filters.getByRole('button', { name: 'TikTok 1' }));
  fireEvent.click(screen.getByLabelText('Use this reference'));
  expect(screen.getByText(/2 selected outside this filter/)).toBeTruthy();
  expect(mockedApi.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  fireEvent.click(filters.getByRole('button', { name: 'All platforms 3' }));
  expect(screen.getAllByRole('article')).toHaveLength(3);
  expect(
    screen
      .getAllByLabelText('Use this reference')
      .every((input) => (input as HTMLInputElement).checked),
  ).toBe(true);
  expect(screen.queryByText(/selected outside this filter/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Create 3 adaptations' }));
  await waitFor(() => expect(onGenerated).toHaveBeenCalledOnce());
  const call = mockedApi.mock.calls.find(([path]) => path.endsWith('/adapt/'))!;
  expect(JSON.parse(String(call[1]?.body)).post_ids).toEqual(['2', '3', '1']);
});

it('shows all networks again when opening another saved research session', async () => {
  const first = { ...session('completed'), posts: [qualified('1')] };
  const second = {
    ...session('completed'),
    id: 'second',
    topic: 'Instagram research',
    posts: [{ ...qualified('2'), evidence: { ...qualified('2').evidence, platform: 'instagram' } }],
  };
  mockedApi.mockImplementation(async (path) => {
    if (path.endsWith('/apps/app/social-research/')) return [first, second];
    if (path.endsWith('/references/')) return { posts: [] };
    return path.endsWith('/second/') ? second : first;
  });
  render(<SocialResearch workspace={workspace} app={app} onGenerated={onGenerated} />);
  fireEvent.click(await screen.findByRole('button', { name: 'TikTok 1' }));
  fireEvent.change(screen.getByLabelText('Research session'), { target: { value: 'second' } });
  await screen.findByText('Post 2 ↗');
  expect(screen.getByRole('button', { name: 'All platforms 1' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  expect(screen.queryByRole('button', { name: 'TikTok 1' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Instagram 1' })).toBeTruthy();
  expect(screen.queryByText('Post 1 ↗')).toBeNull();
});

it('translates the network filter and missing counters without qualifying the post', async () => {
  setLanguage('fr');
  setup({
    ...session('completed'),
    posts: [
      {
        ...qualified('1'),
        evidence: { ...qualified('1').evidence, platform: 'instagram' },
        metrics: {},
        qualification: {
          status: 'unqualified',
          reasons: ['Views were not observed.', 'Likes were not observed.'],
          like_rate: null,
        },
      },
    ],
  });
  render(<SocialResearch workspace={workspace} app={app} onGenerated={onGenerated} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Voir les autres références (1)' }));
  expect(screen.getByText('Le nombre de vues n’a pas pu être observé.')).toBeTruthy();
  expect(screen.getByText('Le nombre de mentions J’aime n’a pas pu être observé.')).toBeTruthy();
  expect(screen.getByRole('group', { name: 'Filtrer les références par réseau' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Tous les réseaux 1' })).toBeTruthy();
  expect(screen.getByText('non qualifié')).toBeTruthy();
  expect(screen.queryByRole('checkbox', { name: /Utiliser cette référence/ })).toBeNull();
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
  await screen.findByText(
    'No qualified references yet. Refine the topic or search another platform in a new session.',
  );
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

function ideaApp(specification = 'Suggest meals using ingredients already in the fridge.') {
  return {
    ...app,
    origin: 'project',
    platform: 'undecided',
    metadata: {
      id: 'project-snapshot',
      data: {
        locale: 'fr-FR',
        project: {
          origin: 'project',
          stage: 'idea',
          name: 'Meal idea',
          specification,
          audience: 'Busy households',
          available_features: '',
          listing_ready: false,
        },
      },
    },
  } as MobileApp;
}

it.each(['ready', 'visible'])(
  'reconnects on %s without losing the reviewed research form or starting a search',
  async (trigger) => {
    setLanguage('fr');
    mockedApi.mockResolvedValue([]);
    mockedBrowser.mockRejectedValue(
      new Error('Browser connector was reloaded. Refresh Panda Store and resume research.'),
    );
    render(<SocialResearch workspace={workspace} app={ideaApp()} onGenerated={onGenerated} />);
    await screen.findByText('Actualisez Panda Store pour reconnecter le navigateur');
    expect(
      screen.getAllByText(
        'Le connecteur a été rechargé. Actualisez Panda Store et reprenez la recherche.',
      ).length,
    ).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('Sujet de recherche'), {
      target: { value: 'Repas pour étudiants' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Choose research model' }));
    for (const platform of ['TikTok', 'Facebook', 'Google']) {
      const checkbox = screen.getByRole('checkbox', { name: platform }) as HTMLInputElement;
      if (checkbox.checked) fireEvent.click(checkbox);
    }
    const instagram = screen.getByRole('checkbox', { name: 'Instagram' }) as HTMLInputElement;
    if (!instagram.checked) fireEvent.click(instagram);
    const confirm = screen.getByLabelText(
      'J’ai vérifié le périmètre de ce projet, y compris les fonctionnalités encore prévues.',
    ) as HTMLInputElement;
    fireEvent.click(confirm);
    const start = screen.getByRole('button', {
      name: 'Démarrer la recherche sociale',
    }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    mockedBrowser.mockResolvedValue({ version: '0.1.8', protocol: 1 });
    if (trigger === 'ready') {
      fireEvent(
        window,
        new MessageEvent('message', {
          source: window,
          origin: location.origin,
          data: { channel: 'panda-smm-ready' },
        }),
      );
    } else {
      const visible = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
      fireEvent(document, new Event('visibilitychange'));
      visible.mockRestore();
    }
    await screen.findByText('Navigateur connecté');
    expect(start.disabled).toBe(false);
    expect(confirm.checked).toBe(true);
    expect(instagram.checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'TikTok' }) as HTMLInputElement).checked).toBe(
      false,
    );
    expect((screen.getByLabelText('Sujet de recherche') as HTMLInputElement).value).toBe(
      'Repas pour étudiants',
    );
    expect(
      (screen.getByLabelText('Périmètre confirmé du projet') as HTMLTextAreaElement).value,
    ).toBe(ideaApp().metadata!.data.project!.specification);
    expect(mockedApi.mock.calls.every(([, options]) => !options?.method)).toBe(true);
    expect(mockedBrowser.mock.calls.every(([command]) => command === 'ping')).toBe(true);
  },
);

it.each([
  { version: '0.1.7' },
  { version: '0.1.8', protocol: 1 },
  { version: '0.1.9', protocol: 1 },
])('accepts compatible connector %j without requiring an update', async (info) => {
  mockedApi.mockResolvedValue([]);
  mockedBrowser.mockResolvedValue(info);
  render(<SocialResearch workspace={workspace} app={ideaApp()} onGenerated={onGenerated} />);
  await screen.findByText('Browser connected');
  expect(screen.queryByText('Browser connector update needed')).toBeNull();
});

it('rejects an unsupported explicit protocol even if the version was previously compatible', async () => {
  mockedApi.mockResolvedValue([]);
  mockedBrowser.mockResolvedValue({ version: '0.1.7', protocol: 2 });
  render(<SocialResearch workspace={workspace} app={ideaApp()} onGenerated={onGenerated} />);
  await screen.findByText('Browser connector update needed');
  expect(
    (screen.getByRole('button', { name: 'Start social research' }) as HTMLButtonElement).disabled,
  ).toBe(true);
});

it('starts research directly from an idea without any imported store fields', async () => {
  const idea = ideaApp();
  mockedApi.mockImplementation(async (_path, options) =>
    options?.method ? session('planning') : [],
  );
  render(<SocialResearch workspace={workspace} app={idea} onGenerated={onGenerated} />);
  await screen.findByText('Browser connected');
  expect((screen.getByLabelText('Confirmed project scope') as HTMLTextAreaElement).value).toBe(
    idea.metadata!.data.project!.specification,
  );
  expect((screen.getByLabelText('Target audience') as HTMLInputElement).value).toBe(
    'Busy households',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Choose research model' }));
  const start = screen.getByRole('button', { name: 'Start social research' }) as HTMLButtonElement;
  expect(start.disabled).toBe(true);
  expect(
    screen.getByText('Check the confirmation box after reviewing the project scope.'),
  ).toBeTruthy();
  expect(mockedApi.mock.calls.every(([, options]) => !options?.method)).toBe(true);
  fireEvent.click(
    screen.getByLabelText(
      'I checked this project scope, including which features are still planned.',
    ),
  );
  expect(start.disabled).toBe(false);
  fireEvent.click(start);
  await screen.findByText('Workflow progress');
  const calls = mockedApi.mock.calls.filter(([, options]) => options?.method === 'POST');
  expect(calls).toHaveLength(1);
  expect(JSON.parse(String(calls[0][1]?.body))).toMatchObject({
    snapshot_id: 'project-snapshot',
    facts_confirmed: true,
    market: 'fr-FR',
    brief: {
      product_facts: idea.metadata!.data.project!.specification,
      audience: 'Busy households',
      goal: 'Encourage the right audience to try the app.',
    },
  });
});

it('explains missing inputs in French and requires review again after editing the scope', async () => {
  setLanguage('fr');
  const idea = ideaApp();
  idea.metadata!.data.project!.audience = '';
  mockedApi.mockResolvedValue([]);
  render(<SocialResearch workspace={workspace} app={idea} onGenerated={onGenerated} />);
  await screen.findByText('Navigateur connecté');
  fireEvent.click(screen.getByRole('button', { name: 'Choose research model' }));
  fireEvent.click(
    screen.getByLabelText(
      'J’ai vérifié le périmètre de ce projet, y compris les fonctionnalités encore prévues.',
    ),
  );
  const start = screen.getByRole('button', {
    name: 'Démarrer la recherche sociale',
  }) as HTMLButtonElement;
  expect(start.disabled).toBe(true);
  expect(
    screen.getByText('Précisez à qui s’adresse cette application dans le champ Public cible.'),
  ).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Public cible'), { target: { value: 'Parents pressés' } });
  expect(start.disabled).toBe(false);
  fireEvent.change(screen.getByLabelText('Périmètre confirmé du projet'), {
    target: { value: 'Planifier des repas simples à partir des restes.' },
  });
  expect(start.disabled).toBe(true);
  expect(
    screen.getByText('Cochez la confirmation après avoir relu le périmètre du projet.'),
  ).toBeTruthy();
});

it('bounds the prefilled scope and preserves an explicitly reviewed scope when the saved brief arrives late', async () => {
  mockedApi.mockResolvedValue([]);
  const idea = ideaApp('Project feature. '.repeat(400));
  const { rerender } = render(
    <SocialResearch workspace={workspace} app={idea} onGenerated={onGenerated} />,
  );
  await screen.findByText('Browser connected');
  const scope = screen.getByLabelText('Confirmed project scope') as HTMLTextAreaElement;
  expect(scope.value).toBe(idea.metadata!.data.project!.specification.slice(0, 4000));
  expect(screen.getByText(/The editable scope contains the first 4,000 characters/)).toBeTruthy();
  fireEvent.click(
    screen.getByLabelText(
      'I checked this project scope, including which features are still planned.',
    ),
  );
  rerender(
    <SocialResearch
      workspace={workspace}
      app={idea}
      onGenerated={onGenerated}
      initialBrief={{
        audience: 'Saved audience',
        product_facts: 'A previously saved scope.',
        goal: 'Learn',
        tone: 'Clear',
      }}
    />,
  );
  expect(scope.value).toBe(idea.metadata!.data.project!.specification.slice(0, 4000));
  expect((screen.getByLabelText('Target audience') as HTMLInputElement).value).toBe(
    'Saved audience',
  );
  expect(
    (
      screen.getByLabelText(
        'I checked this project scope, including which features are still planned.',
      ) as HTMLInputElement
    ).checked,
  ).toBe(true);
});

it('identifies invalid search settings before submitting a paid plan', async () => {
  mockedApi.mockResolvedValue([]);
  render(<SocialResearch workspace={workspace} app={ideaApp()} onGenerated={onGenerated} />);
  await screen.findByText('Browser connected');
  fireEvent.click(screen.getByRole('button', { name: 'Choose research model' }));
  fireEvent.click(
    screen.getByLabelText(
      'I checked this project scope, including which features are still planned.',
    ),
  );
  fireEvent.change(screen.getByLabelText('Minimum likes'), { target: { value: '0' } });
  const start = screen.getByRole('button', { name: 'Start social research' }) as HTMLButtonElement;
  expect(start.disabled).toBe(true);
  expect(
    screen.getByText('Set minimum likes to a whole number between 10 and 100,000,000.'),
  ).toBeTruthy();
  fireEvent.click(start);
  expect(mockedApi.mock.calls.every(([, options]) => !options?.method)).toBe(true);
});
