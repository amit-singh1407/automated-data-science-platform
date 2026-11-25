import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App, { TOKEN_KEY } from "./App";
import type { ResultPageProps } from "./navigation";
import { AuditLogPage } from "./pages/AuditLogPage";
import { CleaningPage } from "./pages/CleaningPage";
import { JobHistoryPage } from "./pages/JobHistoryPage";
import { MachineLearningPage } from "./pages/MachineLearningPage";
import { VisualAnalyticsPage } from "./pages/VisualAnalyticsPage";
import type { CleaningResult, JobHistoryItem, JobResultResponse, JobStatusResponse, MLResult } from "./types";

// Plotly needs a real browser and is loaded on demand by <Plot>. These tests
// check page content, not charts, so <Plot> renders an empty placeholder.
vi.mock("./components/Plot", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./components/Plot")>()),
  Plot: ({ label }: { label: string }) => <div role="img" aria-label={label} />,
}));

const NOW = "2026-11-25T10:00:00+00:00";

function job(overrides: Partial<JobHistoryItem> = {}): JobHistoryItem {
  return { job_id: "job-1-aaaaaaaa", filename: "orders.csv", status: "completed", created_at: NOW, updated_at: NOW, ...overrides };
}

function status(value: JobStatusResponse["status"], progress = 100): JobStatusResponse {
  return { job_id: "job-1-aaaaaaaa", status: value, progress, progress_message: "Transforming features", created_at: NOW, updated_at: NOW };
}

const ecpCleaning: CleaningResult = {
  engine: "ECP",
  mode: "retail",
  mode_reason: "Order columns found; all seven ECP stages ran.",
  column_mapping: { invoice: "InvoiceNo", unit_price: "UnitPrice" },
  stages: [
    { stage: "S1", name: "Profile", status: "completed", cells_changed: 0, rows_moved_or_removed: 0, rows_flagged: 0, duration_ms: 12 },
    { stage: "S2", name: "Standardise", status: "completed", cells_changed: 8, rows_moved_or_removed: 0, rows_flagged: 0, duration_ms: 30 },
    { stage: "S3", name: "Deduplicate", status: "completed", cells_changed: 0, rows_moved_or_removed: 2, rows_flagged: 0, duration_ms: 5 },
    { stage: "S4", name: "Shop rules", status: "completed", cells_changed: 2, rows_moved_or_removed: 3, rows_flagged: 0, duration_ms: 5 },
    { stage: "S5", name: "Dependencies", status: "completed", cells_changed: 2, rows_moved_or_removed: 0, rows_flagged: 0, duration_ms: 5 },
    { stage: "S6", name: "Unusual values", status: "completed", cells_changed: 1, rows_moved_or_removed: 0, rows_flagged: 1, duration_ms: 5 },
    { stage: "S7", name: "Fill and validate", status: "completed", cells_changed: 1, rows_moved_or_removed: 0, rows_flagged: 0, duration_ms: 5 },
  ],
  stage_details: { S3: { duplicates_removed: 2 } },
  rows: { input: 167, sales_output: 162, moved: { returns: 1, duplicates: 2 }, flagged_for_review: 1 },
  cells_changed: 14,
  dependency_rules: [{ rule: "InvoiceNo -> CustomerID", support: 0.995, groups_tested: 44, accepted: true, filled: 1, fixed: 0 }],
  validation: [{ check: "No duplicate rows", passed: true, failures: 0, detail: "Exact duplicate rows remaining." }],
  audit_log_total: 2,
  audit_log_sample: [
    { stage: "S6", row: 166, column: "UnitPrice", action: "repair", old_value: 33.9, new_value: 3.39, reason: "Decimal-point slip" },
    { stage: "S5", row: 163, column: "CustomerID", action: "fill", old_value: null, new_value: "12000", reason: "Blank filled" },
  ],
  review_total: 1,
  review_sample: [{ stage: "S6", row: 167, column: "Quantity", issue: "unusual_quantity", value: 1200, reason: "Flagged only" }],
  uncertain_cases: [],
  before_after_quality: { before: 97.1, after: 99.2, change: 2.1 },
};

const classification: MLResult = {
  mode: "classification",
  target: "target",
  classes: ["no", "yes"],
  rows_used: 300,
  test_rows: 60,
  selection_metric: "accuracy",
  evaluations: [{ model: "random_forest_classifier", accuracy: 0.875, precision: 0.9, recall: 0.85, f1: 0.874, roc_auc: 0.93, mcc: 0.75 }],
  winner: {
    model: "random_forest_classifier", accuracy: 0.875, precision: 0.9, recall: 0.85, f1: 0.874, roc_auc: 0.93, mcc: 0.75,
    confusion_matrix: [[27, 3], [4, 26]], roc_curve: { fpr: [0, 0.1, 1], tpr: [0, 0.8, 1] },
  },
  feature_importance: [{ feature: "a", importance: 0.6 }],
};

function results(overrides: Partial<JobResultResponse> = {}): JobResultResponse {
  return {
    job_id: "job-1-aaaaaaaa", status: "completed", profile: null, cleaning: ecpCleaning, transformation: null,
    machine_learning: classification, visualizations: null, report_available: true, download_links: {}, ...overrides,
  };
}

function props(overrides: Partial<ResultPageProps> = {}): ResultPageProps {
  return {
    selectedJob: job(), jobStatus: status("completed"), results: results(),
    onDownload: vi.fn(async () => undefined), onNavigate: vi.fn(), ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

/** A fake server: maps "METHOD /path" to [status, body]. */
function fakeServer(routes: Record<string, [number, unknown]>) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url.replace("/api/v1", "")}`;
    const [code, body] = routes[key] ?? [404, { detail: `no route for ${key}` }];
    return new Response(JSON.stringify(body), { status: code });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("App shell and login", () => {
  it("shows the login screen when nobody is logged in", async () => {
    fakeServer({});
    await act(async () => {
      render(<App />);
    });
    expect(screen.getByRole("heading", { name: "Log in" })).toBeInTheDocument();
    expect(screen.queryByText("Upload Dataset")).not.toBeInTheDocument();
  });

  it("logs in, sends the token with every request and shows the workspace", async () => {
    const fetchMock = fakeServer({
      "POST /auth/login": [200, { access_token: "token-123" }],
      "GET /auth/me": [200, { id: "u1", email: "student@example.com" }],
      "GET /jobs/history": [200, []],
    });
    await act(async () => {
      render(<App />);
    });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "student@example.com" } });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: "a-good-password" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    });
    expect(screen.getByText("API connected")).toBeInTheDocument();
    expect(screen.getByText("student@example.com")).toBeInTheDocument();
    expect(localStorage.getItem(TOKEN_KEY)).toBe("token-123");
    const historyCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/jobs/history"));
    expect((historyCall?.[1]?.headers as Record<string, string>).Authorization).toBe("Bearer token-123");
  });

  it("shows the server's message for a wrong password", async () => {
    fakeServer({ "POST /auth/login": [401, { detail: "Incorrect email or password." }] });
    await act(async () => {
      render(<App />);
    });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: "wrong-password" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Incorrect email or password.");
  });

  it("returns to the login screen with a message when the session expires", async () => {
    localStorage.setItem(TOKEN_KEY, "expired-token");
    fakeServer({
      "GET /auth/me": [401, { detail: "expired" }],
      "GET /jobs/history": [401, { detail: "expired" }],
    });
    await act(async () => {
      render(<App />);
    });
    expect(screen.getByRole("heading", { name: "Log in" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Your session has expired");
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it("logs out with the Log out button", async () => {
    localStorage.setItem(TOKEN_KEY, "token-123");
    fakeServer({ "GET /auth/me": [200, { id: "u1", email: "s@example.com" }], "GET /jobs/history": [200, []] });
    await act(async () => {
      render(<App />);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Log out/ }));
    });
    expect(screen.getByRole("heading", { name: "Log in" })).toBeInTheDocument();
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it("shows API offline when the server cannot be reached", async () => {
    localStorage.setItem(TOKEN_KEY, "token-123");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Failed to fetch"); }));
    await act(async () => {
      render(<App />);
    });
    expect(screen.getByText("API offline")).toBeInTheDocument();
  });
});

describe("ECP Cleaning page", () => {
  it("shows all seven stages, the dependency rule and the row counts", () => {
    render(<CleaningPage {...props()} />);
    for (const name of ["Profile", "Standardise", "Deduplicate", "Shop rules", "Dependencies", "Unusual values", "Fill and validate"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    expect(screen.getByText("InvoiceNo → CustomerID")).toBeInTheDocument();
    expect(screen.getByText("99.5%")).toBeInTheDocument();
    expect(screen.getByText("162")).toBeInTheDocument();
    expect(screen.getByText(/2 duplicate rows removed/)).toBeInTheDocument();
  });

  it("explains that old jobs were processed before ECP", () => {
    const old = results({ cleaning: { before_after_quality: { before: 90, after: 95, change: 5 } } });
    render(<CleaningPage {...props({ results: old })} />);
    expect(screen.getByText("This job was processed before ECP was added")).toBeInTheDocument();
  });

  it("shows the error for a failed job instead of 'results will appear'", () => {
    render(
      <CleaningPage
        {...props({ selectedJob: job({ status: "failed" }), jobStatus: { ...status("failed"), error_message: "No module named 'reportlab'" }, results: null })}
      />,
    );
    expect(screen.getByText(/Processing failed for orders.csv/)).toBeInTheDocument();
    expect(screen.getByText("No module named 'reportlab'")).toBeInTheDocument();
  });
});

describe("Machine Learning page", () => {
  it("shows the real metrics, not placeholder numbers", () => {
    render(<MachineLearningPage {...props()} />);
    expect(screen.getAllByText("87.5%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("93.0%").length).toBeGreaterThan(0);
    expect(screen.getByText("26")).toBeInTheDocument(); // confusion matrix cell
    for (const fake of ["94.2", "97.6", "91.0", "151"]) {
      expect(screen.queryByText(new RegExp(fake))).not.toBeInTheDocument();
    }
  });

  it("shows a dash for metrics the backend did not calculate", () => {
    const oldFormat: MLResult = { mode: "classification", winner: { model: "random_forest_classifier", accuracy: 0.8 }, evaluations: [] };
    render(<MachineLearningPage {...props({ results: results({ machine_learning: oldFormat }) })} />);
    expect(screen.getAllByText("80.0%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);
  });

  it("does not crash when a job finishes while the page is open", () => {
    const { rerender } = render(<MachineLearningPage {...props({ jobStatus: status("processing", 60), results: null })} />);
    expect(screen.getByRole("status")).toHaveTextContent("60%");
    rerender(<MachineLearningPage {...props()} />);
    expect(screen.getByText("Classification")).toBeInTheDocument();
  });

  it("explains why no model was trained", () => {
    const none: MLResult = { mode: "none", reason: "Too few rows or only one target value." };
    render(<MachineLearningPage {...props({ results: results({ machine_learning: none }) })} />);
    expect(screen.getByText("Too few rows or only one target value.")).toBeInTheDocument();
  });
});

describe("jobs processed before this update", () => {
  it("Visual Analytics explains old chart data instead of drawing empty charts", () => {
    const legacy = results({
      visualizations: {
        quality_comparison: { before: 90, after: 95, change: 5 },
        cleaning_summary: { labels: ["ECP Rules"], values: [3] },
      } as unknown as JobResultResponse["visualizations"],
    });
    render(<VisualAnalyticsPage {...props({ results: legacy })} />);
    expect(screen.getByText("This job was processed before the new charts were added")).toBeInTheDocument();
    expect(screen.queryByLabelText(/each cleaning stage/)).not.toBeInTheDocument();
  });

  it("Machine Learning explains a confusion matrix saved without class names", () => {
    const legacy: MLResult = {
      mode: "classification",
      winner: { model: "random_forest_classifier", accuracy: 0.8, confusion_matrix: [[5, 1], [2, 4]] },
    };
    render(<MachineLearningPage {...props({ results: results({ machine_learning: legacy }) })} />);
    expect(screen.getByText(/did not save class names/)).toBeInTheDocument();
  });
});

describe("Audit Log page", () => {
  it("lists changes with old and new values and filters by stage", () => {
    render(<AuditLogPage {...props()} />);
    expect(screen.getByText("33.9")).toBeInTheDocument();
    expect(screen.getByText("3.39")).toBeInTheDocument();
    expect(screen.getByText("(blank)")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Stage"), { target: { value: "S5" } });
    expect(screen.queryByText("33.9")).not.toBeInTheDocument();
    expect(screen.getByText("12000")).toBeInTheDocument();
  });
});

describe("Job History page", () => {
  it("downloads the cleaned file of the row that was clicked, not the selected job", () => {
    const onDownload = vi.fn(async () => undefined);
    render(
      <JobHistoryPage
        jobs={[job(), job({ job_id: "job-2-bbbbbbbb", filename: "second.csv", duration_ms: 12400, rows: 500, quality_before: 90, quality_after: 95 })]}
        selectedJobId="job-1-aaaaaaaa"
        onOpenJob={vi.fn()}
        onDownload={onDownload}
        onRefresh={vi.fn()}
        onDeleteJob={vi.fn(async () => undefined)}
        onDeleteMultiple={vi.fn(async () => undefined)}
      />,
    );
    fireEvent.click(screen.getByLabelText("Download cleaned data for second.csv"));
    expect(onDownload).toHaveBeenCalledWith("cleaned", "job-2-bbbbbbbb");
    expect(screen.getByText("12.4 s")).toBeInTheDocument();
    expect(screen.queryByText("18.4s")).not.toBeInTheDocument();
  });
});
