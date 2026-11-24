export type JobStatus = "queued" | "processing" | "completed" | "failed";

export interface JobHistoryItem {
  job_id: string;
  filename: string;
  status: JobStatus;
  created_at: string;
  updated_at: string;
  duration_ms?: number;
  quality_score?: number;
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

export interface JobResultResponse {
  job_id: string;
  status: JobStatus;
  profile: Record<string, unknown> | null;
  cleaning: Record<string, unknown> | null;
  transformation: Record<string, unknown> | null;
  machine_learning: Record<string, unknown> | null;
  visualizations: Record<string, unknown> | null;
  report_available: boolean;
  download_links: Record<string, string>;
}
