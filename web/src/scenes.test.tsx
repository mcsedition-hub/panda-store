import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Scenes, { type Storyboard } from '../../addons/studio/frontend/Scenes';
import { api, ApiError, download } from './api';
import type { MobileApp, Workspace } from './contracts';

vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  api: vi.fn(),
  download: vi.fn(),
}));
const mockApi = vi.mocked(api);
const workspace: Workspace = { id: 'work', name: 'Workshop', role: 'owner' };
const app = { id: 'app' } as MobileApp;
const props = { workspace, selectedApp: app, creativeId: 'creative', active: true };
const board: Storyboard = {
  id: 'board',
  creative_id: 'creative',
  version: 1,
  source: { angle: 'Gesture', hook: 'Opening', script: 'Saved script', cta: 'Try it' },
  script_changed: false,
  updated_at: '2026-10-17T12:00:00Z',
  scenes: [
    {
      id: 'first',
      title: 'Opening',
      visual: 'Phone on desk',
      voiceover: 'Start here',
      caption: '',
      duration: 5,
      asset_id: null,
    },
    {
      id: 'second',
      title: 'Gesture',
      visual: 'Swipe right',
      voiceover: 'Keep this photo',
      caption: '',
      duration: 10,
      asset_id: null,
    },
  ],
};
const library = {
  assets: [],
  candidates: [
    {
      snapshot_id: 'snapshot',
      position: 0,
      name: 'own-app.png',
      preview_url: 'https://is1-ssl.mzstatic.com/app.png',
      asset_id: null,
    },
  ],
};
function defaults(path: string, options?: { method?: string; body?: BodyInit | null }) {
  if (path.endsWith('scene-assets/')) return library;
  if (path.endsWith('storyboard/')) return { storyboard: structuredClone(board) };
  if (options?.method === 'PATCH') {
    const body = JSON.parse(options.body as string);
    return { ...board, scenes: body.scenes, version: body.version + 1 };
  }
  return structuredClone(board);
}
beforeEach(() => {
  mockApi.mockReset();
  vi.mocked(download).mockReset();
  mockApi.mockImplementation(async (path, options) => defaults(path, options));
});
afterEach(cleanup);

it('creates a plan only on request and edits, reorders, saves and exports exact versions', async () => {
  mockApi.mockImplementation(async (path, options) =>
    path.endsWith('storyboard/')
      ? options?.method === 'POST'
        ? board
        : { storyboard: null }
      : defaults(path, options),
  );
  render(<Scenes {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Create storyboard' }));
  fireEvent.change(await screen.findByLabelText('On-screen text'), {
    target: { value: 'Your photos, your choice' },
  });
  expect(
    within(screen.getByRole('complementary', { name: 'Storyboard preview' })).getByText(
      'Your photos, your choice',
    ),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Move later' }));
  fireEvent.change(screen.getByLabelText('Duration (seconds)'), { target: { value: '8' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save storyboard' }));
  await screen.findByText(/Saved · v2/);
  const saved = JSON.parse(
    mockApi.mock.calls.find(([, options]) => options?.method === 'PATCH')![1]!.body as string,
  );
  expect(saved.scenes.map((row: { id: string }) => row.id)).toEqual(['second', 'first']);
  expect(saved.scenes[1].duration).toBe(8);
  expect(saved.scenes[1].caption).toBe('Your photos, your choice');
  fireEvent.change(screen.getByLabelText('Saved version'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Export package' }));
  await waitFor(() =>
    expect(download).toHaveBeenCalledWith(
      '/api/workspaces/work/studio/storyboards/board/export/?version=1',
      'storyboard-v1.zip',
    ),
  );
});

it('imports the app screenshot and assigns the archived image to the selected shot', async () => {
  mockApi.mockImplementation(async (path, options) =>
    path.endsWith('scene-assets/') && options?.method === 'POST'
      ? {
          id: 'asset',
          name: 'own-app.png',
          url: '/api/local-image/',
          width: 100,
          height: 200,
          locale: 'en-US',
        }
      : defaults(path, options),
  );
  render(<Scenes {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Use own-app.png' }));
  const preview = screen.getByRole('complementary', { name: 'Storyboard preview' });
  await waitFor(() =>
    expect(within(preview).getByRole('img').getAttribute('src')).toBe('/api/local-image/'),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save storyboard' }));
  await screen.findByText(/Saved · v2/);
  const payload = JSON.parse(
    mockApi.mock.calls.find(([, options]) => options?.method === 'PATCH')![1]!.body as string,
  );
  expect(payload.scenes[0].asset_id).toBe('asset');
  expect(payload.scenes[1].asset_id).toBeNull();
});

it('preserves local edits on conflict and blocks navigation until explicitly reloaded', async () => {
  let leave: (() => Promise<boolean>) | undefined;
  mockApi.mockImplementation(async (path, options) => {
    if (options?.method === 'PATCH') throw new ApiError('Changed elsewhere.', 409);
    return defaults(path, options);
  });
  render(
    <Scenes
      {...props}
      registerLeaveGuard={(guard) => {
        leave = guard;
        return () => {};
      }}
    />,
  );
  fireEvent.change(await screen.findByLabelText('Voiceover'), {
    target: { value: 'Keep my edit' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save storyboard' }));
  await screen.findByText('Changed elsewhere.');
  expect((screen.getByLabelText('Voiceover') as HTMLTextAreaElement).value).toBe('Keep my edit');
  expect(await leave!()).toBe(false);
  fireEvent.click(
    screen.getByRole('button', { name: 'Discard local edits and reload saved version' }),
  );
  await waitFor(() =>
    expect((screen.getByLabelText('Voiceover') as HTMLTextAreaElement).value).toBe('Start here'),
  );
});

it('replays the same payload after an unknown save outcome', async () => {
  let calls = 0;
  mockApi.mockImplementation(async (path, options) => {
    if (options?.method === 'PATCH' && !calls++) throw new ApiError('Network unavailable', 0);
    return defaults(path, options);
  });
  render(<Scenes {...props} />);
  fireEvent.change(await screen.findByLabelText('Voiceover'), { target: { value: 'Local edit' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save storyboard' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Retry save' }));
  await screen.findByText(/Saved · v2/);
  const mutations = mockApi.mock.calls.filter(([, options]) => options?.method === 'PATCH');
  expect(mutations[0][1]!.body).toBe(mutations[1][1]!.body);
});

it('saves edits before leaving and stops playback when the tab becomes inactive', async () => {
  let leave: (() => Promise<boolean>) | undefined;
  const register = (guard: () => Promise<boolean>) => {
    leave = guard;
    return () => {};
  };
  const view = render(<Scenes {...props} registerLeaveGuard={register} />);
  fireEvent.change(await screen.findByLabelText('Voiceover'), { target: { value: 'New words' } });
  await leave!();
  await screen.findByText(/Saved · v2/);
  fireEvent.click(screen.getByRole('button', { name: 'Play preview' }));
  await screen.findByRole('button', { name: 'Pause' });
  view.rerender(<Scenes {...props} active={false} registerLeaveGuard={register} />);
  await screen.findByRole('button', { name: 'Play preview' });
});

it('supports viewer preview and export but prevents editing', async () => {
  render(<Scenes {...props} workspace={{ ...workspace, role: 'viewer' }} />);
  await screen.findByLabelText('Voiceover');
  expect(screen.getByLabelText('Voiceover').closest('fieldset')!.disabled).toBe(true);
  expect(
    (screen.getByRole('button', { name: 'Save storyboard' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(
    ((await screen.findByRole('button', { name: 'Use own-app.png' })) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Export package' }));
  await waitFor(() => expect(download).toHaveBeenCalled());
  expect(mockApi.mock.calls.some(([, options]) => options?.method)).toBe(false);
});
