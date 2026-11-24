import type { JobHistoryItem, JobResultResponse, JobStatusResponse } from "./types";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "/api/v1").replace(/\/$/, "");

function authHeaders(token?: string): HeadersInit {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function uploadDataset(file: File, token?: string): Promise<{ job_id: string; status: string }> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_BASE}/jobs/upload`, {
    method: "POST",
    headers: authHeaders(token),
    body: formData,
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return (await res.json()) as { job_id: string; status: string };
}

export async function getHistory(token?: string): Promise<JobHistoryItem[]> {
  const res = await fetch(`${API_BASE}/jobs/history`, {
    headers: authHeaders(token),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return (await res.json()) as JobHistoryItem[];
}

export async function getStatus(jobId: string, token?: string): Promise<JobStatusResponse> {
  const res = await fetch(`${API_BASE}/jobs/${jobId}/status`, {
    headers: authHeaders(token),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return (await res.json()) as JobStatusResponse;
}

export async function getResults(jobId: string, token?: string): Promise<JobResultResponse> {
  const res = await fetch(`${API_BASE}/jobs/${jobId}/results`, {
    headers: authHeaders(token),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return (await res.json()) as JobResultResponse;
}

export async function getAuditLogs(jobId: string, token?: string): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${API_BASE}/jobs/${jobId}/audit-logs`, {
    headers: authHeaders(token),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  const payload = (await res.json()) as { audit_logs: Record<string, unknown>[] };
  return payload.audit_logs;
}

export function downloadUrl(jobId: string, artifact: string): string {
  return `${API_BASE}/jobs/${jobId}/download/${artifact}`;
}

export async function downloadArtifact(jobId: string, artifact: string, token?: string): Promise<Blob> {
  const res = await fetch(downloadUrl(jobId, artifact), {
    headers: authHeaders(token),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.blob();
}

export async function deleteJob(jobId: string, token?: string): Promise<void> {
  const res = await fetch(`${API_BASE}/jobs/${jobId}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
}

export async function deleteMultipleJobs(jobIds: string[], token?: string): Promise<void> {
  const res = await fetch(`${API_BASE}/jobs/delete-multiple`, {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ job_ids: jobIds }),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
}
