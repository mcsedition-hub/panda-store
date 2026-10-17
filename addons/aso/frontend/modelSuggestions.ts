import type { ModelSuggestions } from '../../../web/src/ai/AIOptions';

// Reviewed 2026-10-16: stable text models with thinking and structured outputs.
// This is a starting selection, not an ASO quality benchmark. Only models returned
// by the workspace's provider key, with thinking explicitly supported, are shown.
// https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash
// https://ai.google.dev/gemini-api/docs/models/gemini-4-argon
export const modelSuggestions: ModelSuggestions = {
  google: {
    label: 'Suggested for ASO',
    description: 'Suggested models are stable and support reasoning.',
    models: [
      { id: 'gemini-3.8-flash', label: 'Balanced', requiresThinking: true },
      { id: 'gemini-4-argon', label: 'Reasoning', requiresThinking: true },
    ],
  },
};
