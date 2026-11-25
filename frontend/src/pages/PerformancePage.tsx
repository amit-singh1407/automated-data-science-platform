import { useEffect, useState } from "react";
import { Clock, Cpu, Gauge, Timer } from "lucide-react";
import { getPerformance } from "../api";
import { CHART, Plot } from "../components/Plot";
import { EmptyState, JobGate, MetricCard, Notice, SectionCard, Table, td } from "../components/ui";
import { bytes, duration, getErrorMessage, humanize, num } from "../lib/format";
import type { ResultPageProps } from "../navigation";
import type { CleaningResult, StageTiming } from "../types";

export function PerformancePage(props: ResultPageProps) {
  return (
    <JobGate {...props} icon={<Timer size={40} />}>
      {(results) => <PerformanceView jobId={results.job_id} cleaning={results.cleaning} />}
    </JobGate>
  );
}

function PerformanceView({ jobId, cleaning }: { jobId: string; cleaning: CleaningResult | null }) {
  const [timings, setTimings] = useState<StageTiming[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setTimings(null);
    setError("");
    getPerformance(jobId)
      .then((rows) => { if (active) setTimings(rows); })
      .catch((e) => { if (active) setError(getErrorMessage(e)); });
    return () => { active = false; };
  }, [jobId]);

  if (error) return <EmptyState tone="error" title="Could not load timings" body={error} />;
  if (!timings) return <EmptyState icon={<Clock size={40} />} title="Loading timings…" body="" />;
  if (timings.length === 0) return <EmptyState icon={<Timer size={40} />} title="No timings recorded for this job" body="" />;

  const total = timings.reduce((sum, t) => sum + t.duration_ms, 0);
  const slowest = timings.reduce((a, b) => (b.duration_ms > a.duration_ms ? b : a));
  const rows = Math.max(...timings.map((t) => t.rows_processed));
  const traced = timings.some((t) => t.peak_memory_bytes > 0);
  const ecpStages = (cleaning?.stages ?? []).filter((s) => s.status === "completed");

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Total processing time" value={duration(total)} icon={<Timer size={17} />} tone="cyan" />
        <MetricCard label="Slowest stage" value={humanize(slowest.stage)} sub={duration(slowest.duration_ms)} icon={<Clock size={17} />} tone="amber" />
        <MetricCard label="Rows processed" value={num(rows)} icon={<Gauge size={17} />} tone="blue" />
        <MetricCard label="Throughput" value={total > 0 ? `${num(rows / (total / 1000))} rows/s` : "—"} sub="whole pipeline" icon={<Cpu size={17} />} tone="green" />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title="Time per Pipeline Stage" icon={<Timer size={18} />}>
          <Plot
            label="Duration of each pipeline stage in seconds"
            height={Math.max(220, timings.length * 40)}
            data={[{
              type: "bar", orientation: "h",
              x: timings.map((t) => t.duration_ms / 1000).reverse(),
              y: timings.map((t) => humanize(t.stage)).reverse(),
              marker: { color: CHART.series[0] },
              hovertemplate: "%{y}: %{x:.2f} s<extra></extra>",
            }]}
            layout={{ margin: { l: 110, r: 16, t: 8, b: 40 }, xaxis: { title: { text: "Seconds" } } }}
          />
        </SectionCard>
        {ecpStages.length > 0 && (
          <SectionCard title="Time per ECP Stage (inside cleaning)" icon={<Timer size={18} />}>
            <Plot
              label="Duration of each ECP stage in seconds"
              height={Math.max(220, ecpStages.length * 40)}
              data={[{
                type: "bar", orientation: "h",
                x: ecpStages.map((s) => (s.duration_ms ?? 0) / 1000).reverse(),
                y: ecpStages.map((s) => `${s.stage} ${s.name}`).reverse(),
                marker: { color: CHART.series[0] },
                hovertemplate: "%{y}: %{x:.2f} s<extra></extra>",
              }]}
              layout={{ margin: { l: 150, r: 16, t: 8, b: 40 }, xaxis: { title: { text: "Seconds" } } }}
            />
          </SectionCard>
        )}
      </div>

      <SectionCard title="Stage Details" icon={<Cpu size={18} />}>
        <Table head={["Stage", "Duration", "Share", "Rows processed", "Peak memory"]}>
          {timings.map((t) => (
            <tr key={t.stage}>
              <td className={`${td} font-medium text-white`}>{humanize(t.stage)}</td>
              <td className={td}>{duration(t.duration_ms)}</td>
              <td className={td}>{total ? `${((t.duration_ms / total) * 100).toFixed(1)}%` : "—"}</td>
              <td className={td}>{num(t.rows_processed)}</td>
              <td className={td}>{traced ? bytes(t.peak_memory_bytes) : "not traced"}</td>
            </tr>
          ))}
        </Table>
      </SectionCard>
      {!traced && (
        <Notice>
          Memory is not traced by default because tracing makes processing several times slower. Start the backend with
          <span className="font-mono text-cyan-200"> AUTODATA_TRACE_MEMORY=true</span> to record peak memory per stage.
        </Notice>
      )}
    </div>
  );
}
