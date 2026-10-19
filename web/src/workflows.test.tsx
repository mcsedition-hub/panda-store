import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';
import WorkflowPanel from './workflows/WorkflowPanel';
import type { WorkflowSnapshot } from './workflows/types';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  api: vi.fn(),
}));
const mockApi = vi.mocked(api);
class Source {
  static current: Source;
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  listeners = new Map<string, (event: { data: string }) => void>();
  close = vi.fn();
  constructor(public url: string) {
    Source.current = this;
  }
  addEventListener(name: string, listener: (event: { data: string }) => void) {
    this.listeners.set(name, listener);
  }
  emit(data: WorkflowSnapshot) {
    this.listeners.get('update')?.({ data: JSON.stringify(data) });
  }
}
const date = '2026-10-16T12:00:00Z';
const queued: WorkflowSnapshot = {
  id: 'flow',
  title: 'Create scripts',
  status: 'queued',
  error: '',
  created_at: date,
  started_at: null,
  completed_at: null,
  heartbeat_at: null,
  retry_of: null,
  cursor: 1,
  has_more: false,
  steps: [
    {
      id: 'step',
      key: 'context',
      title: 'Read app and brief',
      kind: 'validation',
      depends_on: [],
      status: 'queued',
      summary: '',
      started_at: null,
      completed_at: null,
      reused_from_id: null,
    },
  ],
  events: [
    {
      sequence: 1,
      step_key: '',
      kind: 'queued',
      message: 'Waiting for a worker.',
      created_at: date,
    },
  ],
};
const running: WorkflowSnapshot = {
  ...queued,
  status: 'running',
  started_at: date,
  cursor: 2,
  steps: [
    { ...queued.steps[0], status: 'running', started_at: date, summary: 'Reading the brief.' },
  ],
  events: [
    {
      sequence: 2,
      step_key: 'context',
      kind: 'step_started',
      message: 'Reading the brief.',
      created_at: date,
    },
  ],
};
const completed: WorkflowSnapshot = {
  ...running,
  status: 'succeeded',
  completed_at: date,
  cursor: 3,
  steps: [{ ...running.steps[0], status: 'succeeded', completed_at: date }],
  events: [
    {
      sequence: 3,
      step_key: 'context',
      kind: 'step_completed',
      message: 'Brief checked.',
      created_at: date,
    },
  ],
};
const props = {
  workspaceId: 'workspace',
  workflowId: 'flow',
  canWrite: true,
  onStatus: vi.fn(),
  onRetry: vi.fn(),
};

beforeEach(() => {
  mockApi.mockReset();
  props.onStatus.mockReset();
  props.onRetry.mockReset();
  vi.stubGlobal('EventSource', Source);
  mockApi.mockResolvedValue(queued);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('shows real streamed steps, deduplicates replayed events, and opens their details', async () => {
  const view = render(<WorkflowPanel {...props} />);
  await waitFor(() => expect(Source.current.url).toContain('events/?after=1'));
  act(() => {
    Source.current.onopen?.();
    Source.current.emit(running);
    Source.current.emit(running);
  });
  expect(screen.getByText('Live')).toBeTruthy();
  expect(screen.getAllByText('Reading the brief.')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: /Read app and brief Running/ }));
  expect(
    screen.getByRole('button', { name: /Read app and brief Running/ }).getAttribute('aria-pressed'),
  ).toBe('true');
  expect(screen.queryByText('Waiting for a worker.')).toBeNull();
  act(() => Source.current.emit(completed));
  expect(screen.getByText('Saved')).toBeTruthy();
  expect(props.onStatus.mock.calls.map(([status]) => status)).toEqual([
    'queued',
    'running',
    'succeeded',
  ]);
  expect(Source.current.close).toHaveBeenCalled();
  view.unmount();
});

it('falls back to polling after a stream error and resumes from the last event', async () => {
  render(<WorkflowPanel {...props} />);
  await waitFor(() => expect(Source.current.url).toContain('after=1'));
  act(() => Source.current.emit(running));
  mockApi.mockResolvedValue(completed);
  await act(async () => {
    Source.current.onerror?.();
  });
  expect(mockApi.mock.lastCall?.[0]).toContain('?after=2');
  expect(screen.getByText('Brief checked.')).toBeTruthy();
  expect(screen.getAllByText('Reading the brief.')).toHaveLength(1);
  expect(screen.getByText('Saved')).toBeTruthy();
});

it('removes private activity if access is revoked, including late stream messages', async () => {
  render(<WorkflowPanel {...props} />);
  await waitFor(() => expect(Source.current.url).toContain('after=1'));
  act(() => Source.current.emit(running));
  mockApi.mockRejectedValue(new ApiError('Access revoked', 403));
  await act(async () => {
    Source.current.onerror?.();
  });
  expect(screen.getByRole('alert').textContent).toBe('Access revoked');
  expect(screen.queryByText('Reading the brief.')).toBeNull();
  act(() => Source.current.emit(completed));
  expect(screen.queryByText('Brief checked.')).toBeNull();
});

it('sends a stop request and preserves the distinction between stopping and canceled', async () => {
  render(<WorkflowPanel {...props} />);
  await waitFor(() => expect(Source.current.url).toContain('after=1'));
  act(() => Source.current.emit(running));
  mockApi.mockResolvedValue({ ...running, status: 'canceling', cursor: 3 });
  fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
  await waitFor(() =>
    expect((screen.getByRole('button', { name: 'Stopping…' }) as HTMLButtonElement).disabled).toBe(
      true,
    ),
  );
  expect(mockApi.mock.lastCall?.[1]?.method).toBe('POST');
  expect(mockApi.mock.lastCall?.[0]).toContain('/cancel/');
  act(() => Source.current.emit({ ...running, status: 'canceled', cursor: 4 }));
  fireEvent.click(screen.getByRole('button', { name: 'Retry unfinished steps' }));
  await waitFor(() => expect(props.onRetry).toHaveBeenCalledTimes(1));
});

it('keeps workflow activity read-only for viewers and closes streams on unmount', async () => {
  const view = render(<WorkflowPanel {...props} canWrite={false} />);
  await waitFor(() => expect(Source.current.url).toContain('after=1'));
  expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  act(() => Source.current.emit({ ...running, status: 'failed', cursor: 3 }));
  expect(screen.queryByRole('button', { name: 'Retry unfinished steps' })).toBeNull();
  view.unmount();
  expect(Source.current.close).toHaveBeenCalled();
});

it('lets a failed workflow retry with a connected provider and model selected explicitly', async () => {
  const failed = { ...running, status: 'failed' as const, cursor: 3 };
  mockApi.mockImplementation(async (path) =>
    path.endsWith('/ai/')
      ? {
          credentials_ready: true,
          providers: [
            { id: 'openai', name: 'OpenAI', connected: true, models: [{ id: 'gpt-4.1-mini' }] },
            {
              id: 'google',
              name: 'Google Gemini',
              connected: true,
              models: [{ id: 'gemini-2.5-flash' }],
            },
          ],
        }
      : failed,
  );
  render(
    <WorkflowPanel
      {...props}
      retryAI={{
        choice: { provider: 'openai', model: 'gpt-4.1-mini' },
        owner: true,
        moduleContext: 'smm',
      }}
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Change provider or model' }));
  await waitFor(() =>
    expect((screen.getByLabelText('Model') as HTMLSelectElement).value).toBe('gpt-4.1-mini'),
  );
  expect(props.onRetry).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('AI provider'), { target: { value: 'google' } });
  expect(
    (screen.getByRole('button', { name: 'Retry with this model' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'gemini-2.5-flash' } });
  fireEvent.click(screen.getByRole('button', { name: 'Retry with this model' }));
  await waitFor(() =>
    expect(props.onRetry).toHaveBeenCalledWith({ provider: 'google', model: 'gemini-2.5-flash' }),
  );
  expect(screen.queryByText(/Retry keeps the original app, model/)).toBeNull();
  props.onRetry.mockReset();
  fireEvent.click(screen.getByRole('button', { name: 'Keep original model' }));
  fireEvent.click(screen.getByRole('button', { name: 'Retry unfinished steps' }));
  await waitFor(() => expect(props.onRetry).toHaveBeenCalledWith(undefined));
});

it('does not expose model changes for viewers', async () => {
  mockApi.mockResolvedValue({ ...running, status: 'failed', cursor: 3 });
  render(
    <WorkflowPanel
      {...props}
      canWrite={false}
      retryAI={{
        choice: { provider: 'openai', model: 'gpt-4.1-mini' },
        owner: false,
        moduleContext: 'aso',
      }}
    />,
  );
  await screen.findByText('Saved');
  expect(screen.queryByRole('button', { name: 'Change provider or model' })).toBeNull();
  expect(props.onRetry).not.toHaveBeenCalled();
});

it('reloads interrupted activity without retrying the task or losing saved results', async () => {
  mockApi.mockRejectedValue(new ApiError('Cannot reach Panda Store.', 0));
  render(<WorkflowPanel {...props} />);
  await screen.findByText('Activity unavailable');
  expect(screen.getByText(/The task may still be running/)).toBeTruthy();
  mockApi.mockResolvedValue(completed);
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading activity' }));
  await screen.findByText('Brief checked.');
  expect(screen.queryByRole('alert')).toBeNull();
  expect(props.onRetry).not.toHaveBeenCalled();
  expect(mockApi.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
});
