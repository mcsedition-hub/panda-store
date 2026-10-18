import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Studio from '../../addons/studio/frontend';
import { api } from './api';
import type { Brief, Creative, MobileApp, ModuleProps, Run } from './contracts';

const socialResearch = vi.hoisted(() => vi.fn());

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  api: vi.fn(),
}));
vi.mock('../../addons/studio/frontend/SocialResearch', () => ({
  default: (props: { initialBrief?: Brief }) => {
    socialResearch(props);
    return <p>Social research</p>;
  },
}));
vi.mock('../../addons/studio/frontend/Research', () => ({
  default: () => <p>Research workspace</p>,
}));
const mockApi = vi.mocked(api);
const app = { id: 'app-one', name: 'Runclub', metadata: null, is_demo: true } as MobileApp;
const props: ModuleProps = {
  workspace: { id: 'workspace-one', name: 'Atelier', role: 'owner' },
  apps: [app],
  selectedApp: app,
  selectApp: vi.fn(),
  navigate: vi.fn(),
  refreshApps: vi.fn(),
  demoMode: true,
};
const brief = { audience: 'Beginners', goal: 'Discover Runclub', tone: 'Simple' };
const creatives: Creative[] = [1, 2, 3].map((variant) => ({
  id: `creative-${variant}`,
  variant,
  angle: `Angle ${variant}`,
  hook: 'A hook',
  script: 'A script',
  cta: 'Discover',
  approved: false,
  updated_at: '2026-10-16T12:00:00Z',
}));
const run: Run = {
  id: 'run-one',
  status: 'succeeded',
  provider: 'demo_templates',
  error: '',
  created_at: '2026-10-16T12:00:00Z',
  completed_at: null,
  creatives,
};

beforeEach(() => {
  mockApi.mockReset();
  socialResearch.mockClear();
});
afterEach(cleanup);

it('offers new research from Scripts and opens the search form without a paid request', async () => {
  mockApi.mockImplementation(async (path) => (path.endsWith('brief/') ? brief : [run]));
  render(<Studio {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Scripts' }));
  await screen.findByLabelText('Hook — Angle 1');
  const button = screen.getByRole('button', { name: 'New research' }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  act(() => socialResearch.mock.calls.at(-1)![0].onNewResearchAvailabilityChange(true));
  expect(button.disabled).toBe(false);
  fireEvent.click(button);
  expect(screen.getByRole('button', { name: 'Research' }).getAttribute('aria-current')).toBe(
    'page',
  );
  expect(socialResearch).toHaveBeenLastCalledWith(
    expect.objectContaining({ newResearchRequest: 1 }),
  );
  expect(mockApi.mock.calls.some(([, options]) => options?.method)).toBe(false);
});

it('opens research and scripts for an idea without imported store features', async () => {
  const idea = {
    ...app,
    is_demo: false,
    origin: 'project',
    metadata: {
      id: 'idea-snapshot',
      data: {
        name: 'Meal idea',
        project: {
          origin: 'project',
          name: 'Meal idea',
          stage: 'idea',
          specification: 'Plan meals from leftovers.',
          audience: 'Busy households',
          available_features: '',
          listing_ready: false,
        },
      },
    },
  } as MobileApp;
  mockApi.mockImplementation(async (path) => {
    if (path.endsWith('brief/')) return brief;
    if (path.endsWith('runs/')) return [];
    if (path.endsWith('/ai/')) return { providers: [], credentials_ready: true };
    throw new Error('Unexpected request');
  });
  render(<Studio {...props} apps={[idea]} selectedApp={idea} demoMode={false} />);
  expect(screen.getByText('Social research')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Scripts' }));
  expect(await screen.findByLabelText('Audience')).toBeTruthy();
  expect(screen.getByText(/Create launch-ready content from your app description/)).toBeTruthy();
  expect(mockApi.mock.calls.every(([, options]) => !options?.method)).toBe(true);
});

it('never prefills social research with the previous app brief while the new one loads', async () => {
  let resolveBrief!: (value: Brief) => void;
  const nextBrief = {
    ...brief,
    audience: 'Households',
    product_facts: 'Plan meals from leftovers.',
  };
  mockApi.mockImplementation(async (path) => {
    if (path.includes('app-two/brief/'))
      return new Promise((resolve) => {
        resolveBrief = resolve;
      });
    if (path.endsWith('brief/')) return brief;
    if (path.endsWith('runs/')) return [];
    if (path.endsWith('/ai/')) return { providers: [], credentials_ready: true };
    throw new Error('Unexpected request');
  });
  const view = render(<Studio {...props} />);
  await waitFor(() =>
    expect(socialResearch).toHaveBeenLastCalledWith(
      expect.objectContaining({ initialBrief: brief }),
    ),
  );
  socialResearch.mockClear();
  const other = { ...app, id: 'app-two', name: 'Meal idea' };
  view.rerender(<Studio {...props} apps={[app, other]} selectedApp={other} />);
  expect(socialResearch.mock.calls.length).toBeGreaterThan(0);
  expect(socialResearch.mock.calls.every(([value]) => value.initialBrief === undefined)).toBe(true);
  resolveBrief(nextBrief);
  await waitFor(() =>
    expect(socialResearch).toHaveBeenLastCalledWith(
      expect.objectContaining({ initialBrief: nextBrief }),
    ),
  );
});

it('saves the brief before generation, then lets the user edit and approve separately', async () => {
  mockApi.mockImplementation(async (path, options) => {
    if (path.endsWith('brief/')) return brief;
    if (path.endsWith('runs/')) return options?.method === 'POST' ? run : [];
    if (path.includes('creatives/')) {
      const body = JSON.parse(options?.body as string);
      return { ...creatives[0], ...body };
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  render(<Studio {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Scripts' }));
  const audience = await screen.findByLabelText('Audience');
  fireEvent.change(audience, { target: { value: 'Weekend runners' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create scripts' }));
  const hook = await screen.findByLabelText('Hook — Angle 1');
  expect(screen.getAllByRole('article')).toHaveLength(3);
  const mutations = mockApi.mock.calls.filter(([, options]) => options?.method);
  expect(mutations[0][1]?.method).toBe('PUT');
  expect(JSON.parse(mutations[0][1]?.body as string).audience).toBe('Weekend runners');
  expect(mutations[1][1]?.method).toBe('POST');
  expect(JSON.parse(mutations[1][1]?.body as string).request_id).toMatch(/^[\da-f-]{36}$/);
  fireEvent.change(hook, { target: { value: 'My own angle' } });
  const approve = screen.getAllByRole('button', {
    name: 'Approve script',
  })[0] as HTMLButtonElement;
  expect(approve.disabled).toBe(true);
  fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]);
  await screen.findByText('Changes saved.');
  expect(approve.disabled).toBe(false);
  fireEvent.click(approve);
  await screen.findByText('Script approved.');
  expect(screen.getByRole('link', { name: 'Export scripts' }).getAttribute('href')).toBe(
    '/api/workspaces/workspace-one/studio/runs/run-one/export/',
  );
});

it('does not generate if saving the brief fails', async () => {
  mockApi.mockImplementation(async (path, options) => {
    if (options?.method === 'PUT') throw new Error('Could not save');
    return path.endsWith('brief/') ? brief : [];
  });
  render(<Studio {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Scripts' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Create scripts' }));
  await screen.findByRole('alert');
  expect(mockApi.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
});

it('does not expose stale editable content when loading fails', async () => {
  mockApi.mockRejectedValue(new Error('Access unavailable'));
  render(<Studio {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Scripts' }));
  await screen.findByRole('alert');
  await waitFor(() => expect(screen.queryByLabelText('Audience')).toBeNull());
  expect(screen.queryByRole('button', { name: 'Create scripts' })).toBeNull();
});

it('prevents writes in a read-only workspace', async () => {
  mockApi.mockImplementation(async (path) => (path.endsWith('brief/') ? brief : [run]));
  render(<Studio {...props} workspace={{ ...props.workspace, role: 'viewer' }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Scripts' }));
  const button = (await screen.findByRole('button', {
    name: 'Create scripts',
  })) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect((screen.getByLabelText('Hook — Angle 1') as HTMLTextAreaElement).disabled).toBe(true);
});

it('ignores a generation response after switching workspace', async () => {
  let resolveRun: (value: Run) => void = () => {};
  mockApi.mockImplementation(async (path, options) => {
    if (path.endsWith('brief/')) return brief;
    if (options?.method === 'POST')
      return new Promise<Run>((resolve) => {
        resolveRun = resolve;
      });
    return [];
  });
  const view = render(<Studio {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Scripts' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Create scripts' }));
  await waitFor(() =>
    expect(mockApi.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(true),
  );
  view.rerender(
    <Studio {...props} workspace={{ ...props.workspace, id: 'different-workspace' }} />,
  );
  await screen.findByRole('button', { name: 'Create scripts' });
  resolveRun(run);
  await waitFor(() => expect(screen.getByText('No scripts yet.')).toBeTruthy());
  expect(screen.queryByLabelText('Hook — Angle 1')).toBeNull();
});
