export interface AuditView {
  locale: string;
  mode: 'listing' | 'screenshots' | 'project';
  runId: string;
}

export function readAuditView(key: string): AuditView | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (
      value &&
      typeof value.locale === 'string' &&
      typeof value.runId === 'string' &&
      (value.mode === 'listing' || value.mode === 'screenshots' || value.mode === 'project')
    )
      return value;
  } catch {
    /* History remains available from the server without browser storage. */
  }
  return null;
}

export function saveAuditView(key: string, value: AuditView) {
  try {
    // Keep only navigation state here; audit results stay on the server.
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Browsers can disable storage in private sessions. */
  }
}
