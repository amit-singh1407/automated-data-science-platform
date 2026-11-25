import { useState } from "react";
import type { DragEvent } from "react";
import {
  CheckCircle2, Circle, Database, FileClock, Loader2, RefreshCw, Sparkles, TrendingUp, Upload, UploadCloud, XCircle, Zap,
} from "lucide-react";
import { MetricCard, SectionCard, StatusBadge } from "../components/ui";
import { dateTime, num, shortId } from "../lib/format";
import type { JobHistoryItem, JobStatusResponse } from "../types";

/** Progress value (from the backend) at which each step is finished. */
const PIPELINE_STEPS = [
  { label: "Data profiling", desc: "Types, blanks, duplicates, statistics", doneAt: 25 },
  { label: "ECP cleaning (S1-S7)", desc: "Standardise, deduplicate, shop rules, dependencies, unusual values, fill", doneAt: 45 },
  { label: "Data transformation", desc: "Date features, scaling, feature engineering", doneAt: 60 },
  { label: "Machine learning", desc: "Model training and evaluation, or clustering", doneAt: 75 },
  { label: "Visual analytics", desc: "Chart data before and after cleaning", doneAt: 75 },
  { label: "Reports & downloads", desc: "Cleaned data, audit log, review queue, PDF", doneAt: 100 },
];

export function DashboardPage({
  jobs, selectedJobId, selectedJob, jobStatus, selectedFile, uploading, message,
  onSelectJob, onFileSelect, onUpload, onRefreshHistory,
}: {
  jobs: JobHistoryItem[];
  selectedJobId: string;
  selectedJob?: JobHistoryItem;
  jobStatus: JobStatusResponse | null;
  selectedFile: File | null;
  uploading: boolean;
  message: string;
  onSelectJob: (id: string) => void;
  onFileSelect: (file: File | null) => void;
  onUpload: () => void;
  onRefreshHistory: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const completed = jobs.filter((j) => j.status === "completed");
  const inProgress = jobs.filter((j) => j.status === "processing" || j.status === "queued").length;
  const scored = completed.filter((j) => typeof j.quality_after === "number");
  const averageQuality = scored.length
    ? scored.reduce((sum, j) => sum + (j.quality_after as number), 0) / scored.length
    : null;

  const status = jobStatus?.status ?? selectedJob?.status;
  const progress = status === "completed" ? 100 : jobStatus?.progress ?? selectedJob?.progress ?? 0;

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) onFileSelect(file);
  }

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-3xl border border-cyan-400/15 bg-gradient-to-br from-[#11243b] via-[#0d1729] to-[#0b1120] p-6 md:p-8">
        <div className="absolute -right-20 -top-24 h-64 w-64 rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="relative">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">
            <Sparkles size={14} /> Data Operations Center
          </div>
          <h2 className="max-w-2xl text-3xl font-bold tracking-tight text-white md:text-4xl">
            Automated, audited cleaning for order data.
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
            Upload a dataset once. ECP cleans it in seven audited stages without deleting genuine sales,
            then AutoData AI profiles, transforms and models the result and builds the reports.
          </p>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Datasets processed" value={jobs.length} icon={<Database size={17} />} tone="blue" />
        <MetricCard label="Completed jobs" value={completed.length} icon={<CheckCircle2 size={17} />} tone="green" />
        <MetricCard label="In progress" value={inProgress} icon={<Loader2 size={17} className={inProgress ? "animate-spin" : ""} />} tone="violet" />
        <MetricCard
          label="Average quality after cleaning"
          value={averageQuality === null ? "—" : `${averageQuality.toFixed(1)} / 100`}
          sub={scored.length ? `across ${scored.length} completed job${scored.length > 1 ? "s" : ""}` : "no completed jobs yet"}
          icon={<TrendingUp size={17} />}
          tone="amber"
        />
      </div>

      <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.035] px-4 py-3 text-sm text-slate-300" role="status">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-cyan-300" />
          <span className="truncate">{message}</span>
        </div>
        {selectedJobId && <span className="shrink-0 font-mono text-xs text-slate-400">Job {shortId(selectedJobId)}</span>}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Upload Dataset" icon={<UploadCloud size={18} />}>
          <p className="mb-4 text-sm leading-6 text-slate-400">
            CSV, XLS, XLSX or Parquet. Order data with invoice, stock code, quantity and price columns
            runs all seven ECP stages; other data is cleaned in generic mode.
          </p>
          <label
            className={`group mb-4 flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-4 py-7 text-center transition ${
              dragging ? "border-cyan-300 bg-cyan-400/[0.1]" : "border-cyan-400/30 bg-cyan-400/[0.03] hover:border-cyan-300/70 hover:bg-cyan-400/[0.07]"
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            <Upload size={24} className="mb-2 text-cyan-300 transition group-hover:-translate-y-1" />
            <span className="text-sm font-medium text-slate-200">
              {selectedFile ? selectedFile.name : "Click to choose a file, or drag it here"}
            </span>
            <span className="mt-1 text-xs text-slate-500">
              {selectedFile ? `${(selectedFile.size / 1024 / 1024).toFixed(1)} MB` : "Default server limit: 25 MB"}
            </span>
            <input
              className="hidden"
              type="file"
              accept=".csv,.xls,.xlsx,.parquet"
              onChange={(e) => onFileSelect(e.target.files?.[0] ?? null)}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="flex items-center gap-2 rounded-xl bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
              onClick={onUpload}
              disabled={!selectedFile || uploading}
            >
              {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              {uploading ? "Uploading…" : "Upload Dataset"}
            </button>
            <button
              type="button"
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/10"
              onClick={onRefreshHistory}
            >
              <RefreshCw size={14} /> Refresh History
            </button>
          </div>
        </SectionCard>

        <SectionCard title="Recent Datasets" icon={<FileClock size={18} />}>
          {jobs.length === 0 ? (
            <p className="text-sm text-slate-400">No datasets processed yet. Upload a dataset to begin.</p>
          ) : (
            <ul className="max-h-80 space-y-2.5 overflow-auto pr-1">
              {jobs.slice(0, 8).map((job, idx) => (
                <li key={job.job_id}>
                  <button
                    type="button"
                    className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                      selectedJobId === job.job_id
                        ? "border-cyan-400/50 bg-cyan-400/[0.1] text-white"
                        : "border-white/[0.07] bg-white/[0.02] text-slate-300 hover:border-white/20 hover:bg-white/[0.05]"
                    }`}
                    onClick={() => onSelectJob(job.job_id)}
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-cyan-400/35 bg-cyan-400/10 text-xs font-bold text-cyan-300">
                      #{idx + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-semibold text-white">{job.filename}</span>
                        <StatusBadge status={job.status} />
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
                        <span>{dateTime(job.created_at, "short")}{job.rows ? ` · ${num(job.rows)} rows` : ""}</span>
                        <span className="font-mono">{shortId(job.job_id)}</span>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard
        title={selectedJob ? `Pipeline Status · ${selectedJob.filename}` : "Pipeline Status"}
        icon={<Zap size={18} />}
      >
        {!selectedJob ? (
          <p className="text-sm text-slate-400">Select or upload a dataset to see its pipeline.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {PIPELINE_STEPS.map((step, i) => {
              const done = status === "completed" || progress >= step.doneAt;
              const failed = status === "failed" && !done;
              const active = !done && !failed && (status === "processing" || status === "queued")
                && (i === 0 || progress >= PIPELINE_STEPS[i - 1].doneAt);
              return (
                <div key={step.label} className="flex items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                  <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                    done ? "bg-emerald-400/20 text-emerald-300" : failed ? "bg-rose-400/20 text-rose-300"
                      : active ? "bg-cyan-400/20 text-cyan-300" : "bg-white/[0.05] text-slate-500"
                  }`}>
                    {done ? <CheckCircle2 size={14} /> : failed ? <XCircle size={14} /> : active ? <Loader2 size={12} className="animate-spin" /> : <Circle size={12} />}
                  </div>
                  <div>
                    <p className={`text-sm font-medium ${done ? "text-white" : "text-slate-400"}`}>
                      {i + 1}. {step.label}
                      <span className="sr-only">{done ? " (done)" : failed ? " (not reached, job failed)" : active ? " (running)" : " (waiting)"}</span>
                    </p>
                    <p className="text-xs text-slate-500">{step.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
