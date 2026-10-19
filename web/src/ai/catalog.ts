import type { Model } from './modelProfiles';

export type Provider = {
  id: string;
  name: string;
  connected: boolean;
  revision: string | null;
  models: Model[];
  checked_at: string | null;
};
export type Catalog = { providers: Provider[]; credentials_ready: boolean };
export const providerNames = {
  openai: 'OpenAI',
  google: 'Google Gemini',
  anthropic: 'Anthropic Claude',
  zai: 'Z.ai (GLM)',
};
