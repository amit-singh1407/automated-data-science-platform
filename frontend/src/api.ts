import type { JobHistoryItem, JobResultResponse, JobStatusResponse, StageTiming } from "./types";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "/api/v1").replace(/\/$/, "");

// ─── Session ──────────────────────────────────────────────────────────────────
let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

/** Every request after this sends the token as a bearer header. */
export function setAuthToken(token: string | null): void {
  authToken = token;
}

/** Called when the server rejects the token (expired or invalid session). */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = { ...((init.headers as Record<string, string>) ?? {}) };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    if (res.status === 401 && authToken && !path.startsWith("/auth/")) onUnauthorized?.();
    throw new Error(await res.text());
  }
  return res;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  return (await (await request(path, init)).json()) as T;
}

function postJson<T>(path: string, body: unknown): Promise<T> {
  return json(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
export async function login(email: string, password: string): Promise<string> {
  return (await postJson<{ access_token: string }>("/auth/login", { email, password })).access_token;
}

export async function register(email: string, password: string): Promise<string> {
  return (await postJson<{ access_token: string }>("/auth/register", { email, password })).access_token;
}

export function getMe(): Promise<{ id: string; email: string }> {
  return json("/auth/me");
}

// ─── Jobs ─────────────────────────────────────────────────────────────────────
export function uploadDataset(file: File): Promise<{ job_id: string; status: string }> {
  const formData = new FormData();
  formData.append("file", file);
  return json("/jobs/upload", { method: "POST", body: formData });
}

export function getHistory(): Promise<JobHistoryItem[]> {
  return json("/jobs/history");
}

export function getStatus(jobId: string): Promise<JobStatusResponse> {
  return json(`/jobs/${jobId}/status`);
}

export function getResults(jobId: string): Promise<JobResultResponse> {
  return json(`/jobs/${jobId}/results`);
}

export function getPerformance(jobId: string): Promise<StageTiming[]> {
  return json(`/jobs/${jobId}/performance`);
}

export async function downloadArtifact(jobId: string, artifact: string): Promise<{ blob: Blob; filename: string | null }> {
  const res = await request(`/jobs/${jobId}/download/${artifact}`);
  // The server names the file (e.g. cleaned.xlsx, audit-log.csv), so the
  // extension always matches the real format.
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  return { blob: await res.blob(), filename: match ? decodeURIComponent(match[1]) : null };
}

export async function deleteJob(jobId: string): Promise<void> {
  await request(`/jobs/${jobId}`, { method: "DELETE" });
}

export async function deleteMultipleJobs(jobIds: string[]): Promise<void> {
  await postJson("/jobs/delete-multiple", { job_ids: jobIds });
}
