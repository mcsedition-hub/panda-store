import { t } from '../i18n';

export type Model = {
  id: string;
  name: string;
  thinking?: boolean | null;
  vision?: boolean;
  listed_free?: boolean;
};
export type Use = 'writing' | 'ideas' | 'reasoning' | 'images';
type Fit = 'balanced' | 'deep' | 'quick' | 'rewrite' | 'visual' | 'creative';
type Speed = 'Fast' | 'Very fast' | 'Moderate' | 'Variable' | 'Allow more time';
type Mode = 'default' | 'medium' | 'low' | 'off' | 'none';
export type Profile = {
  label: string;
  fit: Fit;
  speed: Speed;
  mode: Mode;
  reasoning: boolean;
  vision: boolean;
  source: string;
  note?: string;
};

// Editorial usage guidance derived from the official pages below, not a benchmark.
// Exact reviewed IDs only: never guess a future model's abilities from its name.
// Keep mode in sync with providers.generate / zai.generate when adapters change.
export const REVIEWED_ON = '2026-10-18';
export const uses: Record<Use, string> = {
  writing: 'Writing',
  ideas: 'Ideas',
  reasoning: 'Reasoning',
  images: 'Image analysis',
};
const fits: Record<Fit, { description: string; uses: Use[] }> = {
  balanced: {
    description: 'Draft and refine texts, explore content angles, and organize information.',
    uses: ['writing', 'ideas'],
  },
  deep: {
    description: 'Work through complex questions, compare options, and build a detailed plan.',
    uses: ['reasoning', 'ideas'],
  },
  quick: {
    description: 'Summarize, extract information, and handle short, clearly defined tasks.',
    uses: ['writing'],
  },
  rewrite: {
    description: 'Rewrite short texts, follow a clear brief, and try several wording variants.',
    uses: ['writing', 'ideas'],
  },
  creative: {
    description: 'Develop story concepts, scripts, tone of voice, and longer creative texts.',
    uses: ['writing', 'ideas'],
  },
  visual: {
    description: 'Read screenshots, compare visuals, and explain layout or image content.',
    uses: ['images'],
  },
};
const profiles: Record<string, Profile> = {};
function add(provider: string, id: string, profile: Profile, aliases: string[] = []) {
  for (const name of [id, ...aliases]) profiles[provider + ':' + name] = profile;
}

const openai: [string, string, Fit, Speed, Mode, string[]][] = [
  ['gpt-6-astra', 'Complex reasoning', 'deep', 'Allow more time', 'default', []],
  ['gpt-6.1-sol', 'Writing & analysis', 'balanced', 'Variable', 'medium', []],
  ['gpt-6-sol', 'Complex reasoning', 'deep', 'Variable', 'medium', []],
  ['gpt-6-luna', 'Focused tasks', 'quick', 'Variable', 'medium', []],
  ['gpt-5.6-sol', 'Writing & analysis', 'balanced', 'Variable', 'medium', []],
  ['gpt-5.6-terra', 'Writing & ideas', 'balanced', 'Variable', 'medium', []],
  ['gpt-5.6-luna', 'Focused tasks', 'quick', 'Variable', 'medium', []],
  ['gpt-5.5', 'Complex reasoning', 'deep', 'Variable', 'medium', ['gpt-5.5-2026-04-23']],
  ['gpt-5.4', 'Writing & analysis', 'balanced', 'Variable', 'off', ['gpt-5.4-2026-03-05']],
  ['gpt-5.4-mini', 'Writing & ideas', 'balanced', 'Fast', 'off', ['gpt-5.4-mini-2026-03-17']],
  ['gpt-5.4-nano', 'Quick tasks', 'quick', 'Very fast', 'off', ['gpt-5.4-nano-2026-03-17']],
  ['gpt-5.2', 'Writing & analysis', 'balanced', 'Variable', 'off', ['gpt-5.2-2025-12-11']],
  ['gpt-5.1', 'Writing & analysis', 'balanced', 'Variable', 'off', ['gpt-5.1-2025-11-13']],
  ['gpt-5', 'Complex reasoning', 'deep', 'Variable', 'default', ['gpt-5-2025-08-07']],
  ['gpt-5-mini', 'Writing & ideas', 'balanced', 'Fast', 'default', ['gpt-5-mini-2025-08-07']],
  ['gpt-5-nano', 'Quick tasks', 'quick', 'Very fast', 'default', ['gpt-5-nano-2025-08-07']],
  ['gpt-4.1', 'Writing & ideas', 'balanced', 'Fast', 'none', ['gpt-4.1-2025-04-14']],
  ['gpt-4.1-mini', 'Quick writing', 'rewrite', 'Fast', 'none', ['gpt-4.1-mini-2025-04-14']],
  ['gpt-4.1-nano', 'Quick tasks', 'quick', 'Very fast', 'none', ['gpt-4.1-nano-2025-04-14']],
  [
    'gpt-4o',
    'Writing & ideas',
    'balanced',
    'Fast',
    'none',
    ['gpt-4o-2024-11-20', 'gpt-4o-2024-08-06'],
  ],
  ['gpt-4o-mini', 'Quick writing', 'rewrite', 'Fast', 'none', ['gpt-4o-mini-2024-07-18']],
];
for (const [id, label, fit, speed, mode, aliases] of openai) {
  add(
    'openai',
    id,
    {
      label,
      fit,
      speed,
      mode,
      vision: true,
      reasoning: mode !== 'none',
      source: 'https://developers.openai.com/api/docs/models/' + id,
    },
    aliases,
  );
}

const google: [string, string, Fit, Speed, Mode, string?][] = [
  ['gemini-4-argon', 'Complex reasoning', 'deep', 'Allow more time', 'medium'],
  ['gemini-3.8-flash', 'Writing & ideas', 'balanced', 'Fast', 'medium'],
  [
    'gemini-3.7-flash',
    'Writing & ideas',
    'balanced',
    'Fast',
    'default',
    'Google redirects this older model to Gemini 3.8 Flash.',
  ],
  ['gemini-3.6-flash', 'Writing & ideas', 'balanced', 'Fast', 'default'],
  [
    'gemini-3.5-flash',
    'Writing & ideas',
    'balanced',
    'Fast',
    'default',
    'Google redirects this older model to Gemini 3.6 Flash.',
  ],
  ['gemini-3.5-flash-lite', 'Quick tasks', 'quick', 'Very fast', 'default'],
  ['gemini-3.1-flash-lite', 'Quick tasks', 'quick', 'Very fast', 'default'],
  [
    'gemini-2.5-pro',
    'Complex reasoning',
    'deep',
    'Allow more time',
    'default',
    'Google limits access to this generation to accounts that have used it before.',
  ],
  [
    'gemini-2.5-flash',
    'Writing & ideas',
    'balanced',
    'Fast',
    'default',
    'Google limits access to this generation to accounts that have used it before.',
  ],
  [
    'gemini-2.5-flash-lite',
    'Quick tasks',
    'quick',
    'Very fast',
    'default',
    'Google limits access to this generation to accounts that have used it before.',
  ],
];
for (const [id, label, fit, speed, mode, note] of google) {
  add('google', id, {
    label,
    fit,
    speed,
    mode,
    note,
    vision: true,
    reasoning: true,
    source: 'https://ai.google.dev/gemini-api/docs/models/' + id,
  });
}

const anthropic: [string, string, Fit, Speed][] = [
  ['claude-fable-5-1', 'Complex reasoning', 'deep', 'Allow more time'],
  ['claude-opus-5-5', 'Writing & analysis', 'balanced', 'Moderate'],
  ['claude-sonnet-5-5', 'Writing & ideas', 'balanced', 'Fast'],
  ['claude-haiku-5-5', 'Quick tasks', 'quick', 'Very fast'],
];
for (const [id, label, fit, speed] of anthropic) {
  add('anthropic', id, {
    label,
    fit,
    speed,
    mode: 'default',
    vision: true,
    reasoning: true,
    source: 'https://platform.claude.com/docs/en/models/overview',
  });
}
for (const id of ['claude-sonnet-5', 'claude-sonnet-4-6']) {
  add('anthropic', id, {
    label: 'Writing & ideas',
    fit: 'balanced',
    speed: 'Variable',
    mode: 'default',
    vision: true,
    reasoning: true,
    source: 'https://platform.claude.com/docs/en/models/' + id.replace('claude-', '') + '/overview',
    note: 'An older generation, still available when returned by your provider account.',
  });
}

const zai: [string, string, Fit, Speed, boolean, string][] = [
  ['glm-5.3', 'Complex reasoning', 'deep', 'Variable', false, 'llm/glm-5.3'],
  ['glm-5.2', 'Writing & analysis', 'balanced', 'Variable', false, 'llm/glm-5.2'],
  ['glm-5.1', 'Creative writing', 'creative', 'Variable', false, 'llm/glm-5.1'],
  ['glm-5', 'Creative writing', 'creative', 'Variable', false, 'llm/glm-5'],
  ['glm-4.7', 'Creative writing', 'creative', 'Variable', false, 'llm/glm-4.7'],
  ['glm-4.7-flash', 'Quick writing', 'rewrite', 'Variable', false, 'llm/glm-4.7'],
  ['glm-4.6', 'Creative writing', 'creative', 'Variable', false, 'llm/glm-4.6'],
  ['glm-4.6v', 'Visual analysis', 'visual', 'Variable', true, 'vlm/glm-4.6v'],
  ['glm-4.6v-flash', 'Visual analysis', 'visual', 'Fast', true, 'vlm/glm-4.6v'],
  ['glm-4.6v-flashx', 'Visual analysis', 'visual', 'Fast', true, 'vlm/glm-4.6v'],
];
for (const [id, label, fit, speed, vision, path] of zai) {
  add('zai', id, {
    label,
    fit,
    speed,
    vision,
    mode: id === 'glm-5.3' ? 'low' : 'off',
    reasoning: true,
    source: 'https://docs.z.ai/guides/' + path,
  });
}

export function modelProfile(provider: string, model: Model): Profile | undefined {
  return profiles[provider + ':' + model.id];
}
export type ModuleContext = 'aso' | 'smm';
export type Recommendation = { model: Model; label: string; reason: string };

// Curated order combines general quality with useful differences in speed and
// writing/vision capabilities. It is editorial guidance, not an objective top 5.
const mainOrder: Record<string, string[]> = {
  openai: [
    'gpt-6.1-sol',
    'gpt-6-astra',
    'gpt-6-luna',
    'gpt-5.6-terra',
    'gpt-5.6-sol',
    'gpt-6-sol',
    'gpt-5.5',
    'gpt-5.4-mini',
    'gpt-5.4',
    'gpt-5.4-nano',
    'gpt-5.2',
    'gpt-5.1',
    'gpt-5-mini',
    'gpt-5',
    'gpt-5-nano',
    'gpt-4.1',
    'gpt-4.1-mini',
    'gpt-4.1-nano',
    'gpt-4o',
    'gpt-4o-mini',
  ],
  google: [
    'gemini-3.8-flash',
    'gemini-4-argon',
    'gemini-3.5-flash-lite',
    'gemini-3.6-flash',
    'gemini-3.1-flash-lite',
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-3.7-flash',
    'gemini-3.5-flash',
  ],
  anthropic: [
    'claude-opus-5-5',
    'claude-sonnet-5-5',
    'claude-fable-5-1',
    'claude-haiku-5-5',
    'claude-sonnet-5',
    'claude-sonnet-4-6',
  ],
  zai: [
    'glm-5.3',
    'glm-5.1',
    'glm-4.7',
    'glm-4.6v',
    'glm-4.7-flash',
    'glm-5.2',
    'glm-5',
    'glm-4.6v-flashx',
    'glm-4.6v-flash',
    'glm-4.6',
  ],
};
function availableVersion(provider: string, id: string, models: Model[]) {
  const profile = profiles[provider + ':' + id];
  return (
    models.find((item) => item.id === id) ??
    (profile && models.find((item) => modelProfile(provider, item) === profile))
  );
}
export function recommendedModel(
  provider: string,
  models: Model[],
  context?: ModuleContext,
  visionTask = false,
): Recommendation | undefined {
  if (!context) return;
  const preferences: Record<ModuleContext, Record<string, string[]>> = {
    aso: {
      openai: ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-5.6-sol'],
      google: ['gemini-3.8-flash', 'gemini-4-argon'],
      anthropic: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1'],
      zai: ['glm-5.3', 'glm-5.1', 'glm-4.6v'],
    },
    smm: {
      openai: ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-5.6-terra'],
      google: ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-4-argon'],
      anthropic: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1'],
      zai: ['glm-5.1', 'glm-4.7', 'glm-5.3', 'glm-4.6v'],
    },
  };
  const order = [...(preferences[context][provider] ?? []), ...(mainOrder[provider] ?? [])];
  const model = order.map((id) => availableVersion(provider, id, models)).find(Boolean);
  if (!model) return; // No recommendation for an unreviewed account catalog.
  const visual = visionTask || modelProfile(provider, model)?.fit === 'visual';
  return {
    model,
    label: context === 'aso' ? 'Recommended for ASO' : 'Recommended for SMM',
    reason: visual
      ? 'A useful choice for reading screenshots and comparing visual content.'
      : context === 'aso'
        ? 'A useful starting point for positioning analysis and consistent store copy.'
        : 'A useful starting point for content angles, writing variants, and social scripts.',
  };
}
export function primaryModels(provider: string, models: Model[], recommended?: Model): Model[] {
  const result: Model[] = recommended ? [recommended] : [];
  const seen = new Set<Profile>();
  if (recommended) {
    const profile = modelProfile(provider, recommended);
    if (profile) seen.add(profile);
  }
  for (const id of mainOrder[provider] ?? []) {
    const candidate = availableVersion(provider, id, models);
    if (!candidate || result.includes(candidate)) continue;
    const profile = modelProfile(provider, candidate);
    if (profile && seen.has(profile)) continue;
    result.push(candidate);
    if (profile) seen.add(profile);
    if (result.length === 5) return result;
  }
  // Keep a limited/unknown catalog usable, with unverified profiles clearly marked.
  for (const model of models) {
    if (result.length === 5) break;
    const profile = modelProfile(provider, model);
    if (result.includes(model) || (profile && seen.has(profile))) continue;
    result.push(model);
    if (profile) seen.add(profile);
  }
  return result;
}
export function modelVision(provider: string, model: Model): boolean | undefined {
  return model.vision ?? modelProfile(provider, model)?.vision;
}
export function modelReasoning(provider: string, model: Model): boolean | undefined {
  return model.thinking ?? modelProfile(provider, model)?.reasoning;
}
export function modelUses(provider: string, model: Model): Use[] {
  const profile = modelProfile(provider, model);
  const result = new Set<Use>(profile ? fits[profile.fit].uses : []);
  if (modelReasoning(provider, model) === true) result.add('reasoning');
  else result.delete('reasoning');
  if (modelVision(provider, model) === true) result.add('images');
  return [...result];
}
export function modelDescription(profile: Profile): string {
  return t(fits[profile.fit].description);
}
export function thinkingHere(provider: string, model: Model): string {
  const profile = modelProfile(provider, model);
  // Report what the current adapter requests, separately from model support.
  if (provider === 'zai') {
    return model.id === 'glm-5.3' ? t('Enabled at low effort here') : t('Disabled here');
  }
  if (provider === 'google' && ['gemini-4-argon', 'gemini-3.8-flash'].includes(model.id)) {
    return t('Medium effort here');
  }
  if (profile?.mode === 'off') return t('Off by provider default');
  if (profile?.mode === 'none') return t('No dedicated thinking mode');
  if (profile?.mode === 'medium') return t('Medium effort by provider default');
  return t('Provider default settings');
}
export function modelOptionLabel(provider: string, model: Model): string {
  const profile = modelProfile(provider, model);
  const parts = [model.id];
  if (profile) parts.push(t(profile.label));
  if (provider === 'zai') {
    parts.push(model.vision ? t('Text + images') : t('Text'));
    if (typeof model.listed_free === 'boolean')
      parts.push(model.listed_free ? t('Listed free') : t('Paid'));
  }
  return parts.join(' · ');
}
