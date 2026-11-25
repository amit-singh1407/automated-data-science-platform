import {
  ArrowRight, CheckCircle2, ClipboardList, Flag, GitBranch, ListChecks, MoveRight, Receipt, ShieldCheck, TrendingUp, WandSparkles,
} from "lucide-react";
import { EmptyState, JobGate, MetricCard, Notice, PassFail, SectionCard, StatusBadge, Table, td } from "../components/ui";
import { duration, humanize, num, pct, signed } from "../lib/format";
import type { Page, ResultPageProps } from "../navigation";
import type { CleaningResult, EcpStage } from "../types";

export function CleaningPage(props: ResultPageProps) {
  return (
    <JobGate {...props} icon={<WandSparkles size={40} />}>
      {(results) => {
        const cleaning = results.cleaning;
        if (!cleaning?.before_after_quality) {
          return <EmptyState title="Cleaning results not available" body="This job has no cleaning data." />;
        }
        if (cleaning.engine !== "ECP" || !cleaning.stages) {
          return (
            <EmptyState
              icon={<WandSparkles size={40} />}
              title="This job was processed before ECP was added"
              body="Upload the dataset again to clean it with the seven ECP stages."
            />
          );
        }
        return <CleaningView cleaning={cleaning} onNavigate={props.onNavigate} />;
      }}
    </JobGate>
  );
}

type Details = Record<string, unknown>;

/** Short, human-readable facts about what one stage did. */
function stageFacts(stage: EcpStage, details: Details | undefined): string[] {
  if (stage.status === "skipped" || !details) return [];
  const n = (key: string) => (typeof details[key] === "number" ? (details[key] as number) : 0);
  switch (stage.stage) {
    case "S1": {
      const fixes = (details.type_fixes as { column: string; type: string; unparseable?: number }[]) ?? [];
      const unreadable = fixes.reduce((sum, f) => sum + (f.unparseable ?? 0), 0);
      return fixes.length
        ? [`${fixes.length} column types fixed (${fixes.map((f) => `${f.column}: ${f.type}`).join(", ")})`,
          ...(unreadable ? [`${num(unreadable)} values could not be read and were blanked`] : [])]
        : ["Profile taken; no types changed"];
    }
    case "S2": {
      const perColumn = Object.entries((details.cells_standardised as Record<string, number>) ?? {});
      const aliases = Object.entries((details.country_aliases_applied as Record<string, string>) ?? {});
      const fuzzy = Object.entries((details.country_fuzzy_matches as Record<string, string>) ?? {});
      return [
        perColumn.length ? `Cells standardised: ${perColumn.map(([c, v]) => `${c} ${num(v)}`).join(" · ")}` : "No text needed standardising",
        ...(aliases.length ? [`Country aliases: ${aliases.map(([a, b]) => `${a} → ${b}`).join(", ")}`] : []),
        ...(fuzzy.length ? [`Fuzzy country matches: ${fuzzy.map(([a, b]) => `${a} → ${b}`).join(", ")}`] : []),
      ];
    }
    case "S3":
      return [`${num(n("duplicates_removed"))} duplicate rows removed (exact matches after S2, so near-duplicates are included)`];
    case "S4":
      return [
        `Moved: ${num(n("returns"))} returns · ${num(n("adjustments"))} adjustments · ${num(n("fees"))} fee lines`,
        `${num(n("negative_quantities_fixed"))} negative quantities made positive · ${num(n("zero_prices_to_missing"))} zero prices set to blank`,
      ];
    case "S5": {
      const rules = (details.rules as { accepted: boolean; filled: number; fixed: number }[]) ?? [];
      const accepted = rules.filter((r) => r.accepted);
      return [
        `${accepted.length} of ${rules.length} rules met the 90% threshold`,
        `${num(accepted.reduce((s, r) => s + r.filled, 0))} blanks filled · ${num(accepted.reduce((s, r) => s + r.fixed, 0))} values corrected`,
      ];
    }
    case "S6":
      return [
        `Prices: ${num(n("price_outliers"))} unusual · ${num(n("price_kept_as_genuine"))} kept (seen 8+ times) · ${num(n("price_decimal_slips_repaired"))} decimal slips repaired · ${num(n("price_sent_to_review"))} sent to review`,
        `Quantities: ${num(n("quantity_outliers"))} unusual · ${num(n("quantity_kept_as_genuine_repeat") + n("quantity_kept_as_normal_for_customer"))} kept by safety checks · ${num(n("quantity_sent_to_review"))} sent to review (never changed)`,
      ];
    case "S7": {
      const filled = Object.entries((details.prices_filled as Record<string, number>) ?? {});
      const generic = Object.entries((details.filled as Record<string, number>) ?? {});
      if (generic.length) return [`General fill: ${generic.map(([c, v]) => `${c} ${num(v)}`).join(" · ")}`];
      return [
        filled.length ? `Prices filled: ${filled.map(([how, v]) => `${num(v)} from ${how}`).join(" · ")}` : "No missing prices to fill",
        ...(n("prices_still_missing") ? [`${num(n("prices_still_missing"))} prices could not be filled (sent to review)`] : []),
      ];
    }
    default:
      return [];
  }
}

function CleaningView({ cleaning, onNavigate }: { cleaning: CleaningResult; onNavigate: (page: Page) => void }) {
  const rows = cleaning.rows;
  const quality = cleaning.before_after_quality;
  const moved = Object.entries(rows?.moved ?? {});
  const movedTotal = moved.reduce((sum, [, n]) => sum + n, 0);
  const rules = cleaning.dependency_rules ?? [];
  const checks = cleaning.validation ?? [];
  const totals = cleaning.invoice_totals;
  const mapping = Object.entries(cleaning.column_mapping ?? {});

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-cyan-400/20 bg-gradient-to-r from-cyan-400/[0.08] via-blue-500/[0.05] to-transparent p-4">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-300">E-commerce Cleaning Pipeline</span>
          <h3 className="text-xl font-bold text-white">
            {cleaning.mode === "retail" ? "Order data: all seven stages ran" : "Generic mode: order stages skipped"}
          </h3>
          <p className="mt-1 text-sm text-slate-400">{cleaning.mode_reason}</p>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-3.5 py-2 text-sm font-semibold text-cyan-200 hover:bg-cyan-400/20"
          onClick={() => onNavigate("Audit Log")}
        >
          Open audit log <ArrowRight size={14} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <MetricCard label="Rows kept as sales" value={num(rows?.sales_output)} sub={`of ${num(rows?.input)} uploaded`} icon={<CheckCircle2 size={17} />} tone="green" />
        <MetricCard label="Cells changed" value={num(cleaning.cells_changed)} sub="each one in the audit log" icon={<WandSparkles size={17} />} tone="cyan" />
        <MetricCard label="Rows moved out" value={num(movedTotal)} sub={moved.length ? moved.map(([t, n]) => `${t} ${num(n)}`).join(" · ") : "none"} icon={<MoveRight size={17} />} tone="blue" />
        <MetricCard label="Rows for review" value={num(rows?.flagged_for_review)} sub={rows?.input ? pct((rows.flagged_for_review ?? 0) / rows.input) + " of rows" : undefined} icon={<Flag size={17} />} tone="amber" />
        <MetricCard
          label="Quality score"
          value={`${num(quality.before, 1)} → ${num(quality.after, 1)}`}
          sub={`${signed(quality.change)} points`}
          icon={<TrendingUp size={17} />}
          tone="violet"
        />
      </div>

      {mapping.length > 0 && (
        <SectionCard title="Columns Recognised" icon={<ClipboardList size={18} />}>
          <div className="flex flex-wrap gap-2">
            {mapping.map(([role, column]) => (
              <span key={role} className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs text-slate-300">
                {humanize(role)}: <span className="font-mono text-cyan-200">{column}</span>
              </span>
            ))}
          </div>
        </SectionCard>
      )}

      <SectionCard title="Stages S1-S7" icon={<ListChecks size={18} />}>
        <ol className="space-y-2.5">
          {(cleaning.stages ?? []).map((stage) => {
            const facts = stageFacts(stage, cleaning.stage_details?.[stage.stage] as Details | undefined);
            return (
              <li key={stage.stage} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="rounded-md bg-cyan-400/15 px-2 py-0.5 font-mono text-xs font-bold text-cyan-200">{stage.stage}</span>
                  <span className="font-semibold text-white">{stage.name}</span>
                  <StatusBadge status={stage.status} />
                  {stage.status === "completed" && (
                    <span className="ml-auto flex flex-wrap gap-x-4 text-xs text-slate-400">
                      <span>{num(stage.cells_changed)} changed</span>
                      <span>{num(stage.rows_moved_or_removed)} moved/removed</span>
                      <span>{num(stage.rows_flagged)} flagged</span>
                      <span>{duration(stage.duration_ms)}</span>
                    </span>
                  )}
                </div>
                {stage.status === "skipped" && <p className="mt-1.5 text-xs text-slate-500">{stage.reason}</p>}
                {facts.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-xs text-slate-400">
                    {facts.map((fact) => <li key={fact}>{fact}</li>)}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      </SectionCard>

      {rules.length > 0 && (
        <SectionCard title="S5 Dependency Rules" icon={<GitBranch size={18} />}>
          <Table head={["Rule", "Rows that follow it", "Groups tested", "Used?", "Blanks filled", "Values corrected"]}>
            {rules.map((rule) => (
              <tr key={rule.rule}>
                <td className={`${td} font-mono text-xs text-cyan-200`}>{rule.rule.replace("->", "→")}</td>
                <td className={td}>{rule.support === null ? "not testable" : pct(rule.support)}</td>
                <td className={td}>{num(rule.groups_tested)}</td>
                <td className={td}><PassFail passed={rule.accepted} passLabel="Used" failLabel="Below 90%" /></td>
                <td className={td}>{num(rule.filled)}</td>
                <td className={td}>{num(rule.fixed)}</td>
              </tr>
            ))}
          </Table>
          <p className="mt-3 text-xs text-slate-500">
            A rule is used only if at least 90% of rows follow it. Values are filled or corrected only where more than half of the group agrees.
          </p>
        </SectionCard>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {totals && (
          <SectionCard title="Invoice Totals" icon={<Receipt size={18} />}>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-xs text-slate-500">Invoices</dt><dd className="text-lg font-semibold text-white">{num(totals.invoices)}</dd></div>
              <div><dt className="text-xs text-slate-500">Changed by more than 1%</dt><dd className="text-lg font-semibold text-white">{num(totals.invoices_changed_over_1pct)}</dd></div>
              <div><dt className="text-xs text-slate-500">Sales value before</dt><dd className="text-lg font-semibold text-white">{num(totals.sales_value_before, 2)}</dd></div>
              <div><dt className="text-xs text-slate-500">Sales value after</dt><dd className="text-lg font-semibold text-white">{num(totals.sales_value_after, 2)}</dd></div>
              <div className="col-span-2"><dt className="text-xs text-slate-500">Value added by filling missing prices (S7)</dt><dd className="text-lg font-semibold text-white">{num(totals.value_added_by_price_fills, 2)}</dd></div>
            </dl>
            <p className="mt-3 text-xs text-slate-500">{totals.note}</p>
          </SectionCard>
        )}

        {checks.length > 0 && (
          <SectionCard title="S7 Validation Checks" icon={<ShieldCheck size={18} />}>
            <ul className="space-y-2">
              {checks.map((check) => (
                <li key={check.check} className="flex items-start gap-3 rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-200">{check.check.replace("->", "→")}</p>
                    <p className="text-xs text-slate-500">{check.detail}{check.failures ? ` (${num(check.failures)})` : ""}</p>
                  </div>
                  <PassFail passed={check.passed} />
                </li>
              ))}
            </ul>
          </SectionCard>
        )}
      </div>

      {cleaning.mode === "generic" && (
        <Notice>
          S4-S6 need invoice, stock code, quantity and unit price columns. The S7 fill in generic mode (median or most common value) is a general rule, not part of ECP.
        </Notice>
      )}
    </div>
  );
}
