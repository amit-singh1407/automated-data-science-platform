import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertCircle, BarChart3, CheckCircle2, ChevronRight, Circle, Database, FileClock, FileDown, FlaskConical,
  LayoutDashboard, Loader2, LogOut, ScrollText, ShieldCheck, Sparkles, Timer, UserRound, WandSparkles,
} from "lucide-react";
import {
  deleteJob, deleteMultipleJobs, downloadArtifact, getHistory, getMe, getResults, getStatus,
  setAuthToken, setUnauthorizedHandler, uploadDataset,
} from "./api";
import { LoginPage } from "./pages/LoginPage";
import { PageHeader } from "./components/ui";
import { getErrorMessage, shortId } from "./lib/format";
import { PAGE_DESCRIPTIONS, PAGES } from "./navigation";
import type { Page, ResultPageProps } from "./navigation";
import { AuditLogPage } from "./pages/AuditLogPage";
import { CleaningPage } from "./pages/CleaningPage";
import { DashboardPage } from "./pages/DashboardPage";
import { JobHistoryPage } from "./pages/JobHistoryPage";
import { MachineLearningPage } from "./pages/MachineLearningPage";
import { PerformancePage } from "./pages/PerformancePage";
import { ProfilingPage } from "./pages/ProfilingPage";
import { ReportsPage } from "./pages/ReportsPage";
import { TransformationPage } from "./pages/TransformationPage";
import { VisualAnalyticsPage } from "./pages/VisualAnalyticsPage";
import type { JobHistoryItem, JobResultResponse, JobStatusResponse } from "./types";

const PAGE_ICONS: Record<Page, ReactNode> = {
  "Dashboard": <LayoutDashboard size={16} />,
  "Data Profiling": <Database size={16} />,
  "ECP Cleaning": <WandSparkles size={16} />,
  "Audit Log": <ScrollText size={16} />,
  "Data Transformation": <Sparkles size={16} />,
  "Machine Learning": <FlaskConical size={16} />,
  "Visual Analytics": <BarChart3 size={16} />,
  "Performance": <Timer size={16} />,
  "Reports & Downloads": <FileDown size={16} />,
  "Job History": <FileClock size={16} />,
};

const POLL_MS = 1200;
export const TOKEN_KEY = "autodata_token";

export default function App() {
  const [token, setToken] = useState<string | null>(() => {
    const saved = localStorage.getItem(TOKEN_KEY);
    setAuthToken(saved);
    return saved;
  });
  const [userEmail, setUserEmail] = useState("");
  const [loginNotice, setLoginNotice] = useState("");
  const [activePage, setActivePage] = useState<Page>("Dashboard");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [jobs, setJobs] = useState<JobHistoryItem[]>([]);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [results, setResults] = useState<JobResultResponse | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatusResponse | null>(null);
  const [message, setMessage] = useState("Ready. Choose a dataset to begin.");
  const [uploading, setUploading] = useState(false);
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);

  const selectedJob = useMemo(() => jobs.find((j) => j.job_id === selectedJobId), [jobs, selectedJobId]);

  function signIn(newToken: string) {
    localStorage.setItem(TOKEN_KEY, newToken);
    setAuthToken(newToken);
    setLoginNotice("");
    setToken(newToken);
  }

  const signOut = useCallback((notice = "") => {
    localStorage.removeItem(TOKEN_KEY);
    setAuthToken(null);
    setToken(null);
    setUserEmail("");
    setJobs([]);
    setSelectedJobId("");
    setResults(null);
    setJobStatus(null);
    setSelectedFile(null);
    setActivePage("Dashboard");
    setMessage("Ready. Choose a dataset to begin.");
    setLoginNotice(notice);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => signOut("Your session has expired. Please log in again."));
    return () => setUnauthorizedHandler(null);
  }, [signOut]);

  useEffect(() => {
    if (!token) return;
    getMe().then((me) => setUserEmail(me.email)).catch(() => undefined);
  }, [token]);

  const refreshHistory = useCallback(async () => {
    try {
      const rows = await getHistory();
      setJobs(rows);
      setApiOnline(true);
      setSelectedJobId((current) => (current && rows.some((j) => j.job_id === current) ? current : rows[0]?.job_id ?? ""));
    } catch (e) {
      setApiOnline(false);
      setMessage(`Could not reach the server: ${getErrorMessage(e)}`);
    }
  }, []);

  function selectJob(jobId: string) {
    if (jobId === selectedJobId) return;
    setSelectedJobId(jobId);
    setResults(null);
    setJobStatus(null);
  }

  async function handleUpload() {
    if (!selectedFile) return;
    setUploading(true);
    try {
      setMessage(`Uploading ${selectedFile.name}…`);
      const response = await uploadDataset(selectedFile);
      setMessage("Upload complete. Processing has started.");
      setSelectedFile(null);
      selectJob(response.job_id);
      await refreshHistory();
    } catch (e) {
      setMessage(`Upload failed: ${getErrorMessage(e)}`);
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload(artifact: string, jobId: string = selectedJobId) {
    if (!jobId) return;
    try {
      const { blob, filename } = await downloadArtifact(jobId, artifact);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `autodata-${shortId(jobId)}-${filename ?? artifact}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setMessage(`Download failed: ${getErrorMessage(e)}`);
    }
  }

  async function handleDeleteJobs(jobIds: string[]) {
    try {
      if (jobIds.length === 1) await deleteJob(jobIds[0]);
      else await deleteMultipleJobs(jobIds);
      if (jobIds.includes(selectedJobId)) {
        setSelectedJobId("");
        setResults(null);
        setJobStatus(null);
      }
      await refreshHistory();
      setMessage(`${jobIds.length} job${jobIds.length > 1 ? "s" : ""} deleted.`);
    } catch (e) {
      setMessage(`Delete failed: ${getErrorMessage(e)}`);
    }
  }

  // Poll the selected job until it completes or fails, then load its results
  // and refresh the job list so every status badge is current.
  useEffect(() => {
    if (!selectedJobId) return;
    let active = true;
    let timer: number | undefined;

    const poll = async () => {
      try {
        const status = await getStatus(selectedJobId);
        if (!active) return;
        setJobStatus(status);
        if (status.status === "completed") {
          const data = await getResults(selectedJobId);
          if (!active) return;
          setResults(data);
          setMessage("Results are ready.");
          void refreshHistory();
          return;
        }
        if (status.status === "failed") {
          setMessage(`Processing failed: ${status.error_message ?? "no error message recorded."}`);
          void refreshHistory();
          return;
        }
        setMessage(`Processing… ${status.progress}%${status.progress_message ? `: ${status.progress_message}` : ""}`);
        timer = window.setTimeout(() => void poll(), POLL_MS);
      } catch (e) {
        if (active) setMessage(getErrorMessage(e));
      }
    };

    void poll();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [selectedJobId, refreshHistory]);

  useEffect(() => {
    if (token) void refreshHistory();
  }, [token, refreshHistory]);

  if (!token) {
    return <LoginPage onSignedIn={signIn} notice={loginNotice} />;
  }

  const isProcessing = jobStatus?.status === "processing" || jobStatus?.status === "queued";
  const pageProps: ResultPageProps = {
    selectedJob,
    jobStatus,
    results,
    onDownload: handleDownload,
    onNavigate: setActivePage,
  };

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100">
      <header className="sticky top-0 z-20 border-b border-white/[0.08] bg-[#0b1120]/95 px-5 py-4 backdrop-blur-xl md:px-8">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-blue-600 shadow-lg shadow-blue-500/20">
              <Sparkles size={21} className="text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-white">AutoData AI</h1>
              <p className="hidden text-xs text-slate-400 sm:block">ECP cleaning and automated analysis for order data</p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs">
            {isProcessing && (
              <span className="flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1.5 text-cyan-300">
                <Loader2 size={12} className="animate-spin" /> Processing {jobStatus?.progress ?? 0}%
              </span>
            )}
            {apiOnline === null ? (
              <span className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-slate-300">
                <Loader2 size={12} className="animate-spin" /> Connecting…
              </span>
            ) : apiOnline ? (
              <span className="flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-emerald-300">
                <Circle size={7} fill="currentColor" /> API connected
              </span>
            ) : (
              <span className="flex items-center gap-2 rounded-full border border-rose-400/20 bg-rose-400/10 px-3 py-1.5 text-rose-300">
                <AlertCircle size={12} /> API offline
              </span>
            )}
            {userEmail && (
              <span className="hidden items-center gap-1.5 text-slate-400 lg:flex" title="Logged in as">
                <UserRound size={13} /> {userEmail}
              </span>
            )}
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-slate-300 transition hover:bg-white/10 hover:text-white"
              onClick={() => signOut()}
            >
              <LogOut size={12} /> Log out
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid min-h-[calc(100vh-73px)] max-w-[1600px] grid-cols-1 md:grid-cols-[250px_1fr]">
        <aside className="border-b border-white/[0.08] bg-[#0b1120]/60 p-4 md:border-b-0 md:border-r md:p-5">
          <nav aria-label="Workspace" className="space-y-1">
            {PAGES.map((page) => (
              <button
                key={page}
                type="button"
                aria-current={activePage === page ? "page" : undefined}
                className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-xs transition ${
                  activePage === page
                    ? "bg-cyan-400/10 font-semibold text-cyan-300 ring-1 ring-cyan-400/20"
                    : "text-slate-400 hover:bg-white/[0.05] hover:text-white"
                }`}
                onClick={() => setActivePage(page)}
              >
                {PAGE_ICONS[page]}
                <span className="flex-1 truncate">{page}</span>
                {activePage === page && <ChevronRight size={13} className="shrink-0" />}
              </button>
            ))}
          </nav>
          {selectedJob && (
            <div className="mt-6 rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 text-xs">
              <p className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500">
                <ShieldCheck size={11} /> Current dataset
              </p>
              <p className="truncate font-medium text-white" title={selectedJob.filename}>{selectedJob.filename}</p>
              <div className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                selectedJob.status === "completed" ? "bg-emerald-400/10 text-emerald-300"
                  : selectedJob.status === "failed" ? "bg-rose-400/10 text-rose-300" : "bg-cyan-400/10 text-cyan-300"
              }`}>
                {(selectedJob.status === "processing" || selectedJob.status === "queued") && <Loader2 size={9} className="animate-spin" />}
                {selectedJob.status === "completed" && <CheckCircle2 size={9} />}
                {selectedJob.status === "failed" && <AlertCircle size={9} />}
                {selectedJob.status}
              </div>
            </div>
          )}
        </aside>

        <main className="min-w-0 p-5 md:p-8">
          <PageHeader title={activePage} description={PAGE_DESCRIPTIONS[activePage]} />
          <div className="mt-6">
            {activePage === "Dashboard" && (
              <DashboardPage
                jobs={jobs}
                selectedJobId={selectedJobId}
                selectedJob={selectedJob}
                jobStatus={jobStatus}
                selectedFile={selectedFile}
                uploading={uploading}
                message={message}
                onSelectJob={selectJob}
                onFileSelect={setSelectedFile}
                onUpload={() => void handleUpload()}
                onRefreshHistory={() => void refreshHistory()}
              />
            )}
            {activePage === "Data Profiling" && <ProfilingPage {...pageProps} />}
            {activePage === "ECP Cleaning" && <CleaningPage {...pageProps} />}
            {activePage === "Audit Log" && <AuditLogPage {...pageProps} />}
            {activePage === "Data Transformation" && <TransformationPage {...pageProps} />}
            {activePage === "Machine Learning" && <MachineLearningPage {...pageProps} />}
            {activePage === "Visual Analytics" && <VisualAnalyticsPage {...pageProps} />}
            {activePage === "Performance" && <PerformancePage {...pageProps} />}
            {activePage === "Reports & Downloads" && <ReportsPage {...pageProps} />}
            {activePage === "Job History" && (
              <JobHistoryPage
                jobs={jobs}
                selectedJobId={selectedJobId}
                onOpenJob={(id) => { selectJob(id); setActivePage("ECP Cleaning"); }}
                onDownload={handleDownload}
                onRefresh={() => void refreshHistory()}
                onDeleteJob={(id) => handleDeleteJobs([id])}
                onDeleteMultiple={handleDeleteJobs}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
