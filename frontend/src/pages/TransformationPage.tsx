import { CalendarDays, Columns3, ListChecks, Minus, Scaling, Sparkles, Target } from "lucide-react";
import { EmptyState, JobGate, MetricCard, SectionCard } from "../components/ui";
import { num } from "../lib/format";
import type { ResultPageProps } from "../navigation";
import type { TransformationResult, TransformStep } from "../types";

export function TransformationPage(props: ResultPageProps) {
  return (
    <JobGate {...props} icon={<Sparkles size={40} />}>
      {(results) =>
        results.transformation?.steps ? (
          <TransformationView transformation={results.transformation} />
        ) : (
          <EmptyState title="Transformation data not available" body="This job has no transformation data." />
        )
      }
    </JobGate>
  );
}

const STEP_TITLES: Record<string, string> = {
  remove_constant_features: "Removed constant columns",
  date_feature_extraction: "Extracted year, month and day from a date",
  min_max_scaling: "Scaled numeric columns to 0-1 (min-max)",
  interaction_feature: "Created an interaction feature",
  remove_duplicate_features: "Removed duplicate columns",
};

function stepColumns(step: TransformStep): string[] {
  if (step.columns) return step.columns;
  if (step.features && step.column) return [step.column, "→", ...step.features];
  if (step.column) return [step.column];
  if (step.feature) return [step.feature];
  return [];
}

function TransformationView({ transformation }: { transformation: TransformationResult }) {
  const steps = transformation.steps;
  const ofType = (type: string) => steps.filter((s) => s.step === type);
  const dateFeatures = ofType("date_feature_extraction").reduce((n, s) => n + (s.features?.length ?? 0), 0);
  const scaled = ofType("min_max_scaling").reduce((n, s) => n + (s.columns?.length ?? 0), 0);
  const removed = [...ofType("remove_constant_features"), ...ofType("remove_duplicate_features")]
    .reduce((n, s) => n + (s.columns?.length ?? 0), 0);
  const after = transformation.columns_after_transformation ?? [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <MetricCard label="Steps applied" value={steps.length} icon={<ListChecks size={17} />} tone="cyan" />
        <MetricCard label="Date features created" value={num(dateFeatures)} icon={<CalendarDays size={17} />} tone="violet" />
        <MetricCard label="Columns scaled" value={num(scaled)} icon={<Scaling size={17} />} tone="blue" />
        <MetricCard label="Columns removed" value={num(removed)} icon={<Minus size={17} />} tone="amber" />
        <MetricCard label="Columns after" value={after.length ? num(after.length) : "—"} icon={<Columns3 size={17} />} tone="green" />
      </div>

      <SectionCard title="Target Column" icon={<Target size={18} />}>
        <p className="text-sm text-slate-300">
          {transformation.target_column
            ? <>Column <span className="font-mono text-cyan-200">{transformation.target_column}</span> is the prediction target, so it was left unchanged.</>
            : "No target column (named target, label or y) was found, so all columns were treated as features."}
        </p>
      </SectionCard>

      <SectionCard title="Steps Applied" icon={<ListChecks size={18} />}>
        {steps.length === 0 ? (
          <p className="text-sm text-slate-400">No transformation was needed for this dataset.</p>
        ) : (
          <ol className="space-y-2">
            {steps.map((step, i) => (
              <li key={i} className="flex items-start gap-3 rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2.5">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cyan-400/20 text-[10px] font-bold text-cyan-300">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white">{STEP_TITLES[step.step] ?? step.step}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {stepColumns(step).map((col, j) => (
                      col === "→"
                        ? <span key={j} className="text-xs text-slate-500">→</span>
                        : <span key={j} className="rounded bg-cyan-400/10 px-1.5 py-0.5 font-mono text-xs text-cyan-300">{col}</span>
                    ))}
                  </div>
                  {step.reason && <p className="mt-1 text-xs text-slate-400">{step.reason}</p>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </SectionCard>

      {after.length > 0 && (
        <SectionCard title="Columns in the Transformed Dataset" icon={<Columns3 size={18} />}>
          <div className="flex flex-wrap gap-1.5">
            {after.map((col) => (
              <span key={col} className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-0.5 font-mono text-xs text-slate-300">{col}</span>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}
