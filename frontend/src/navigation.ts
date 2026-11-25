import type { JobHistoryItem, JobResultResponse, JobStatusResponse } from "./types";

export const PAGES = [
  "Dashboard",
  "Data Profiling",
  "ECP Cleaning",
  "Audit Log",
  "Data Transformation",
  "Machine Learning",
  "Visual Analytics",
  "Performance",
  "Reports & Downloads",
  "Job History",
] as const;

export type Page = (typeof PAGES)[number];

export const PAGE_DESCRIPTIONS: Record<Page, string> = {
  "Dashboard": "Overview, upload and pipeline status",
  "Data Profiling": "Structure and quality of the uploaded data",
  "ECP Cleaning": "The seven ECP stages and what each one changed",
  "Audit Log": "Every change, with old value, new value and reason; rows for review",
  "Data Transformation": "Feature engineering applied after cleaning",
  "Machine Learning": "Model selection and evaluation",
  "Visual Analytics": "Charts of the data before and after cleaning",
  "Performance": "Time spent in each processing stage",
  "Reports & Downloads": "Cleaned data, logs, side tables and the PDF report",
  "Job History": "All processing jobs",
};

/** What every result page receives. */
export interface ResultPageProps {
  selectedJob?: JobHistoryItem;
  jobStatus: JobStatusResponse | null;
  results: JobResultResponse | null;
  onDownload: (artifact: string, jobId?: string) => Promise<void>;
  onNavigate: (page: Page) => void;
}
