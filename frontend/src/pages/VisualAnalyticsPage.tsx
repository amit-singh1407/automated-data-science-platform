import { useState } from "react";
import { AlertCircle, BarChart3, Grid3x3, ListChecks, TrendingUp, Zap } from "lucide-react";
import { CHART, Plot } from "../components/Plot";
import { EmptyState, JobGate, MetricCard, SectionCard } from "../components/ui";
import { num, signed } from "../lib/format";
import type { ResultPageProps } from "../navigation";
import type { Visualizations } from "../types";

export function VisualAnalyticsPage(props: ResultPageProps) {
  return (
    <JobGate {...props} icon={<BarChart3 size={40} />}>
      {(results) =>
        results.visualizations?.quality_comparison ? (
          <VisualView visuals={results.visualizations} />
        ) : (
          <EmptyState title="Charts not available" body="This job has no chart data." />
        )
      }
    </JobGate>
  );
}

function VisualView({ visuals }: { visuals: Visualizations }) {
  const quality = visuals.quality_comparison!;
  const missing = visuals.missing_values;
  const distributions = visuals.distributions ?? {};
  const distributionColumns = Object.keys(distributions);
  const [column, setColumn] = useState(distributionColumns[0] ?? "");
  const legacy = !missing && !visuals.correlation && distributionColumns.length === 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Quality before cleaning" value={num(quality.before, 1)} icon={<BarChart3 size={17} />} tone="blue" />
        <MetricCard label="Quality after cleaning" value={num(quality.after, 1)} icon={<TrendingUp size={17} />} tone="green" />
        <MetricCard label="Change" value={`${signed(quality.change)} pts`} icon={<Zap size={17} />} tone="cyan" />
        <MetricCard
          label="Rows before → after"
          value={missing ? `${num(missing.rows_before)} → ${num(missing.rows_after)}` : "—"}
          icon={<ListChecks size={17} />}
          tone="violet"
        />
      </div>

      {legacy && (
        <EmptyState
          title="This job was processed before the new charts were added"
          body="Upload the dataset again to see missing values, distributions and correlations."
        />
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {missing && <MissingChart missing={missing} />}
        {visuals.cleaning_summary?.cells_changed && (
          <SectionCard title="What Each ECP Stage Did" icon={<ListChecks size={18} />}>
            <Plot
              label="Cells changed, rows moved or removed, and rows flagged for each cleaning stage"
              data={[
                { name: "Cells changed", values: visuals.cleaning_summary.cells_changed },
                { name: "Rows moved or removed", values: visuals.cleaning_summary.rows_moved_or_removed },
                { name: "Rows flagged for review", values: visuals.cleaning_summary.rows_flagged },
              ].map((series, i) => ({
                type: "bar", name: series.name,
                x: visuals.cleaning_summary!.labels, y: series.values,
                marker: { color: CHART.series[i] },
                hovertemplate: `%{x}<br>${series.name}: %{y:,}<extra></extra>`,
              }))}
              layout={{ barmode: "group", yaxis: { title: { text: "Count" } } }}
            />
          </SectionCard>
        )}
      </div>

      {distributionColumns.length > 0 && (
        <SectionCard
          title="Distribution after Cleaning"
          icon={<BarChart3 size={18} />}
          action={
            <label className="flex items-center gap-2 text-xs text-slate-400">
              Column
              <select
                className="rounded-lg border border-white/10 bg-[#070b14] px-2.5 py-1.5 text-xs text-white outline-none focus:border-cyan-400"
                value={column}
                onChange={(e) => setColumn(e.target.value)}
              >
                {distributionColumns.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          }
        >
          {distributions[column] && <Histogram name={column} data={distributions[column]} />}
        </SectionCard>
      )}

      {visuals.correlation && <Correlation correlation={visuals.correlation} />}

      {visuals.unusual_values && visuals.unusual_values.columns.length > 0 && (
        <SectionCard title="Unusual Values by Column (for reference)" icon={<AlertCircle size={18} />}>
          <Plot
            label="Number of unusual values per numeric column using the IQR rule"
            height={260}
            data={[{
              type: "bar", x: visuals.unusual_values.columns, y: visuals.unusual_values.counts,
              marker: { color: CHART.series[0] }, hovertemplate: "%{x}: %{y:,} values<extra></extra>",
            }]}
            layout={{ yaxis: { title: { text: "Values outside 1.5 × IQR" } } }}
          />
          <p className="mt-2 text-xs text-slate-500">
            {visuals.unusual_values.method}. ECP does not use this rule: S6 scores each product separately because one shop sells both very cheap and very expensive items.
          </p>
        </SectionCard>
      )}
    </div>
  );
}

function MissingChart({ missing }: { missing: NonNullable<Visualizations["missing_values"]> }) {
  const keep = missing.columns.map((_, i) => i).filter((i) => missing.before[i] > 0 || missing.after[i] > 0);
  return (
    <SectionCard title="Blank Values Before and After Cleaning" icon={<AlertCircle size={18} />}>
      {keep.length === 0 ? (
        <p className="text-sm text-slate-300">No blank values before or after cleaning.</p>
      ) : (
        <Plot
          label="Blank values per column before and after cleaning"
          data={[
            { name: "Before cleaning", values: missing.before },
            { name: "After cleaning", values: missing.after },
          ].map((series, i) => ({
            type: "bar", name: series.name,
            x: keep.map((k) => missing.columns[k]), y: keep.map((k) => series.values[k]),
            marker: { color: CHART.series[i] },
            hovertemplate: `%{x}<br>${series.name}: %{y:,}<extra></extra>`,
          }))}
          layout={{ barmode: "group", yaxis: { title: { text: "Blank values" } } }}
        />
      )}
    </SectionCard>
  );
}

function Histogram({ name, data }: { name: string; data: { edges: number[]; counts: number[]; excluded_extremes: number } }) {
  const centres = data.counts.map((_, i) => (data.edges[i] + data.edges[i + 1]) / 2);
  const widths = data.counts.map((_, i) => data.edges[i + 1] - data.edges[i]);
  return (
    <>
      <Plot
        label={`Distribution of ${name}`}
        data={[{
          type: "bar", x: centres, y: data.counts, width: widths.map((w) => w * 0.92),
          marker: { color: CHART.series[0] },
          customdata: data.counts.map((_, i) => [data.edges[i], data.edges[i + 1]]),
          hovertemplate: "%{customdata[0]:.3~f} to %{customdata[1]:.3~f}: %{y:,} rows<extra></extra>",
        }]}
        layout={{ bargap: 0, xaxis: { title: { text: name } }, yaxis: { title: { text: "Rows" } } }}
      />
      {data.excluded_extremes > 0 && (
        <p className="mt-2 text-xs text-slate-500">
          {num(data.excluded_extremes)} values below the 1st or above the 99th percentile are not drawn, so a few extreme values do not hide the rest.
        </p>
      )}
    </>
  );
}

function Correlation({ correlation }: { correlation: NonNullable<Visualizations["correlation"]> }) {
  const size = correlation.columns.length;
  return (
    <SectionCard title="Correlation Between Numeric Columns" icon={<Grid3x3 size={18} />}>
      <Plot
        label="Pearson correlation between numeric columns after cleaning"
        height={Math.min(560, 160 + size * 36)}
        data={[{
          type: "heatmap",
          z: correlation.matrix, x: correlation.columns, y: correlation.columns,
          zmin: -1, zmax: 1, colorscale: CHART.diverging, xgap: 2, ygap: 2,
          colorbar: { title: { text: "r" }, tickvals: [-1, -0.5, 0, 0.5, 1], outlinewidth: 0 },
          hovertemplate: "%{y} vs %{x}: r = %{z:.2f}<extra></extra>",
        }]}
        layout={{ margin: { l: 120, r: 16, t: 8, b: 100 }, yaxis: { autorange: "reversed" } }}
      />
      <p className="mt-2 text-xs text-slate-500">
        Pearson correlation on the cleaned data. Red = move together, blue = move in opposite directions, grey = no linear relationship.
      </p>
    </SectionCard>
  );
}
