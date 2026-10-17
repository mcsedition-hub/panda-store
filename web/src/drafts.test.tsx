import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import DraftEditor from '../../addons/aso/frontend/DraftEditor';
import type { Draft } from '../../addons/aso/frontend/draftTypes';
import { api, ApiError } from './api';
import type { MobileApp, ModuleProps } from './contracts';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  api: vi.fn(),
}));
const mockApi = vi.mocked(api);
const content = {
  name: 'Panda',
  subtitle: 'Training diary',
  description: 'Track runs.',
  keywords: 'fitness',
  promotional_text: '',
};
const initial: Draft = {
  id: 'draft-one',
  name: 'Keyword cleanup',
  locale: 'en-US',
  status: 'draft',
  version: 1,
  created_at: '2026-10-16T12:00:00Z',
  updated_at: '2026-10-16T12:00:00Z',
  captured_at: '2026-10-16T12:00:00Z',
  snapshot_id: 'snapshot',
  is_demo: false,
  content,
  baseline: { ...content, keywords: 'run,fitness' },
  changed_fields: ['keywords'],
  provenance: [],
  validation: { can_mark_ready: true, blocking: [], checks: [] },
  latest: {
    snapshot_id: 'snapshot',
    captured_at: '2026-10-16T12:00:00Z',
    content,
    changed_since_baseline: [],
    matching_fields: [],
    all_changes_match: false,
  },
};
const app = { id: 'app-one', name: 'Panda', platform: 'ios', metadata: null } as MobileApp;
const props: ModuleProps & {
  app: MobileApp;
  initial: Draft;
  onBack: () => void;
  onSaved: (draft: Draft) => void;
  onDuplicate: (draft: Draft) => void;
} = {
  workspace: { id: 'workspace-one', name: 'Workshop', role: 'owner' },
  apps: [app],
  selectedApp: app,
  app,
  initial,
  selectApp: vi.fn(),
  navigate: vi.fn(),
  refreshApps: vi.fn(),
  demoMode: false,
  onBack: vi.fn(),
  onSaved: vi.fn(),
  onDuplicate: vi.fn(),
};
beforeEach(() => {
  vi.useFakeTimers();
  mockApi.mockReset();
  vi.mocked(props.onSaved).mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const tick = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(700);
  });
};

it('autosaves changed fields with a version and preserves the imported reference', async () => {
  mockApi.mockImplementation(async (_url, options) => {
    const body = JSON.parse(options!.body as string);
    return { ...initial, content: body.content, name: body.name, version: 2 };
  });
  render(<DraftEditor {...props} />);
  fireEvent.change(screen.getByLabelText('Draft Keywords'), { target: { value: 'fitness,pace' } });
  expect(screen.getByText('Unsaved changes')).toBeTruthy();
  await tick();
  expect(screen.getByText('Saved')).toBeTruthy();
  const body = JSON.parse(mockApi.mock.calls[0][1]!.body as string);
  expect(body).toMatchObject({ version: 1, content: { keywords: 'fitness,pace' } });
  expect(screen.getByText('run,fitness')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Export changes' }).getAttribute('href')).toContain(
    'version=2',
  );
});

it('keeps typing made during a save and serializes the next version', async () => {
  const resolve: ((draft: Draft) => void)[] = [];
  mockApi.mockImplementation(
    () =>
      new Promise((done) => {
        resolve.push(done);
      }),
  );
  render(<DraftEditor {...props} />);
  fireEvent.change(screen.getByLabelText('Draft Keywords'), { target: { value: 'first' } });
  await tick();
  fireEvent.change(screen.getByLabelText('Draft Keywords'), { target: { value: 'latest' } });
  await act(async () => {
    resolve[0]({ ...initial, content: { ...content, keywords: 'first' }, version: 2 });
  });
  expect((screen.getByLabelText('Draft Keywords') as HTMLTextAreaElement).value).toBe('latest');
  expect(mockApi).toHaveBeenCalledTimes(2);
  expect(JSON.parse(mockApi.mock.calls[1][1]!.body as string)).toMatchObject({
    version: 2,
    content: { keywords: 'latest' },
  });
  await act(async () => {
    resolve[1]({ ...initial, content: { ...content, keywords: 'latest' }, version: 3 });
  });
  expect(screen.getByText('Saved')).toBeTruthy();
});

it('keeps text and blocks navigation on a conflict until the user reloads', async () => {
  let guard: () => Promise<boolean> = async () => true;
  const register = (next: () => Promise<boolean>) => {
    guard = next;
    return () => {};
  };
  mockApi.mockRejectedValue(new ApiError('Another editor saved this draft.', 409));
  render(<DraftEditor {...props} registerLeaveGuard={register} />);
  fireEvent.change(screen.getByLabelText('Draft Keywords'), { target: { value: 'my text' } });
  await tick();
  expect(screen.getByRole('alert').textContent).toContain('Another editor');
  expect((screen.getByLabelText('Draft Keywords') as HTMLTextAreaElement).value).toBe('my text');
  expect(await guard()).toBe(false);
  mockApi.mockResolvedValue({
    ...initial,
    version: 3,
    content: { ...content, keywords: 'their text' },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Discard local edits and reload' }));
  });
  expect((screen.getByLabelText('Draft Keywords') as HTMLTextAreaElement).value).toBe('their text');
  expect(await guard()).toBe(true);
});

it('flushes before navigation and retries a lost response with the same mutation ID', async () => {
  let guard: () => Promise<boolean> = async () => true;
  const release = vi.fn();
  mockApi
    .mockRejectedValueOnce(new Error('Connection lost'))
    .mockResolvedValue({ ...initial, version: 2, content: { ...content, keywords: 'new' } });
  const view = render(
    <DraftEditor
      {...props}
      registerLeaveGuard={(next) => {
        guard = next;
        return release;
      }}
    />,
  );
  fireEvent.change(screen.getByLabelText('Draft Keywords'), { target: { value: 'new' } });
  let ok = true;
  await act(async () => {
    ok = await guard();
  });
  expect(ok).toBe(false);
  await act(async () => {
    ok = await guard();
  });
  expect(ok).toBe(true);
  expect(mockApi.mock.calls[0][1]!.body).toBe(mockApi.mock.calls[1][1]!.body);
  view.unmount();
  expect(release).toHaveBeenCalled();
});

it('marks saved text ready separately and shows edits as a draft again', async () => {
  mockApi.mockResolvedValue({ ...initial, status: 'ready', version: 2 });
  render(<DraftEditor {...props} />);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Mark ready' }));
  });
  expect(JSON.parse(mockApi.mock.calls[0][1]!.body as string)).toMatchObject({
    status: 'ready',
    version: 1,
  });
  expect(screen.getByRole('button', { name: 'Return to draft' })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Draft Subtitle'), { target: { value: 'Updated' } });
  expect(screen.getByRole('button', { name: 'Mark ready' })).toBeTruthy();
});

it('does not enable edits for viewers or overwrite inputs when comparing imports', async () => {
  render(<DraftEditor {...props} workspace={{ ...props.workspace, role: 'viewer' }} />);
  expect((screen.getByLabelText('Draft Keywords') as HTMLTextAreaElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Mark ready' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  fireEvent.change(screen.getByLabelText('Compare with'), { target: { value: 'latest' } });
  expect((screen.getByLabelText('Draft Keywords') as HTMLTextAreaElement).value).toBe('fitness');
  expect(mockApi).not.toHaveBeenCalled();
});

it('ignores a late response after the editor unmounts', async () => {
  let resolve: (draft: Draft) => void = () => {};
  mockApi.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const view = render(<DraftEditor {...props} />);
  fireEvent.change(screen.getByLabelText('Draft Keywords'), { target: { value: 'new' } });
  await tick();
  view.unmount();
  await act(async () => {
    resolve({ ...initial, version: 2, content: { ...content, keywords: 'new' } });
  });
  expect(props.onSaved).not.toHaveBeenCalled();
});

it('does not adopt a newer draft version while refreshing store metadata', async () => {
  mockApi.mockResolvedValue({
    ...initial,
    version: 3,
    content: { ...content, keywords: 'Another editor' },
  });
  render(<DraftEditor {...props} />);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Compare latest import' }));
  });
  expect(screen.getByRole('alert').textContent).toContain('another session');
  expect((screen.getByLabelText('Draft Keywords') as HTMLTextAreaElement).value).toBe('fitness');
  await tick();
  expect(mockApi.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(false);
});
