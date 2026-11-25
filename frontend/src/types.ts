export type JobStatus = "queued" | "processing" | "completed" | "failed";

export interface JobHistoryItem {
  job_id: string;
  filename: string;
  status: JobStatus;
  created_at: string;
  updated_at: string;
  progress?: number;
  error_message?: string | null;
  rows?: number | null;
  quality_before?: number | null;
  quality_after?: number | null;
  duration_ms?: number | null;
}

export interface JobStatusResponse {
  job_id: string;
  status: JobStatus;
  progress: number;
  progress_message?: string | null;
  error_message?: string | null;
  created_at: string;
  updated_at: string;
}

export interface StageTiming {
  stage: string;
  started_at: string;
  duration_ms: number;
  peak_memory_bytes: number;
  rows_processed: number;
}

// ─── Profile ──────────────────────────────────────────────────────────────────
export interface Profile {
  rows: number;
  columns: number;
  data_types: Record<string, string>;
  missing_values: Record<string, number>;
  duplicate_rows: number;
  quality_score: number;
  quality_method?: string;
  numeric_summary: Record<string, Record<string, number>>;
  categorical_summary?: Record<string, Record<string, number>>;
  unusual_numeric_values: Record<string, number>;
}

// ─── ECP cleaning ─────────────────────────────────────────────────────────────
export interface EcpStage {
  stage: string;
  name: string;
  status: "completed" | "skipped";
  reason?: string;
  duration_ms?: number;
  rows_in?: number;
  rows_out?: number;
  cells_changed?: number;
  rows_moved_or_removed?: number;
  rows_flagged?: number;
  actions?: Record<string, number>;
}

export interface DependencyRule {
  rule: string;
  support: number | null;
  groups_tested: number;
  accepted: boolean;
  filled: number;
  fixed: number;
}

export interface ValidationCheck {
  check: string;
  passed: boolean;
  failures: number;
  detail: string;
}

export interface AuditEntry {
  stage: string;
  row: number;
  column: string | null;
  action: string;
  old_value: unknown;
  new_value: unknown;
  reason: string;
}

export interface ReviewEntry {
  stage: string;
  row: number;
  column: string | null;
  issue: string;
  value: unknown;
  reason: string;
  [column: string]: unknown;
}

export interface UncertainCase {
  stage?: string;
  column: string | null;
  issue: string;
  rows?: number;
  missing_ratio?: number;
  reason: string;
}

export interface InvoiceTotals {
  invoices: number;
  invoices_changed_over_1pct: number;
  sales_value_before: number;
  sales_value_after: number;
  value_added_by_price_fills: number;
  note: string;
}

export interface CleaningResult {
  /** "ECP" for jobs processed by the ECP pipeline; missing for older jobs. */
  engine?: string;
  mode?: "retail" | "generic";
  mode_reason?: string;
  column_mapping?: Record<string, string>;
  stages?: EcpStage[];
  stage_details?: Record<string, Record<string, unknown>>;
  rows?: {
    input: number;
    sales_output: number;
    moved: Record<string, number>;
    flagged_for_review: number;
  };
  cells_changed?: number;
  dependency_rules?: DependencyRule[];
  validation?: ValidationCheck[];
  invoice_totals?: InvoiceTotals | null;
  uncertain_cases?: UncertainCase[];
  audit_log_total?: number;
  audit_log_sample?: AuditEntry[];
  review_total?: number;
  review_sample?: ReviewEntry[];
  before_after_quality: { before: number; after: number; change: number };
}

// ─── Transformation ───────────────────────────────────────────────────────────
export interface TransformStep {
  step: string;
  column?: string;
  columns?: string[];
  feature?: string;
  features?: string[];
  reason?: string;
}

export interface TransformationResult {
  steps: TransformStep[];
  target_column: string | null;
  columns_after_transformation?: string[];
}

// ─── Machine learning ─────────────────────────────────────────────────────────
export interface ModelEvaluation {
  model: string;
  accuracy?: number | null;
  precision?: number | null;
  recall?: number | null;
  f1?: number | null;
  mcc?: number | null;
  roc_auc?: number | null;
  confusion_matrix?: number[][];
  rmse?: number | null;
  mae?: number | null;
  r2_score?: number | null;
}

export interface WinningModel extends ModelEvaluation {
  roc_curve?: { fpr: number[]; tpr: number[] } | null;
  actual_vs_predicted?: { actual: number[]; predicted: number[] };
}

export interface MLResult {
  mode: "classification" | "regression" | "unsupervised" | "none";
  reason?: string;
  target?: string;
  rows_used?: number;
  rows_available?: number;
  classes?: string[];
  averaging?: string;
  selection_metric?: string;
  test_rows?: number;
  evaluations?: ModelEvaluation[];
  winner?: WinningModel | null;
  feature_importance?: { feature: string; importance: number }[];
  algorithm?: string;
  features?: string[];
  clusters?: number;
  k_scores?: Record<string, number>;
  silhouette_score?: number;
  cluster_sizes?: number[];
  cluster_profiles?: { columns: string[]; means: (number | null)[][] };
  anomaly_detection?: { algorithm: string; anomalies: number; share?: number };
}

// ─── Visualisations ───────────────────────────────────────────────────────────
export interface Visualizations {
  missing_values?: { columns: string[]; before: number[]; after: number[]; rows_before: number; rows_after: number };
  quality_comparison?: { before: number; after: number; change: number };
  unusual_values?: { method: string; columns: string[]; counts: number[] };
  cleaning_summary?: { labels: string[]; cells_changed: number[]; rows_moved_or_removed: number[]; rows_flagged: number[] };
  correlation?: { columns: string[]; matrix: (number | null)[][] } | null;
  distributions?: Record<string, { edges: number[]; counts: number[]; excluded_extremes: number }>;
}

export interface JobResultResponse {
  job_id: string;
  status: JobStatus;
  profile: Profile | null;
  cleaning: CleaningResult | null;
  transformation: TransformationResult | null;
  machine_learning: MLResult | null;
  visualizations: Visualizations | null;
  report_available: boolean;
  download_links: Record<string, string>;
}
