export type Notice = { id: string; kind: 'success' | 'error' | 'info'; message: string };
export type TrackedWork = { id: string; workspaceId: string };
let notices: Notice[] = [];
let work: TrackedWork[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
export const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const getNotices = () => notices;
export const getWork = () => work;
export function notify(kind: Notice['kind'], message: string, id: string = crypto.randomUUID()) {
  if (!message || notices.some((item) => item.id === id)) return;
  notices = [...notices, { id, kind, message }].slice(-5);
  emit();
}
export function dismiss(id: string) {
  if (!notices.some((item) => item.id === id)) return;
  notices = notices.filter((item) => item.id !== id);
  emit();
}
export function trackWork(workspaceId: string, id: string) {
  if (work.some((item) => item.id === id)) return;
  work = [...work, { workspaceId, id }];
  emit();
}
export function finishWork(id: string) {
  work = work.filter((item) => item.id !== id);
  emit();
}
export function clearNotifications() {
  notices = [];
  work = [];
  emit();
}
