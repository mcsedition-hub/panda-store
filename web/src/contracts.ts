export interface Session {
  user: { id: string; username: string } | null;
  csrf_token: string;
  demo_mode: boolean;
  setup_required: boolean;
  preview_mode?: boolean;
}

export interface Workspace {
  id: string;
  name: string;
  role: 'owner' | 'editor' | 'viewer';
}
export interface ModuleInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  enabled: boolean;
  required: boolean;
  availability?: 'available' | 'planned';
  family: 'frost' | 'coral' | 'lichen';
  icon: string;
  depends: Record<string, string>;
  capabilities: string[];
}
export interface AppMetadata {
  name: string;
  external_id: string;
  bundle_id: string;
  platform: string;
  subtitle: string;
  description: string;
  category: string;
  locale: string;
  version: string;
  features: string[];
  audience: string;
  source_note: string;
  icon_url?: string;
  keywords?: string;
  version_state?: string;
  screenshots_locale?: string;
  screenshots?: { url: string; name: string; display_type: string }[];
  localizations?: {
    locale: string;
    name: string;
    subtitle: string;
    description: string;
    keywords: string;
    promotional_text: string;
    whats_new: string;
  }[];
}
export interface MobileApp {
  id: string;
  name: string;
  platform: string;
  bundle_id: string;
  external_id: string;
  is_demo: boolean;
  sync_provider?: string;
  last_synced_at?: string | null;
  last_sync_error?: string;
  metadata: { id: string; data: AppMetadata; source: string; captured_at: string } | null;
}
export interface ModuleProps {
  workspace: Workspace;
  apps: MobileApp[];
  selectedApp: MobileApp | null;
  selectApp: (app: MobileApp) => void;
  navigate: (module: string, appId?: string) => void;
  detailAppId?: string;
  availableModules?: string[];
  refreshApps: () => Promise<void>;
  demoMode: boolean;
  previewMode?: boolean;
}
export interface Creative {
  id: string;
  variant: number;
  angle: string;
  hook: string;
  script: string;
  cta: string;
  approved: boolean;
  updated_at: string;
}
export interface Run {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceling' | 'canceled';
  workflow_id?: string | null;
  provider: string;
  error: string;
  created_at: string;
  completed_at: string | null;
  creatives: Creative[];
}
export interface Brief {
  audience: string;
  goal: string;
  tone: string;
}
