import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../api';
import { setLanguage } from '../i18n';
import UsageDashboard from './UsageDashboard';
import type { UsageDashboardData, UsageTotals } from './types';

vi.mock('../api', () => ({ api: vi.fn() }));
const totals: UsageTotals = {
  calls: 1,
  input_tokens: 100,
  output_tokens: 20,
  tokens: 120,
  cached_tokens: 0,
  reasoning_tokens: 0,
  cost_usd: '1',
  reserved_usd: '0',
  reserved_tokens: 0,
  pending: 0,
  unknown: 0,
  unpriced: 0,
  historical: 0,
  historical_unpriced: 0,
};
function response(): UsageDashboardData {
  return {
    month: '2026-10',
    summary: { ...totals },
    current_month: { ...totals },
    alerts: [],
    budget: {
      revision: 'v1',
      tracking_started_at: '2026-10-19T00:00:00Z',
      monthly_usd: null,
      operation_usd: null,
      monthly_tokens: null,
      operation_tokens: null,
    },
    prices_verified_at: '2026-10-19',
    sources: { openai: 'https://developers.openai.com/api/docs/pricing' },
    apps: [
      { id: 'app1', name: 'Mimlo' },
      { id: 'app2', name: 'Frigo Futé' },
    ],
    by_app: [{ ...totals, app_id: 'app1', app_name: 'Mimlo' }],
    by_provider: [{ ...totals, provider: 'openai' }],
    operations: [
      {
        ...totals,
        key: 'audit:abcd1234',
        label: 'ASO audit',
        module: 'aso',
        app_name: 'Mimlo',
        last_at: '2026-10-19T00:00:00Z',
      },
    ],
    operation_count: 1,
    calls: [],
    next_offset: null,
  };
}
const workspace = { id: 'workspace', name: 'Example', role: 'owner' as const };
beforeEach(() => {
  vi.resetAllMocks();
  setLanguage('en');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setLanguage('en');
});

it('shows disabled limits, usage attribution and an explicit distinction from provider balance', async () => {
  vi.mocked(api).mockResolvedValue(response());
  render(<UsageDashboard workspace={workspace} />);
  expect(await screen.findByText('Tokens used', { selector: 'article span' })).toBeTruthy();
  expect(screen.getByText('120', { selector: 'article strong' })).toBeTruthy();
  expect(screen.getAllByText('No limit')).toHaveLength(2);
  expect(screen.getByText(/This is not your provider account balance/)).toBeTruthy();
  expect(screen.getByText('ASO audit')).toBeTruthy();
  expect(screen.queryByText(/At least 80%/)).toBeNull();
});

it('saves empty fields as disabled and zero as a real cap without confusing the two', async () => {
  vi.mocked(api).mockResolvedValue(response());
  render(<UsageDashboard workspace={workspace} />);
  fireEvent.click(await screen.findByText('Configure AI limits'));
  fireEvent.change(screen.getByLabelText('Monthly budget (USD)'), { target: { value: '20' } });
  fireEvent.change(screen.getByLabelText('Budget per operation (USD)'), { target: { value: '0' } });
  fireEvent.click(screen.getByText('Save AI limits'));
  await waitFor(() =>
    expect(vi.mocked(api).mock.calls.some(([, args]) => args?.method === 'PUT')).toBe(true),
  );
  const [, request] = vi.mocked(api).mock.calls.find(([, args]) => args?.method === 'PUT')!;
  expect(JSON.parse(request?.body as string)).toEqual({
    revision: 'v1',
    monthly_usd: '20',
    operation_usd: '0',
    monthly_tokens: null,
    operation_tokens: null,
  });
});

it('shows remaining Panda budget, counts reservations and warns at 80 percent', async () => {
  const data = response();
  data.budget.monthly_usd = '20';
  data.current_month.cost_usd = '15';
  data.current_month.reserved_usd = '2';
  data.alerts = ['usd'];
  vi.mocked(api).mockResolvedValue(data);
  render(<UsageDashboard workspace={workspace} />);
  expect(await screen.findByText('$3.00')).toBeTruthy();
  expect(screen.getByText(/At least 80%/)).toBeTruthy();
});

it('saves a monthly dollar limit with all other limits disabled', async () => {
  vi.mocked(api).mockResolvedValue(response());
  render(<UsageDashboard workspace={workspace} />);
  fireEvent.click(await screen.findByText('Configure AI limits'));
  fireEvent.change(screen.getByLabelText('Monthly budget (USD)'), { target: { value: '5' } });
  fireEvent.click(screen.getByText('Save AI limits'));
  await waitFor(() =>
    expect(vi.mocked(api).mock.calls.some(([, args]) => args?.method === 'PUT')).toBe(true),
  );
  const [, request] = vi.mocked(api).mock.calls.find(([, args]) => args?.method === 'PUT')!;
  expect(JSON.parse(request?.body as string)).toEqual({
    revision: 'v1',
    monthly_usd: '5',
    operation_usd: null,
    monthly_tokens: null,
    operation_tokens: null,
  });
});

it('shows the estimated remainder and the excluded unknown historical charges', async () => {
  const data = response();
  data.budget.monthly_usd = '5';
  Object.assign(data.current_month, {
    cost_usd: '4.17',
    unpriced: 3,
    historical_unpriced: 3,
    historical: 150,
  });
  vi.mocked(api).mockResolvedValue(data);
  render(<UsageDashboard workspace={workspace} />);
  expect(await screen.findByText('$0.83')).toBeTruthy();
  expect(screen.getByText('Partial estimate')).toBeTruthy();
  expect(screen.getByText(/3 earlier calls have an unknown cost/)).toBeTruthy();
  expect(screen.queryByText('Unknown')).toBeNull();
});

it('keeps the remainder unknown when a live charge is missing alongside partial history', async () => {
  const data = response();
  data.budget.monthly_usd = '5';
  data.current_month.unpriced = 4;
  data.current_month.historical_unpriced = 3;
  vi.mocked(api).mockResolvedValue(data);
  render(<UsageDashboard workspace={workspace} />);
  expect(await screen.findByText('Unknown')).toBeTruthy();
  expect(screen.queryByText('$4.00')).toBeNull();
});

it('preserves an unsaved budget while background totals refresh', async () => {
  vi.mocked(api).mockResolvedValue(response());
  render(<UsageDashboard workspace={workspace} />);
  fireEvent.click(await screen.findByText('Configure AI limits'));
  fireEvent.change(screen.getByLabelText('Monthly budget (USD)'), { target: { value: '19' } });
  fireEvent.click(screen.getByText('Refresh usage'));
  await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
  expect((screen.getByLabelText('Monthly budget (USD)') as HTMLInputElement).value).toBe('19');
});

it('filters the data without changing the workspace budget and keeps all app options', async () => {
  vi.mocked(api).mockResolvedValue(response());
  render(<UsageDashboard workspace={workspace} />);
  await screen.findByText('ASO audit');
  fireEvent.change(screen.getByLabelText('AI provider'), { target: { value: 'google' } });
  await waitFor(() =>
    expect(api).toHaveBeenLastCalledWith(
      expect.stringContaining('provider=google'),
      expect.anything(),
    ),
  );
  await screen.findByText('ASO audit');
  expect(screen.getByRole('option', { name: 'Frigo Futé' })).toBeTruthy();
});

it('shows unknown charges as partial rather than a zero balance', async () => {
  const data = response();
  data.summary.unpriced = 1;
  data.current_month.unpriced = 1;
  data.budget.monthly_usd = '20';
  vi.mocked(api).mockResolvedValue(data);
  render(<UsageDashboard workspace={workspace} />);
  expect(await screen.findByText('Partial')).toBeTruthy();
  expect(screen.getByText('Unknown')).toBeTruthy();
  expect(screen.getByText(/Some costs or token counts are unknown/)).toBeTruthy();
});

it('keeps budget editing unavailable to viewers and translates the page to French', async () => {
  setLanguage('fr');
  vi.mocked(api).mockResolvedValue(response());
  render(<UsageDashboard workspace={{ ...workspace, role: 'viewer' }} />);
  expect(await screen.findByText('Budgets et limites')).toBeTruthy();
  expect(screen.queryByText('Configurer les limites IA')).toBeNull();
  expect(
    screen.getByText('Seul le propriétaire de l’espace peut modifier les limites IA.'),
  ).toBeTruthy();
  expect(screen.getByText('Audit ASO')).toBeTruthy();
});

it('recovers from a failed load through refresh without making an AI request', async () => {
  vi.mocked(api).mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValue(response());
  render(<UsageDashboard workspace={workspace} />);
  expect(await screen.findByRole('alert')).toBeTruthy();
  fireEvent.click(screen.getByText('Refresh usage'));
  expect(await screen.findByText('ASO audit')).toBeTruthy();
  expect(vi.mocked(api).mock.calls.every(([path]) => path.includes('/ai-usage/'))).toBe(true);
});

it('localizes the month selector and separates unknown costs from missing usage', async () => {
  setLanguage('fr');
  const data = response();
  data.summary.unpriced = 3;
  data.months = ['2026-10'];
  vi.mocked(api).mockResolvedValue(data);
  render(<UsageDashboard workspace={workspace} />);
  expect(await screen.findByRole('option', { name: 'octobre 2026' })).toBeTruthy();
  expect(screen.getByText(/3 coûts inconnus/)).toBeTruthy();
  expect(screen.queryByText(/0 consommation inconnue/)).toBeNull();
});
