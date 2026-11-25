import type { ReactElement, ReactNode } from "react";
import { AlertCircle, CheckCircle2, Database, Download, Info, Loader2, XCircle } from "lucide-react";
import type { JobHistoryItem, JobResultResponse, JobStatusResponse } from "../types";

// ─── Layout pieces ────────────────────────────────────────────────────────────
export function PageHeader({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-300">AutoData AI Platform</p>
      <h2 className="text-2xl font-bold tracking-tight text-white">{title}</h2>
      <p className="mt-1 text-sm text-slate-400">{description}</p>
    </div>
  );
}

export function EmptyState({ icon, title, body, tone = "neutral" }: {
  icon?: ReactNode; title: string; body: ReactNode; tone?: "neutral" | "error";
}) {
  const border = tone === "error" ? "border-rose-400/30 bg-rose-400/[0.04]" : "border-white/10 bg-white/[0.02]";
  return (
    <div className={`flex flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-16 text-center ${border}`}>
      <div className={`mb-4 ${tone === "error" ? "text-rose-300" : "text-slate-600"}`}>{icon ?? <Database size={40} />}</div>
      <h3 className="text-base font-semibold text-white">{title}</h3>
      <div className="mt-2 max-w-lg text-sm text-slate-400">{body}</div>
    </div>
  );
}

export function ProcessingBanner({ status }: { status: JobStatusResponse }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.07] px-4 py-3 text-sm text-cyan-200" role="status">
      <Loader2 size={16} className="shrink-0 animate-spin" />
      <span>
        Pipeline in progress: {status.progress}%{status.progress_message ? ` · ${status.progress_message}` : ""}
      </span>
      <div className="ml-auto h-1.5 w-32 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-cyan-400 transition-all duration-500" style={{ width: `${status.progress}%` }} />
      </div>
    </div>
  );
}

export function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warning" }) {
  const style = tone === "warning"
    ? "border-amber-400/25 bg-amber-400/[0.06] text-amber-100"
    : "border-cyan-400/20 bg-cyan-400/[0.05] text-slate-300";
  return (
    <div className={`flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm ${style}`}>
      <Info size={15} className="mt-0.5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

type Tone = "blue" | "green" | "violet" | "amber" | "cyan" | "rose";
const TONES: Record<Tone, string> = {
  blue: "bg-blue-400/10 text-blue-300",
  green: "bg-emerald-400/10 text-emerald-300",
  violet: "bg-violet-400/10 text-violet-300",
  amber: "bg-amber-400/10 text-amber-300",
  cyan: "bg-cyan-400/10 text-cyan-300",
  rose: "bg-rose-400/10 text-rose-300",
};

export function MetricCard({ label, value, icon, tone, sub }: {
  label: string; value: ReactNode; icon: ReactNode; tone: Tone; sub?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-[#0d1424] p-4 shadow-lg shadow-black/10">
      <div className={`mb-3 flex h-8 w-8 items-center justify-center rounded-lg ${TONES[tone]}`}>{icon}</div>
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-1 truncate text-xl font-bold text-white">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p>}
    </div>
  );
}

export function SectionCard({ title, icon, children, className, action }: {
  title: string; icon?: ReactElement; children: ReactNode; className?: string; action?: ReactNode;
}) {
  return (
    <section className={`min-w-0 rounded-2xl border border-white/[0.08] bg-[#0d1424] p-5 shadow-xl shadow-black/10 ${className ?? ""}`}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {icon && <span className="text-cyan-300">{icon}</span>}
        <h3 className="font-semibold text-white">{title}</h3>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {children}
    </section>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed: "bg-emerald-400/10 text-emerald-300",
    processing: "bg-cyan-400/10 text-cyan-300",
    queued: "bg-amber-400/10 text-amber-300",
    failed: "bg-rose-400/10 text-rose-300",
    skipped: "bg-slate-400/10 text-slate-300",
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

/** Pass/fail pill that never relies on colour alone (icon + word). */
export function PassFail({ passed, passLabel = "Passed", failLabel = "Failed" }: {
  passed: boolean; passLabel?: string; failLabel?: string;
}) {
  return passed ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-0.5 text-xs font-semibold text-emerald-300">
      <CheckCircle2 size={12} /> {passLabel}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-rose-400/10 px-2 py-0.5 text-xs font-semibold text-rose-300">
      <XCircle size={12} /> {failLabel}
    </span>
  );
}

export function DownloadButton({ onClick, children, primary = false }: {
  onClick: () => void; children: ReactNode; primary?: boolean;
}) {
  const style = primary
    ? "bg-cyan-400 text-slate-950 hover:bg-cyan-300"
    : "border border-white/15 bg-white/[0.05] text-slate-200 hover:bg-white/10";
  return (
    <button type="button" className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${style}`} onClick={onClick}>
      <Download size={12} /> {children}
    </button>
  );
}

// ─── Tables ───────────────────────────────────────────────────────────────────
export function Table({ head, children, compact = false }: { head: ReactNode[]; children: ReactNode; compact?: boolean }) {
  return (
    <div className="overflow-auto">
      <table className={`w-full ${compact ? "text-xs" : "text-sm"}`}>
        <thead>
          <tr className="border-b border-white/[0.08]">
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap pb-2 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.04] text-slate-300">{children}</tbody>
      </table>
    </div>
  );
}

export const td = "py-2.5 pr-4 align-top";

// ─── Job gate ─────────────────────────────────────────────────────────────────
/**
 * Shows the right state for the selected job (none / queued / processing /
 * failed / loading) and only renders `children` once results exist. Pages put
 * their hooks inside the component passed as children, so the number of hooks
 * never changes between renders (this is what used to crash the ML and Visual
 * Analytics pages when a job finished while they were open).
 */
export function JobGate({ selectedJob, jobStatus, results, icon, children }: {
  selectedJob?: JobHistoryItem;
  jobStatus: JobStatusResponse | null;
  results: JobResultResponse | null;
  icon: ReactNode;
  children: (results: JobResultResponse) => ReactNode;
}) {
  if (!selectedJob) {
    return <EmptyState icon={icon} title="No dataset selected" body="Upload a dataset on the Dashboard, or pick one in Job History." />;
  }
  const status = jobStatus?.status ?? selectedJob.status;
  if (status === "failed") {
    const error = jobStatus?.error_message ?? selectedJob.error_message;
    return (
      <EmptyState
        tone="error"
        icon={<AlertCircle size={40} />}
        title={`Processing failed for ${selectedJob.filename}`}
        body={error ? <code className="break-words text-rose-200">{error}</code> : "The server did not record an error message."}
      />
    );
  }
  if (status === "queued" || status === "processing") {
    return jobStatus ? <ProcessingBanner status={jobStatus} /> : <EmptyState icon={<Loader2 size={40} className="animate-spin" />} title="Checking job status…" body="" />;
  }
  if (!results) {
    return <EmptyState icon={<Loader2 size={40} className="animate-spin" />} title="Loading results…" body={`Fetching the results for ${selectedJob.filename}.`} />;
  }
  return <>{children(results)}</>;
}
