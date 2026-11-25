import { useMemo, useState } from "react";
import { AlertTriangle, Flag, ListChecks, ScrollText, Search } from "lucide-react";
import { DownloadButton, EmptyState, JobGate, MetricCard, SectionCard, Table, td } from "../components/ui";
import { cellValue, humanize, num } from "../lib/format";
import type { ResultPageProps } from "../navigation";
import type { CleaningResult } from "../types";

export function AuditLogPage(props: ResultPageProps) {
  return (
    <JobGate {...props} icon={<ScrollText size={40} />}>
      {(results) =>
        results.cleaning?.engine === "ECP" ? (
          <AuditView cleaning={results.cleaning} onDownload={(artifact) => void props.onDownload(artifact)} />
        ) : (
          <EmptyState
            icon={<ScrollText size={40} />}
            title="No ECP audit log for this job"
            body="This job was processed before ECP was added. Upload the dataset again to get a full audit log."
          />
        )
      }
    </JobGate>
  );
}

const inputStyle = "rounded-xl border border-white/10 bg-[#070b14] px-3 py-2 text-xs text-white outline-none focus:border-cyan-400";

function AuditView({ cleaning, onDownload }: { cleaning: CleaningResult; onDownload: (artifact: string) => void }) {
  const audit = cleaning.audit_log_sample ?? [];
  const review = cleaning.review_sample ?? [];
  const uncertain = cleaning.uncertain_cases ?? [];
  const [stage, setStage] = useState("all");
  const [action, setAction] = useState("all");
  const [search, setSearch] = useState("");

  const stages = useMemo(() => [...new Set(audit.map((a) => a.stage))].sort(), [audit]);
  const actions = useMemo(() => [...new Set(audit.map((a) => a.action))].sort(), [audit]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return audit.filter((entry) =>
      (stage === "all" || entry.stage === stage)
      && (action === "all" || entry.action === action)
      && (!needle || [entry.column, entry.reason, cellValue(entry.old_value), cellValue(entry.new_value), String(entry.row)]
        .some((text) => String(text ?? "").toLowerCase().includes(needle))),
    );
  }, [audit, stage, action, search]);

  const shown = filtered.slice(0, 500);
  const sampled = (cleaning.audit_log_total ?? 0) > audit.length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Changes recorded" value={num(cleaning.audit_log_total)} sub="cells changed, rows moved or removed" icon={<ListChecks size={17} />} tone="cyan" />
        <MetricCard label="Rows for review" value={num(cleaning.rows?.flagged_for_review)} sub="not changed automatically" icon={<Flag size={17} />} tone="amber" />
        <MetricCard label="Review flags" value={num(cleaning.review_total)} sub="a row can have more than one" icon={<AlertTriangle size={17} />} tone="violet" />
        <MetricCard label="Open issues" value={num(uncertain.length)} sub="grouped by stage, column and issue" icon={<ScrollText size={17} />} tone="blue" />
      </div>

      <SectionCard
        title="Audit Log"
        icon={<ScrollText size={18} />}
        action={<DownloadButton primary onClick={() => onDownload("log")}>Full audit log (CSV)</DownloadButton>}
      >
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <label className="relative min-w-[220px] flex-1">
            <span className="sr-only">Search the audit log</span>
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input className={`${inputStyle} w-full pl-9`} placeholder="Search row, column, value or reason…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <label className="text-xs text-slate-400">
            <span className="sr-only">Stage</span>
            <select className={inputStyle} value={stage} onChange={(e) => setStage(e.target.value)}>
              <option value="all">All stages</option>
              {stages.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-400">
            <span className="sr-only">Action</span>
            <select className={inputStyle} value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="all">All actions</option>
              {actions.map((a) => <option key={a} value={a}>{humanize(a)}</option>)}
            </select>
          </label>
        </div>

        {sampled && (
          <p className="mb-3 text-xs text-slate-400">
            Showing a sample of {num(audit.length)} of {num(cleaning.audit_log_total)} changes (an equal share from each stage).
            The full log is in the CSV download.
          </p>
        )}

        {filtered.length === 0 ? (
          <p className="text-sm text-slate-400">{audit.length ? "No changes match these filters." : "ECP made no changes to this dataset."}</p>
        ) : (
          <>
            <Table compact head={["Stage", "Row", "Column", "Action", "Old value", "New value", "Reason"]}>
              {shown.map((entry, i) => (
                <tr key={`${entry.stage}-${entry.row}-${entry.column}-${i}`}>
                  <td className={`${td} font-mono text-cyan-200`}>{entry.stage}</td>
                  <td className={`${td} font-mono`}>{entry.row}</td>
                  <td className={`${td} font-mono text-slate-300`}>{entry.column ?? "(whole row)"}</td>
                  <td className={td}>{humanize(entry.action)}</td>
                  <td className={`${td} max-w-[200px] break-words text-slate-400`}>{entry.column ? cellValue(entry.old_value) : "—"}</td>
                  <td className={`${td} max-w-[200px] break-words text-white`}>{entry.column ? cellValue(entry.new_value) : "—"}</td>
                  <td className={`${td} min-w-[240px] text-slate-400`}>{entry.reason}</td>
                </tr>
              ))}
            </Table>
            {filtered.length > shown.length && (
              <p className="mt-3 text-xs text-slate-500">Showing the first {num(shown.length)} of {num(filtered.length)} matching entries.</p>
            )}
          </>
        )}
      </SectionCard>

      <SectionCard
        title="Review Queue"
        icon={<Flag size={18} />}
        action={<DownloadButton onClick={() => onDownload("review")}>Full review queue (CSV)</DownloadButton>}
      >
        <p className="mb-3 text-sm text-slate-400">
          Rows that look wrong but could not be repaired safely. ECP leaves them unchanged so a person can decide.
          {(cleaning.review_total ?? 0) > review.length && ` Showing ${num(review.length)} of ${num(cleaning.review_total)} flags.`}
        </p>
        {review.length === 0 ? (
          <p className="text-sm text-slate-300">Nothing was sent for review.</p>
        ) : (
          <Table compact head={["Row", "Stage", "Column", "Issue", "Value", "Reason"]}>
            {review.map((entry, i) => (
              <tr key={`${entry.row}-${entry.issue}-${i}`}>
                <td className={`${td} font-mono`}>{entry.row}</td>
                <td className={`${td} font-mono text-cyan-200`}>{entry.stage}</td>
                <td className={`${td} font-mono`}>{entry.column ?? "—"}</td>
                <td className={td}>{humanize(entry.issue)}</td>
                <td className={`${td} text-white`}>{cellValue(entry.value)}</td>
                <td className={`${td} min-w-[240px] text-slate-400`}>{entry.reason}</td>
              </tr>
            ))}
          </Table>
        )}
      </SectionCard>

      {uncertain.length > 0 && (
        <SectionCard title="Open Issues by Type" icon={<AlertTriangle size={18} />}>
          <Table compact head={["Stage", "Column", "Issue", "Rows", "Reason"]}>
            {uncertain.map((c, i) => (
              <tr key={i}>
                <td className={`${td} font-mono text-cyan-200`}>{c.stage ?? "—"}</td>
                <td className={`${td} font-mono`}>{c.column ?? "—"}</td>
                <td className={td}>{humanize(c.issue)}</td>
                <td className={td}>{c.rows !== undefined ? num(c.rows) : c.missing_ratio !== undefined ? `${(c.missing_ratio * 100).toFixed(1)}% blank` : "—"}</td>
                <td className={`${td} text-slate-400`}>{c.reason}</td>
              </tr>
            ))}
          </Table>
        </SectionCard>
      )}
    </div>
  );
}
