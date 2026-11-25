import { AlertCircle, BarChart3, Boxes, CheckCircle2, FlaskConical, Gauge, Target, TrendingUp } from "lucide-react";
import { CHART, Plot } from "../components/Plot";
import { EmptyState, JobGate, MetricCard, Notice, SectionCard, Table, td } from "../components/ui";
import { DASH, humanize, num, pct } from "../lib/format";
import type { ResultPageProps } from "../navigation";
import type { MLResult } from "../types";

export function MachineLearningPage(props: ResultPageProps) {
  return (
    <JobGate {...props} icon={<FlaskConical size={40} />}>
      {(results) =>
        results.machine_learning?.mode ? (
          <MachineLearningView ml={results.machine_learning} />
        ) : (
          <EmptyState title="Machine learning results not available" body="This job has no machine learning data." />
        )
      }
    </JobGate>
  );
}

const MODEL_NAMES: Record<string, string> = {
  random_forest_classifier: "Random Forest (classifier)",
  xgboost_classifier: "XGBoost (classifier)",
  random_forest_regressor: "Random Forest (regressor)",
  xgboost_regressor: "XGBoost (regressor)",
};
const modelName = (name?: string) => (name ? MODEL_NAMES[name] ?? humanize(name) : DASH);

function MachineLearningView({ ml }: { ml: MLResult }) {
  if (ml.mode === "none") {
    return (
      <EmptyState
        icon={<FlaskConical size={40} />}
        title="No model was trained for this dataset"
        body={ml.reason ?? "The dataset did not meet the requirements for machine learning."}
      />
    );
  }
  const title = { classification: "Classification", regression: "Regression", unsupervised: "Clustering and anomaly detection" }[ml.mode];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-cyan-400/20 bg-gradient-to-r from-cyan-400/[0.08] via-blue-500/[0.05] to-transparent p-4">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-300">Automated machine learning</span>
          <h3 className="text-xl font-bold text-white">{title}</h3>
          <p className="mt-1 text-sm text-slate-400">
            {ml.mode === "unsupervised"
              ? ml.reason
              : <>Predicting <span className="font-mono text-cyan-200">{ml.target}</span> · {num(ml.rows_used)} rows used{ml.rows_available && ml.rows_available > (ml.rows_used ?? 0) ? ` (sampled from ${num(ml.rows_available)})` : ""} · {num(ml.test_rows)} held out for testing</>}
          </p>
        </div>
        {ml.winner?.model && (
          <span className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-300">
            Best model: <strong className="text-cyan-300">{modelName(ml.winner.model)}</strong>
            {ml.selection_metric && <span className="text-slate-500"> (by {ml.selection_metric})</span>}
          </span>
        )}
      </div>
      {ml.mode === "classification" && <Classification ml={ml} />}
      {ml.mode === "regression" && <Regression ml={ml} />}
      {ml.mode === "unsupervised" && <Unsupervised ml={ml} />}
      {ml.mode !== "unsupervised" && <ModelTable ml={ml} />}
    </div>
  );
}

function FeatureImportance({ ml }: { ml: MLResult }) {
  const top = [...(ml.feature_importance ?? [])].slice(0, 10).reverse();
  if (top.length === 0) return null;
  return (
    <SectionCard title="Most Important Features" icon={<BarChart3 size={18} />}>
      <Plot
        label="Feature importance of the best model"
        height={Math.max(220, top.length * 30)}
        data={[{
          type: "bar", orientation: "h",
          x: top.map((f) => f.importance), y: top.map((f) => f.feature),
          marker: { color: CHART.series[0] },
          hovertemplate: "%{y}: %{x:.3f}<extra></extra>",
        }]}
        layout={{ margin: { l: 140, r: 16, t: 8, b: 40 }, xaxis: { title: { text: "Importance" } } }}
      />
    </SectionCard>
  );
}

function Classification({ ml }: { ml: MLResult }) {
  const w = ml.winner ?? { model: "" };
  const classes = ml.classes ?? [];
  const matrix = w.confusion_matrix;
  const showMatrix = matrix && classes.length > 0 && classes.length <= 10;
  const maxCell = matrix ? Math.max(1, ...matrix.flat()) : 1;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="Accuracy" value={pct(w.accuracy)} icon={<CheckCircle2 size={17} />} tone="green" />
        <MetricCard label="Precision" value={pct(w.precision)} icon={<Target size={17} />} tone="blue" />
        <MetricCard label="Recall" value={pct(w.recall)} icon={<Gauge size={17} />} tone="cyan" />
        <MetricCard label="F1 score" value={pct(w.f1)} icon={<TrendingUp size={17} />} tone="violet" />
        <MetricCard label="ROC AUC" value={pct(w.roc_auc)} icon={<BarChart3 size={17} />} tone="amber" />
        <MetricCard label="MCC" value={w.mcc === null || w.mcc === undefined ? DASH : w.mcc.toFixed(3)} sub="-1 to 1; 0 = chance" icon={<Gauge size={17} />} tone="blue" />
      </div>
      {ml.averaging && <p className="text-xs text-slate-500">Precision, recall and F1: {ml.averaging}.</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        {w.roc_curve ? (
          <SectionCard title="ROC Curve" icon={<TrendingUp size={18} />}>
            <Plot
              label="ROC curve of the best model"
              data={[
                {
                  type: "scatter", mode: "lines", name: "Best model",
                  x: w.roc_curve.fpr, y: w.roc_curve.tpr,
                  line: { color: CHART.series[0], width: 2 },
                  hovertemplate: "False positive rate %{x:.2f}<br>True positive rate %{y:.2f}<extra></extra>",
                },
                {
                  type: "scatter", mode: "lines", name: "Random guess",
                  x: [0, 1], y: [0, 1], line: { color: CHART.neutral, width: 1 }, hoverinfo: "skip",
                },
              ]}
              layout={{
                xaxis: { title: { text: "False positive rate" }, range: [0, 1] },
                yaxis: { title: { text: "True positive rate" }, range: [0, 1.02] },
              }}
            />
          </SectionCard>
        ) : (
          <SectionCard title="ROC Curve" icon={<TrendingUp size={18} />}>
            <p className="text-sm text-slate-400">A ROC curve is drawn for two-class targets only. This target has {classes.length || "several"} classes.</p>
          </SectionCard>
        )}

        <SectionCard title="Confusion Matrix" icon={<Boxes size={18} />}>
          {showMatrix ? (
            <div className="overflow-auto">
              <table className="w-full border-collapse text-center text-xs">
                <thead>
                  <tr>
                    <th className="p-2 text-left font-semibold text-slate-500">Actual ↓ / Predicted →</th>
                    {classes.map((c) => <th key={c} className="p-2 font-semibold text-slate-300">{c}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {matrix.map((row, i) => (
                    <tr key={i}>
                      <th className="p-2 text-left font-semibold text-slate-300">{classes[i]}</th>
                      {row.map((value, j) => (
                        <td
                          key={j}
                          className={`border border-[#0d1424] p-3 font-mono font-semibold ${i === j ? "text-white" : "text-slate-200"}`}
                          style={{ backgroundColor: `rgba(57, 135, 229, ${0.08 + 0.6 * (value / maxCell)})` }}
                          title={`Actual ${classes[i]}, predicted ${classes[j]}: ${value}`}
                        >
                          {num(value)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-slate-500">Diagonal = correct predictions. Darker = more rows.</p>
            </div>
          ) : (
            <p className="text-sm text-slate-400">
              {!matrix ? "No confusion matrix for this job."
                : classes.length === 0 ? "This job did not save class names. Upload the dataset again to see the confusion matrix."
                  : "Too many classes to show as a table."}
            </p>
          )}
        </SectionCard>
      </div>
      <FeatureImportance ml={ml} />
    </>
  );
}

function Regression({ ml }: { ml: MLResult }) {
  const w = ml.winner ?? { model: "" };
  const points = w.actual_vs_predicted;
  const all = points ? [...points.actual, ...points.predicted] : [];
  const low = all.length ? Math.min(...all) : 0;
  const high = all.length ? Math.max(...all) : 1;
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricCard label="R² (share of variation explained)" value={w.r2_score === null || w.r2_score === undefined ? DASH : w.r2_score.toFixed(3)} icon={<TrendingUp size={17} />} tone="violet" />
        <MetricCard label="RMSE (root mean squared error)" value={num(w.rmse, 3)} sub={`in units of ${ml.target}`} icon={<BarChart3 size={17} />} tone="amber" />
        <MetricCard label="MAE (mean absolute error)" value={num(w.mae, 3)} sub={`in units of ${ml.target}`} icon={<Gauge size={17} />} tone="green" />
      </div>
      {points && (
        <SectionCard title="Actual vs Predicted (test rows)" icon={<Target size={18} />}>
          <Plot
            label="Actual against predicted values"
            data={[
              {
                type: "scatter", mode: "markers", name: "Test rows",
                x: points.actual, y: points.predicted,
                marker: { color: CHART.series[0], size: 8, opacity: 0.7, line: { color: "#0d1424", width: 1 } },
                hovertemplate: "Actual %{x:.3f}<br>Predicted %{y:.3f}<extra></extra>",
              },
              {
                type: "scatter", mode: "lines", name: "Perfect prediction",
                x: [low, high], y: [low, high], line: { color: CHART.neutral, width: 1 }, hoverinfo: "skip",
              },
            ]}
            layout={{ xaxis: { title: { text: "Actual" } }, yaxis: { title: { text: "Predicted" } } }}
          />
          <p className="mt-2 text-xs text-slate-500">Up to 300 test rows. Points on the line are predicted exactly.</p>
        </SectionCard>
      )}
      <FeatureImportance ml={ml} />
    </>
  );
}

function Unsupervised({ ml }: { ml: MLResult }) {
  const sizes = ml.cluster_sizes ?? [];
  const profiles = ml.cluster_profiles;
  const kScores = Object.entries(ml.k_scores ?? {});
  const anomalies = ml.anomaly_detection;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Clusters chosen (k)" value={num(ml.clusters)} sub={kScores.length ? `best silhouette of k = ${kScores.map(([k]) => k).join(", ")}` : undefined} icon={<Boxes size={17} />} tone="blue" />
        <MetricCard label="Silhouette score" value={ml.silhouette_score === undefined ? DASH : ml.silhouette_score.toFixed(3)} sub="-1 to 1; higher = better separated" icon={<TrendingUp size={17} />} tone="green" />
        <MetricCard label="Rows clustered" value={num(ml.rows_used)} sub={ml.features ? `${ml.features.length} numeric columns` : undefined} icon={<BarChart3 size={17} />} tone="cyan" />
        <MetricCard
          label="Anomalies (Isolation Forest)"
          value={num(anomalies?.anomalies)}
          sub={anomalies?.share !== undefined ? `${pct(anomalies.share)} of rows` : undefined}
          icon={<AlertCircle size={17} />}
          tone="amber"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {sizes.length > 0 && (
          <SectionCard title="Rows per Cluster" icon={<Boxes size={18} />}>
            <Plot
              label="Number of rows in each cluster"
              height={260}
              data={[{
                type: "bar", x: sizes.map((_, i) => `Cluster ${i + 1}`), y: sizes,
                marker: { color: CHART.series[0] }, hovertemplate: "%{x}: %{y:,} rows<extra></extra>",
              }]}
              layout={{ yaxis: { title: { text: "Rows" } } }}
            />
          </SectionCard>
        )}
        {kScores.length > 0 && (
          <SectionCard title="Choosing k: Silhouette Score per k" icon={<TrendingUp size={18} />}>
            <Plot
              label="Silhouette score for each number of clusters tried"
              height={260}
              data={[{
                type: "bar", x: kScores.map(([k]) => `k = ${k}`), y: kScores.map(([, v]) => v),
                marker: { color: kScores.map(([k]) => (Number(k) === ml.clusters ? CHART.series[0] : CHART.neutral)) },
                hovertemplate: "%{x}: %{y:.3f}<extra></extra>",
              }]}
              layout={{ yaxis: { title: { text: "Silhouette (on a sample)" } } }}
            />
            <p className="mt-2 text-xs text-slate-500">Highlighted bar: the k that was chosen.</p>
          </SectionCard>
        )}
      </div>

      {profiles && profiles.means.length > 0 && (
        <SectionCard title="Cluster Profiles (average of each column)" icon={<BarChart3 size={18} />}>
          <Table compact head={["Cluster", "Rows", ...profiles.columns]}>
            {profiles.means.map((row, i) => (
              <tr key={i}>
                <td className={`${td} font-semibold text-white`}>Cluster {i + 1}</td>
                <td className={td}>{num(sizes[i])}</td>
                {row.map((value, j) => <td key={j} className={td}>{num(value, 3)}</td>)}
              </tr>
            ))}
          </Table>
          <p className="mt-2 text-xs text-slate-500">Values are on the transformed (0-1 scaled) data.</p>
        </SectionCard>
      )}
      <Notice>
        Clustering is used because the dataset has no column named target, label or y. Rename the column you want to predict to
        <span className="font-mono text-cyan-200"> target</span> to train a supervised model instead.
      </Notice>
    </>
  );
}

function ModelTable({ ml }: { ml: MLResult }) {
  const evaluations = ml.evaluations ?? [];
  if (evaluations.length === 0) return null;
  const isClassification = ml.mode === "classification";
  return (
    <SectionCard title="Models Compared" icon={<BarChart3 size={18} />}>
      <Table head={isClassification
        ? ["Model", "Accuracy", "Precision", "Recall", "F1", "ROC AUC", ""]
        : ["Model", "R²", "RMSE", "MAE", ""]}
      >
        {evaluations.map((m) => {
          const best = m.model === ml.winner?.model;
          return (
            <tr key={m.model} className={best ? "bg-emerald-400/[0.04]" : ""}>
              <td className={`${td} font-medium text-white`}>{modelName(m.model)}</td>
              {isClassification ? (
                <>
                  <td className={td}>{pct(m.accuracy)}</td>
                  <td className={td}>{pct(m.precision)}</td>
                  <td className={td}>{pct(m.recall)}</td>
                  <td className={td}>{pct(m.f1)}</td>
                  <td className={td}>{pct(m.roc_auc)}</td>
                </>
              ) : (
                <>
                  <td className={td}>{m.r2_score === null || m.r2_score === undefined ? DASH : m.r2_score.toFixed(3)}</td>
                  <td className={td}>{num(m.rmse, 3)}</td>
                  <td className={td}>{num(m.mae, 3)}</td>
                </>
              )}
              <td className={td}>{best && <span className="rounded bg-emerald-400/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">Best</span>}</td>
            </tr>
          );
        })}
      </Table>
    </SectionCard>
  );
}
