export interface UsageTotals {
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  reasoning_tokens: number;
  tokens: number;
  cost_usd: string | number;
  reserved_usd: string | number;
  reserved_tokens: number;
  pending: number;
  unknown: number;
  unpriced: number;
  historical: number;
  historical_unpriced: number;
}
export interface Budget {
  revision: string;
  tracking_started_at: string;
  monthly_usd: string | null;
  operation_usd: string | null;
  monthly_tokens: number | null;
  operation_tokens: number | null;
}
export interface UsageCall {
  id: string;
  operation_key: string;
  label: string;
  module: string;
  app_name: string;
  provider: string;
  model: string;
  resolved_model: string;
  status: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cached_tokens: number | null;
  cache_write_tokens: number | null;
  reasoning_tokens: number | null;
  cost_usd: string | null;
  reserved_usd: string | null;
  reserved_tokens: number;
  created_at: string;
  historical: boolean;
  reconciled_at: string | null;
  can_reconcile: boolean;
  error_code: string;
  price: { source?: string; verified_at?: string };
}
export interface UsageDashboardData {
  months?: string[];
  month: string;
  summary: UsageTotals;
  current_month: UsageTotals;
  alerts: string[];
  budget: Budget;
  prices_verified_at: string;
  sources: Record<string, string>;
  apps: { id: string; name: string }[];
  by_provider: (UsageTotals & { provider: string })[];
  by_app: (UsageTotals & { app_id: string; app_name: string })[];
  operations: (UsageTotals & {
    key: string;
    label: string;
    app_name: string;
    module: string;
    last_at: string;
  })[];
  operation_count: number;
  calls: UsageCall[];
  next_offset: number | null;
}
