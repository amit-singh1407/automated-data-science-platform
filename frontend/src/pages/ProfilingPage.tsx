import { AlertCircle, BarChart3, Copy, Database, ListChecks, TrendingUp } from "lucide-react";
import { EmptyState, JobGate, MetricCard, Notice, SectionCard, Table, td } from "../components/ui";
import { num } from "../lib/format";
import type { ResultPageProps } from "../navigation";
import type { Profile } from "../types";

export function ProfilingPage(props: ResultPageProps) {
  return (
    <JobGate {...props} icon={<Database size={40} />}>
      {(results) =>
        results.profile?.data_types ? (
          <ProfilingView profile={results.profile} />
        ) : (
          <EmptyState title="Profile not available" body="This job has no profile data." />
        )
      }
    </JobGate>
  );
}

function ProfilingView({ profile }: { profile: Profile }) {
  const rows = profile.rows || 0;
  const missing = profile.missing_values ?? {};
  const unusual = profile.unusual_numeric_values ?? {};
  const stats = profile.numeric_summary ?? {};
  const categorical = Object.entries(profile.categorical_summary ?? {}).slice(0, 6);
  const missingCols = Object.entries(missing).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a);
  const share = (n: number) => (rows ? `${((n / rows) * 100).toFixed(1)}%` : "—");

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Rows" value={num(profile.rows)} icon={<Database size={17} />} tone="blue" />
        <MetricCard label="Columns" value={num(profile.columns)} icon={<BarChart3 size={17} />} tone="cyan" />
        <MetricCard label="Quality score (as uploaded)" value={`${num(profile.quality_score, 1)} / 100`} icon={<TrendingUp size={17} />} tone="green" />
        <MetricCard label="Exact duplicate rows" value={num(profile.duplicate_rows)} sub={share(profile.duplicate_rows)} icon={<Copy size={17} />} tone="amber" />
      </div>

      {profile.quality_method && (
        <Notice>
          <strong className="text-white">How the quality score is calculated:</strong> {profile.quality_method}
        </Notice>
      )}

      <SectionCard title="Columns and Detected Types" icon={<Database size={18} />}>
        <Table head={["Column", "Type", "Blank values", "Blank %", "IQR outliers"]}>
          {Object.entries(profile.data_types).map(([col, dtype]) => {
            const blank = missing[col] ?? 0;
            return (
              <tr key={col}>
                <td className={`${td} font-mono text-xs text-cyan-200`}>{col}</td>
                <td className={td}><span className="rounded-md bg-blue-400/10 px-2 py-0.5 font-mono text-xs text-blue-300">{dtype}</span></td>
                <td className={`${td} ${blank ? "font-medium text-amber-300" : "text-slate-400"}`}>{num(blank)}</td>
                <td className={`${td} text-xs text-slate-400`}>{share(blank)}</td>
                <td className={`${td} text-slate-400`}>{col in unusual ? num(unusual[col]) : "—"}</td>
              </tr>
            );
          })}
        </Table>
        <p className="mt-3 text-xs text-slate-500">
          IQR outliers use one rule for the whole column, which ECP deliberately does not rely on (S6 scores each product separately).
          They are shown here for reference only.
        </p>
      </SectionCard>

      <SectionCard title="Blank Values" icon={<AlertCircle size={18} />}>
        {missingCols.length === 0 ? (
          <p className="text-sm text-slate-300">No blank values in any column.</p>
        ) : (
          <div className="space-y-3">
            {missingCols.map(([col, value]) => (
              <div key={col} className="flex items-center gap-3">
                <span className="w-40 shrink-0 truncate font-mono text-xs text-cyan-200">{col}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                  <div className="h-full rounded-full bg-[#3987e5]" style={{ width: `${rows ? Math.min(100, (value / rows) * 100) : 0}%` }} />
                </div>
                <span className="w-32 shrink-0 text-right text-xs text-slate-300">{num(value)} ({share(value)})</span>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {Object.keys(stats).length > 0 && (
        <SectionCard title="Numeric Summary" icon={<TrendingUp size={18} />}>
          <Table compact head={["Column", "Count", "Mean", "Std dev", "Min", "25%", "Median", "75%", "Max"]}>
            {Object.entries(stats).map(([col, s]) => (
              <tr key={col}>
                <td className={`${td} font-mono text-cyan-200`}>{col}</td>
                <td className={td}>{num(s.count)}</td>
                <td className={td}>{num(s.mean, 2)}</td>
                <td className={td}>{num(s.std, 2)}</td>
                <td className={td}>{num(s.min, 2)}</td>
                <td className={td}>{num(s["25%"], 2)}</td>
                <td className={td}>{num(s["50%"], 2)}</td>
                <td className={td}>{num(s["75%"], 2)}</td>
                <td className={td}>{num(s.max, 2)}</td>
              </tr>
            ))}
          </Table>
        </SectionCard>
      )}

      {categorical.length > 0 && (
        <SectionCard title="Most Common Values in Text Columns" icon={<ListChecks size={18} />}>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {categorical.map(([col, values]) => {
              const top = Object.entries(values).slice(0, 5);
              const max = Math.max(...top.map(([, n]) => n), 1);
              return (
                <div key={col} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                  <p className="mb-2 font-mono text-xs text-cyan-200">{col}</p>
                  <ul className="space-y-1.5">
                    {top.map(([value, count]) => (
                      <li key={value} className="text-xs">
                        <div className="flex justify-between gap-2 text-slate-300">
                          <span className="truncate" title={value}>{value === "nan" ? "(blank)" : value}</span>
                          <span className="shrink-0 text-slate-400">{num(count)}</span>
                        </div>
                        <div className="mt-0.5 h-1 rounded-full bg-white/[0.06]">
                          <div className="h-full rounded-full bg-[#3987e5]" style={{ width: `${(count / max) * 100}%` }} />
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}
    </div>
  );
}
