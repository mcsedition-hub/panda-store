import { useSyncExternalStore } from 'react';
import french from './fr.json';
import serverTemplates from './serverTemplates.json';

export type Language = 'en' | 'fr';
const storageKey = 'panda.language';
const messages: Record<string, string> = french;
const listeners = new Set<() => void>();
function initialLanguage(): Language {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === 'en' || saved === 'fr') return saved;
  } catch {
    /* Browser storage can be unavailable in private sessions. */
  }
  return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('fr')
    ? 'fr'
    : 'en';
}
let language = initialLanguage();
export const getLanguage = () => language;
export const getLocale = () => (language === 'fr' ? 'fr-FR' : 'en-US');
export function setLanguage(next: Language) {
  if (next !== 'en' && next !== 'fr') return;
  language = next;
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  try {
    localStorage.setItem(storageKey, next);
  } catch {
    /* Keep the in-memory choice. */
  }
  listeners.forEach((listener) => listener());
}
export function useLanguage() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getLanguage,
    () => 'en' as Language,
  );
}
if (typeof document !== 'undefined') document.documentElement.lang = language;
if (typeof window !== 'undefined')
  window.addEventListener('storage', (event) => {
    if (event.key === storageKey && (event.newValue === 'en' || event.newValue === 'fr')) {
      language = event.newValue;
      document.documentElement.lang = language;
      listeners.forEach((listener) => listener());
    }
  });

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patterns = Object.entries(messages)
  .filter(([key]) => serverTemplates.includes(key))
  // Prefer complete server messages over short, generic templates.
  .sort(([a], [b]) => b.replace(/\{\d+\}/g, '').length - a.replace(/\{\d+\}/g, '').length)
  .map(([key, value]) => {
    const slots: number[] = [];
    const parts = key.split(/(\{\d+\})/);
    const pattern = parts
      .map((part) => {
        if (!/^\{\d+\}$/.test(part)) return escape(part);
        slots.push(Number(part.slice(1, -1)));
        return '([\\s\\S]*?)';
      })
      .join('');
    return { pattern: new RegExp(`^${pattern}$`), value, slots };
  });
const interpolate = (value: string, args: unknown[]) =>
  value.replace(/\{(\d+)\}/g, (match, index) =>
    args[Number(index)] == null ? match : String(args[Number(index)]),
  );

/** Translate interface text only. Imported, user-written and AI-generated content stays intact. */
export function t(source: string | null | undefined, ...args: unknown[]): string {
  if (!source) return '';
  if (language === 'en') return interpolate(source, args);
  const key = source.replace(/\s+/g, ' ').trim();
  let translated = Object.hasOwn(messages, key) ? messages[key] : undefined;
  if (!translated && !args.length) {
    for (const item of patterns) {
      const found = item.pattern.exec(key);
      if (found) {
        const values: string[] = [];
        item.slots.forEach((slot, index) => {
          values[slot] = found[index + 1];
        });
        translated = interpolate(item.value, values);
        break;
      }
    }
  }
  if (!translated) return interpolate(source, args);
  return `${source.match(/^\s*/)?.[0] ?? ''}${interpolate(translated, args)}${source.match(/\s*$/)?.[0] ?? ''}`;
}
