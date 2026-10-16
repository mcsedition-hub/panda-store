let csrfToken = '';
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
  const response = await fetch(path, {
    ...options,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken, ...options.headers },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(
      data ? errorText(data.error ?? data) : `Service unavailable (${response.status}).`,
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

export function moduleUrl(workspaceId: string, moduleId: string, suffix = '') {
  return `/api/workspaces/${workspaceId}/${moduleId}/${suffix}`;
}
