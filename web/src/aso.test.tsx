import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ASO from '../../addons/aso/frontend';
import { api } from './api';
import type { MobileApp, ModuleProps } from './contracts';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  api: vi.fn(),
}));
vi.mock('./workflows/WorkflowPanel', () => ({ default: () => <div>Workflow activity</div> }));
const mockApi = vi.mocked(api);
const app = {
  id: 'one',
  name: 'Panda',
  platform: 'ios',
  metadata: {
    id: 'snapshot-one',
    captured_at: '2026-10-16T12:00:00Z',
    source: 'apple_store.api',
    data: { locale: 'en-US', localizations: [{ locale: 'en-US' }, { locale: 'fr-CA' }] },
  },
} as MobileApp;
const props: ModuleProps = {
  workspace: { id: 'workspace-one', name: 'Workshop', role: 'owner' },
  apps: [app],
  selectedApp: app,
  selectApp: vi.fn(),
  navigate: vi.fn(),
  refreshApps: vi.fn(),
  demoMode: false,
};
const check = {
  id: 'keywords.cleanup',
  field: 'keywords',
  title: 'Keyword repetition and separators',
  status: 'recommendation',
  basis: 'recommendation',
  observation: 'sort: already in subtitle',
  action: 'Review the proposed cleanup.',
  observed: 'sort,photos',
  replacement: 'photos',
  sources: [
    {
      id: 'apple',
      publisher: 'Apple',
      title: 'App Store search',
      url: 'https://developer.apple.com/app-store/search/',
      reviewed_on: '2026-10-16',
    },
  ],
};
const run = {
  id: 'audit-one',
  workflow_id: 'workflow-one',
  locale: 'en-US',
  status: 'succeeded',
  snapshot_id: 'snapshot-one',
  captured_at: '2026-10-16T12:00:00Z',
  created_at: '2026-10-16T12:01:00Z',
  report: { checks: [check], counts: { recommendation: 1 } },
};
function mockData(handler: (path: string, options?: RequestInit) => Promise<unknown>) {
  mockApi.mockImplementation(async (path, options) =>
    path.endsWith('/ai/') ? { providers: [], credentials_ready: true } : handler(path, options),
  );
}
beforeEach(() => {
  mockApi.mockReset();
});
afterEach(cleanup);

const savedGuidance = {
  id: 'saved-source',
  guidance: 'The exact notes saved with this audit.',
  limitations: 'No measured conversion data.',
  fields: ['subtitle'],
  source: {
    id: 'saved-source',
    publisher: 'SplitMetrics',
    title: 'Testing framework',
    url: 'https://splitmetrics.com/',
    reviewed_on: '2026-10-16',
    kind: 'vendor_methodology',
  },
};

it('shows frozen audit notes separately from the library for new audits', async () => {
  const aiRun = {
    ...run,
    ai: { provider: 'google', model: 'model' },
    knowledge: [savedGuidance],
    knowledge_version: 'saved-version',
  };
  mockData(async (path) =>
    path.endsWith('/knowledge/')
      ? {
          version: 'new-version',
          entries: [{ ...savedGuidance, guidance: 'Updated library notes.' }],
        }
      : [aiRun],
  );
  render(<ASO {...props} />);
  await screen.findByText('sort: already in subtitle');
  fireEvent.click(screen.getByRole('button', { name: 'Sources' }));
  expect(screen.getByText(savedGuidance.guidance)).toBeTruthy();
  expect(screen.getByText('Vendor methodology')).toBeTruthy();
  expect(screen.getByText('Reviewed 2026-10-16')).toBeTruthy();
  expect(mockApi.mock.calls.some(([path]) => path.endsWith('/knowledge/'))).toBe(false);
  fireEvent.change(screen.getByLabelText('Reference set'), { target: { value: 'current' } });
  await screen.findByText('Updated library notes.');
  expect(screen.queryByText(savedGuidance.guidance)).toBeNull();
  fireEvent.change(screen.getByLabelText('Reference set'), { target: { value: 'saved' } });
  expect(screen.getByText(savedGuidance.guidance)).toBeTruthy();
  expect(screen.queryByText('Updated library notes.')).toBeNull();
});

it('loads the library without an AI audit and recovers from a load error', async () => {
  let fail = true;
  mockData(async (path) => {
    if (!path.endsWith('/knowledge/')) return [];
    if (fail) throw new Error('Sources unavailable');
    return { entries: [savedGuidance] };
  });
  render(<ASO {...props} />);
  await screen.findByText('Review your store listing');
  fireEvent.click(screen.getByRole('button', { name: 'Sources' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Sources unavailable');
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading sources' }));
  await screen.findByText(savedGuidance.guidance);
  expect(screen.getByText(/Notes supplied to new App Store AI reviews/)).toBeTruthy();
  expect(screen.queryByLabelText('Reference set')).toBeNull();
});

it('does not substitute current guidance for an older audit without saved notes', async () => {
  mockData(async () => [{ ...run, ai: { provider: 'google', model: 'model' } }]);
  render(<ASO {...props} />);
  await screen.findByText('sort: already in subtitle');
  fireEvent.click(screen.getByRole('button', { name: 'Sources' }));
  expect(screen.getByText('No guidance notes were saved for this audit.')).toBeTruthy();
  expect(mockApi.mock.calls.some(([path]) => path.endsWith('/knowledge/'))).toBe(false);
});

it('labels cited vendor methodology and shows its saved annotation', async () => {
  mockData(async () => [
    {
      ...run,
      report: {
        ...run.report,
        checks: [
          {
            ...check,
            basis: 'editorial_hypothesis',
            sources: [
              {
                ...savedGuidance.source,
                guidance: savedGuidance.guidance,
                limitations: savedGuidance.limitations,
              },
            ],
          },
        ],
      },
    },
  ]);
  render(<ASO {...props} />);
  await screen.findByText('sort: already in subtitle');
  expect(screen.getByText('Vendor methodology · Reviewed 2026-10-16')).toBeTruthy();
  expect(screen.getByText('Guidance used')).toBeTruthy();
  expect(screen.getByText(savedGuidance.guidance)).toBeTruthy();
  expect(screen.queryByText(/Editorial hypothesis · Apple guidance/)).toBeNull();
});

it('sends the chosen locale and exact snapshot, and shows a sourced copyable proposal', async () => {
  mockData(async (_path, options) => (options?.method === 'POST' ? run : []));
  render(<ASO {...props} />);
  await screen.findByText('Review your store listing');
  fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'fr-CA' } });
  mockData(async (_path, options) =>
    options?.method === 'POST' ? { ...run, locale: 'fr-CA' } : [],
  );
  fireEvent.click(screen.getByRole('button', { name: 'Run audit' }));
  await screen.findByText('sort: already in subtitle');
  const post = mockApi.mock.calls.find(([, options]) => options?.method === 'POST')!;
  expect(JSON.parse(post[1]!.body as string)).toMatchObject({
    locale: 'fr-CA',
    snapshot_id: 'snapshot-one',
  });
  expect(screen.getByRole('link', { name: /Apple · App Store search/ }).getAttribute('href')).toBe(
    check.sources[0].url,
  );
  expect((screen.getByLabelText('Proposed keywords') as HTMLTextAreaElement).readOnly).toBe(true);
  expect(screen.queryByRole('button', { name: /Publish/ })).toBeNull();
  expect(screen.getByText(/No changes have been sent to Apple/)).toBeTruthy();
});

it('keeps languages separate and marks audits of older imports', async () => {
  mockData(async () => [{ ...run, snapshot_id: 'older' }]);
  render(<ASO {...props} />);
  await screen.findByText(/This audit uses an earlier import/);
  fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'fr-CA' } });
  expect(screen.queryByText('sort: already in subtitle')).toBeNull();
  expect(screen.getByText('Review your store listing')).toBeTruthy();
});

it('prevents viewer actions and unsupported store audits', async () => {
  mockData(async () => []);
  const view = render(<ASO {...props} workspace={{ ...props.workspace, role: 'viewer' }} />);
  await screen.findByText('Review your store listing');
  expect((screen.getByRole('button', { name: 'Run audit' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  view.rerender(<ASO {...props} selectedApp={{ ...app, id: 'android', platform: 'android' }} />);
  await screen.findByText(/Audits currently support App Store/);
  expect(screen.queryByRole('button', { name: 'Run audit' })).toBeNull();
});

it('does not leak a late audit response after changing workspace', async () => {
  let resolvePost: (value: unknown) => void = () => {};
  mockData(async (_path, options) =>
    options?.method === 'POST'
      ? new Promise((resolve) => {
          resolvePost = resolve;
        })
      : [],
  );
  const view = render(<ASO {...props} />);
  await screen.findByText('Review your store listing');
  fireEvent.click(screen.getByRole('button', { name: 'Run audit' }));
  view.rerender(<ASO {...props} workspace={{ ...props.workspace, id: 'other' }} />);
  await screen.findByText('Review your store listing');
  resolvePost(run);
  await waitFor(() => expect(screen.queryByText('sort: already in subtitle')).toBeNull());
});

it('blocks new runs if audit history cannot be loaded', async () => {
  mockData(async () => {
    throw new Error('Access unavailable');
  });
  render(<ASO {...props} />);
  await screen.findByRole('alert');
  expect((screen.getByRole('button', { name: 'Run audit' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
});

it('requires an explicit model and sends it with the AI audit; labels AI proposals distinctly', async () => {
  const aiRun = {
    ...run,
    ai: { provider: 'openai', model: 'gpt-4.1-mini' },
    report: {
      ...run.report,
      checks: [
        {
          ...check,
          field: 'subtitle',
          basis: 'editorial_hypothesis',
          replacement: 'Sort photos your way',
        },
      ],
    },
  };
  mockApi.mockImplementation(async (path, options) =>
    path.endsWith('/ai/')
      ? {
          providers: [
            {
              id: 'openai',
              name: 'OpenAI',
              connected: true,
              revision: 'rev',
              models: [{ id: 'gpt-4.1-mini', name: 'Mini' }],
            },
          ],
          credentials_ready: true,
        }
      : options?.method === 'POST'
        ? aiRun
        : [],
  );
  render(<ASO {...props} />);
  await screen.findByLabelText('Model');
  expect((screen.getByRole('button', { name: 'Run audit' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'gpt-4.1-mini' } });
  fireEvent.click(screen.getByRole('button', { name: 'Run audit' }));
  await screen.findByText('AI proposal · Review');
  const post = mockApi.mock.calls.find(([, options]) => options?.method === 'POST')!;
  expect(JSON.parse(post[1]!.body as string)).toMatchObject({
    provider: 'openai',
    model: 'gpt-4.1-mini',
    locale: 'en-US',
  });
  expect(screen.getByRole('heading', { name: 'Recommendations' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Add to draft' })).toBeTruthy();
  expect(screen.getByLabelText('Proposed text')).toBeTruthy();
});

it('shows all content assessments separately from passed length checks without duplicating proposals', async () => {
  const proposal = {
    ...check,
    field: 'subtitle',
    basis: 'editorial_hypothesis',
    replacement: 'Sort photos your way',
  };
  const fields = ['name', 'subtitle', 'description', 'promotional_text', 'keywords'];
  mockData(async () => [
    {
      ...run,
      ai: { provider: 'google', model: 'gemini-3.8-flash' },
      report: {
        checks: [
          proposal,
          {
            ...check,
            id: 'name.length',
            field: 'name',
            title: 'App name',
            status: 'passed',
            basis: 'requirement',
            replacement: null,
          },
        ],
        editorial: {
          resolved_model: 'gemini-3.8-flash',
          usage: {},
          accepted_proposals: 1,
          rejected_proposals: 0,
          reviewed_fields: 4,
          assessments: fields.map((field) => ({
            field,
            verdict:
              field === 'subtitle'
                ? 'improve'
                : field === 'keywords'
                  ? 'insufficient_evidence'
                  : field === 'promotional_text'
                    ? 'not_imported'
                    : 'keep',
            observation: `Specific observation for ${field}.`,
            observed: 'Imported text',
            evidence: [],
            sources: check.sources,
          })),
        },
      },
    },
  ]);
  render(<ASO {...props} />);
  await screen.findByRole('heading', { name: 'Content review' });
  for (const field of fields)
    expect(screen.getByText(`Specific observation for ${field}.`)).toBeTruthy();
  expect(screen.getByText('4 of 5 fields reviewed · AI assessment')).toBeTruthy();
  expect(screen.getAllByText('No change suggested')).toHaveLength(2);
  expect(screen.getByText('Needs evidence')).toBeTruthy();
  expect(screen.getByText('Not imported')).toBeTruthy();
  expect(screen.getAllByRole('button', { name: 'Add to draft' })).toHaveLength(1);
  expect(screen.getByRole('heading', { name: 'Apple checks' })).toBeTruthy();
  const passed = screen.getByText('1 Apple checks passed').closest('details')!;
  fireEvent.click(screen.getByText('1 Apple checks passed'));
  expect(within(passed).getByText('Within limit')).toBeTruthy();
});

it('does not invent field reviews for historical audits', async () => {
  mockData(async () => [{ ...run, ai: { provider: 'google', model: 'gemini-2.5-flash' } }]);
  render(<ASO {...props} />);
  await screen.findByText(/This earlier audit did not record a review for each field/);
  expect(screen.queryByText('No change suggested')).toBeNull();
});
