import { Archive, Copy, Database, FileDown, FileSpreadsheet, FileText, Flag, ListChecks, Receipt, Sparkles, Undo2, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import { DownloadButton, JobGate, SectionCard } from "../components/ui";
import { num, signed } from "../lib/format";
import type { ResultPageProps } from "../navigation";
import type { JobResultResponse } from "../types";

export function ReportsPage(props: ResultPageProps) {
  return (
    <JobGate {...props} icon={<FileDown size={40} />}>
      {(results) => <ReportsView results={results} onDownload={(artifact) => void props.onDownload(artifact)} />}
    </JobGate>
  );
}

/** Download links from the server, keyed by the artifact name in the URL. */
const ARTIFACTS: { artifact: string; title: string; description: string; icon: ReactNode; group: "data" | "audit" | "side" }[] = [
  { artifact: "cleaned", title: "Cleaned dataset", description: "Sales rows after ECP, in the same format as the upload", icon: <FileSpreadsheet size={18} />, group: "data" },
  { artifact: "transformed", title: "Transformed features", description: "Cleaned data with date features and scaling, ready for modelling", icon: <Sparkles size={18} />, group: "data" },
  { artifact: "original", title: "Original upload", description: "The file exactly as it was uploaded", icon: <Database size={18} />, group: "data" },
  { artifact: "report", title: "PDF report", description: "Summary of the job: quality, ECP stages, rows, machine learning", icon: <FileText size={18} />, group: "audit" },
  { artifact: "log", title: "Audit log", description: "Every change: stage, row, column, old value, new value, reason", icon: <ListChecks size={18} />, group: "audit" },
  { artifact: "review", title: "Review queue", description: "Rows flagged for a person to check, with the reason", icon: <Flag size={18} />, group: "audit" },
  { artifact: "returns", title: "Returns", description: "Cancelled invoices moved out of sales (S4)", icon: <Undo2 size={18} />, group: "side" },
  { artifact: "fees", title: "Fees and non-product lines", description: "Postage, fees, discounts, samples, manual lines (S4)", icon: <Receipt size={18} />, group: "side" },
  { artifact: "adjustments", title: "Adjustments", description: "Bad-debt adjustments and stock write-offs (S4)", icon: <Wrench size={18} />, group: "side" },
  { artifact: "duplicates", title: "Removed duplicates", description: "Rows removed as duplicates after standardisation (S3)", icon: <Copy size={18} />, group: "side" },
];

function ReportsView({ results, onDownload }: { results: JobResultResponse; onDownload: (artifact: string) => void }) {
  const available = new Set(Object.values(results.download_links).map((url) => url.split("/").pop()));
  const cleaning = results.cleaning;
  const rows = cleaning?.rows;
  const quality = cleaning?.before_after_quality;
  const groups: { key: "data" | "audit" | "side"; title: string }[] = [
    { key: "data", title: "Datasets" },
    { key: "audit", title: "Report and audit" },
    { key: "side", title: "Side tables (rows moved out of sales)" },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        {groups.map((group) => {
          const items = ARTIFACTS.filter((a) => a.group === group.key && available.has(a.artifact));
          if (items.length === 0) return null;
          return (
            <SectionCard key={group.key} title={group.title} icon={<FileDown size={18} />}>
              <ul className="space-y-2.5">
                {items.map((item) => (
                  <li key={item.artifact} className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3.5">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-400/10 text-cyan-300">{item.icon}</div>
                      <div className="min-w-0">
                        <p className="font-semibold text-white">
                          {item.title}
                          {group.key === "side" && rows?.moved?.[item.artifact] !== undefined && (
                            <span className="ml-2 text-xs font-normal text-slate-400">{num(rows.moved[item.artifact])} rows</span>
                          )}
                        </p>
                        <p className="text-xs text-slate-400">{item.description}</p>
                      </div>
                    </div>
                    <DownloadButton onClick={() => onDownload(item.artifact)}>Download</DownloadButton>
                  </li>
                ))}
              </ul>
            </SectionCard>
          );
        })}
        <button
          type="button"
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-400/40 bg-cyan-400/10 py-3 text-sm font-bold text-cyan-200 transition hover:bg-cyan-400/20"
          onClick={() => onDownload("all")}
        >
          <Archive size={16} /> Download all files (ZIP)
        </button>
      </div>

      <SectionCard title="Report Summary" icon={<FileText size={18} />} className="h-fit">
        <dl className="space-y-3 text-sm">
          {quality && (
            <div className="flex justify-between gap-3">
              <dt className="text-slate-400">Quality score</dt>
              <dd className="text-right font-semibold text-white">{num(quality.before, 1)} → {num(quality.after, 1)} ({signed(quality.change)})</dd>
            </div>
          )}
          {rows && (
            <>
              <div className="flex justify-between gap-3"><dt className="text-slate-400">Rows uploaded</dt><dd className="font-semibold text-white">{num(rows.input)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-400">Rows kept as sales</dt><dd className="font-semibold text-white">{num(rows.sales_output)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-400">Rows for review</dt><dd className="font-semibold text-white">{num(rows.flagged_for_review)}</dd></div>
            </>
          )}
          {cleaning?.cells_changed !== undefined && (
            <div className="flex justify-between gap-3"><dt className="text-slate-400">Cells changed by ECP</dt><dd className="font-semibold text-white">{num(cleaning.cells_changed)}</dd></div>
          )}
          {results.machine_learning?.mode && (
            <div className="flex justify-between gap-3"><dt className="text-slate-400">Machine learning</dt><dd className="font-semibold capitalize text-white">{results.machine_learning.mode}</dd></div>
          )}
        </dl>
        {cleaning?.stages && (
          <ul className="mt-4 space-y-1 border-t border-white/[0.08] pt-4 text-xs text-slate-400">
            {cleaning.stages.map((s) => (
              <li key={s.stage} className="flex justify-between gap-2">
                <span><span className="font-mono text-cyan-200">{s.stage}</span> {s.name}</span>
                <span>{s.status === "skipped" ? "skipped" : `${num(s.cells_changed)} changed`}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-5">
          <DownloadButton primary onClick={() => onDownload("report")}>Download PDF report</DownloadButton>
        </div>
      </SectionCard>
    </div>
  );
}
