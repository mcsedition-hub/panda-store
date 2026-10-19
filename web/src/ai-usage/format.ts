import { getLocale, t } from '../i18n';
export const money = (value: number | string | null) => {
  if (value === null) return t('Unknown');
  const amount = Number(value);
  const format = new Intl.NumberFormat(getLocale(), {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return amount > 0 && amount < 0.01 ? `< ${format.format(0.01)}` : format.format(amount);
};
export const count = (value: number | null) =>
  value === null ? t('Unknown') : value.toLocaleString(getLocale());
export const providerNames: Record<string, string> = {
  openai: 'OpenAI',
  google: 'Google Gemini',
  anthropic: 'Anthropic Claude',
  zai: 'Z.ai (GLM)',
};
