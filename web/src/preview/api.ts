import catalogModule from '../../../addons/app_catalog/module.json';
import connectionsModule from '../../../addons/apple_store/module.json';
import studioModule from '../../../addons/studio/module.json';
import exampleModule from '../../../addons/example/module.json';
import demoCatalog from '../../../addons/apple_store/fixtures/apps.json';
import sampleRuns from './scripts.json';

// Only this explicit development preview reads these fictional fixtures.
// It never reads browser credentials, sends network requests or writes data.
const workspace = { id: 'preview-workspace', name: 'Panda workshop', role: 'viewer' };
const prefix = `/api/workspaces/${workspace.id}/`;
const capturedAt = '2026-10-16T12:00:00Z';
const apps = demoCatalog.map((metadata) => ({
  id: metadata.external_id,
  name: metadata.name,
  platform: metadata.platform,
  bundle_id: metadata.bundle_id,
  external_id: metadata.external_id,
  is_demo: true,
  metadata: {
    id: `snapshot-${metadata.external_id}`,
    data: metadata,
    source: 'visual-preview',
    captured_at: capturedAt,
  },
}));

export async function previewApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  if ((options.method ?? 'GET').toUpperCase() !== 'GET') {
    throw new Error('This visual preview is read-only.');
  }
  let result: unknown;
  if (path === '/api/session/') {
    result = {
      user: { id: 'preview-user', username: 'Explorer' },
      csrf_token: '',
      demo_mode: true,
      preview_mode: true,
    };
  } else if (path === '/api/workspaces/') {
    result = [workspace];
  } else if (path === `${prefix}modules/`) {
    result = [catalogModule, connectionsModule, studioModule, exampleModule].map((module) => ({
      ...module,
      required: 'required' in module && module.required,
      enabled: true,
    }));
  } else if (path === `${prefix}app_catalog/apps/`) {
    result = apps;
  } else if (path === `${prefix}apple_store/catalog/`) {
    result = { mode: 'demo', apps: demoCatalog };
  } else if (path === `${prefix}example/hello/`) {
    result = { message: 'This example uses the same module contract as every built-in tool.' };
  } else {
    const sample = sampleRuns.find((item) =>
      path.startsWith(`${prefix}studio/apps/${item.app_id}/`),
    );
    if (!sample) throw new Error('This page is not part of the visual preview.');
    if (path === `${prefix}studio/apps/${sample.app_id}/brief/`) result = sample.brief;
    else if (path === `${prefix}studio/apps/${sample.app_id}/runs/`) result = [sample.run];
    else throw new Error('This page is not part of the visual preview.');
  }
  return structuredClone(result) as T;
}
