import { useMemo, useState } from "react";
import { AlertCircle, Check, CheckCircle2, Download, FileClock, FileSpreadsheet, Loader2, RefreshCw, Search, Trash2 } from "lucide-react";
import { EmptyState, MetricCard, SectionCard, StatusBadge } from "../components/ui";
import { dateTime, duration, num, signed } from "../lib/format";
import type { JobHistoryItem } from "../types";

export function JobHistoryPage({
  jobs, selectedJobId, onOpenJob, onDownload, onRefresh, onDeleteJob, onDeleteMultiple,
}: {
  jobs: JobHistoryItem[];
  selectedJobId: string;
  onOpenJob: (id: string) => void;
  onDownload: (artifact: string, jobId?: string) => Promise<void>;
  onRefresh: () => void;
  onDeleteJob: (jobId: string) => Promise<void>;
  onDeleteMultiple: (jobIds: string[]) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return jobs.filter((j) =>
      (!needle || j.filename.toLowerCase().includes(needle) || j.job_id.toLowerCase().includes(needle))
      && (statusFilter === "all" || j.status === statusFilter));
  }, [jobs, search, statusFilter]);

  const allSelected = filtered.length > 0 && filtered.every((j) => selected.includes(j.job_id));

  function toggleAll() {
    const ids = filtered.map((j) => j.job_id);
    setSelected(allSelected ? selected.filter((id) => !ids.includes(id)) : [...new Set([...selected, ...ids])]);
  }

  function toggle(id: string) {
    setSelected(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  async function bulkDelete() {
    if (selected.length === 0) return;
    if (!window.confirm(`Delete ${selected.length} job(s) and all their files? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await onDeleteMultiple(selected);
      setSelected([]);
    } finally {
      setDeleting(false);
    }
  }

  async function singleDelete(job: JobHistoryItem) {
    if (!window.confirm(`Delete "${job.filename}" and all its files? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await onDeleteJob(job.job_id);
      setSelected(selected.filter((x) => x !== job.job_id));
    } finally {
      setDeleting(false);
    }
  }

  const input = "rounded-xl border border-white/10 bg-[#070b14] px-3 py-2 text-xs text-white outline-none focus:border-cyan-400";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Total uploads" value={jobs.length} icon={<FileSpreadsheet size={17} />} tone="blue" />
        <MetricCard label="Completed" value={jobs.filter((j) => j.status === "completed").length} icon={<CheckCircle2 size={17} />} tone="green" />
        <MetricCard label="Failed" value={jobs.filter((j) => j.status === "failed").length} icon={<AlertCircle size={17} />} tone="rose" />
        <MetricCard label="Queued or processing" value={jobs.filter((j) => j.status === "processing" || j.status === "queued").length} icon={<Loader2 size={17} />} tone="cyan" />
      </div>

      <SectionCard title="Upload History" icon={<FileClock size={18} />}>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <label className="relative min-w-[200px] flex-1">
            <span className="sr-only">Search jobs</span>
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input className={`${input} w-full pl-9`} placeholder="Search by file name or job ID…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <label>
            <span className="sr-only">Status</span>
            <select className={input} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">All statuses</option>
              <option value="completed">Completed</option>
              <option value="processing">Processing</option>
              <option value="queued">Queued</option>
              <option value="failed">Failed</option>
            </select>
          </label>
          <button type="button" className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-blue-500" onClick={onRefresh}>
            <RefreshCw size={13} /> Refresh
          </button>
        </div>

        {selected.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-xs">
            <div className="flex items-center gap-2 font-semibold text-rose-300">
              <Check size={14} /> {selected.length} job{selected.length > 1 ? "s" : ""} selected
            </div>
            <div className="flex items-center gap-2">
              <button type="button" className="rounded-lg bg-white/10 px-3 py-1 text-slate-300 transition hover:bg-white/20" onClick={() => setSelected([])}>Clear selection</button>
              <button type="button" className="flex items-center gap-1.5 rounded-lg bg-rose-600 px-3.5 py-1 font-bold text-white transition hover:bg-rose-500 disabled:opacity-50" onClick={() => void bulkDelete()} disabled={deleting}>
                <Trash2 size={13} /> {deleting ? "Deleting…" : `Delete selected (${selected.length})`}
              </button>
            </div>
          </div>
        )}

        {filtered.length === 0 ? (
          <EmptyState icon={<FileClock size={32} />} title={jobs.length ? "No jobs match these filters" : "No uploads yet"} body={jobs.length ? "Change the search or status filter." : "Upload a dataset from the Dashboard."} />
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.08] text-slate-500">
                  <th className="w-8 pb-3 pl-3 pr-2 text-left">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-4 w-4 cursor-pointer accent-rose-500" aria-label="Select all shown jobs" />
                  </th>
                  {["File", "Uploaded", "Status", "Rows", "Quality before → after", "Duration", ""].map((h) => (
                    <th key={h} className="pb-3 pr-4 text-left font-semibold uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {filtered.map((job) => {
                  const isSelected = selected.includes(job.job_id);
                  const completed = job.status === "completed";
                  const qualityChange = job.quality_before != null && job.quality_after != null ? job.quality_after - job.quality_before : null;
                  return (
                    <tr key={job.job_id} className={`transition hover:bg-white/[0.02] ${isSelected ? "bg-rose-500/[0.07]" : selectedJobId === job.job_id ? "bg-cyan-400/[0.04]" : ""}`}>
                      <td className="py-3 pl-3 pr-2">
                        <input type="checkbox" checked={isSelected} onChange={() => toggle(job.job_id)} className="h-4 w-4 cursor-pointer accent-rose-500" aria-label={`Select ${job.filename}`} />
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2.5">
                          <FileSpreadsheet size={16} className="shrink-0 text-cyan-400" />
                          <div className="min-w-0">
                            <p className="max-w-[220px] truncate font-semibold text-white" title={job.filename}>{job.filename}</p>
                            {job.status === "failed" && job.error_message && (
                              <p className="max-w-[220px] truncate text-[11px] text-rose-300" title={job.error_message}>{job.error_message}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap py-3 pr-4 text-slate-400">{dateTime(job.created_at)}</td>
                      <td className="py-3 pr-4"><StatusBadge status={job.status} /></td>
                      <td className="py-3 pr-4 text-slate-300">{num(job.rows)}</td>
                      <td className="whitespace-nowrap py-3 pr-4 text-slate-300">
                        {job.quality_before != null ? `${num(job.quality_before, 1)} → ${num(job.quality_after, 1)}` : "—"}
                        {qualityChange !== null && <span className="ml-1.5 text-slate-500">({signed(qualityChange)})</span>}
                      </td>
                      <td className="whitespace-nowrap py-3 pr-4 font-mono text-slate-400">{duration(job.duration_ms)}</td>
                      <td className="py-3 pr-2 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button type="button" className="rounded-lg border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-xs font-semibold text-cyan-300 hover:bg-cyan-400/20" onClick={() => onOpenJob(job.job_id)}>
                            Open
                          </button>
                          {completed && (
                            <button type="button" className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-slate-300 hover:bg-white/10" onClick={() => void onDownload("cleaned", job.job_id)} aria-label={`Download cleaned data for ${job.filename}`}>
                              <Download size={11} /> Cleaned
                            </button>
                          )}
                          <button type="button" className="flex items-center rounded-lg border border-rose-500/20 bg-rose-500/10 px-2 py-1 text-rose-300 transition hover:bg-rose-500/20" onClick={() => void singleDelete(job)} aria-label={`Delete ${job.filename}`} disabled={deleting}>
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
