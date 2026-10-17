let csrfToken = '';
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export function setCsrfToken(token: string) {
  csrfToken = token;
}

function errorText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(errorText).join(' ');
  if (value && typeof value === 'object') return Object.values(value).map(errorText).join(' ');
  return 'The request could not be completed. Please try again.';
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (!path.startsWith('/api/')) throw new Error('Invalid API path.');
  // An explicit local visual preview uses fictional, read-only fixtures.
  // Vite removes this branch and its dynamic import from production builds.
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('preview') === '1') {
    const { previewApi } = await import('./preview/api');
    return previewApi<T>(path, options);
  }
  const response = await fetch(path, {
    ...options,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken, ...options.headers },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ApiError(
      data ? errorText(data.error ?? data) : `Service unavailable (${response.status}).`,
      response.status,
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

export function moduleUrl(workspaceId: string, moduleId: string, suffix = '') {
  return `/api/workspaces/${workspaceId}/${moduleId}/${suffix}`;
}
