import { clearNotifications, notify, trackWork } from './notifications/store';

let csrfToken = '';
export type ApiOptions = RequestInit & {
  feedback?: { success?: string; error?: string } | false;
  responseFormat?: 'json' | 'blob';
};
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

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  if (!path.startsWith('/api/')) throw new Error('Invalid API path.');
  // An explicit local visual preview uses fictional, read-only fixtures.
  // Vite removes this branch and its dynamic import from production builds.
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('preview') === '1') {
    const { previewApi } = await import('./preview/api');
    return previewApi<T>(path, options);
  }
  const { feedback, responseFormat, ...request } = options;
  const mutation = !['GET', 'HEAD'].includes((request.method || 'GET').toUpperCase());
  const announce = feedback !== false && (mutation || !!feedback);
  try {
    const response = await fetch(path, {
      ...request,
      credentials: 'same-origin',
      headers: {
        ...(request.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        'X-CSRFToken': csrfToken,
        ...options.headers,
      },
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new ApiError(
        data ? errorText(data.error ?? data) : `Service unavailable (${response.status}).`,
        response.status,
      );
    }
    const result =
      response.status === 204
        ? undefined
        : responseFormat === 'blob'
          ? await response.blob()
          : await response.json();
    if (path === '/api/session/logout/') clearNotifications();
    if (mutation && typeof result?.workflow_id === 'string') {
      const workspaceId = path.match(/^\/api\/workspaces\/([^/]+)\//)?.[1];
      if (workspaceId) trackWork(workspaceId, result.workflow_id);
    }
    if (announce)
      notify(
        'success',
        feedback
          ? (feedback.success ?? 'Changes saved.')
          : result?.workflow_id
            ? 'Task started.'
            : 'Changes saved.',
      );
    return result as T;
  } catch (caught) {
    if (request.signal?.aborted || (caught instanceof DOMException && caught.name === 'AbortError'))
      throw caught;
    const error =
      caught instanceof ApiError
        ? caught
        : new ApiError(
            caught instanceof SyntaxError
              ? 'The server returned an unreadable response. Reload to check whether your action was saved.'
              : mutation
                ? 'The action could not be confirmed. Check your connection and reload the saved state before retrying.'
                : 'Cannot reach Panda Store. Check your connection and server, then try again.',
            0,
          );
    if (announce)
      notify(
        'error',
        feedback && feedback.error ? `${feedback.error} ${error.message}` : error.message,
        `request:${path}:${error.message}`,
      );
    throw error;
  }
}

export function moduleUrl(workspaceId: string, moduleId: string, suffix = '') {
  return `/api/workspaces/${workspaceId}/${moduleId}/${suffix}`;
}

export async function download(path: string, filename: string) {
  const blob = await api<Blob>(path, { responseFormat: 'blob', feedback: { success: '' } });
  let url: string | undefined;
  let link: HTMLAnchorElement | undefined;
  try {
    url = URL.createObjectURL(blob);
    link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    notify('success', 'Export prepared. Download started.');
  } catch {
    const message =
      'The export was prepared but the browser could not start the download. Try again.';
    notify('error', message);
    throw new ApiError(message, 0);
  } finally {
    link?.remove();
    if (url) setTimeout(() => URL.revokeObjectURL(url!), 1000);
  }
}
