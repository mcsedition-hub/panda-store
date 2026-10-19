import { getLocale } from '../../../web/src/i18n';
export const fields = [
  ['name', 'App name', 30],
  ['subtitle', 'Subtitle', 30],
  ['promotional_text', 'Hook (promotional text)', 170],
  ['description', 'Description', 4000],
  ['keywords', 'Keywords', 100],
] as const;
export const googleFields = [
  ['name', 'App name', 30],
  ['short_description', 'Short description', 80],
  ['description', 'Description', 4000],
] as const;
export const listingFields = (platform?: string) =>
  platform === 'android' ? googleFields : fields;
export type Field = (typeof fields)[number][0] | (typeof googleFields)[number][0];
export type Content = Partial<Record<Field, string>>;
export interface DraftSummary {
  platform?: 'ios' | 'android';
  id: string;
  name: string;
  locale: string;
  status: 'draft' | 'ready';
  version: number;
  updated_at: string;
  created_at: string;
}
export interface Draft extends DraftSummary {
  content: Content;
  baseline: Content;
  snapshot_id: string;
  captured_at: string;
  is_demo: boolean;
  changed_fields: Field[];
  provenance: {
    audit_id: string;
    provider?: string;
    model?: string;
    created_at?: string;
    snapshot_id?: string;
    locale?: string;
    check: {
      title: string;
      observation: string;
      sources: { url: string; title: string; publisher?: string }[];
    };
  }[];
  validation: {
    can_mark_ready: boolean;
    blocking: string[];
    checks: {
      id: string;
      field: Field;
      status: string;
      observation: string;
      action: string;
    }[];
  };
  latest: {
    snapshot_id: string | null;
    captured_at: string | null;
    content: Content | null;
    changed_since_baseline: Field[];
    matching_fields: Field[];
    all_changes_match: boolean;
  };
}
export interface Revision {
  version: number;
  name: string;
  content: Content;
  status: string;
  reason: string;
  author: string;
  created_at: string;
}
export interface ComparisonSelection {
  field: Field;
  audit_id: string;
  check_id: string;
}
export type DraftSeed = { name: string } & (
  | { audit_id: string; check_id: string; comparison?: never }
  | {
      audit_id?: never;
      check_id?: never;
      comparison: { base_audit_id: string; selections: ComparisonSelection[] };
    }
);
export const when = (value: string) =>
  new Date(value).toLocaleString(getLocale(), {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
