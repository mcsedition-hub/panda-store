export type WorkflowStatus =
  'queued' | 'running' | 'canceling' | 'succeeded' | 'failed' | 'canceled';
export interface WorkflowEvent {
  sequence: number;
  step_key: string;
  kind: string;
  message: string;
  created_at: string;
}
export interface WorkflowSnapshot {
  id: string;
  title: string;
  status: WorkflowStatus;
  error: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  heartbeat_at: string | null;
  retry_of: string | null;
  cursor: number;
  has_more: boolean;
  events: WorkflowEvent[];
  steps: {
    id: string;
    key: string;
    title: string;
    kind: string;
    depends_on: string[];
    status: Exclude<WorkflowStatus, 'canceling'> | 'skipped';
    summary: string;
    started_at: string | null;
    completed_at: string | null;
    reused_from_id: string | null;
  }[];
}
