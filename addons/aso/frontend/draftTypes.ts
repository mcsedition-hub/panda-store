export const fields = [
  ['name', 'App name', 30],
  ['subtitle', 'Subtitle', 30],
  ['keywords', 'Keywords', 100],
  ['description', 'Description', 4000],
  ['promotional_text', 'Promotional text', 170],
] as const;
export type Field = (typeof fields)[number][0];
export type Content = Partial<Record<Field, string>>;
export interface DraftSummary {
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
    check: { title: string; observation: string; sources: { url: string; title: string }[] };
  }[];
  validation: {
    can_mark_ready: boolean;
    blocking: string[];
    checks: { id: string; field: Field; status: string; observation: string; action: string }[];
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
export interface DraftSeed {
  audit_id: string;
  check_id: string;
  name: string;
}
export const when = (value: string) =>
  new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
