import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import AIOptions from './ai/AIOptions';
import { api } from './api';
import { setLanguage } from './i18n';
import { primaryModels, recommendedModel } from './ai/modelProfiles';
vi.mock('./api', () => ({ api: vi.fn() }));
const mockApi = vi.mocked(api);
const catalog = {
  credentials_ready: true,
  providers: [
    {
      id: 'openai',
      name: 'OpenAI',
      connected: true,
      revision: 'revision-one',
      models: [{ id: 'gpt-4.1-mini', name: 'Mini' }],
    },
  ],
};
beforeEach(() => {
  setLanguage('en');
  mockApi.mockReset();
});
afterEach(() => {
  cleanup();
  setLanguage('en');
});

const zaiCatalog = {
  credentials_ready: true,
  providers: [
    {
      id: 'zai',
      name: 'Z.ai (GLM)',
      connected: true,
      revision: 'zai-one',
      models: [
        { id: 'glm-4.7-flash', name: 'glm-4.7-flash', vision: false, listed_free: true },
        { id: 'glm-4.6v-flash', name: 'glm-4.6v-flash', vision: true, listed_free: true },
        { id: 'glm-5.3', name: 'glm-5.3', vision: false, listed_free: false },
      ],
    },
  ],
};

it('does not restore a saved text model for a retry requiring images', async () => {
  mockApi.mockResolvedValue(zaiCatalog);
  const changed = vi.fn();
  render(
    <AIOptions
      workspaceId="one"
      owner
      disabled={false}
      onChange={changed}
      capability="vision"
      initialChoice={{ provider: 'zai', model: 'glm-5.3' }}
    />,
  );
  await waitFor(() =>
    expect(changed).toHaveBeenLastCalledWith({ provider: 'zai', model: '' }, false),
  );
  expect((screen.getByLabelText('Model') as HTMLSelectElement).value).toBe('');
});

it('clears a selected GLM text model when switching to a visual task without selecting a paid model', async () => {
  mockApi.mockResolvedValue(zaiCatalog);
  const changed = vi.fn();
  const view = render(<AIOptions workspaceId="one" owner disabled={false} onChange={changed} />);
  const model = await screen.findByLabelText('Model');
  fireEvent.change(model, { target: { value: 'glm-4.7-flash' } });
  view.rerender(
    <AIOptions workspaceId="one" owner disabled={false} onChange={changed} capability="vision" />,
  );
  await waitFor(() =>
    expect(changed).toHaveBeenLastCalledWith({ provider: 'zai', model: '' }, false),
  );
  expect(Array.from((model as HTMLSelectElement).options, (option) => option.value)).toEqual([
    '',
    'glm-4.6v-flash',
  ]);
  expect(screen.getByText(/Only GLM models that accept images/)).toBeTruthy();
  expect(mockApi).toHaveBeenCalledTimes(1);
});

it('does not offer Z.ai for legacy web discovery', async () => {
  mockApi.mockResolvedValue(zaiCatalog);
  const changed = vi.fn();
  render(
    <AIOptions
      workspaceId="one"
      owner
      disabled={false}
      onChange={changed}
      capability="web_search"
    />,
  );
  await waitFor(() => expect(changed).toHaveBeenLastCalledWith(null, false));
  const option = screen.getByRole('option', { name: 'Z.ai (GLM) · Use browser research' });
  expect((option as HTMLOptionElement).disabled).toBe(true);
  expect(screen.queryByLabelText('Model')).toBeNull();
});

it('does not adopt late connection responses after unmount', async () => {
  let resolve: (value: unknown) => void = () => {};
  mockApi.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const changed = vi.fn();
  const view = render(<AIOptions workspaceId="one" owner disabled={false} onChange={changed} />);
  view.unmount();
  resolve(catalog);
  await Promise.resolve();
  expect(changed.mock.calls).toEqual([[null, true]]);
});

const googleCatalog = {
  credentials_ready: true,
  providers: [
    {
      id: 'google',
      connected: true,
      models: [
        { id: 'gemini-4-argon', name: 'Argon', thinking: true },
        { id: 'gemini-3.8-flash', name: 'Flash', thinking: true },
        { id: 'gemini-3.1-pro-preview', name: 'Pro', thinking: true },
        { id: 'gemini-2.5-flash-lite', name: 'Lite', thinking: true },
        { id: 'gemini-pro-latest', name: 'Latest', thinking: true },
      ],
    },
    ...catalog.providers,
  ],
};

it('explains Gemini choices without limiting them to an ASO shortlist', async () => {
  mockApi.mockResolvedValue(googleCatalog);
  const changed = vi.fn();
  render(<AIOptions workspaceId="one" owner disabled={false} onChange={changed} />);
  const model = (await screen.findByLabelText('Model')) as HTMLSelectElement;
  expect(Array.from(model.options, (option) => option.value).sort()).toEqual(
    ['', ...googleCatalog.providers[0].models.map((item) => item.id)].sort(),
  );
  expect(model.value).toBe('');
  expect(changed).toHaveBeenLastCalledWith({ provider: 'google', model: '' }, false);
  fireEvent.change(model, { target: { value: 'gemini-3.8-flash' } });
  const profile = screen.getByRole('region', { name: 'Selected model profile' });
  expect(within(profile).getByText('Medium effort here')).toBeTruthy();
  expect(within(profile).getByText('Fast')).toBeTruthy();
  expect(within(profile).getByRole('link').getAttribute('href')).toContain('/gemini-3.8-flash');
  expect(changed).toHaveBeenLastCalledWith(
    { provider: 'google', model: 'gemini-3.8-flash' },
    false,
  );
  fireEvent.change(model, { target: { value: 'gemini-pro-latest' } });
  expect(within(profile).getByText(/no reviewed usage profile/)).toBeTruthy();
  expect(within(profile).queryByRole('link')).toBeNull();
  expect(mockApi).toHaveBeenCalledTimes(1);
});

it('shows five main GPT models, expands older versions, and preserves an explicit older choice', async () => {
  const ids = [
    'gpt-4.1-mini',
    'gpt-5.4',
    'gpt-5.4-2026-03-05',
    'gpt-6-luna',
    'gpt-6.1-sol',
    'gpt-6-astra',
    'gpt-6-sol',
  ];
  mockApi.mockResolvedValue({
    ...catalog,
    providers: [{ ...catalog.providers[0], models: ids.map((id) => ({ id, name: id })) }],
  });
  const changed = vi.fn();
  render(<AIOptions workspaceId="one" owner disabled={false} onChange={changed} />);
  const model = (await screen.findByLabelText('Model')) as HTMLSelectElement;
  expect(Array.from(model.options, (item) => item.value)).toEqual([
    '',
    'gpt-6.1-sol',
    'gpt-6-astra',
    'gpt-6-luna',
    'gpt-6-sol',
    'gpt-5.4',
  ]);
  expect(model.value).toBe('');
  fireEvent.click(screen.getByRole('button', { name: 'See more (7 models)' }));
  expect(model.options.length).toBe(8);
  fireEvent.change(model, { target: { value: 'gpt-5.4' } });
  const profile = screen.getByRole('region', { name: 'Selected model profile' });
  expect(within(profile).getByText('Off by provider default')).toBeTruthy();
  fireEvent.change(model, { target: { value: 'gpt-4.1-mini' } });
  fireEvent.click(screen.getByRole('button', { name: 'Show main models' }));
  expect(model.value).toBe('gpt-4.1-mini');
  expect(model.options.length).toBe(6); // Four main models and the explicit choice.
  expect(changed).toHaveBeenLastCalledWith({ provider: 'openai', model: 'gpt-4.1-mini' }, false);
  expect(mockApi).toHaveBeenCalledTimes(1);
});

it('uses only available older GPT IDs when current models are absent, without duplicate snapshots', async () => {
  const ids = ['gpt-4.1-mini', 'gpt-4.1-mini-2025-04-14', 'gpt-5.4-2026-03-05'];
  mockApi.mockResolvedValue({
    ...catalog,
    providers: [{ ...catalog.providers[0], models: ids.map((id) => ({ id, name: id })) }],
  });
  render(<AIOptions workspaceId="one" owner disabled={false} onChange={vi.fn()} />);
  const model = (await screen.findByLabelText('Model')) as HTMLSelectElement;
  expect(Array.from(model.options, (item) => item.value)).toEqual([
    '',
    'gpt-5.4-2026-03-05',
    'gpt-4.1-mini',
  ]);
  fireEvent.change(model, { target: { value: 'gpt-5.4-2026-03-05' } });
  expect(
    screen.getByRole('link', { name: 'Official model documentation' }).getAttribute('href'),
  ).toBe('https://developers.openai.com/api/docs/models/gpt-5.4');
});

it('distinguishes GLM thinking support, actual settings and image analysis without generating images', async () => {
  mockApi.mockResolvedValue(zaiCatalog);
  render(<AIOptions workspaceId="one" owner disabled={false} onChange={vi.fn()} />);
  const model = await screen.findByLabelText('Model');
  fireEvent.change(model, { target: { value: 'glm-4.7-flash' } });
  const profile = screen.getByRole('region', { name: 'Selected model profile' });
  expect(within(profile).getByText('Disabled here')).toBeTruthy();
  expect(within(profile).getByText('Not supported')).toBeTruthy(); // Text only.
  expect(within(profile).getByText('Supported')).toBeTruthy(); // Thinking capability.
  fireEvent.change(model, { target: { value: 'glm-5.3' } });
  expect(within(profile).getByText('Enabled at low effort here')).toBeTruthy();
  fireEvent.change(model, { target: { value: 'glm-4.6v-flash' } });
  expect(within(profile).getAllByText('Supported')).toHaveLength(2);
  expect(screen.getByText(/Image creation is not enabled/)).toBeTruthy();
});

it('offers the same guide for Claude and lets comparison choose a model explicitly', async () => {
  mockApi.mockResolvedValue({
    ...catalog,
    providers: [
      {
        id: 'anthropic',
        connected: true,
        models: ['claude-sonnet-5-5', 'claude-fable-5-1', 'claude-haiku-5-5'].map((id) => ({
          id,
          name: id,
        })),
      },
    ],
  });
  const changed = vi.fn();
  render(<AIOptions workspaceId="one" owner disabled={false} onChange={changed} />);
  const model = (await screen.findByLabelText('Model')) as HTMLSelectElement;
  fireEvent.click(screen.getByText('Compare models by use'));
  fireEvent.change(screen.getByLabelText('Explore by use'), { target: { value: 'ideas' } });
  expect(screen.queryByRole('button', { name: 'Choose claude-haiku-5-5' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Choose claude-fable-5-1' }));
  expect(model.value).toBe('claude-fable-5-1');
  const profile = screen.getByRole('region', { name: 'Selected model profile' });
  expect(within(profile).getByText('Allow more time')).toBeTruthy();
  expect(within(profile).getByText('Provider default settings')).toBeTruthy();
  expect(within(profile).getByRole('link').getAttribute('href')).toContain('platform.claude.com');
  fireEvent.change(screen.getByLabelText('Find a model'), { target: { value: 'not-in-catalog' } });
  expect(screen.getByText(/No reviewed models match/)).toBeTruthy();
  expect(model.value).toBe('claude-fable-5-1');
  expect(changed).toHaveBeenLastCalledWith(
    { provider: 'anthropic', model: 'claude-fable-5-1' },
    false,
  );
  expect(mockApi).toHaveBeenCalledTimes(1);
});

it('honors catalog capability overrides and does not guess capabilities from an unfamiliar model name', async () => {
  mockApi.mockResolvedValue({
    ...catalog,
    providers: [
      {
        id: 'google',
        connected: true,
        models: [
          { id: 'gemini-4-argon', name: 'Argon', thinking: false, vision: false },
          { id: 'gemini-99-pro-thinking', name: 'Future model' },
        ],
      },
    ],
  });
  const changed = vi.fn();
  const view = render(<AIOptions workspaceId="one" owner disabled={false} onChange={changed} />);
  const model = (await screen.findByLabelText('Model')) as HTMLSelectElement;
  fireEvent.change(model, { target: { value: 'gemini-4-argon' } });
  expect(
    within(screen.getByRole('region', { name: 'Selected model profile' })).getAllByText(
      'Not supported',
    ),
  ).toHaveLength(2);
  view.rerender(
    <AIOptions workspaceId="one" owner disabled={false} onChange={changed} capability="vision" />,
  );
  await waitFor(() =>
    expect(changed).toHaveBeenLastCalledWith({ provider: 'google', model: '' }, false),
  );
  expect(Array.from(model.options, (item) => item.value)).toEqual(['', 'gemini-99-pro-thinking']);
  fireEvent.change(model, { target: { value: 'gemini-99-pro-thinking' } });
  const profile = screen.getByRole('region', { name: 'Selected model profile' });
  expect(within(profile).getAllByText('Not verified')).toHaveLength(3);
  expect(within(profile).queryByRole('link')).toBeNull();
});

it('keeps an unfamiliar OpenAI catalog selectable without inventing main models', async () => {
  mockApi.mockResolvedValue({
    ...catalog,
    providers: [
      {
        ...catalog.providers[0],
        models: [{ id: 'gpt-99-new', name: 'Unreviewed' }],
      },
    ],
  });
  render(<AIOptions workspaceId="one" owner disabled={false} onChange={vi.fn()} />);
  const model = (await screen.findByLabelText('Model')) as HTMLSelectElement;
  expect(Array.from(model.options, (item) => item.value)).toEqual(['', 'gpt-99-new']);
  expect(screen.queryByRole('button', { name: /See more/ })).toBeNull();
});

it('translates model profiles and comparison controls into the account language', async () => {
  setLanguage('fr');
  mockApi.mockResolvedValue(zaiCatalog);
  render(<AIOptions workspaceId="one" owner disabled={false} onChange={vi.fn()} />);
  const model = await screen.findByLabelText('Modèle');
  fireEvent.change(model, { target: { value: 'glm-5.3' } });
  const profile = screen.getByRole('region', { name: 'Fiche du modèle choisi' });
  expect(within(profile).getByText('Raisonnement complexe')).toBeTruthy();
  expect(within(profile).getByText('Activée ici, effort faible')).toBeTruthy();
  expect(within(profile).getByText(/Approfondir des questions complexes/)).toBeTruthy();
  fireEvent.click(screen.getByText('Comparer les modèles par usage'));
  expect(screen.getByRole('option', { name: 'Rédaction' })).toBeTruthy();
  expect(screen.getByRole('option', { name: 'Idées' })).toBeTruthy();
  expect(
    within(profile).getByRole('link', { name: 'Documentation officielle du modèle' }),
  ).toBeTruthy();
});

it.each([
  [
    'google',
    [
      'gemini-3.8-flash',
      'gemini-4-argon',
      'gemini-3.5-flash-lite',
      'gemini-3.6-flash',
      'gemini-3.1-flash-lite',
      'gemini-2.5-pro',
    ],
  ],
  ['zai', ['glm-5.3', 'glm-5.2', 'glm-5.1', 'glm-5', 'glm-4.7', 'glm-4.6v', 'glm-4.7-flash']],
  [
    'anthropic',
    [
      'claude-opus-5-5',
      'claude-sonnet-5-5',
      'claude-fable-5-1',
      'claude-haiku-5-5',
      'claude-older-one',
      'claude-older-two',
    ],
  ],
] as const)(
  'limits %s to five main choices and keeps the full catalog accessible',
  async (provider, ids) => {
    mockApi.mockResolvedValue({
      ...catalog,
      providers: [{ id: provider, connected: true, models: ids.map((id) => ({ id, name: id })) }],
    });
    render(
      <AIOptions workspaceId="one" owner disabled={false} onChange={vi.fn()} moduleContext="aso" />,
    );
    const model = (await screen.findByLabelText('Model')) as HTMLSelectElement;
    expect(model.options.length).toBe(6);
    expect(model.value).toBe('');
    expect(screen.getByRole('option', { name: /Recommended for ASO/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: `See more (${ids.length} models)` }));
    expect(model.options.length).toBe(ids.length + 1);
  },
);

it('changes the module recommendation without choosing a model or changing a previous choice', async () => {
  const ids = ['glm-5.3', 'glm-5.1', 'glm-4.7', 'glm-4.6v', 'glm-4.7-flash', 'glm-4.6v-flash'];
  mockApi.mockResolvedValue({
    ...catalog,
    providers: [
      {
        id: 'zai',
        connected: true,
        models: ids.map((id) => ({ id, name: id, vision: id.includes('4.6v') })),
      },
    ],
  });
  const changed = vi.fn();
  const view = render(
    <AIOptions workspaceId="one" owner disabled={false} onChange={changed} moduleContext="aso" />,
  );
  const model = (await screen.findByLabelText('Model')) as HTMLSelectElement;
  expect(screen.getByRole('option', { name: /glm-5.3.*Recommended for ASO/ })).toBeTruthy();
  expect(model.value).toBe('');
  fireEvent.change(model, { target: { value: 'glm-4.7-flash' } });
  view.rerender(
    <AIOptions workspaceId="one" owner disabled={false} onChange={changed} moduleContext="smm" />,
  );
  expect(screen.getByRole('option', { name: /glm-5.1.*Recommended for SMM/ })).toBeTruthy();
  expect(screen.getByText(/content angles, writing variants/)).toBeTruthy();
  expect(model.value).toBe('glm-4.7-flash');
  view.rerender(
    <AIOptions
      workspaceId="one"
      owner
      disabled={false}
      onChange={changed}
      moduleContext="smm"
      capability="vision"
    />,
  );
  await waitFor(() => expect(model.value).toBe(''));
  expect(screen.getByRole('option', { name: /glm-4.6v ·.*Recommended for SMM/ })).toBeTruthy();
  expect(screen.queryByRole('option', { name: /glm-5.1/ })).toBeNull();
  expect(mockApi).toHaveBeenCalledTimes(1);
});

it('does not label an unreviewed model recommended or introduce unavailable models', () => {
  const models = [{ id: 'gpt-future', name: 'Future' }];
  expect(primaryModels('openai', models)).toEqual(models);
  expect(recommendedModel('openai', models, 'aso')).toBeUndefined();
});

it('keeps model selection in the module and directs unconnected workspaces to sidebar settings', async () => {
  mockApi.mockResolvedValue({ credentials_ready: true, providers: [] });
  const changed = vi.fn();
  render(<AIOptions workspaceId="one" disabled={false} onChange={changed} />);
  await screen.findByText('Connect providers in Settings → AI settings in the sidebar.');
  expect(screen.queryByRole('button', { name: 'AI settings' })).toBeNull();
  expect(screen.queryByLabelText('API key')).toBeNull();
  expect(changed).toHaveBeenLastCalledWith(null, false);
  expect(mockApi.mock.calls.every(([, options]) => !options?.method)).toBe(true);
});

it('retries a failed selector catalog read without opening connection settings', async () => {
  mockApi.mockRejectedValueOnce(new Error('Cannot reach Panda Store.'));
  render(<AIOptions workspaceId="one" disabled={false} onChange={vi.fn()} />);
  await screen.findByText(/AI connections could not be loaded/);
  mockApi.mockResolvedValue(catalog);
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading AI connections' }));
  await screen.findByLabelText('Model');
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByLabelText('API key')).toBeNull();
});
