import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AppCatalog from '../../addons/app_catalog/frontend';
import ProjectForm from '../../addons/app_catalog/frontend/ProjectForm';
import ASO from '../../addons/aso/frontend';
import { api } from './api';
import type { MobileApp, ModuleProps } from './contracts';
import { setLanguage } from './i18n';
import App from './App';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  api: vi.fn(),
}));
vi.mock('./workflows/WorkflowPanel', () => ({ default: () => <div>Workflow activity</div> }));
const mockApi = vi.mocked(api);
const project = {
  id: 'project-one',
  origin: 'project',
  name: 'Future app',
  platform: 'undecided',
  metadata: {
    id: 'snapshot-one',
    source: 'project.manual',
    captured_at: '2026-10-18T12:00:00Z',
    data: {
      name: 'Future app',
      locale: 'fr-CA',
      description: '',
      project: {
        origin: 'project',
        name: 'Future app',
        stage: 'idea',
        specification: '# My app\nA planned calendar for runners.',
        audience: 'New runners',
        available_features: '',
        listing_ready: false,
      },
    },
  },
} as MobileApp;
const props: ModuleProps = {
  workspace: { id: 'workspace-one', name: 'Workshop', role: 'owner' },
  apps: [],
  selectedApp: null,
  selectApp: vi.fn(),
  navigate: vi.fn(),
  refreshApps: vi.fn().mockResolvedValue(undefined),
  demoMode: false,
  availableModules: ['app_catalog', 'aso', 'studio'],
};
beforeEach(() => {
  vi.clearAllMocks();
  mockApi.mockReset();
  setLanguage('en');
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setLanguage('en');
});

it('opens the saved project through the real application navigation guard', async () => {
  let created = false;
  mockApi.mockImplementation(async (path, options) => {
    if (path === '/api/session/')
      return {
        user: { id: 'owner', username: 'owner' },
        language: 'en',
        setup_required: false,
        csrf_token: 'test-token',
      };
    if (path === '/api/workspaces/') return [props.workspace];
    if (path.endsWith('/modules/')) return [{ id: 'app_catalog', name: 'My apps', enabled: true }];
    if (path.endsWith('/apps/')) return created ? [project] : [];
    if (path.endsWith('/projects/') && options?.method === 'POST') {
      created = true;
      return project;
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Create a project' }));
  fireEvent.change(await screen.findByLabelText('Project name'), {
    target: { value: project.name },
  });
  fireEvent.change(screen.getByLabelText('Describe your app or paste Markdown'), {
    target: { value: project.metadata!.data.project!.specification },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
  await screen.findByRole('heading', { name: project.name });
  expect(screen.getByRole('button', { name: 'Edit project' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Create project' })).toBeNull();
});

it('allows a new project from an empty catalog without Connections enabled', () => {
  const view = render(<AppCatalog {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Create a project' }));
  expect(props.navigate).toHaveBeenCalledWith('app_catalog', undefined, 'new-project');
  view.rerender(<AppCatalog {...props} page="new-project" />);
  expect(screen.getByLabelText('Project name')).toBeTruthy();
  expect(screen.getByLabelText('Target platform')).toHaveProperty('value', 'undecided');
});

it('saves a pasted idea separately from draft listing text and opens the saved project', async () => {
  setLanguage('fr');
  mockApi.mockResolvedValue(project);
  render(<ProjectForm {...props} />);
  fireEvent.change(screen.getByLabelText('Nom du projet'), { target: { value: 'Future app' } });
  fireEvent.change(screen.getByLabelText('Décrivez votre application ou collez du Markdown'), {
    target: { value: project.metadata!.data.project!.specification },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Créer le projet' }));
  await waitFor(() => expect(props.navigate).toHaveBeenCalledWith('app_catalog', project.id));
  const [path, options] = mockApi.mock.calls[0];
  expect(path).toBe('/api/workspaces/workspace-one/app_catalog/projects/');
  expect(options?.method).toBe('POST');
  const body = JSON.parse(options!.body as string);
  expect(body).toMatchObject({
    stage: 'idea',
    platform: 'undecided',
    locale: 'fr-FR',
    available_features: '',
    specification: project.metadata!.data.project!.specification,
  });
  expect(body.listing).toBeUndefined();
  expect(screen.queryByText('Prepare an ASO listing (optional)')).toBeNull();
  expect(body.request_id).toMatch(/^[\da-f-]{36}$/);
  expect(props.refreshApps).toHaveBeenCalled();
  expect(props.selectApp).toHaveBeenCalledWith(project);
});

it('imports Markdown as editable text without rendering its markup', async () => {
  render(<ProjectForm {...props} />);
  const contents =
    '# New idea\n<script>alert("example")</script>\n![Image](https://example.com/private)';
  const file = new File([contents], 'app.md', { type: 'text/markdown' });
  Object.defineProperty(file, 'text', { value: async () => contents });
  fireEvent.change(screen.getByLabelText('Import a Markdown file'), { target: { files: [file] } });
  expect(await screen.findByText('Text imported from app.md. You can edit it above.')).toBeTruthy();
  expect(screen.getByLabelText('Describe your app or paste Markdown')).toHaveProperty(
    'value',
    contents,
  );
  expect(document.querySelector('script')).toBeNull();
  expect(mockApi).not.toHaveBeenCalled();
});

it('rejects oversized and non-Markdown imports without replacing typed work', async () => {
  render(<ProjectForm {...props} app={project} />);
  const field = screen.getByLabelText('Import a Markdown file');
  fireEvent.change(field, { target: { files: [new File(['bad'], 'app.pdf')] } });
  expect((await screen.findByRole('alert')).textContent).toContain('Choose a Markdown file');
  fireEvent.change(field, { target: { files: [new File(['a'.repeat(65537)], 'app.md')] } });
  expect(screen.getByLabelText('Describe your app or paste Markdown')).toHaveProperty(
    'value',
    project.metadata!.data.project!.specification,
  );
  const file = new File(['a'.repeat(20001)], 'app.md');
  Object.defineProperty(file, 'text', { value: async () => 'a'.repeat(20001) });
  fireEvent.change(field, { target: { files: [file] } });
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('at most 20,000'));
  expect(screen.getByLabelText('Describe your app or paste Markdown')).toHaveProperty(
    'value',
    project.metadata!.data.project!.specification,
  );
});

it('keeps typed work and the same request ID after a failed create', async () => {
  mockApi.mockRejectedValueOnce(new Error('Cannot reach Panda Store.')).mockResolvedValue(project);
  render(<ProjectForm {...props} />);
  fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Future app' } });
  fireEvent.change(screen.getByLabelText('Describe your app or paste Markdown'), {
    target: { value: project.metadata!.data.project!.specification },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
  await screen.findByRole('alert');
  expect(screen.getByLabelText('Project name')).toHaveProperty('value', 'Future app');
  fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
  await waitFor(() => expect(props.navigate).toHaveBeenCalled());
  expect(mockApi.mock.calls[0][1]?.body).toBe(mockApi.mock.calls[1][1]?.body);
});

it('edits development scope with snapshot protection and preserves a conflict', async () => {
  mockApi.mockRejectedValue(new Error('This project changed. Reopen it before saving your edits.'));
  render(<ProjectForm {...props} app={project} />);
  fireEvent.change(screen.getByLabelText('Project stage'), { target: { value: 'development' } });
  fireEvent.change(screen.getByLabelText('Features already implemented'), {
    target: { value: 'The calendar works locally.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save project' }));
  await screen.findByRole('alert');
  expect(mockApi.mock.calls[0][1]?.method).toBe('PUT');
  expect(JSON.parse(mockApi.mock.calls[0][1]!.body as string)).toMatchObject({
    snapshot_id: 'snapshot-one',
    stage: 'development',
    available_features: 'The calendar works locally.',
  });
  expect(props.navigate).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Features already implemented')).toHaveProperty(
    'value',
    'The calendar works locally.',
  );
});

it('protects unsaved work and releases its navigation guard on unmount', async () => {
  let guard: (() => Promise<boolean>) | undefined;
  const release = vi.fn();
  const view = render(
    <ProjectForm
      {...props}
      registerLeaveGuard={(value) => {
        guard = value;
        return release;
      }}
    />,
  );
  expect(await guard!()).toBe(true);
  fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Draft' } });
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  expect(await guard!()).toBe(false);
  view.unmount();
  expect(release).toHaveBeenCalled();
});

it('shows an unpublished project and prevents viewer edits', () => {
  const view = render(
    <AppCatalog
      {...props}
      apps={[project]}
      detailAppId={project.id}
      workspace={{ ...props.workspace, role: 'viewer' }}
    />,
  );
  expect(screen.getByText(/Unpublished project/)).toBeTruthy();
  expect(screen.getByText(/A planned calendar for runners/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Edit project' })).toBeNull();
  view.rerender(
    <ProjectForm {...props} app={project} workspace={{ ...props.workspace, role: 'viewer' }} />,
  );
  expect(
    (
      screen
        .getByRole('button', { name: 'Save project' })
        .closest('fieldset') as HTMLFieldSetElement
    ).disabled,
  ).toBe(true);
});

it('starts ASO from the idea without asking the user for listing copy', async () => {
  mockApi.mockImplementation(async (path, options) => {
    if (path.endsWith('/ai/'))
      return {
        providers: [{ id: 'openai', connected: true, models: [{ id: 'gpt-4.1-mini' }] }],
        credentials_ready: true,
      };
    if (options?.method === 'POST')
      return {
        id: 'idea-run',
        workflow_id: 'workflow',
        mode: 'project',
        locale: 'fr-CA',
        status: 'queued',
        created_at: '2026-10-18T12:00:00Z',
        captured_at: '2026-10-18T12:00:00Z',
      };
    return [];
  });
  render(<ASO {...props} apps={[project]} selectedApp={project} />);
  await screen.findByText('Your first listing starts with your idea');
  expect(screen.queryByRole('button', { name: 'Prepare draft listing' })).toBeNull();
  const button = screen.getByRole('button', { name: 'Analyze idea and suggest listing' });
  expect(button).toHaveProperty('disabled', true);
  fireEvent.change(await screen.findByLabelText('Model'), { target: { value: 'gpt-4.1-mini' } });
  await waitFor(() => expect(button).toHaveProperty('disabled', false));
  fireEvent.click(button);
  await waitFor(() =>
    expect(mockApi.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(true),
  );
  const body = JSON.parse(
    mockApi.mock.calls.find(([, options]) => options?.method === 'POST')![1]!.body as string,
  );
  expect(body).toMatchObject({
    snapshot_id: 'snapshot-one',
    mode: 'project',
    locale: 'fr-CA',
    provider: 'openai',
    model: 'gpt-4.1-mini',
  });
  expect(body.listing).toBeUndefined();
});

const suggestedFields = ['name', 'subtitle', 'description', 'keywords', 'promotional_text'].map(
  (field) => ({
    field,
    text: `${field} example`,
    rationale: 'Explains the intended use.',
    evidence: [{ field: 'specification', quote: 'A planned calendar for runners.' }],
    sources: [],
  }),
);
const savedProposal = {
  id: 'idea-run',
  mode: 'project',
  workflow_id: 'workflow',
  locale: 'fr-CA',
  status: 'succeeded',
  snapshot_id: 'snapshot-one',
  source: 'project.manual',
  created_at: '2026-10-18T12:00:00Z',
  captured_at: '2026-10-18T12:00:00Z',
  report: {
    checks: [],
    counts: {},
    project: {
      stage: 'idea',
      analysis: {
        positioning: 'A calendar concept for new runners.',
        audience: 'New runners',
        search_intents: ['beginner running plan'],
        missing_information: ['Which plans will be available?'],
      },
      fields: suggestedFields,
      accepted: true,
      reviewed_items: 6,
      withheld_fields: [],
      model: 'model',
      usage: {},
      review_usage: {},
    },
  },
};

it('restores the whole saved ASO proposal and creates a draft from its five fields without new AI', async () => {
  mockApi.mockImplementation(async (path, options) => {
    if (path.endsWith('/ai/')) return { providers: [], credentials_ready: true };
    if (options?.method === 'POST') throw new Error('Save unavailable');
    return path.endsWith('/drafts/') ? [] : [savedProposal];
  });
  render(<ASO {...props} apps={[project]} selectedApp={project} />);
  await screen.findByText('A calendar concept for new runners.');
  expect(screen.getByText('Which plans will be available?')).toBeTruthy();
  expect(screen.getByLabelText('Suggested Subtitle')).toHaveProperty('value', 'subtitle example');
  expect(screen.getByLabelText('Suggested Keywords')).toHaveProperty('value', 'keywords example');
  fireEvent.click(screen.getByRole('button', { name: 'Use this listing as a draft' }));
  await screen.findByText(/This draft starts with all five fields proposed from your idea/);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Create draft' })).toHaveProperty('disabled', false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Create draft' }));
  await screen.findByText('Save unavailable');
  const writes = mockApi.mock.calls.filter(([, options]) => options?.method === 'POST');
  expect(writes).toHaveLength(1);
  expect(writes[0][0]).toBe('/api/workspaces/workspace-one/aso/apps/project-one/drafts/');
  expect(JSON.parse(writes[0][1]!.body as string)).toMatchObject({
    audit_id: 'idea-run',
    check_id: 'project.listing',
  });
});

it('withholds a rejected listing and does not offer it as an editable proposal', async () => {
  mockApi.mockImplementation(async (path) =>
    path.endsWith('/ai/')
      ? { providers: [], credentials_ready: true }
      : [
          {
            ...savedProposal,
            report: {
              ...savedProposal.report,
              project: {
                ...savedProposal.report.project,
                accepted: false,
                fields: [],
                withheld_fields: ['description'],
              },
            },
          },
        ],
  );
  render(<ASO {...props} apps={[project]} selectedApp={project} />);
  await screen.findByText(/The proposal did not pass the project evidence review/);
  expect(screen.queryByRole('button', { name: 'Use this listing as a draft' })).toBeNull();
  expect(screen.queryByLabelText('Suggested Description')).toBeNull();
});
