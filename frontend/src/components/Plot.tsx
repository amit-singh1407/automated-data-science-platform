import { useEffect, useRef } from "react";

/**
 * Chart colours, validated for the app's dark surface (#0d1424) with the
 * dataviz palette validator: lightness band, chroma, colour-blind separation
 * and contrast all pass for the three series colours.
 */
export const CHART = {
  series: ["#3987e5", "#d95926", "#199e70"] as const, // blue, orange, aqua
  text: "#cbd5e1",
  muted: "#94a3b8",
  grid: "#1e293b",
  neutral: "#64748b",
  // Diverging blue <-> red with a neutral grey midpoint (for correlations).
  diverging: [
    [0, "#3987e5"],
    [0.5, "#383835"],
    [1, "#e66767"],
  ] as [number, string][],
};

const BASE_LAYOUT = {
  paper_bgcolor: "rgba(0,0,0,0)",
  plot_bgcolor: "rgba(0,0,0,0)",
  font: { color: CHART.text, family: "Inter, Segoe UI, sans-serif", size: 12 },
  margin: { l: 56, r: 16, t: 16, b: 48 },
  xaxis: { gridcolor: CHART.grid, linecolor: CHART.grid, zerolinecolor: CHART.grid, automargin: true },
  yaxis: { gridcolor: CHART.grid, linecolor: CHART.grid, zerolinecolor: CHART.grid, automargin: true },
  legend: { orientation: "h", x: 0, y: 1.12, font: { color: CHART.muted } },
  hoverlabel: { bgcolor: "#0b1120", bordercolor: CHART.grid, font: { color: "#f1f5f9" } },
  barcornerradius: 4,
  bargap: 0.35,
  bargroupgap: 0.1,
};

type Layout = Record<string, unknown>;

function mergeLayout(layout: Layout): Layout {
  return {
    ...BASE_LAYOUT,
    ...layout,
    xaxis: { ...BASE_LAYOUT.xaxis, ...((layout.xaxis as Layout | undefined) ?? {}) },
    yaxis: { ...BASE_LAYOUT.yaxis, ...((layout.yaxis as Layout | undefined) ?? {}) },
  };
}

/**
 * A Plotly chart. Plotly is loaded on first use (it is large), and the chart
 * is redrawn only when its data or layout actually change.
 */
export function Plot({
  data,
  layout = {},
  height = 300,
  label,
}: {
  data: object[];
  layout?: Layout;
  height?: number;
  /** Accessible name for the chart. */
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const signature = JSON.stringify([data, layout]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let cancelled = false;
    void import("plotly.js-dist-min").then(({ default: Plotly }) => {
      if (cancelled) return;
      void Plotly.react(element, data, mergeLayout(layout), {
        responsive: true,
        displaylogo: false,
        modeBarButtonsToRemove: ["lasso2d", "select2d"],
      });
    });
    return () => {
      cancelled = true;
    };
    // `signature` captures data and layout by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  useEffect(() => {
    const element = ref.current;
    return () => {
      if (element) void import("plotly.js-dist-min").then(({ default: Plotly }) => Plotly.purge(element));
    };
  }, []);

  return <div ref={ref} role="img" aria-label={label} style={{ height, width: "100%" }} />;
}
