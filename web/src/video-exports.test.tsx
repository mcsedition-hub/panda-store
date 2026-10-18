import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import VideoExports from '../../addons/studio/frontend/VideoExports';
import { api, ApiError, download } from './api';
vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  api: vi.fn(),
  download: vi.fn(),
}));
vi.mock('./workflows/WorkflowPanel', () => ({
  default: ({ onRetry }: { onRetry: () => void }) => (
    <button onClick={onRetry}>Retry saved render</button>
  ),
}));
const mockApi = vi.mocked(api);
const props = { workspaceId: 'work', boardId: 'board', version: 2, dirty: false, canWrite: true };
const saved = {
  id: 'render',
  version: 1,
  workflow_id: 'workflow',
  status: 'succeeded',
  error: '',
  created_at: '2026-10-17T12:00:00Z',
  url: '/api/video/',
  can_delete: true,
};
beforeEach(() => {
  mockApi.mockReset();
  vi.mocked(download).mockReset();
  mockApi.mockImplementation(async (path, options) =>
    path.endsWith('media-capabilities/')
      ? { available: true }
      : options?.method
        ? { ...saved, version: 2, status: 'queued', url: null }
        : [],
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('starts a render from the saved version and never starts from unsaved edits', async () => {
  const view = render(<VideoExports {...props} dirty />);
  await waitFor(() => expect(mockApi).toHaveBeenCalledTimes(2));
  expect(
    (screen.getByRole('button', { name: 'Render MP4 · v2' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  view.rerender(<VideoExports {...props} />);
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Render MP4 · v2' }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Render MP4 · v2' }));
  await screen.findByLabelText('Render');
  const body = JSON.parse(
    mockApi.mock.calls.find(([, options]) => options?.method === 'POST')![1]!.body as string,
  );
  expect(body.version).toBe(2);
  expect(body.request_id).toMatch(/^[a-f\d-]{36}$/);
});

it('keeps the same request and original version after an ambiguous network failure', async () => {
  let count = 0;
  mockApi.mockImplementation(async (path, options) => {
    if (path.endsWith('media-capabilities/')) return { available: true };
    if (options?.method === 'POST') {
      if (!count++) throw new ApiError('Unknown outcome', 0);
      return { ...saved, version: 2 };
    }
    return [];
  });
  const view = render(<VideoExports {...props} />);
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Render MP4 · v2' }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Render MP4 · v2' }));
  await screen.findByText('Unknown outcome');
  view.rerender(<VideoExports {...props} version={3} dirty />);
  fireEvent.click(screen.getByRole('button', { name: 'Check render request' }));
  await screen.findByLabelText('Render');
  const calls = mockApi.mock.calls.filter(([, options]) => options?.method === 'POST');
  expect(calls[0][1]!.body).toBe(calls[1][1]!.body);
});

it('shows the original version and allows viewers to download a completed render', async () => {
  mockApi.mockImplementation(async (path) =>
    path.endsWith('media-capabilities/') ? { available: true } : [saved],
  );
  render(<VideoExports {...props} canWrite={false} />);
  await screen.findByText('This video uses saved version 1. The editor is on version 2.');
  fireEvent.click(screen.getByRole('button', { name: 'Download MP4' }));
  await waitFor(() =>
    expect(download).toHaveBeenCalledWith('/api/video/?download=1', 'storyboard-v1.mp4'),
  );
  expect(screen.queryByText('Delete render files')).toBeNull();
});

it('explains the missing local renderer and blocks starting', async () => {
  mockApi.mockImplementation(async (path) =>
    path.endsWith('media-capabilities/') ? { available: false } : [],
  );
  render(<VideoExports {...props} />);
  await screen.findByText(/Install FFmpeg and ffprobe/);
  expect(
    (screen.getByRole('button', { name: 'Render MP4 · v2' }) as HTMLButtonElement).disabled,
  ).toBe(true);
});

it('updates a render that finishes while an older export is selected', async () => {
  const active = {
    ...saved,
    id: 'active',
    workflow_id: 'active-workflow',
    version: 2,
    status: 'running',
    url: null,
    can_delete: false,
  };
  let renders = [active, saved];
  mockApi.mockImplementation(async (path) =>
    path.endsWith('media-capabilities/') ? { available: true } : renders,
  );
  render(<VideoExports {...props} />);
  const picker = await screen.findByLabelText('Render');
  vi.useFakeTimers();
  fireEvent.change(picker, { target: { value: saved.id } });
  expect(
    (screen.getByRole('button', { name: 'Render MP4 · v2' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  renders = [
    { ...active, status: 'succeeded', url: '/api/active-video/', can_delete: true },
    saved,
  ];
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2500);
  });
  expect(
    (screen.getByRole('button', { name: 'Render MP4 · v2' }) as HTMLButtonElement).disabled,
  ).toBe(false);
  expect((picker as HTMLSelectElement).value).toBe(saved.id);
});
