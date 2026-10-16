import { lazy, type ComponentType } from 'react';
import type { ModuleProps } from './contracts';

// Module frontends are bundled at deployment. Server manifests control visibility;
// every backend endpoint independently checks workspace membership and activation.
const files = import.meta.glob<{ default: ComponentType<ModuleProps> }>(
  '../../addons/*/frontend/index.tsx',
);
export const moduleViews = Object.fromEntries(
  Object.entries(files).map(([path, load]) => {
    const id = path.match(/addons\/([^/]+)\/frontend/)![1];
    return [id, lazy(load)];
  }),
);
