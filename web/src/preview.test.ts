import { expect, it } from 'vitest';
import { previewApi } from './preview/api';
import type { MobileApp, Run, Workspace } from './contracts';

it('shows fictional apps and script samples with a read-only workspace', async () => {
  const [workspace] = await previewApi<Workspace[]>('/api/workspaces/');
  expect(workspace.role).toBe('viewer');
  const base = `/api/workspaces/${workspace.id}/`;
  const apps = await previewApi<MobileApp[]>(`${base}app_catalog/apps/`);
  expect(apps.every((app) => app.is_demo)).toBe(true);
  for (const app of apps) {
    const [run] = await previewApi<Run[]>(`${base}studio/apps/${app.id}/runs/`);
    expect(run.creatives).toHaveLength(3);
  }
});

it('rejects mutations and unknown routes without falling through to a real server', async () => {
  await expect(previewApi('/api/workspaces/', { method: 'POST' })).rejects.toThrow('read-only');
  await expect(previewApi('/api/unknown/')).rejects.toThrow('not part of the visual preview');
});
