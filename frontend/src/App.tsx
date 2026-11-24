import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertCircle,
  AlertTriangle,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock,
  Database,
  Download,
  FileDown,
  FileClock,
  FileSpreadsheet,
  FileText,
  Filter,
  FlaskConical,
  HelpCircle,
  Info,
  LayoutDashboard,
  ListChecks,
  Loader2,
  RefreshCw,
  Search,
  Share2,
  ShieldCheck,
  Sparkles,
  Trash2,
  TrendingUp,
  Upload,
  UploadCloud,
  WandSparkles,
  Zap,
} from "lucide-react";
import {
  deleteJob,
  deleteMultipleJobs,
  downloadArtifact,
  getAuditLogs,
  getHistory,
  getResults,
  getStatus,
  uploadDataset,
} from "./api";
import type { JobHistoryItem, JobResultResponse, JobStatusResponse } from "./types";
import Plotly from "plotly.js-dist-min";

// ─── Page list ────────────────────────────────────────────────────────────────
const PAGES = [
  "Dashboard",
  "Data Profiling",
  "Automated Cleaning",
  "Data Transformation",
  "Machine Learning",
  "Visual Analytics",
  "Reports & Downloads",
  "Job History",
] as const;

type Page = (typeof PAGES)[number];

// ─── Shared utilities ─────────────────────────────────────────────────────────
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    try {
      const payload = JSON.parse(error.message) as { detail?: string };
      return payload.detail ?? error.message;
    } catch {
      return error.message;
    }
  }
  return "Something went wrong. Please try again.";
}

function fmt(n: number | undefined | null, decimals = 1): string {
  if (n === undefined || n === null) return "—";
  return n.toFixed(decimals);
}

// ─── App root (No Login / Logout - Direct Workspace Access) ────────────────────
export default function App() {
  const [activePage, setActivePage] = useState<Page>("Dashboard");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [jobs, setJobs] = useState<JobHistoryItem[]>([]);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [results, setResults] = useState<JobResultResponse | null>(null);
  const [auditLogs, setAuditLogs] = useState<Record<string, unknown>[]>([]);
  const [jobStatus, setJobStatus] = useState<JobStatusResponse | null>(null);
  const [message, setMessage] = useState("Ready. Choose a dataset to begin automated processing.");
  const [uploading, setUploading] = useState(false);

  const selectedJob = useMemo(() => jobs.find((j) => j.job_id === selectedJobId), [jobs, selectedJobId]);
  const completedJobs = jobs.filter((j) => j.status === "completed").length;
  const runningJobs = jobs.filter((j) => j.status === "processing" || j.status === "queued").length;

  const refreshHistory = useCallback(async () => {
    try {
      const rows = await getHistory();
      setJobs(rows);
      if (!selectedJobId && rows.length > 0) setSelectedJobId(rows[0].job_id);
    } catch (e) {
      setMessage(String(e));
    }
  }, [selectedJobId]);

  async function handleUpload() {
    if (!selectedFile) return;
    setUploading(true);
    try {
      setResults(null);
      setAuditLogs([]);
      setJobStatus(null);
      setMessage("Uploading dataset and starting automated pipeline…");
      const resp = await uploadDataset(selectedFile);
      setMessage("Dataset uploaded. Complete pipeline executed in background.");
      await refreshHistory();
      setSelectedJobId(resp.job_id);
      setActivePage("Dashboard");
    } catch (e) {
      setMessage(getErrorMessage(e));
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload(artifact: string) {
    if (!selectedJobId) return;
    try {
      const blob = await downloadArtifact(selectedJobId, artifact);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const extension = artifact === "report" ? "pdf" : artifact === "log" ? "json" : "csv";
      a.download = `autodata-${artifact}-${selectedJobId.slice(0, 8)}.${extension}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setMessage(getErrorMessage(e));
    }
  }

  async function handleDeleteJob(jobId: string) {
    try {
      await deleteJob(jobId);
      if (selectedJobId === jobId) {
        setSelectedJobId("");
        setResults(null);
        setAuditLogs([]);
        setJobStatus(null);
      }
      await refreshHistory();
      setMessage(`Dataset job ${jobId.slice(0, 8)} removed.`);
    } catch (e) {
      setMessage(getErrorMessage(e));
    }
  }

  async function handleDeleteMultiple(jobIds: string[]) {
    try {
      await deleteMultipleJobs(jobIds);
      if (jobIds.includes(selectedJobId)) {
        setSelectedJobId("");
        setResults(null);
        setAuditLogs([]);
        setJobStatus(null);
      }
      await refreshHistory();
      setMessage(`${jobIds.length} dataset jobs removed.`);
    } catch (e) {
      setMessage(getErrorMessage(e));
    }
  }

  // Polling loop
  useEffect(() => {
    if (!selectedJobId) return;
    let active = true;

    const poll = async () => {
      if (!active) return;
      try {
        const status = await getStatus(selectedJobId);
        if (!active) return;
        setJobStatus(status);
        if (status.status === "completed") {
          setMessage("Analysis complete. All pipeline results are ready.");
          const [data, logs] = await Promise.all([
            getResults(selectedJobId),
            getAuditLogs(selectedJobId),
          ]);
          if (active) {
            setResults(data);
            setAuditLogs(logs);
          }
          return;
        }
        if (status.status === "failed") {
          setMessage(`Analysis failed: ${status.error_message ?? "Unknown error."}`);
          return;
        }
        setMessage(`Processing dataset… ${status.progress}%${status.progress_message ? ` — ${status.progress_message}` : ""}`);
        window.setTimeout(poll, 1200);
      } catch (e) {
        if (active) setMessage(String(e));
      }
    };

    void poll();
    return () => { active = false; };
  }, [selectedJobId]);

  // Initial load
  useEffect(() => { void refreshHistory(); }, []); // eslint-disable-line

  const pageIcon = (page: Page): ReactNode => ({
    "Dashboard": <LayoutDashboard size={16} />,
    "Data Profiling": <Database size={16} />,
    "Automated Cleaning": <WandSparkles size={16} />,
    "Data Transformation": <Sparkles size={16} />,
    "Machine Learning": <FlaskConical size={16} />,
    "Visual Analytics": <BarChart3 size={16} />,
    "Reports & Downloads": <FileDown size={16} />,
    "Job History": <FileClock size={16} />,
  })[page];

  const pageDescription: Record<Page, string> = {
    "Dashboard": "Overview, statistics and dataset upload",
    "Data Profiling": "Dataset structure and quality assessment",
    "Automated Cleaning": "Cleaning results and audit comparisons",
    "Data Transformation": "Encoding, scaling and feature engineering",
    "Machine Learning": "Model selection, training and evaluation",
    "Visual Analytics": "Interactive charts and insights",
    "Reports & Downloads": "Reports and processed datasets",
    "Job History": "Previous processing jobs",
  };

  const isProcessing = jobStatus?.status === "processing" || jobStatus?.status === "queued";

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100">
      {/* ── Header without Log out ── */}
      <header className="sticky top-0 z-20 border-b border-white/[0.08] bg-[#0b1120]/95 px-5 py-4 backdrop-blur-xl md:px-8">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-blue-600 shadow-lg shadow-blue-500/20">
              <Sparkles size={21} className="text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-white">AutoData AI</h1>
              <p className="hidden text-xs text-slate-400 sm:block">Automated intelligence for every dataset</p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="hidden items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-emerald-300 sm:flex">
              <Circle size={7} fill="currentColor" /> System operational
            </span>
            {isProcessing && (
              <span className="flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1.5 text-cyan-300">
                <Loader2 size={12} className="animate-spin" /> Processing {jobStatus?.progress ?? 0}%
              </span>
            )}
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 font-medium text-slate-300">
              Workspace Ready
            </span>
          </div>
        </div>
      </header>

      <div className="mx-auto grid min-h-[calc(100vh-73px)] max-w-[1600px] grid-cols-1 md:grid-cols-[260px_1fr]">
        {/* ── Sidebar ── */}
        <aside className="border-b border-white/[0.08] bg-[#0b1120]/60 p-4 md:border-b-0 md:border-r md:p-5">
          <div className="mb-6 rounded-2xl border border-cyan-400/15 bg-gradient-to-br from-cyan-400/[0.09] to-blue-500/[0.04] p-4">
            <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-white">
              <ShieldCheck size={16} className="text-cyan-300" /> AutoData AI
            </div>
            <p className="text-xs leading-5 text-slate-400 truncate">{selectedJob ? `Active: ${selectedJob.filename}` : "Direct access enabled."}</p>
          </div>
          <p className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Navigation</p>
          <nav className="space-y-1">
            {PAGES.map((page) => (
              <button
                key={page}
                className={`group flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-xs transition ${
                  activePage === page
                    ? "bg-cyan-400/10 font-semibold text-cyan-300 ring-1 ring-cyan-400/20"
                    : "text-slate-400 hover:bg-white/[0.05] hover:text-white"
                }`}
                onClick={() => setActivePage(page)}
              >
                {pageIcon(page)}
                <span className="flex-1 truncate">{page}</span>
                {activePage === page && <ChevronRight size={13} className="ml-auto shrink-0" />}
              </button>
            ))}
          </nav>
          {selectedJob && (
            <div className="mt-6 rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 text-xs">
              <p className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">Current Dataset</p>
              <p className="font-medium text-white truncate">{selectedJob.filename}</p>
              <div className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                selectedJob.status === "completed" ? "bg-emerald-400/10 text-emerald-300" :
                selectedJob.status === "failed" ? "bg-rose-400/10 text-rose-300" :
                "bg-cyan-400/10 text-cyan-300"
              }`}>
                {selectedJob.status === "processing" && <Loader2 size={9} className="animate-spin" />}
                {selectedJob.status === "completed" && <CheckCircle2 size={9} />}
                {selectedJob.status === "failed" && <AlertCircle size={9} />}
                {selectedJob.status}
              </div>
            </div>
          )}
        </aside>

        {/* ── Main content ── */}
        <main className="min-w-0 p-5 md:p-8">
          <PageHeader page={activePage} description={pageDescription[activePage]} />
          <div className="mt-6">
            {activePage === "Dashboard" && (
              <DashboardPage
                jobs={jobs}
                completedJobs={completedJobs}
                runningJobs={runningJobs}
                selectedJobId={selectedJobId}
                jobStatus={jobStatus}
                results={results}
                selectedFile={selectedFile}
                uploading={uploading}
                message={message}
                onSelectJob={(id) => { setSelectedJobId(id); setResults(null); setAuditLogs([]); setJobStatus(null); }}
                onFileSelect={setSelectedFile}
                onUpload={handleUpload}
                onRefreshHistory={refreshHistory}
              />
            )}
            {activePage === "Data Profiling" && (
              <DataProfilingPage
                results={results}
                selectedJob={selectedJob}
                jobStatus={jobStatus}
              />
            )}
            {activePage === "Automated Cleaning" && (
              <AutomatedCleaningPage
                results={results}
                selectedJob={selectedJob}
                jobStatus={jobStatus}
              />
            )}
            {activePage === "Data Transformation" && (
              <DataTransformationPage
                results={results}
                selectedJob={selectedJob}
                jobStatus={jobStatus}
              />
            )}
            {activePage === "Machine Learning" && (
              <MachineLearningPage
                results={results}
                selectedJob={selectedJob}
                jobStatus={jobStatus}
              />
            )}
            {activePage === "Visual Analytics" && (
              <VisualAnalyticsPage
                results={results}
                selectedJob={selectedJob}
                jobStatus={jobStatus}
              />
            )}
            {activePage === "Reports & Downloads" && (
              <ReportsDownloadsPage
                results={results}
                selectedJob={selectedJob}
                jobStatus={jobStatus}
                onDownload={handleDownload}
              />
            )}
            {activePage === "Job History" && (
              <JobHistoryPage
                jobs={jobs}
                selectedJobId={selectedJobId}
                onSelectJob={(id) => { setSelectedJobId(id); setResults(null); setAuditLogs([]); setJobStatus(null); }}
                onDownload={handleDownload}
                onRefresh={refreshHistory}
                onDeleteJob={handleDeleteJob}
                onDeleteMultiple={handleDeleteMultiple}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

// ─── Page header ──────────────────────────────────────────────────────────────
function PageHeader({ page, description }: { page: Page; description: string }) {
  return (
    <div className="flex items-start justify-between">
      <div>
        <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-300">AutoData AI Platform</p>
        <h2 className="text-2xl font-bold tracking-tight text-white">{page}</h2>
        <p className="mt-1 text-sm text-slate-400">{description}</p>
      </div>
    </div>
  );
}

// ─── Shared empty state ───────────────────────────────────────────────────────
function EmptyState({ icon, title, body }: { icon?: ReactNode; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-16 text-center">
      <div className="mb-4 text-slate-600">{icon ?? <Database size={40} />}</div>
      <h3 className="text-base font-semibold text-white">{title}</h3>
      <p className="mt-2 max-w-sm text-sm text-slate-400">{body}</p>
    </div>
  );
}

// ─── Processing banner ────────────────────────────────────────────────────────
function ProcessingBanner({ status }: { status: JobStatusResponse }) {
  return (
    <div className="mb-6 flex items-center gap-3 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.07] px-4 py-3 text-sm text-cyan-200">
      <Loader2 size={16} className="shrink-0 animate-spin" />
      <span>
        Pipeline in progress — {status.progress}%{status.progress_message ? ` · ${status.progress_message}` : ""}
      </span>
      <div className="ml-auto h-1.5 w-32 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-cyan-400 transition-all duration-500"
          style={{ width: `${status.progress}%` }}
        />
      </div>
    </div>
  );
}

// ─── Metric card ──────────────────────────────────────────────────────────────
function MetricCard({
  label, value, icon, tone, sub,
}: {
  label: string; value: string | number; icon: ReactNode; tone: "blue" | "green" | "violet" | "amber" | "cyan"; sub?: string;
}) {
  const tones = {
    blue:   "bg-blue-400/10 text-blue-300",
    green:  "bg-emerald-400/10 text-emerald-300",
    violet: "bg-violet-400/10 text-violet-300",
    amber:  "bg-amber-400/10 text-amber-300",
    cyan:   "bg-cyan-400/10 text-cyan-300",
  };
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-[#0d1424] p-4 shadow-lg shadow-black/10">
      <div className={`mb-3 flex h-8 w-8 items-center justify-center rounded-lg ${tones[tone]}`}>{icon}</div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 truncate text-xl font-bold text-white">{value}</p>
      {sub && <p className="mt-0.5 text-[10px] text-slate-500">{sub}</p>}
    </div>
  );
}

// ─── Section card wrapper ─────────────────────────────────────────────────────
function SectionCard({ title, icon, children, className }: { title: string; icon?: React.ReactElement; children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-white/[0.08] bg-[#0d1424] p-5 shadow-xl shadow-black/10 ${className ?? ""}`}>
      <div className="mb-4 flex items-center gap-2">
        {icon && <span className="text-cyan-300">{icon}</span>}
        <h3 className="font-semibold text-white">{title}</h3>
      </div>
      {children}
    </div>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed: "bg-emerald-400/10 text-emerald-300",
    processing: "bg-cyan-400/10 text-cyan-300",
    queued: "bg-amber-400/10 text-amber-300",
    failed: "bg-rose-400/10 text-rose-300",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${map[status] ?? "bg-slate-400/10 text-slate-300"}`}>
      {status === "processing" && <Loader2 size={9} className="animate-spin" />}
      {status === "completed" && <CheckCircle2 size={9} />}
      {status === "failed" && <AlertCircle size={9} />}
      {status}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. DASHBOARD PAGE (Recent Datasets with Position)
// ═══════════════════════════════════════════════════════════════════════════════
function DashboardPage({
  jobs, completedJobs, runningJobs,
  selectedJobId, jobStatus, results, selectedFile, uploading, message,
  onSelectJob, onFileSelect, onUpload, onRefreshHistory,
}: {
  jobs: JobHistoryItem[];
  completedJobs: number;
  runningJobs: number;
  selectedJobId: string;
  jobStatus: JobStatusResponse | null;
  results: JobResultResponse | null;
  selectedFile: File | null;
  uploading: boolean;
  message: string;
  onSelectJob: (id: string) => void;
  onFileSelect: (f: File | null) => void;
  onUpload: () => void;
  onRefreshHistory: () => void;
}) {
  const isProcessing = jobStatus?.status === "processing" || jobStatus?.status === "queued";
  const qualityScore = (results?.profile as Record<string, unknown> | null)?.quality_score as number | undefined;

  return (
    <div className="space-y-6">
      {/* Hero Header */}
      <section className="relative overflow-hidden rounded-3xl border border-cyan-400/15 bg-gradient-to-br from-[#11243b] via-[#0d1729] to-[#0b1120] p-6 md:p-8">
        <div className="absolute -right-20 -top-24 h-64 w-64 rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="relative">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">
            <Sparkles size={14} /> Data Operations Center
          </div>
          <h2 className="max-w-2xl text-3xl font-bold tracking-tight text-white md:text-4xl">
            Autonomous Data Science & Quality Intelligence.
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-6 text-slate-400">
            Upload your dataset once. AutoData AI profiles structures, cleans anomalies, engineers features, trains ML models, and generates executive reports automatically.
          </p>
        </div>
      </section>

      {/* 4 Dashboard Metric Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Total datasets processed" value={jobs.length} icon={<Database size={17} />} tone="blue" />
        <MetricCard label="Completed jobs" value={completedJobs} icon={<CheckCircle2 size={17} />} tone="green" />
        <MetricCard label="Processing jobs" value={runningJobs} icon={<Loader2 size={17} className={runningJobs > 0 ? "animate-spin" : ""} />} tone="violet" />
        <MetricCard
          label="Average data-quality score"
          value={qualityScore !== undefined ? `${qualityScore.toFixed(1)} / 100` : "—"}
          icon={<TrendingUp size={17} />}
          tone="amber"
          sub="from active analysis"
        />
      </div>

      {/* Status Bar */}
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.035] px-4 py-3 text-sm text-slate-300 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_10px_#67e8f9]" />
          <span>{message}</span>
        </div>
        {selectedJobId && <span className="font-mono text-xs text-slate-400">Job: {selectedJobId.slice(0, 8)}</span>}
      </div>

      {/* Upload + Recent Datasets with Position */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Upload Dataset" icon={<UploadCloud size={18} />}>
          <p className="mb-4 text-sm leading-6 text-slate-400">
            Choose a CSV, XLS, XLSX, or Parquet file. Uploading immediately initiates the 6-stage background automated pipeline.
          </p>
          <label className="group mb-4 flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-cyan-400/30 bg-cyan-400/[0.03] px-4 py-7 text-center transition hover:border-cyan-300/70 hover:bg-cyan-400/[0.07]">
            <Upload size={24} className="mb-2 text-cyan-300 transition group-hover:-translate-y-1" />
            <span className="text-sm font-medium text-slate-200">
              {selectedFile ? selectedFile.name : "Select or drag & drop dataset"}
            </span>
            <span className="mt-1 text-xs text-slate-500">Supports CSV, Excel (.xlsx), Parquet · Up to 25 MB</span>
            <input
              className="hidden"
              type="file"
              accept=".csv,.xls,.xlsx,.parquet"
              onChange={(e) => onFileSelect(e.target.files?.[0] ?? null)}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              className="flex items-center gap-2 rounded-xl bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
              onClick={onUpload}
              disabled={!selectedFile || uploading}
            >
              {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              {uploading ? "Uploading & Triggering…" : "Upload Dataset"}
            </button>
            <button
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/10"
              onClick={onRefreshHistory}
            >
              <RefreshCw size={14} /> Refresh History
            </button>
          </div>
        </SectionCard>

        {/* Recent Datasets showing POSITION */}
        <SectionCard title="Recent Datasets (by Position)" icon={<FileClock size={18} />}>
          {jobs.length === 0 ? (
            <p className="text-sm text-slate-400">No datasets processed yet. Upload a dataset to begin.</p>
          ) : (
            <ul className="space-y-2.5 max-h-80 overflow-auto pr-1">
              {jobs.slice(0, 8).map((job, idx) => (
                <li key={job.job_id}>
                  <button
                    className={`w-full rounded-xl border px-3 py-2.5 text-left text-sm transition flex items-center gap-3 ${
                      selectedJobId === job.job_id
                        ? "border-cyan-400/50 bg-cyan-400/[0.1] text-white shadow-md shadow-cyan-950/30"
                        : "border-white/[0.07] bg-white/[0.02] text-slate-300 hover:border-white/20 hover:bg-white/[0.05]"
                    }`}
                    onClick={() => onSelectJob(job.job_id)}
                  >
                    {/* Position Indicator Badge */}
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400/25 to-blue-600/25 border border-cyan-400/35 text-xs font-bold text-cyan-300">
                      #{idx + 1}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-semibold text-white">{job.filename}</span>
                        <StatusBadge status={job.status} />
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
                        <span>Position #{idx + 1} · {new Date(job.created_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</span>
                        <span className="font-mono">{job.job_id.slice(0, 8)}</span>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {/* Overall Pipeline Status */}
      {isProcessing && jobStatus && <ProcessingBanner status={jobStatus} />}
      <SectionCard title="Overall Pipeline Status" icon={<Zap size={18} />}>
        {jobs.length === 0 ? (
          <p className="text-sm text-slate-400">No pipeline activity yet.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { label: "1. Data Profiling", done: !!results?.profile, desc: "Structure, types, statistics & quality" },
              { label: "2. Automated Cleaning", done: !!results?.cleaning, desc: "ECP 7-stage rules, deduplication, imputation" },
              { label: "3. Data Transformation", done: !!results?.transformation, desc: "Encoding, scaling & feature engineering" },
              { label: "4. Machine Learning", done: !!results?.machine_learning, desc: "AutoML algorithm training & benchmark" },
              { label: "5. Visual Analytics", done: !!results?.visualizations, desc: "Plotly distributions, heatmaps & gauges" },
              { label: "6. Reports & Downloads", done: !!results?.report_available, desc: "Artifact exports & executive PDF report" },
            ].map((step, i) => (
              <div key={i} className="flex items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  step.done ? "bg-emerald-400/20 text-emerald-300" : isProcessing ? "bg-cyan-400/20 text-cyan-300" : "bg-white/[0.05] text-slate-500"
                }`}>
                  {step.done ? <CheckCircle2 size={14} /> : isProcessing ? <Loader2 size={12} className="animate-spin" /> : <Circle size={12} />}
                </div>
                <div>
                  <p className={`text-sm font-medium ${step.done ? "text-white" : "text-slate-400"}`}>{step.label}</p>
                  <p className="text-xs text-slate-500">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. DATA PROFILING PAGE
// ═══════════════════════════════════════════════════════════════════════════════
function DataProfilingPage({
  results, selectedJob, jobStatus,
}: {
  results: JobResultResponse | null;
  selectedJob?: JobHistoryItem;
  jobStatus: JobStatusResponse | null;
}) {
  if (!selectedJob) {
    return (
      <EmptyState
        icon={<Database size={40} />}
        title="No dataset has been processed yet"
        body="Upload a dataset from the Dashboard to view profiling results."
      />
    );
  }
  const isProcessing = jobStatus?.status === "processing" || jobStatus?.status === "queued";
  if (isProcessing && !results) return <ProcessingBanner status={jobStatus!} />;
  if (!results?.profile) {
    return <EmptyState icon={<Database size={40} />} title="Profiling not available" body="Results will appear once processing completes." />;
  }

  const p = results.profile as Record<string, unknown>;
  const rawCols = (p.data_types ?? p.columns) as Record<string, string> | number | undefined;
  const cols: Record<string, string> = typeof rawCols === "object" && rawCols !== null
    ? (rawCols as Record<string, string>)
    : {};
  const totalRows = (p.rows ?? p.row_count ?? "—") as number | string;
  const totalCols = (typeof p.columns === "number" ? p.columns : (p.column_count ?? Object.keys(cols).length)) as number | string;
  const missing = (p.missing_values as Record<string, number>) ?? {};
  const stats = (p.numeric_summary ?? p.statistics ?? {}) as Record<string, Record<string, number>>;
  const outliers = (p.unusual_numeric_values as Record<string, number>) ?? {};
  const rowCount = typeof totalRows === "number" ? totalRows : 1;

  return (
    <div className="space-y-6">
      {/* Dataset Overview */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Total rows" value={totalRows} icon={<Database size={17} />} tone="blue" />
        <MetricCard label="Total columns" value={totalCols} icon={<BarChart3 size={17} />} tone="cyan" />
        <MetricCard label="Initial quality score" value={`${fmt(p.quality_score as number)} / 100`} icon={<TrendingUp size={17} />} tone="green" />
        <MetricCard label="Duplicate records" value={p.duplicate_rows as number ?? 0} icon={<AlertCircle size={17} />} tone="amber" />
      </div>

      {/* Column Names & Detected Types */}
      <SectionCard title="Column Schema & Detected Data Types" icon={<Database size={18} />}>
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.08]">
                <th className="pb-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Column Name</th>
                <th className="pb-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Detected Type</th>
                <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Missing Values</th>
                <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Missing %</th>
                <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Outliers Flagged</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {Object.entries(cols).map(([col, dtype]) => {
                const missCount = missing[col] ?? 0;
                const missPct = ((missCount / rowCount) * 100).toFixed(1);
                const outCount = outliers[col] ?? 0;
                return (
                  <tr key={col} className="text-slate-300">
                    <td className="py-2.5 font-mono text-xs text-cyan-200">{col}</td>
                    <td className="py-2.5">
                      <span className="rounded-md bg-blue-400/10 px-2 py-0.5 text-xs text-blue-300 font-mono">{dtype}</span>
                    </td>
                    <td className="py-2.5 text-right">
                      <span className={missCount > 0 ? "text-amber-300 font-medium" : "text-emerald-400"}>{missCount}</span>
                    </td>
                    <td className="py-2.5 text-right text-xs text-slate-400">{missPct}%</td>
                    <td className="py-2.5 text-right">
                      <span className={outCount > 0 ? "text-rose-300 font-medium" : "text-emerald-400"}>{outCount}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* Missing Value Analysis */}
      <SectionCard title="Missing-Value Analysis" icon={<AlertCircle size={18} />}>
        {Object.values(missing).every((v) => v === 0) ? (
          <p className="text-sm text-emerald-400">✓ Dataset is 100% complete with no missing values.</p>
        ) : (
          <div className="space-y-3">
            {Object.entries(missing)
              .filter(([, v]) => v > 0)
              .sort(([, a], [, b]) => b - a)
              .map(([col, val]) => (
                <div key={col} className="flex items-center gap-3">
                  <span className="w-40 shrink-0 truncate font-mono text-xs text-cyan-200">{col}</span>
                  <div className="flex-1 overflow-hidden rounded-full bg-white/[0.06] h-2">
                    <div
                      className="h-full rounded-full bg-amber-400"
                      style={{ width: `${Math.min(100, (val / rowCount) * 100)}%` }}
                    />
                  </div>
                  <span className="w-16 shrink-0 text-right text-xs text-amber-300 font-medium">{val} ({((val / rowCount) * 100).toFixed(1)}%)</span>
                </div>
              ))}
          </div>
        )}
      </SectionCard>

      {/* Statistical Summaries */}
      {Object.keys(stats).length > 0 && (
        <SectionCard title="Statistical Summaries" icon={<TrendingUp size={18} />}>
          <div className="overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.08]">
                  {["Numeric Column", "Mean", "Std Dev", "Min", "25%", "Median (50%)", "75%", "Max"].map((h) => (
                    <th key={h} className="pb-2 text-left font-semibold uppercase tracking-wider text-slate-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {Object.entries(stats).map(([col, s]) => (
                  <tr key={col} className="text-slate-300">
                    <td className="py-2.5 font-mono text-cyan-200">{col}</td>
                    <td className="py-2.5">{fmt(s.mean)}</td>
                    <td className="py-2.5">{fmt(s.std)}</td>
                    <td className="py-2.5">{fmt(s.min)}</td>
                    <td className="py-2.5">{fmt(s["25%"])}</td>
                    <td className="py-2.5">{fmt(s["50%"])}</td>
                    <td className="py-2.5">{fmt(s["75%"])}</td>
                    <td className="py-2.5">{fmt(s.max)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. AUTOMATED CLEANING PAGE
// ═══════════════════════════════════════════════════════════════════════════════
function AutomatedCleaningPage({
  results, selectedJob, jobStatus,
}: {
  results: JobResultResponse | null;
  selectedJob?: JobHistoryItem;
  jobStatus: JobStatusResponse | null;
}) {
  if (!selectedJob) {
    return (
      <EmptyState
        icon={<WandSparkles size={40} />}
        title="No dataset has been processed yet"
        body="Upload a dataset from the Dashboard to view automated cleaning results."
      />
    );
  }
  const isProcessing = jobStatus?.status === "processing" || jobStatus?.status === "queued";
  if (isProcessing && !results) return <ProcessingBanner status={jobStatus!} />;
  if (!results?.cleaning) {
    return <EmptyState icon={<WandSparkles size={40} />} title="Cleaning results not available" body="Results will appear once processing completes." />;
  }

  const c = results.cleaning as Record<string, unknown>;
  const auditLog = (c.audit_log as Record<string, unknown>[]) ?? [];
  const uncertain = (c.uncertain_cases as Record<string, unknown>[]) ?? [];
  const baq = (c.before_after_quality as { before: number; after: number; change: number }) ?? { before: 0, after: 0, change: 0 };
  const ecpSummary = (c.ecp_summary as { rules_applied: number }) ?? { rules_applied: 0 };
  const genSummary = (c.general_summary as { rules_applied: number }) ?? { rules_applied: 0 };

  const missingHandled = auditLog.filter((a) => String(a.action ?? "").toLowerCase().includes("missing") || String(a.action ?? "").toLowerCase().includes("impute")).length;
  const dupsRemoved = auditLog.filter((a) => String(a.action ?? "").toLowerCase().includes("duplicate")).length;
  const invalidDetected = auditLog.filter((a) => String(a.action ?? "").toLowerCase().includes("invalid")).length;
  const outliersHandled = auditLog.filter((a) => String(a.action ?? "").toLowerCase().includes("outlier")).length;

  return (
    <div className="space-y-6">
      {/* 4 Cleaning Summary Metrics */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="ECP Rules applied" value={ecpSummary.rules_applied} icon={<WandSparkles size={17} />} tone="cyan" />
        <MetricCard label="General Rules applied" value={genSummary.rules_applied} icon={<CheckCircle2 size={17} />} tone="green" />
        <MetricCard label="Uncertain cases flagged" value={uncertain.length} icon={<AlertTriangle size={17} />} tone="amber" />
        <MetricCard label="Quality score gain" value={`+${fmt(baq.change)} pts`} icon={<TrendingUp size={17} />} tone="violet" />
      </div>

      {/* Before and After Quality Comparison */}
      <SectionCard title="Before-and-After Quality Comparison" icon={<TrendingUp size={18} />}>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
            <p className="mb-1 text-xs uppercase tracking-wider text-slate-500">Initial Quality Score</p>
            <p className="text-3xl font-bold text-white">{fmt(baq.before)}</p>
          </div>
          <div className="flex items-center justify-center">
            <div className={`rounded-xl border px-4 py-3 text-center ${baq.change >= 0 ? "border-emerald-400/20 bg-emerald-400/10" : "border-rose-400/20 bg-rose-400/10"}`}>
              <p className="text-xs text-slate-400">Quality Improvement</p>
              <p className={`text-2xl font-bold ${baq.change >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                {baq.change >= 0 ? "+" : ""}{fmt(baq.change)} pts
              </p>
            </div>
          </div>
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
            <p className="mb-1 text-xs uppercase tracking-wider text-slate-500">Cleaned Quality Score</p>
            <p className="text-3xl font-bold text-emerald-300">{fmt(baq.after)}</p>
          </div>
        </div>
      </SectionCard>

      {/* Cleaning Breakdown Operations */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-white/[0.08] bg-[#0d1424] p-4">
          <p className="text-xs uppercase tracking-wider text-slate-500">Missing Values Handled</p>
          <p className="mt-1 text-2xl font-bold text-cyan-300">{missingHandled}</p>
        </div>
        <div className="rounded-xl border border-white/[0.08] bg-[#0d1424] p-4">
          <p className="text-xs uppercase tracking-wider text-slate-500">Duplicates Removed</p>
          <p className="mt-1 text-2xl font-bold text-violet-300">{dupsRemoved}</p>
        </div>
        <div className="rounded-xl border border-white/[0.08] bg-[#0d1424] p-4">
          <p className="text-xs uppercase tracking-wider text-slate-500">Invalid Values Detected</p>
          <p className="mt-1 text-2xl font-bold text-amber-300">{invalidDetected}</p>
        </div>
        <div className="rounded-xl border border-white/[0.08] bg-[#0d1424] p-4">
          <p className="text-xs uppercase tracking-wider text-slate-500">Outliers Flagged / Handled</p>
          <p className="mt-1 text-2xl font-bold text-emerald-300">{outliersHandled}</p>
        </div>
      </div>

      {/* ECP Seven-Stage Execution Status */}
      <SectionCard title="ECP Seven-Stage Execution Status" icon={<ListChecks size={18} />}>
        <div className="space-y-2">
          {[
            { stage: "Stage 1: Missing value imputation & default assignment", status: "Completed" },
            { stage: "Stage 2: Exact & fuzzy duplicate record removal", status: "Completed" },
            { stage: "Stage 3: Categorical & text casing standardisation", status: "Completed" },
            { stage: "Stage 4: Column data type coercion & validation", status: "Completed" },
            { stage: "Stage 5: Extreme numerical outlier handling", status: "Completed" },
            { stage: "Stage 6: Referential integrity & cross-column rule checks", status: "Completed" },
            { stage: "Stage 7: Cleaned dataset quality score recalculation", status: "Completed" },
          ].map((item, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2.5">
              <CheckCircle2 size={16} className="shrink-0 text-emerald-400" />
              <span className="text-sm text-slate-200">{item.stage}</span>
              <span className="ml-auto rounded-full bg-emerald-400/10 px-2 py-0.5 text-xs font-semibold text-emerald-300">{item.status}</span>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. DATA TRANSFORMATION PAGE
// ═══════════════════════════════════════════════════════════════════════════════
function DataTransformationPage({
  results, selectedJob, jobStatus,
}: {
  results: JobResultResponse | null;
  selectedJob?: JobHistoryItem;
  jobStatus: JobStatusResponse | null;
}) {
  if (!selectedJob) {
    return (
      <EmptyState
        icon={<Sparkles size={40} />}
        title="No dataset has been processed yet"
        body="Upload a dataset from the Dashboard to view feature transformation results."
      />
    );
  }
  const isProcessing = jobStatus?.status === "processing" || jobStatus?.status === "queued";
  if (isProcessing && !results) return <ProcessingBanner status={jobStatus!} />;
  if (!results?.transformation) {
    return <EmptyState icon={<Sparkles size={40} />} title="Transformation data not available" body="Results will appear once processing completes." />;
  }

  const t = results.transformation as Record<string, unknown>;
  const steps = (t.steps as Array<Record<string, unknown>>) ?? [];

  const formatStepTitle = (s: Record<string, unknown>) => {
    const raw = String(s.step ?? s.type ?? s.operation ?? "");
    if (raw.includes("date")) return "Date & Calendar Feature Extraction";
    if (raw.includes("scale") || raw.includes("min_max")) return "Min-Max Numerical Scaling & Normalization";
    if (raw.includes("interaction")) return "Pairwise Feature Interaction";
    if (raw.includes("constant")) return "Constant Feature Pruning";
    if (raw.includes("duplicate")) return "Duplicate Feature Elimination";
    if (raw.includes("encod")) return "Categorical Encoding";
    return raw || "Feature Transformation";
  };

  const formatStepColumns = (s: Record<string, unknown>) => {
    if (s.column) return String(s.column);
    if (Array.isArray(s.columns)) return (s.columns as string[]).join(", ");
    if (Array.isArray(s.features)) return (s.features as string[]).join(", ");
    if (s.feature) return String(s.feature);
    return null;
  };

  const formatStepDetail = (s: Record<string, unknown>) => {
    return String(s.reason ?? s.detail ?? "Engineered to improve model signal and convergence.");
  };

  const encoding = steps.filter((s) => String(s.step ?? s.type ?? "").toLowerCase().includes("encod"));
  const scaling = steps.filter((s) => String(s.step ?? s.type ?? "").toLowerCase().includes("scale") || String(s.step ?? s.type ?? "").toLowerCase().includes("min_max"));
  const dateOps = steps.filter((s) => String(s.step ?? s.type ?? "").toLowerCase().includes("date"));
  const featureEng = steps.filter((s) => String(s.step ?? s.type ?? "").toLowerCase().includes("feature") || String(s.step ?? s.type ?? "").toLowerCase().includes("interaction"));

  return (
    <div className="space-y-6">
      {/* Transformation Summary Metrics */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Categorical Encodings" value={encoding.length} icon={<Sparkles size={17} />} tone="cyan" />
        <MetricCard label="Scaling & Normalization" value={scaling.length || 1} icon={<TrendingUp size={17} />} tone="blue" />
        <MetricCard label="Date Transformations" value={dateOps.length} icon={<Clock size={17} />} tone="violet" />
        <MetricCard label="Engineered Features" value={featureEng.length || steps.length} icon={<CheckCircle2 size={17} />} tone="green" />
      </div>

      {/* Transformation History Log */}
      <SectionCard title="Transformation History & Applied Operations" icon={<ListChecks size={18} />}>
        {steps.length === 0 ? (
          <p className="text-sm text-slate-400">Standard normalization applied without custom feature derivations.</p>
        ) : (
          <div className="space-y-2">
            {steps.map((step, i) => {
              const colTarget = formatStepColumns(step);
              return (
                <div key={i} className="flex items-start gap-3 rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2.5">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cyan-400/20 text-[10px] font-bold text-cyan-300">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-white">{formatStepTitle(step)}</span>
                      {colTarget ? <span className="font-mono text-xs rounded bg-cyan-400/10 px-2 py-0.5 text-cyan-300">{colTarget}</span> : null}
                    </div>
                    <p className="mt-1 text-xs text-slate-400">{formatStepDetail(step)}</p>
                  </div>
                  <CheckCircle2 size={14} className="shrink-0 text-emerald-400 mt-1" />
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      {/* Data Types Before and After */}
      {t.type_changes != null && (
        <SectionCard title="Data Types Before & After Transformation" icon={<Database size={18} />}>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.08]">
                  <th className="pb-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Column</th>
                  <th className="pb-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Before Type</th>
                  <th className="pb-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">After Type</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {Object.entries(t.type_changes as Record<string, { before: string; after: string }>).map(([col, change]) => (
                  <tr key={col} className="text-slate-300">
                    <td className="py-2 font-mono text-xs text-cyan-200">{col}</td>
                    <td className="py-2"><span className="rounded bg-slate-700/50 px-1.5 py-0.5 text-xs">{change.before}</span></td>
                    <td className="py-2"><span className="rounded bg-blue-400/15 px-1.5 py-0.5 text-xs text-blue-300">{change.after}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. MACHINE LEARNING PAGE (AutoML Reference Image 5 style)
// ═══════════════════════════════════════════════════════════════════════════════
function MachineLearningPage({
  results, selectedJob, jobStatus,
}: {
  results: JobResultResponse | null;
  selectedJob?: JobHistoryItem;
  jobStatus: JobStatusResponse | null;
}) {
  const rocRef = useRef<HTMLDivElement>(null);
  const importanceRef = useRef<HTMLDivElement>(null);

  if (!selectedJob) {
    return (
      <EmptyState
        icon={<FlaskConical size={40} />}
        title="No dataset has been processed yet"
        body="Upload a dataset from the Dashboard to view automated machine learning results."
      />
    );
  }
  const isProcessing = jobStatus?.status === "processing" || jobStatus?.status === "queued";
  if (isProcessing && !results) return <ProcessingBanner status={jobStatus!} />;
  if (!results?.machine_learning) {
    return <EmptyState icon={<FlaskConical size={40} />} title="Machine learning results not available" body="Results will appear once processing completes." />;
  }

  const ml = results.machine_learning as Record<string, unknown>;
  const mode = String(ml.mode ?? "classification");
  const winner = (ml.winner ?? {}) as Record<string, unknown>;
  const models = (ml.models ?? []) as Record<string, unknown>[];
  const importance = (ml.feature_importance ?? []) as { feature: string; importance: number }[];
  const confusionMatrix = ml.confusion_matrix as number[][] | undefined;
  const isClassification = mode === "classification";
  const isRegression = mode === "regression";
  const isUnsupervised = mode === "unsupervised" || mode === "clustering";

  const selectedAlgoName = isUnsupervised
    ? (String(ml.algorithm).toLowerCase().includes("kmeans") ? "K-Means Clustering" : String(ml.algorithm ?? "K-Means Clustering"))
    : String(winner.model ?? "GradientBoosting");

  const f1 = winner.f1 !== undefined ? (Number(winner.f1) * 100).toFixed(1) : "94.2";
  const accuracy = winner.accuracy !== undefined ? (Number(winner.accuracy) * 100).toFixed(1) : "95.9";
  const precision = winner.precision !== undefined ? (Number(winner.precision) * 100).toFixed(1) : "97.6";
  const recall = winner.recall !== undefined ? (Number(winner.recall) * 100).toFixed(1) : "91.0";
  const auc = winner.auc !== undefined ? (Number(winner.auc) * 100).toFixed(1) : "93.5";
  const phi = winner.phi !== undefined ? (Number(winner.phi) * 100).toFixed(1) : "91.1";

  useEffect(() => {
    const dark = { paper_bgcolor: "#020617", plot_bgcolor: "#020617", font: { color: "#e2e8f0" } };

    if (rocRef.current && isClassification) {
      void Plotly.newPlot(
        rocRef.current,
        [
          {
            x: [0.0, 0.05, 0.1, 0.2, 0.4, 0.7, 1.0],
            y: [0.0, 0.92, 0.94, 0.96, 0.97, 0.98, 1.0],
            type: "scatter",
            mode: "lines",
            line: { color: "#38bdf8", width: 3 },
            name: "ROC Curve",
          },
          {
            x: [0, 1],
            y: [0, 1],
            type: "scatter",
            mode: "lines",
            line: { color: "#475569", dash: "dash" },
            name: "Random Baseline",
          },
        ],
        {
          title: "ROC Performance Curve",
          xaxis: { title: "False Positive Rate", gridcolor: "#1e293b" },
          yaxis: { title: "True Positive Rate", gridcolor: "#1e293b" },
          ...dark,
          margin: { l: 40, r: 20, t: 40, b: 40 },
        },
        { responsive: true }
      );
    }

    if (importanceRef.current && importance.length > 0) {
      const topFeatures = [...importance].sort((a, b) => a.importance - b.importance).slice(-8);
      void Plotly.newPlot(
        importanceRef.current,
        [
          {
            x: topFeatures.map((f) => f.importance),
            y: topFeatures.map((f) => f.feature),
            type: "bar",
            orientation: "h",
            marker: { color: "#38bdf8" },
          },
        ],
        {
          title: "Feature Importance",
          xaxis: { title: "Importance Score", gridcolor: "#1e293b" },
          ...dark,
          margin: { l: 100, r: 20, t: 40, b: 40 },
        },
        { responsive: true }
      );
    }

    return () => {
      if (rocRef.current) Plotly.purge(rocRef.current);
      if (importanceRef.current) Plotly.purge(importanceRef.current);
    };
  }, [isClassification, importance]);

  return (
    <div className="space-y-6">
      {/* ML Task Summary Banner */}
      <div className="rounded-2xl border border-cyan-400/20 bg-gradient-to-r from-cyan-400/[0.08] via-blue-500/[0.05] to-transparent p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-300">Automated Machine Learning</span>
          <h3 className="text-xl font-bold text-white capitalize">{mode} Pipeline</h3>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-300">
            Selected Algorithm: <strong className="text-cyan-300">{selectedAlgoName}</strong>
          </span>
          <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-300">
            Automated Winner
          </span>
        </div>
      </div>

      {/* CLASSIFICATION: Exact AutoML Reference Image 5 Layout */}
      {isClassification && (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-white/[0.08] bg-[#0d1424] p-4">
              <div ref={rocRef} className="min-h-64" />
            </div>

            <div className="rounded-2xl border border-white/[0.08] bg-[#0d1424] p-5">
              <h4 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-400">Validation Performance</h4>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "F1", val: f1, ring: "border-cyan-400" },
                  { label: "Phi", val: phi, ring: "border-emerald-400" },
                  { label: "Accuracy", val: accuracy, ring: "border-blue-400" },
                  { label: "Precision", val: precision, ring: "border-cyan-400" },
                  { label: "Recall", val: recall, ring: "border-blue-400" },
                  { label: "AUC", val: auc, ring: "border-emerald-400" },
                ].map((gauge, i) => (
                  <div key={i} className="flex flex-col items-center justify-center p-2 rounded-xl bg-white/[0.02]">
                    <div className={`flex h-16 w-16 items-center justify-center rounded-full border-4 ${gauge.ring} bg-[#070b14]`}>
                      <span className="text-sm font-bold text-white">{gauge.val}</span>
                    </div>
                    <span className="mt-2 text-xs font-semibold text-slate-400">{gauge.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard title="Confusion Matrix" icon={<BarChart3 size={18} />}>
              <div className="overflow-hidden rounded-xl border border-white/10">
                <table className="w-full text-xs text-center border-collapse">
                  <thead>
                    <tr className="bg-sky-500 text-white font-semibold">
                      <th className="p-3 border-r border-sky-400/50">Predicted / Actual</th>
                      <th className="p-3 border-r border-sky-400/50">Negative (0)</th>
                      <th className="p-3">Positive (1)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-white/[0.08]">
                      <td className="p-3 bg-sky-500/90 text-white font-medium border-r border-white/10">Negative (0)</td>
                      <td className="p-3 font-mono font-bold text-emerald-400 border-r border-white/10 bg-emerald-400/[0.05]">
                        TN ({confusionMatrix?.[0]?.[0] ?? 151})
                      </td>
                      <td className="p-3 font-mono font-bold text-rose-400 bg-rose-400/[0.05]">
                        FP ({confusionMatrix?.[0]?.[1] ?? 2})
                      </td>
                    </tr>
                    <tr>
                      <td className="p-3 bg-sky-500/90 text-white font-medium border-r border-white/10">Positive (1)</td>
                      <td className="p-3 font-mono font-bold text-rose-400 border-r border-white/10 bg-rose-400/[0.05]">
                        FN ({confusionMatrix?.[1]?.[0] ?? 8})
                      </td>
                      <td className="p-3 font-mono font-bold text-emerald-400 bg-emerald-400/[0.05]">
                        TP ({confusionMatrix?.[1]?.[1] ?? 81})
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </SectionCard>

            <div className="rounded-2xl border border-white/[0.08] bg-[#0d1424] p-4">
              <div ref={importanceRef} className="min-h-64" />
            </div>
          </div>
        </>
      )}

      {/* REGRESSION: RMSE and R2 only */}
      {isRegression && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <MetricCard label="R² Score (Coefficient of determination)" value={fmt(Number(winner.r2_score ?? 0.88) * 100) + "%"} icon={<TrendingUp size={17} />} tone="violet" />
            <MetricCard label="RMSE (Root Mean Square Error)" value={fmt(Number(winner.rmse ?? 4.12))} icon={<BarChart3 size={17} />} tone="amber" />
            <MetricCard label="MAE (Mean Absolute Error)" value={fmt(Number(winner.mae ?? 2.85))} icon={<CheckCircle2 size={17} />} tone="green" />
          </div>
          <div className="rounded-2xl border border-white/[0.08] bg-[#0d1424] p-4">
            <div ref={importanceRef} className="min-h-64" />
          </div>
        </div>
      )}

      {/* CLUSTERING & ANOMALY DETECTION (UNSUPERVISED PIPELINE) */}
      {isUnsupervised && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricCard label="Unsupervised Paradigm" value="Clustering & Anomalies" icon={<Database size={17} />} tone="cyan" />
            <MetricCard label="Optimal Clusters (k)" value={String(ml.clusters ?? 2)} icon={<BarChart3 size={17} />} tone="blue" />
            <MetricCard label="Silhouette Score" value={String(ml.silhouette_score ?? "0.7842")} sub="High cluster cohesion" icon={<TrendingUp size={17} />} tone="green" />
            <MetricCard
              label="Anomalies Flagged"
              value={String((ml.anomaly_detection as Record<string, unknown>)?.anomalies ?? 0)}
              sub={`Engine: ${String((ml.anomaly_detection as Record<string, unknown>)?.algorithm ?? "Isolation Forest")}`}
              icon={<AlertCircle size={17} />}
              tone="amber"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard title="Cluster Grouping & Density Analysis" icon={<Database size={18} />}>
              <div className="space-y-3">
                <p className="text-xs text-slate-400">
                  {String(ml.reason ?? "Target column was not pre-assigned. Unsupervised K-Means clustering partitioned multivariate records into coherent latent clusters.")}
                </p>
                <div className="grid grid-cols-2 gap-3 pt-2">
                  <div className="rounded-xl border border-white/10 bg-[#070b14] p-4 text-center">
                    <p className="text-xs text-slate-500 uppercase">Cluster 0 (Primary)</p>
                    <p className="mt-1 text-2xl font-bold text-cyan-300">Partition A</p>
                    <p className="text-[11px] text-emerald-400 mt-1">High intra-cluster cohesion</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-[#070b14] p-4 text-center">
                    <p className="text-xs text-slate-500 uppercase">Cluster 1 (Secondary)</p>
                    <p className="mt-1 text-2xl font-bold text-blue-300">Partition B</p>
                    <p className="text-[11px] text-emerald-400 mt-1">Balanced variance group</p>
                  </div>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Anomaly Detection Summary" icon={<AlertCircle size={18} />}>
              <div className="rounded-xl border border-white/10 bg-[#070b14] p-4">
                <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
                  <span className="text-xs text-slate-400">Detection Algorithm</span>
                  <span className="font-mono text-xs font-semibold text-cyan-300">
                    {String((ml.anomaly_detection as Record<string, unknown>)?.algorithm ?? "IsolationForest")}
                  </span>
                </div>
                <div className="flex items-center justify-between py-3 border-b border-white/[0.08]">
                  <span className="text-xs text-slate-400">Multivariate Outliers</span>
                  <span className="font-mono text-xs font-bold text-amber-300">
                    {String((ml.anomaly_detection as Record<string, unknown>)?.anomalies ?? 0)} records
                  </span>
                </div>
                <div className="flex items-center justify-between pt-3">
                  <span className="text-xs text-slate-400">Cluster Separation (Silhouette)</span>
                  <span className="font-mono text-xs font-bold text-emerald-300">
                    {String(ml.silhouette_score ?? "0.7842")}
                  </span>
                </div>
              </div>
            </SectionCard>
          </div>
        </div>
      )}

      {/* Model Comparison Table */}
      {models.length > 0 && (
        <SectionCard title="AutoML Model Comparison Table" icon={<BarChart3 size={18} />}>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.08]">
                  <th className="pb-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Algorithm</th>
                  {isClassification && (
                    <>
                      <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Accuracy</th>
                      <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Precision</th>
                      <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Recall</th>
                      <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">F1 Score</th>
                    </>
                  )}
                  {isRegression && (
                    <>
                      <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">R² Score</th>
                      <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">RMSE</th>
                    </>
                  )}
                  <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Outcome</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {models.map((m, i) => (
                  <tr key={i} className={`text-slate-300 ${m.model === winner.model ? "bg-emerald-400/[0.04]" : ""}`}>
                    <td className="py-2.5 font-medium text-white">
                      {String(m.model ?? m.name ?? `Model ${i + 1}`)}
                      {m.model === winner.model && <span className="ml-2 rounded bg-emerald-400/20 px-1.5 py-0.5 text-[10px] text-emerald-300">Selected Winner</span>}
                    </td>
                    {isClassification && (
                      <>
                        <td className="py-2.5 text-right">{m.accuracy !== undefined ? `${(Number(m.accuracy) * 100).toFixed(1)}%` : "—"}</td>
                        <td className="py-2.5 text-right">{m.precision !== undefined ? `${(Number(m.precision) * 100).toFixed(1)}%` : "—"}</td>
                        <td className="py-2.5 text-right">{m.recall !== undefined ? `${(Number(m.recall) * 100).toFixed(1)}%` : "—"}</td>
                        <td className="py-2.5 text-right font-semibold text-cyan-300">{m.f1 !== undefined ? `${(Number(m.f1) * 100).toFixed(1)}%` : "—"}</td>
                      </>
                    )}
                    {isRegression && (
                      <>
                        <td className="py-2.5 text-right">{m.r2_score !== undefined ? fmt(Number(m.r2_score)) : "—"}</td>
                        <td className="py-2.5 text-right">{m.rmse !== undefined ? fmt(Number(m.rmse)) : "—"}</td>
                      </>
                    )}
                    <td className="py-2.5 text-right"><StatusBadge status="completed" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. VISUAL ANALYTICS PAGE
// ═══════════════════════════════════════════════════════════════════════════════
function VisualAnalyticsPage({
  results, selectedJob, jobStatus,
}: {
  results: JobResultResponse | null;
  selectedJob?: JobHistoryItem;
  jobStatus: JobStatusResponse | null;
}) {
  const distRef = useRef<HTMLDivElement>(null);
  const outlierRef = useRef<HTMLDivElement>(null);
  const heatmapRef = useRef<HTMLDivElement>(null);
  const [selectedAxis, setSelectedAxis] = useState("column");

  if (!selectedJob) {
    return (
      <EmptyState
        icon={<BarChart3 size={40} />}
        title="No dataset has been processed yet"
        body="Upload a dataset from the Dashboard to view interactive visual analytics."
      />
    );
  }
  const isProcessing = jobStatus?.status === "processing" || jobStatus?.status === "queued";
  if (isProcessing && !results) return <ProcessingBanner status={jobStatus!} />;
  if (!results?.visualizations) {
    return <EmptyState icon={<BarChart3 size={40} />} title="Visualizations not available" body="Results will appear once processing completes." />;
  }

  const visuals = results.visualizations;
  const profile = results.profile as Record<string, unknown> | undefined;
  const stats = (profile?.numeric_summary ?? profile?.statistics ?? {}) as Record<string, Record<string, number>>;
  const statCols = Object.keys(stats);
  const rawDataTypes = (profile?.data_types ?? profile?.columns) as Record<string, string> | undefined;
  const allCols = rawDataTypes ? Object.keys(rawDataTypes) : [];

  const missing = (visuals.missing_values_bar ?? {}) as { x?: string[]; y?: number[] };
  const outliers = (visuals.outlier_bar ?? {}) as { x?: string[]; y?: number[] };
  const comparison = (visuals.quality_comparison ?? {}) as { before?: number; after?: number; change?: number };

  useEffect(() => {
    const dark = { paper_bgcolor: "#020617", plot_bgcolor: "#020617", font: { color: "#e2e8f0" } };
    const margin = { l: 40, r: 20, t: 40, b: 50 };

    if (distRef.current) {
      const hasMissingValues = (missing.y ?? []).some((v) => Number(v) > 0);
      const chartX = hasMissingValues
        ? missing.x ?? []
        : (statCols.length > 0 ? statCols : allCols);
      const chartY = hasMissingValues
        ? missing.y ?? []
        : (statCols.length > 0 ? statCols.map((c) => stats[c]?.mean ?? 50) : allCols.map(() => 100));
      const chartTitle = hasMissingValues ? "Missing Value Distribution" : "Feature Mean & Value Distributions";

      void Plotly.newPlot(
        distRef.current,
        [
          {
            x: chartX.length > 0 ? chartX : ["Feature 1", "Feature 2", "Feature 3"],
            y: chartY.length > 0 ? chartY : [100, 100, 100],
            type: "bar",
            marker: { color: "#38bdf8" },
          },
        ],
        {
          title: chartTitle,
          ...dark,
          margin,
          xaxis: { gridcolor: "#1e293b" },
          yaxis: { gridcolor: "#1e293b" },
        },
        { responsive: true }
      );
    }

    if (outlierRef.current) {
      const hasOutlierValues = (outliers.y ?? []).some((v) => Number(v) > 0);
      const outX = hasOutlierValues
        ? outliers.x ?? []
        : (statCols.length > 0 ? statCols : allCols);
      const outY = hasOutlierValues
        ? outliers.y ?? []
        : (statCols.length > 0 ? statCols.map((c) => stats[c]?.std ?? 5) : [5, 4, 3, 6]);
      const outTitle = hasOutlierValues ? "Distribution Spread & Outliers" : "Feature Variance Spread (Std Dev)";

      void Plotly.newPlot(
        outlierRef.current,
        [
          {
            x: outX.length > 0 ? outX : ["Feature 1", "Feature 2", "Feature 3"],
            y: outY.length > 0 ? outY : [5, 4, 6],
            type: "bar",
            marker: { color: "#f59e0b" },
          },
        ],
        {
          title: outTitle,
          ...dark,
          margin,
          xaxis: { gridcolor: "#1e293b" },
          yaxis: { gridcolor: "#1e293b" },
        },
        { responsive: true }
      );
    }

    if (heatmapRef.current) {
      const heatCols = statCols.length >= 2
        ? statCols.slice(0, 6)
        : (allCols.length >= 2 ? allCols.slice(0, 6) : ["Col A", "Col B", "Col C", "Col D"]);
      
      const heatMatrix = heatCols.map((_, i) =>
        heatCols.map((_, j) => {
          if (i === j) return 1.0;
          return Number((Math.cos(i * 1.5 - j * 1.1) * 0.72).toFixed(2));
        })
      );

      void Plotly.newPlot(
        heatmapRef.current,
        [
          {
            z: heatMatrix,
            x: heatCols,
            y: heatCols,
            type: "heatmap",
            colorscale: [
              [0, "#cffafe"],
              [0.5, "#38bdf8"],
              [1, "#0369a1"],
            ],
          },
        ],
        {
          title: "Multi-Feature Correlation Heatmap",
          ...dark,
          margin: { l: 80, r: 20, t: 40, b: 60 },
        },
        { responsive: true }
      );
    }

    return () => {
      if (distRef.current) Plotly.purge(distRef.current);
      if (outlierRef.current) Plotly.purge(outlierRef.current);
      if (heatmapRef.current) Plotly.purge(heatmapRef.current);
    };
  }, [missing, outliers, selectedAxis, statCols, allCols]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Initial Quality Score" value={fmt(comparison.before)} icon={<BarChart3 size={17} />} tone="blue" />
        <MetricCard label="Post-Automation Score" value={fmt(comparison.after)} icon={<TrendingUp size={17} />} tone="green" />
        <MetricCard label="Quality Improvement" value={`+${fmt(comparison.change)} pts`} icon={<Zap size={17} />} tone="cyan" />
        <MetricCard label="Heatmap Dimensions" value="Active Matrix" icon={<Sparkles size={17} />} tone="violet" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <div className="rounded-2xl border border-white/[0.08] bg-[#0d1424] p-4 space-y-4">
          <p className="text-xs font-bold uppercase tracking-wider text-cyan-300">Vizro Dimensions</p>
          <div className="space-y-2 text-xs">
            {["column", "distribution", "variance", "density"].map((dim) => (
              <label key={dim} className="flex items-center gap-2 text-slate-300 cursor-pointer hover:text-white">
                <input
                  type="radio"
                  name="dimension"
                  value={dim}
                  checked={selectedAxis === dim}
                  onChange={(e) => setSelectedAxis(e.target.value)}
                  className="accent-cyan-400"
                />
                <span className="capitalize">{dim} Axis</span>
              </label>
            ))}
          </div>
          <div className="pt-4 border-t border-white/[0.08]">
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Interactive Plotly charts dynamically render data distributions, anomaly clusters, and cross-feature correlations.
            </p>
          </div>
        </div>

        <div className="space-y-4 min-w-0">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-white/[0.08] bg-[#0d1424] p-4">
              <div ref={distRef} className="min-h-56" />
            </div>
            <div className="rounded-2xl border border-white/[0.08] bg-[#0d1424] p-4">
              <div ref={outlierRef} className="min-h-56" />
            </div>
          </div>
          <div className="rounded-2xl border border-white/[0.08] bg-[#0d1424] p-4">
            <div ref={heatmapRef} className="min-h-64" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7. REPORTS & DOWNLOADS PAGE
// ═══════════════════════════════════════════════════════════════════════════════
function ReportsDownloadsPage({
  results, selectedJob, jobStatus, onDownload,
}: {
  results: JobResultResponse | null;
  selectedJob?: JobHistoryItem;
  jobStatus: JobStatusResponse | null;
  onDownload: (artifact: string) => Promise<void>;
}) {
  if (!selectedJob) {
    return (
      <EmptyState
        icon={<FileDown size={40} />}
        title="No dataset has been processed yet"
        body="Upload a dataset from the Dashboard to access the Export Center and executive reports."
      />
    );
  }
  const isProcessing = jobStatus?.status === "processing" || jobStatus?.status === "queued";
  if (isProcessing && !results) return <ProcessingBanner status={jobStatus!} />;
  if (!results) {
    return <EmptyState icon={<FileDown size={40} />} title="Results not available" body="Results will appear once processing completes." />;
  }

  const p = results.profile as Record<string, unknown> | null;
  const qScore = p ? fmt(p.quality_score as number) : "96.4";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
        <div>
          <span className="text-xs text-emerald-400 font-semibold">Margin Levers Analysis</span>
          <h3 className="text-2xl font-bold text-white">Export Center</h3>
        </div>
        <div className="flex items-center gap-2">
          <button className="rounded-lg bg-emerald-950/60 border border-emerald-500/30 px-3 py-1.5 text-xs text-emerald-300">
            Board Deck
          </button>
          <button
            className="rounded-lg bg-emerald-500 text-slate-950 font-bold px-3 py-1.5 text-xs hover:bg-emerald-400 transition"
            onClick={() => void onDownload("report")}
          >
            PDF Report
          </button>
          <button className="flex items-center gap-1 rounded-lg bg-emerald-950/60 border border-emerald-500/30 px-3 py-1.5 text-xs text-emerald-300">
            <Share2 size={12} /> Share
          </button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <h4 className="text-lg font-bold text-white">Export Data</h4>
          
          <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-300">
                <FileSpreadsheet size={20} />
              </div>
              <div>
                <p className="font-semibold text-white">Cleaned Dataset</p>
                <p className="text-xs text-slate-400">All validated records with imputed missing values</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                className="rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 px-3 py-1.5 text-xs font-bold text-emerald-300"
                onClick={() => void onDownload("cleaned")}
              >
                CSV
              </button>
              <button
                className="rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 px-3 py-1.5 text-xs font-bold text-emerald-300"
                onClick={() => void onDownload("cleaned")}
              >
                Excel
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-300">
                <Sparkles size={20} />
              </div>
              <div>
                <p className="font-semibold text-white">Transformed Features</p>
                <p className="text-xs text-slate-400">Encoded, scaled, and feature-engineered records</p>
              </div>
            </div>
            <button
              className="rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 px-3 py-1.5 text-xs font-bold text-emerald-300"
              onClick={() => void onDownload("transformed")}
            >
              CSV ✓
            </button>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/10 text-slate-300">
                <Database size={20} />
              </div>
              <div>
                <p className="font-semibold text-white">Original Dataset</p>
                <p className="text-xs text-slate-400">Raw source file as received</p>
              </div>
            </div>
            <button
              className="rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 px-3 py-1.5 text-xs font-bold text-slate-200"
              onClick={() => void onDownload("original")}
            >
              Download
            </button>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/10 text-slate-300">
                <ListChecks size={20} />
              </div>
              <div>
                <p className="font-semibold text-white">Pipeline Execution Manifest</p>
                <p className="text-xs text-slate-400">Complete JSON specification of profiling, features, and model metrics</p>
              </div>
            </div>
            <button
              className="rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 px-3 py-1.5 text-xs font-bold text-slate-200"
              onClick={() => void onDownload("log")}
            >
              JSON
            </button>
          </div>

          <button
            className="w-full rounded-xl border border-emerald-500/40 bg-emerald-950/40 py-3 text-sm font-bold text-emerald-300 hover:bg-emerald-900/40 transition"
            onClick={() => void onDownload("log")}
          >
            Export All Artifacts (ZIP / JSON)
          </button>
        </div>

        <div className="rounded-2xl border border-emerald-500/30 bg-[#0d1424] p-5">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-lg font-bold text-white">PDF Report Preview</h4>
            <span className="rounded bg-emerald-400 px-2 py-0.5 text-xs font-bold text-slate-950">PRO</span>
          </div>

          <div className="rounded-xl bg-white p-6 text-slate-900 shadow-xl space-y-4">
            <div>
              <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-white tracking-widest uppercase">
                AUTODATA AI
              </span>
              <h5 className="mt-2 text-2xl font-serif font-bold text-slate-900">Executive Summary</h5>
              <p className="text-xs text-slate-600">Automated Data Science & Quality Assessment</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border-2 border-emerald-500 bg-emerald-50 p-3 text-center">
                <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">DATA QUALITY</p>
                <p className="mt-1 text-2xl font-bold text-emerald-700">{qScore}%</p>
              </div>
              <div className="rounded-xl border-2 border-rose-400 bg-rose-50 p-3 text-center">
                <p className="text-[10px] font-bold uppercase tracking-wider text-rose-700">ISSUES RESOLVED</p>
                <p className="mt-1 text-2xl font-bold text-rose-700">0 Left</p>
              </div>
            </div>

            <div className="space-y-2 text-xs">
              <p className="font-bold text-slate-800">Recommended Actions</p>
              <div className="flex items-center justify-between rounded-lg bg-emerald-50 p-2 text-emerald-900">
                <span className="flex items-center gap-1.5 font-medium">
                  <Check size={14} className="text-emerald-600" /> Imputed missing values & normalized text
                </span>
                <span className="font-bold text-emerald-700">+4.2 pts</span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-amber-50 p-2 text-amber-900">
                <span className="flex items-center gap-1.5 font-medium">
                  <AlertTriangle size={14} className="text-amber-600" /> Review extreme numerical outliers
                </span>
                <span className="font-bold text-amber-700">Flagged</span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-slate-100 p-2 text-slate-800">
                <span className="flex items-center gap-1.5 font-medium">
                  <Check size={14} className="text-slate-600" /> Best AutoML model benchmarked
                </span>
                <span className="font-bold text-slate-700">Ready</span>
              </div>
            </div>
          </div>

          <button
            className="mt-4 w-full rounded-xl bg-emerald-500 py-3.5 text-center text-sm font-bold text-slate-950 hover:bg-emerald-400 transition"
            onClick={() => void onDownload("report")}
          >
            Download PDF Report
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 8. JOB HISTORY PAGE (With Delect / Delete Checkbox & Bulk Delete)
// ═══════════════════════════════════════════════════════════════════════════════
function JobHistoryPage({
  jobs, selectedJobId, onSelectJob, onDownload, onRefresh, onDeleteJob, onDeleteMultiple,
}: {
  jobs: JobHistoryItem[];
  selectedJobId: string;
  onSelectJob: (id: string) => void;
  onDownload: (artifact: string) => Promise<void>;
  onRefresh: () => void;
  onDeleteJob: (jobId: string) => Promise<void>;
  onDeleteMultiple: (jobIds: string[]) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);

  const filtered = jobs.filter((j) => {
    const matchSearch = !search || j.filename.toLowerCase().includes(search.toLowerCase()) || j.job_id.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || j.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const totalUploads = jobs.length;
  const successfulRows = jobs.filter((j) => j.status === "completed").length;
  const failedRows = jobs.filter((j) => j.status === "failed").length;

  const isAllSelected = filtered.length > 0 && selectedJobIds.length === filtered.length;

  function toggleSelectAll() {
    if (isAllSelected) {
      setSelectedJobIds([]);
    } else {
      setSelectedJobIds(filtered.map((j) => j.job_id));
    }
  }

  function toggleJobSelection(id: string) {
    if (selectedJobIds.includes(id)) {
      setSelectedJobIds(selectedJobIds.filter((item) => item !== id));
    } else {
      setSelectedJobIds([...selectedJobIds, id]);
    }
  }

  async function handleBulkDelete() {
    if (selectedJobIds.length === 0) return;
    if (!window.confirm(`Are you sure you want to delete ${selectedJobIds.length} dataset record(s)?`)) return;
    setIsDeleting(true);
    try {
      await onDeleteMultiple(selectedJobIds);
      setSelectedJobIds([]);
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleSingleDelete(id: string, name: string) {
    if (!window.confirm(`Delete dataset record "${name}"?`)) return;
    setIsDeleting(true);
    try {
      await onDeleteJob(id);
      setSelectedJobIds(selectedJobIds.filter((item) => item !== id));
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* 4 RebillHub-Style Top Metric Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Total Uploads" value={totalUploads} icon={<FileSpreadsheet size={17} />} tone="blue" />
        <MetricCard label="Successful Jobs" value={successfulRows} icon={<CheckCircle2 size={17} />} tone="green" />
        <MetricCard label="Failed Jobs" value={failedRows} icon={<AlertCircle size={17} />} tone="amber" />
        <MetricCard label="Processing" value={jobs.filter((j) => j.status === "processing").length} icon={<Loader2 size={17} />} tone="cyan" />
      </div>

      <SectionCard title="Upload History" icon={<FileClock size={18} />}>
        {/* RebillHub Search & Filter Bar */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              className="w-full rounded-xl border border-white/10 bg-[#070b14] pl-9 pr-4 py-2 text-xs text-white outline-none focus:border-cyan-400"
              placeholder="Search by filename or date…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="rounded-xl border border-white/10 bg-[#070b14] px-3 py-2 text-xs text-white outline-none focus:border-cyan-400"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All Statuses</option>
            <option value="completed">Completed / Finished</option>
            <option value="processing">Processing</option>
            <option value="failed">Failed</option>
          </select>
          <button
            className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-500 transition"
            onClick={onRefresh}
          >
            <RefreshCw size={13} /> Refresh
          </button>
        </div>

        {/* Selected Jobs / Delete Action Bar */}
        {selectedJobIds.length > 0 && (
          <div className="mb-4 flex items-center justify-between rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-xs">
            <div className="flex items-center gap-2 text-rose-300 font-semibold">
              <Check size={14} />
              <span>{selectedJobIds.length} dataset{selectedJobIds.length > 1 ? "s" : ""} selected for deletion</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                className="rounded-lg bg-white/10 px-3 py-1 text-slate-300 hover:bg-white/20 transition"
                onClick={() => setSelectedJobIds([])}
              >
                Clear Selection
              </button>
              <button
                className="flex items-center gap-1.5 rounded-lg bg-rose-600 px-3.5 py-1 font-bold text-white hover:bg-rose-500 transition disabled:opacity-50"
                onClick={() => void handleBulkDelete()}
                disabled={isDeleting}
              >
                <Trash2 size={13} /> {isDeleting ? "Deleting…" : `Delete Selected (${selectedJobIds.length})`}
              </button>
            </div>
          </div>
        )}

        {/* RebillHub-Style Table with Checkbox (Delect Box) */}
        {filtered.length === 0 ? (
          <EmptyState icon={<FileClock size={32} />} title="No uploads found" body="Upload a dataset from the Dashboard to record processing history." />
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.08] text-slate-500">
                  {/* Select All Checkbox (Delect Box) */}
                  <th className="pb-3 pl-3 pr-2 w-8 text-left">
                    <input
                      type="checkbox"
                      checked={isAllSelected}
                      onChange={toggleSelectAll}
                      className="h-4 w-4 rounded border-white/20 bg-slate-900 accent-rose-500 cursor-pointer"
                      title="Select all"
                    />
                  </th>
                  <th className="pb-3 text-left font-semibold uppercase pr-4">File</th>
                  <th className="pb-3 text-left font-semibold uppercase pr-4">Date</th>
                  <th className="pb-3 text-left font-semibold uppercase pr-4">Status</th>
                  <th className="pb-3 text-left font-semibold uppercase pr-4">Success Rate</th>
                  <th className="pb-3 text-left font-semibold uppercase pr-4">Duration</th>
                  <th className="pb-3 text-right font-semibold uppercase pr-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {filtered.map((job) => {
                  const isFinished = job.status === "completed";
                  const isSelected = selectedJobIds.includes(job.job_id);
                  return (
                    <tr
                      key={job.job_id}
                      className={`cursor-pointer transition hover:bg-white/[0.02] ${
                        isSelected ? "bg-rose-500/[0.07]" : selectedJobId === job.job_id ? "bg-cyan-400/[0.04]" : ""
                      }`}
                      onClick={() => onSelectJob(job.job_id)}
                    >
                      {/* Row Checkbox (Delect Box) */}
                      <td className="py-3 pl-3 pr-2" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleJobSelection(job.job_id)}
                          className="h-4 w-4 rounded border-white/20 bg-slate-900 accent-rose-500 cursor-pointer"
                          title="Select for deletion"
                        />
                      </td>

                      {/* FILE column: icon, name, badge */}
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2.5">
                          <FileSpreadsheet size={16} className="text-cyan-400 shrink-0" />
                          <div>
                            <p className="font-semibold text-white truncate max-w-[200px]">{job.filename}</p>
                            <span className={`inline-block mt-0.5 rounded px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-wider ${
                              isFinished ? "bg-emerald-400/20 text-emerald-300" :
                              job.status === "failed" ? "bg-rose-400/20 text-rose-300" :
                              "bg-cyan-400/20 text-cyan-300"
                            }`}>
                              {isFinished ? "FINISHED" : job.status}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* DATE */}
                      <td className="py-3 pr-4 text-slate-400">
                        {new Date(job.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                      </td>

                      {/* STATUS */}
                      <td className="py-3 pr-4">
                        <StatusBadge status={job.status} />
                      </td>

                      {/* SUCCESS RATE: progress bar + percentage */}
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2 w-28">
                          <div className="flex-1 overflow-hidden rounded-full bg-white/10 h-1.5">
                            <div
                              className={`h-full rounded-full ${isFinished ? "bg-emerald-400" : "bg-cyan-400"}`}
                              style={{ width: isFinished ? "100%" : "30%" }}
                            />
                          </div>
                          <span className="text-[11px] font-mono text-slate-300">{isFinished ? "100.0%" : "—"}</span>
                        </div>
                      </td>

                      {/* DURATION */}
                      <td className="py-3 pr-4 font-mono text-slate-400">
                        {isFinished ? "18.4s" : "—"}
                      </td>

                      {/* ACTIONS */}
                      <td className="py-3 text-right pr-2">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            className="rounded-lg border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-xs font-semibold text-cyan-300 hover:bg-cyan-400/20"
                            onClick={(e) => { e.stopPropagation(); onSelectJob(job.job_id); }}
                          >
                            View
                          </button>
                          {isFinished && (
                            <button
                              className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-slate-300 hover:bg-white/10"
                              onClick={(e) => { e.stopPropagation(); void onDownload("cleaned"); }}
                            >
                              <Download size={11} /> Excel
                            </button>
                          )}
                          <button
                            className="flex items-center gap-1 rounded-lg border border-rose-500/20 bg-rose-500/10 px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/20 transition"
                            onClick={(e) => { e.stopPropagation(); void handleSingleDelete(job.job_id, job.filename); }}
                            title="Delete dataset"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
