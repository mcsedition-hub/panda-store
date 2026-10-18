import { t } from '../i18n';
import { useEffect, useSyncExternalStore } from 'react';
import { api, ApiError } from '../api';
import type { WorkflowSnapshot } from '../workflows/types';
import { useLanguage } from '../i18n';
import {
  dismiss,
  finishWork,
  getNotices,
  getWork,
  notify,
  subscribe,
  type Notice,
  type TrackedWork,
} from './store';

function Toast({ notice }: { notice: Notice }) {
  useEffect(() => {
    if (notice.kind === 'error') return;
    const timer = setTimeout(() => dismiss(notice.id), 7000);
    return () => clearTimeout(timer);
  }, [notice.id, notice.kind]);
  return (
    <div className={`notification notification-${notice.kind}`}>
      <span className="notification-symbol" aria-hidden="true">
        {notice.kind === 'success' ? '✓' : notice.kind === 'error' ? '!' : '·'}
      </span>
      <p role={notice.kind === 'error' ? 'alert' : 'status'}>{t(notice.message)}</p>
      <button aria-label={t('Dismiss notification')} onClick={() => dismiss(notice.id)}>
        ×
      </button>
    </div>
  );
}

function WorkWatcher({ job }: { job: TrackedWork }) {
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    const controller = new AbortController();
    async function check() {
      try {
        const next = await api<WorkflowSnapshot>(
          `/api/workspaces/${job.workspaceId}/workflows/${job.id}/`,
          { signal: controller.signal, feedback: false },
        );
        if (!active || !getWork().some((item) => item.id === job.id)) return;
        failures = 0;
        dismiss(`tracking:${job.id}`);
        if (['succeeded', 'failed', 'canceled'].includes(next.status)) {
          notify(
            next.status === 'failed' ? 'error' : next.status === 'succeeded' ? 'success' : 'info',
            next.status === 'failed'
              ? t('{0} failed. {1}', t(next.title), t(next.error))
              : t(next.status === 'succeeded' ? '{0} completed.' : '{0} stopped.', t(next.title)),
            `workflow:${job.id}`,
          );
          finishWork(job.id);
          return;
        }
      } catch (error) {
        if (!active) return;
        if (error instanceof ApiError && [401, 403, 404].includes(error.status)) {
          notify(
            'error',
            'Task updates are unavailable. Check your session and workspace access.',
            `access:${job.workspaceId}`,
          );
          finishWork(job.id);
          return;
        }
        failures += 1;
        if (failures === 3)
          notify(
            'error',
            'Live task updates are interrupted. Reconnecting; the task may still be running.',
            `tracking:${job.id}`,
          );
      }
      if (active) timer = setTimeout(check, failures ? 10000 : 3000);
    }
    void check();
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [job]);
  return null;
}

export default function Notifications() {
  useLanguage();
  const notices = useSyncExternalStore(subscribe, getNotices);
  const work = useSyncExternalStore(subscribe, getWork);
  return (
    <>
      {work.map((job) => (
        <WorkWatcher key={job.id} job={job} />
      ))}
      <aside className="notifications" aria-label={t('Notifications')}>
        {notices.map((notice) => (
          <Toast key={notice.id} notice={notice} />
        ))}
      </aside>
    </>
  );
}
