import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ScreenshotBriefs, { type ScreenshotBrief } from '../../addons/aso/frontend/ScreenshotBriefs';
import { api, ApiError, download } from './api';
import type { MobileApp, ModuleProps } from './contracts';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  api: vi.fn(),
  download: vi.fn(),
}));
const mockApi = vi.mocked(api);
const app = { id: 'app-one', name: 'Panda', platform: 'ios', metadata: null } as MobileApp;
const initial: ScreenshotBrief = {
  id: 'brief-one',
  name: 'Show the diary',
  locale: 'en-US',
  status: 'draft',
  version: 1,
  updated_at: '2026-10-17T13:00:00Z',
  reference_url: '/api/workspaces/one/aso/images/one/',
  can_mark_ready: false,
  content: { change: 'Show a concrete task.', screen: '', caption: '', test_plan: '' },
  source: {
    audit_id: 'audit-one',
    imported_at: '2026-10-17T12:00:00Z',
    model: 'test-model',
    finding: {
      name: 'diary.png',
      observation: 'Original observation.',
      recommendation: 'Show a concrete task.',
      visible_text: 'Run your way',
      sources: [],
    },
    listing: { description: 'Track each run.' },
  },
};
const props: ModuleProps & { app: MobileApp; initial: ScreenshotBrief } = {
  workspace: { id: 'workspace-one', name: 'Workshop', role: 'owner' },
  apps: [app],
  selectedApp: app,
  app,
  initial,
  selectApp: vi.fn(),
  navigate: vi.fn(),
  refreshApps: vi.fn(),
  demoMode: false,
};
const writes = () => mockApi.mock.calls.filter(([, options]) => options?.method === 'PATCH');
const body = (index: number) => JSON.parse(writes()[index][1]!.body as string);
beforeEach(() => {
  mockApi.mockReset();
  vi.mocked(download).mockReset();
  mockApi.mockImplementation(async (_path, options) => {
    if (!options?.method) return [];
    const data = JSON.parse(options.body as string);
    return {
      ...initial,
      ...data,
      content: { ...initial.content, ...data.content },
      version: data.version + 1,
      can_mark_ready: true,
    };
  });
});
afterEach(cleanup);

it('saves a brief while keeping the original image and observations unchanged', async () => {
  render(<ScreenshotBriefs {...props} />);
  fireEvent.change(screen.getByLabelText('Screen or state to capture'), {
    target: { value: 'Open the diary with a recorded run.' },
  });
  fireEvent.change(screen.getByLabelText('Caption (optional)'), {
    target: { value: 'See every run' },
  });
  expect(screen.getByText('Unsaved changes')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Save brief' }));
  await waitFor(() => expect(screen.queryByText('Unsaved changes')).toBeNull());
  expect(body(0)).toMatchObject({ version: 1, content: { caption: 'See every run' } });
  expect(screen.getByText('Original observation.')).toBeTruthy();
  expect(
    screen.getByRole('img', { name: 'Reference screenshot: diary.png' }).getAttribute('src'),
  ).toBe(initial.reference_url);
});

it('replays an uncertain save with the same request ID and preserves edits made after failure', async () => {
  let count = 0;
  mockApi.mockImplementation(async (_path, options) => {
    if (!options?.method) return [];
    const data = JSON.parse(options.body as string);
    count += 1;
    if (count === 1) throw new ApiError('Connection lost.', 0);
    return { ...initial, ...data, content: data.content, version: data.version + 1 };
  });
  render(<ScreenshotBriefs {...props} />);
  fireEvent.change(screen.getByLabelText('Caption (optional)'), {
    target: { value: 'First edit' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save brief' }));
  await screen.findByRole('alert');
  fireEvent.change(screen.getByLabelText('Caption (optional)'), {
    target: { value: 'Newer edit' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save brief' }));
  await waitFor(() => expect(writes()).toHaveLength(3));
  await waitFor(() => expect(screen.queryByText('Unsaved changes')).toBeNull());
  expect(body(1)).toEqual(body(0));
  expect(body(2)).toMatchObject({ version: 2, content: { caption: 'Newer edit' } });
  expect((screen.getByLabelText('Caption (optional)') as HTMLTextAreaElement).value).toBe(
    'Newer edit',
  );
});

it('requires saved fields and a human confirmation before marking ready', async () => {
  render(<ScreenshotBriefs {...props} />);
  const ready = screen.getByRole('button', { name: 'Mark ready for design' }) as HTMLButtonElement;
  expect(ready.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Screen or state to capture'), {
    target: { value: 'Diary screen' },
  });
  expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Save brief' }));
  await waitFor(() =>
    expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(false),
  );
  expect(ready.disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(ready);
  await screen.findByText('Ready for design');
  expect(body(1)).toMatchObject({ version: 2, status: 'ready', claims_confirmed: true });
  fireEvent.change(screen.getByLabelText('Caption (optional)'), { target: { value: 'New claim' } });
  expect(screen.queryByText('Ready for design')).toBeNull();
  expect(
    (screen.getByRole('button', { name: 'Mark ready for design' }) as HTMLButtonElement).disabled,
  ).toBe(true);
});

it('saves before export and downloads the precise saved revision', async () => {
  render(<ScreenshotBriefs {...props} />);
  fireEvent.change(screen.getByLabelText('Caption (optional)'), {
    target: { value: 'Export this caption' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Export brief' }));
  await waitFor(() =>
    expect(download).toHaveBeenCalledWith(
      expect.stringContaining('/export/?version=2'),
      'screenshot-brief-v2.zip',
    ),
  );
  expect(body(0).content.caption).toBe('Export this caption');
});

it('keeps conflicted edits and blocks navigation until the saved version is resolved', async () => {
  let guard: (() => Promise<boolean>) | undefined;
  mockApi.mockImplementation(async (_path, options) => {
    if (!options?.method) return [];
    throw new ApiError('Changed in another session.', 409);
  });
  render(
    <ScreenshotBriefs
      {...props}
      registerLeaveGuard={(next) => {
        guard = next;
        return () => {
          guard = undefined;
        };
      }}
    />,
  );
  fireEvent.change(screen.getByLabelText('Caption (optional)'), {
    target: { value: 'My unsaved caption' },
  });
  let left = true;
  await act(async () => {
    left = await guard!();
  });
  expect(left).toBe(false);
  expect(screen.getByRole('button', { name: 'Compare saved version' })).toBeTruthy();
  expect((screen.getByLabelText('Caption (optional)') as HTMLTextAreaElement).value).toBe(
    'My unsaved caption',
  );
  await act(async () => {
    left = await guard!();
  });
  expect(left).toBe(false);
  expect(writes()).toHaveLength(1);
});

it('saves pending edits before navigating away and warns before closing the browser', async () => {
  let guard: (() => Promise<boolean>) | undefined;
  render(
    <ScreenshotBriefs
      {...props}
      registerLeaveGuard={(next) => {
        guard = next;
        return () => {
          guard = undefined;
        };
      }}
    />,
  );
  fireEvent.change(screen.getByLabelText('Caption (optional)'), { target: { value: 'Keep this' } });
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  let left = false;
  await act(async () => {
    left = await guard!();
  });
  expect(left).toBe(true);
  expect(body(0).content.caption).toBe('Keep this');
});

it('allows viewers to export while disabling editing and approval', async () => {
  render(<ScreenshotBriefs {...props} workspace={{ ...props.workspace, role: 'viewer' }} />);
  expect((screen.getByLabelText('Caption (optional)') as HTMLTextAreaElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Duplicate' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(
    (screen.getByRole('button', { name: 'Mark ready for design' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Export brief' }));
  await waitFor(() => expect(download).toHaveBeenCalled());
  expect(writes()).toHaveLength(0);
});
