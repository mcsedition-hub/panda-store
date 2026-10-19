import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ASO, { type AuditRun } from '../../addons/aso/frontend';
import CompareAudits from '../../addons/aso/frontend/CompareAudits';
import { fields, googleFields, type DraftSeed } from '../../addons/aso/frontend/draftTypes';
import { api } from './api';
import type { MobileApp, ModuleProps } from './contracts';
import { setLanguage } from './i18n';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  api: vi.fn(),
}));
vi.mock('./workflows/WorkflowPanel', () => ({ default: () => <div>Workflow activity</div> }));
const mockApi = vi.mocked(api);
function audit(id: string, provider: string): AuditRun {
  return {
    id,
    mode: 'project',
    workflow_id: id,
    status: 'succeeded',
    locale: 'fr-FR',
    created_at: '2026-10-18T12:00:00Z',
    captured_at: '2026-10-18T11:00:00Z',
    snapshot_id: 'snapshot',
    source: 'project.manual',
    is_demo: false,
    ai: { provider, model: `${provider}-model` },
    report: {
      ruleset: 'rules',
      reviewed_on: '2026-10-18',
      checks: [],
      counts: { issue: 0, recommendation: 0, review: 0, unavailable: 0, passed: 0 },
      project: {
        stage: 'idea',
        version: 'v2',
        accepted: true,
        reviewed_items: 6,
        withheld_fields: [],
        model: `${provider}-model`,
        usage: {},
        review_usage: {},
        analysis: {
          positioning: `${provider} positioning`,
          audience: 'Home cooks',
          search_intents: ['Recipes'],
          missing_information: [],
        },
        fields: fields.map(([field]) => ({
          field,
          text: `${provider} ${field}`,
          rationale: `${provider} explanation`,
          evidence: [{ field: 'specification', quote: 'Recipes from your ingredients.' }],
          sources: [],
        })),
      },
    },
  };
}
const a = audit('audit-a', 'openai'),
  b = audit('audit-b', 'google');
const common = {
  runs: [a, b],
  preferredId: a.id,
  storageKey: 'comparison-test',
  loading: false,
  error: '',
  canWrite: true,
  onRefresh: vi.fn(),
  onCompose: vi.fn(),
};

it('combines three Google Play fields including a short description from another model', () => {
  const android = (run: AuditRun): AuditRun => ({
    ...run,
    platform: 'android',
    report: {
      ...run.report!,
      project: {
        ...run.report!.project!,
        platform: 'android',
        reviewed_items: 4,
        fields: googleFields.map(([field]) => ({
          field,
          text: `${run.ai!.provider} ${field}`,
          rationale: 'Based on the saved project.',
          evidence: [{ field: 'specification', quote: 'Recipes from your ingredients.' }],
          sources: [],
        })),
      },
    },
  });
  render(<CompareAudits {...common} runs={[android(a), android(b)]} />);
  expect(screen.getByText('0 of 3 fields selected')).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Subtitle' })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Keywords' })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Hook (promotional text)' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Choose all from A' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Use B for Short description' }));
  expect(screen.getByText('3 of 3 fields selected')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Create draft from selection' }));
  expect(common.onCompose).toHaveBeenCalledWith(
    expect.objectContaining({
      comparison: {
        base_audit_id: a.id,
        selections: [
          { field: 'name', audit_id: a.id, check_id: 'project.listing' },
          { field: 'short_description', audit_id: b.id, check_id: 'project.listing' },
          { field: 'description', audit_id: a.id, check_id: 'project.listing' },
        ],
      },
    }),
    'fr-FR',
  );
});
const app = {
  id: 'app',
  name: 'Frigo',
  origin: 'project',
  platform: 'ios',
  metadata: {
    id: 'snapshot',
    captured_at: a.captured_at,
    source: 'project.manual',
    data: {
      locale: 'fr-FR',
      name: 'Frigo',
      project: {
        origin: 'project',
        stage: 'idea',
        specification: 'Recipes from your ingredients.',
      },
    },
  },
} as MobileApp;
const props: ModuleProps = {
  workspace: { id: 'workspace', name: 'My team', role: 'owner' },
  apps: [app],
  selectedApp: app,
  selectApp: vi.fn(),
  navigate: vi.fn(),
  refreshApps: vi.fn(),
  demoMode: false,
};
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  setLanguage('en');
});
afterEach(() => {
  cleanup();
  setLanguage('en');
});

it('compares saved analyses and sends only selected references when composing a draft', async () => {
  mockApi.mockImplementation(async (path, options) => {
    if (path.endsWith('/ai/')) return { providers: [], credentials_ready: true };
    if (options?.method === 'POST') {
      const body = JSON.parse(options.body as string);
      const content = Object.fromEntries(
        body.comparison.selections.map((item: { field: string; audit_id: string }) => [
          item.field,
          `${item.audit_id === a.id ? 'openai' : 'google'} ${item.field}`,
        ]),
      );
      return {
        id: 'draft',
        name: body.name,
        locale: 'fr-FR',
        status: 'draft',
        version: 1,
        content,
        baseline: {},
        captured_at: a.captured_at,
        snapshot_id: 'snapshot',
        changed_fields: Object.keys(content),
        provenance: [],
        validation: { can_mark_ready: true, blocking: [], checks: [] },
        latest: {
          snapshot_id: 'snapshot',
          content: {},
          changed_since_baseline: [],
          matching_fields: [],
          all_changes_match: false,
        },
      };
    }
    return path.endsWith('/drafts/') ? [] : [a, b];
  });
  render(<ASO {...props} />);
  await screen.findByRole('heading', { name: 'Your ASO proposal' });
  fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
  expect(screen.getByText('openai positioning')).toBeTruthy();
  expect(screen.getByText('google positioning')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Create draft from selection' })).toHaveProperty(
    'disabled',
    true,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Choose all from A' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Use B for Subtitle' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Use B for Hook (promotional text)' }));
  expect(mockApi.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Create draft from selection' }));
  await screen.findByText(/Their source analyses are retained/);
  fireEvent.click(screen.getByRole('button', { name: 'Create draft' }));
  await screen.findByLabelText('Draft Subtitle');
  expect(screen.getByLabelText('Draft App name')).toHaveProperty('value', 'openai name');
  expect(screen.getByLabelText('Draft Subtitle')).toHaveProperty('value', 'google subtitle');
  expect(screen.getByLabelText('Draft Hook (promotional text)')).toHaveProperty(
    'value',
    'google promotional_text',
  );
  const writes = mockApi.mock.calls.filter(([, options]) => options?.method === 'POST');
  expect(writes).toHaveLength(1);
  expect(writes[0][0]).toBe('/api/workspaces/workspace/aso/apps/app/drafts/');
  const body = JSON.parse(writes[0][1]!.body as string);
  expect(body.comparison.base_audit_id).toBe(a.id);
  expect(body.comparison.selections).toHaveLength(5);
  expect(
    body.comparison.selections.find((item: { field: string }) => item.field === 'subtitle'),
  ).toEqual({ field: 'subtitle', audit_id: b.id, check_id: 'project.listing' });
  expect(body).not.toHaveProperty('content');
});

it('warns about different project versions and blocks composing across languages', () => {
  const other = { ...b, locale: 'en-US', snapshot_id: 'other-snapshot' };
  render(<CompareAudits {...common} runs={[a, other]} />);
  expect(screen.getByText(/different languages/)).toBeTruthy();
  expect(screen.getByText(/different versions of the project/)).toBeTruthy();
  for (const radio of screen.getAllByRole('radio')) expect(radio).toHaveProperty('disabled', true);
  expect(screen.getByRole('button', { name: 'Create draft from selection' })).toHaveProperty(
    'disabled',
    true,
  );
  expect(common.onCompose).not.toHaveBeenCalled();
});

it('restores the comparison and its selections without retaining result text in browser storage', () => {
  const view = render(<CompareAudits {...common} />);
  fireEvent.click(screen.getByRole('button', { name: 'Choose all from A' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Use B for Subtitle' }));
  view.unmount();
  expect(sessionStorage.getItem(common.storageKey)).not.toContain('openai name');
  render(<CompareAudits {...common} />);
  expect(screen.getByRole('radio', { name: 'Use B for Subtitle' })).toHaveProperty('checked', true);
  fireEvent.change(screen.getByLabelText('Analysis A'), { target: { value: b.id } });
  expect(screen.getByLabelText('Analysis B')).toHaveProperty('value', a.id);
  expect(screen.getByText('0 of 5 fields selected')).toBeTruthy();
});

it('withholds rejected proposals and excludes incomplete analyses and screenshot reports', () => {
  const rejected = structuredClone(b);
  rejected.report!.project!.accepted = false;
  const pending = { ...a, id: 'pending', status: 'running' as const };
  const screenshot = { ...a, id: 'screenshot', mode: 'screenshots' as const };
  render(<CompareAudits {...common} runs={[a, rejected, pending, screenshot]} />);
  expect(within(screen.getByLabelText('Analysis A')).getAllByRole('option')).toHaveLength(2);
  expect(screen.getByText(/no approved listing proposal/)).toBeTruthy();
  expect(screen.queryByText('google subtitle')).toBeNull();
  expect(screen.queryByRole('radio', { name: 'Use B for Subtitle' })).toBeNull();
});

it('lets viewers compare in French without creating or selecting draft content', () => {
  setLanguage('fr');
  render(<CompareAudits {...common} canWrite={false} />);
  expect(screen.getByRole('heading', { name: 'Comparer les analyses enregistrées' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Accroche (texte promotionnel)' })).toBeTruthy();
  expect(screen.queryByRole('radio')).toBeNull();
  expect(screen.queryByRole('button', { name: /brouillon/ })).toBeNull();
});

it('compares imported listing recommendations and keeps missing replacements unselected', () => {
  const listing = (run: AuditRun): AuditRun => ({
    ...run,
    mode: 'listing',
    report: {
      ...run.report!,
      project: undefined,
      checks: [
        {
          id: 'subtitle.edit',
          field: 'subtitle',
          title: 'Subtitle',
          status: 'recommendation',
          basis: 'editorial_hypothesis',
          observation: 'A clearer benefit',
          action: 'Review',
          replacement: `${run.id} subtitle`,
          sources: [],
        },
      ],
    },
  });
  const noReplacementA = listing(a);
  noReplacementA.report!.checks[0].replacement = null;
  const view = render(<CompareAudits {...common} runs={[noReplacementA, listing(b)]} />);
  expect(screen.getByRole('button', { name: 'Choose all from A' })).toHaveProperty(
    'disabled',
    true,
  );
  expect(screen.getByRole('button', { name: 'Choose all from B' })).toHaveProperty(
    'disabled',
    false,
  );
  expect(screen.getByText('No replacement text to select in this analysis.')).toBeTruthy();
  fireEvent.click(screen.getByRole('radio', { name: 'Use B for Subtitle' }));
  fireEvent.click(screen.getByRole('button', { name: 'Create draft from selection' }));
  const seed: DraftSeed = common.onCompose.mock.calls[0][0];
  expect(seed.comparison?.selections).toEqual([
    { field: 'subtitle', audit_id: b.id, check_id: 'subtitle.edit' },
  ]);
  expect(screen.getByText(/Unselected fields keep the saved listing from analysis A/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Choose all from A' }));
  expect(screen.getByRole('radio', { name: 'Use B for Subtitle' })).toHaveProperty('checked', true);

  const noReplacementB = listing(b);
  noReplacementB.report!.checks[0].replacement = null;
  noReplacementB.report!.editorial = {
    provider: 'google',
    model: 'google-model',
    resolved_model: 'google-model',
    usage: {},
    accepted_proposals: 0,
    rejected_proposals: 0,
    assessments: [
      {
        field: 'promotional_text',
        verdict: 'unvalidated',
        observed: null,
        observation:
          'This AI observation was withheld because its claims were not supported clearly enough by the imported listing.',
        evidence: [],
        sources: [],
      },
    ],
  };
  setLanguage('fr');
  view.rerender(<CompareAudits {...common} runs={[noReplacementA, noReplacementB]} />);
  expect(screen.getByRole('button', { name: 'Tout choisir dans A' })).toHaveProperty(
    'disabled',
    true,
  );
  expect(screen.getByRole('button', { name: 'Tout choisir dans B' })).toHaveProperty(
    'disabled',
    true,
  );
  expect(screen.getByText(/Ces analyses ne contiennent aucun texte de remplacement/)).toBeTruthy();
  expect(screen.getByText(/Cette observation IA a été écartée/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Créer un brouillon avec la sélection' })).toBeNull();
  expect(screen.queryByRole('radio')).toBeNull();
});
