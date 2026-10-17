import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { api, download } from './api';
import Notifications from './notifications/Notifications';
import { clearNotifications, getNotices, getWork, notify, trackWork } from './notifications/store';

beforeEach(() => clearNotifications());
afterEach(() => {
  cleanup();
  clearNotifications();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('only confirms an export after receiving the file and reports download errors', async () => {
  vi.useFakeTimers();
  const create = vi.fn(() => 'blob:test-export');
  const revoke = vi.fn();
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    },
  );
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response('Saved draft text', { headers: { 'Content-Type': 'text/plain' } }),
      )
      .mockResolvedValueOnce(response({ error: 'You no longer have access.' }, 403)),
  );
  await download('/api/draft/export/', 'draft.txt');
  expect(create).toHaveBeenCalledTimes(1);
  expect(click).toHaveBeenCalledTimes(1);
  expect(getNotices()[0].message).toBe('Export prepared. Download started.');
  await expect(download('/api/draft/export/', 'draft.txt')).rejects.toThrow(
    'no longer have access',
  );
  expect(click).toHaveBeenCalledTimes(1);
  expect(getNotices()[1].kind).toBe('error');
  vi.advanceTimersByTime(1000);
  expect(revoke).toHaveBeenCalledWith('blob:test-export');
});
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

it('announces confirmed actions and suppresses autosave success and background reads', async () => {
  const fetcher = vi.fn().mockImplementation(() => Promise.resolve(response({ saved: true })));
  vi.stubGlobal('fetch', fetcher);
  await api('/api/example/');
  await api('/api/example/', { method: 'PATCH', feedback: { success: '' } });
  expect(getNotices()).toEqual([]);
  await api('/api/example/', { method: 'POST', feedback: { success: 'App imported.' } });
  expect(getNotices().map((item) => item.message)).toEqual(['App imported.']);
  expect(fetcher.mock.calls[2][1]).not.toHaveProperty('feedback');
});

it('keeps errors visible, deduplicates them and allows dismissal', async () => {
  vi.useFakeTimers();
  render(<Notifications />);
  act(() => {
    notify('success', 'Saved.');
    notify('error', 'OpenAI: API credits are exhausted.', 'billing');
    notify('error', 'OpenAI: API credits are exhausted.', 'billing');
  });
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  act(() => vi.advanceTimersByTime(7000));
  expect(screen.queryByText('Saved.')).toBeNull();
  expect(screen.getByRole('alert').textContent).toContain('credits');
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
  expect(screen.queryByRole('alert')).toBeNull();
});

it.each(['succeeded', 'failed', 'canceled'])(
  'follows a started task to %s without its module mounted',
  async (status) => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ workflow_id: 'run-one', status: 'queued' }, 202))
      .mockResolvedValueOnce(
        response({
          id: 'run-one',
          title: 'Listing audit',
          status,
          error: 'Gemini: billing needs attention.',
        }),
      );
    vi.stubGlobal('fetch', fetcher);
    await api('/api/workspaces/one/aso/apps/app/runs/', { method: 'POST' });
    render(<Notifications />);
    await waitFor(() => expect(getWork()).toEqual([]));
    expect(getNotices()).toHaveLength(2);
    expect(getNotices()[1].kind).toBe(
      status === 'failed' ? 'error' : status === 'succeeded' ? 'success' : 'info',
    );
    if (status === 'failed') expect(screen.getByRole('alert').textContent).toContain('billing');
    expect(fetcher.mock.calls.map(([, options]) => options.method || 'GET')).toEqual([
      'POST',
      'GET',
    ]);
  },
);

it('reports network failures without claiming success and leaves aborted requests quiet', async () => {
  const fetcher = vi.fn().mockRejectedValue(new TypeError('private transport detail'));
  vi.stubGlobal('fetch', fetcher);
  await expect(api('/api/example/', { method: 'POST' })).rejects.toThrow('could not be confirmed');
  expect(getNotices()[0].kind).toBe('error');
  expect(getNotices()[0].message).not.toContain('private');
  clearNotifications();
  const controller = new AbortController();
  controller.abort();
  await expect(
    api('/api/example/', { method: 'POST', signal: controller.signal }),
  ).rejects.toThrow();
  expect(getNotices()).toEqual([]);
});

it('clears pending tasks and prevents a late notification after sign out', async () => {
  let resolve: (value: Response) => void = () => {};
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          }),
      )
      .mockResolvedValueOnce(response({ csrf_token: 'test' })),
  );
  trackWork('one', 'run-one');
  render(<Notifications />);
  await act(async () => {
    await api('/api/session/logout/', { method: 'POST', feedback: { success: 'Signed out.' } });
  });
  await act(async () => {
    resolve(response({ status: 'succeeded', title: 'Private task' }));
  });
  expect(getWork()).toEqual([]);
  expect(getNotices().map((item) => item.message)).toEqual(['Signed out.']);
});
