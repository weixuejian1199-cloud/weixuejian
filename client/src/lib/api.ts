/**
 * ATLAS API Client — V6.1
 * Connects to Express backend at /api/atlas/*
 * All endpoints are same-origin (no CORS issues)
 */

export interface FieldInfo {
  name: string;
  type: "numeric" | "text" | "datetime";
  dtype: string;
  null_count: number;
  unique_count: number;
  sample: (string | number)[];
}

export interface DataFrameInfo {
  row_count: number;
  col_count: number;
  fields: FieldInfo[];
  preview: Record<string, unknown>[];
}

export interface UploadResponse {
  session_id: string;
  filename: string;
  file_url: string;
  df_info: DataFrameInfo;
  ai_analysis: string;
}

export interface GenerateReportResponse {
  report_id: string;
  filename: string;
  download_url: string;
  ai_message: string;
  plan: {
    title: string;
    sheets: Array<{ name: string; summary: string }>;
    insights: string;
  };
}

// ── Upload ────────────────────────────────────────────────────────────────────

export async function uploadFile(file: File): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", file);

  const res = await fetch("/api/atlas/upload", {
    method: "POST",
    body: form,
    credentials: "include",
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const err = await res.json(); msg = err.error || msg; } catch {}
    throw new Error(msg);
  }

  return res.json();
}

// ── Chat (streaming) ──────────────────────────────────────────────────────────

export interface ChatStreamOptions {
  sessionId: string;
  message: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  onChunk: (chunk: string) => void;
  onDone: (fullText: string) => void;
  onError: (err: Error) => void;
}

export async function chatStream(opts: ChatStreamOptions): Promise<void> {
  const { sessionId, message, history, onChunk, onDone, onError } = opts;

  try {
    const res = await fetch("/api/atlas/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ session_id: sessionId, message, history }),
    });

    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const err = await res.json(); msg = err.error || msg; } catch {}
      throw new Error(msg);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let fullText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      fullText += chunk;
      onChunk(chunk);
    }

    onDone(fullText);
  } catch (err) {
    onError(err instanceof Error ? err : new Error(String(err)));
  }
}

// ── Generate Report ───────────────────────────────────────────────────────────

export async function generateReport(
  sessionId: string,
  requirement: string,
  reportTitle?: string
): Promise<GenerateReportResponse> {
  const res = await fetch("/api/atlas/generate-report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      session_id: sessionId,
      requirement,
      report_title: reportTitle,
    }),
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const err = await res.json(); msg = err.error || msg; } catch {}
    throw new Error(msg);
  }

  return res.json();
}

// ── Download URL ──────────────────────────────────────────────────────────────

export function getDownloadUrl(reportId: string): string {
  return `/api/atlas/download/${reportId}`;
}

// ── Health check ────────────────────────────────────────────────────────────

export async function healthCheck(): Promise<{ status: string }> {
  const res = await fetch("/api/trpc/auth.me", { credentials: "include" });
  if (!res.ok) throw new Error("Server unreachable");
  return { status: "ok" };
}

// ── Legacy compat (kept for any remaining references) ─────────────────────────

export const api = {
  health: healthCheck,
  upload: uploadFile,
  chat: async (session_id: string, message: string) => {
    return new Promise<{ response: string; session_id: string }>((resolve, reject) => {
      let fullText = "";
      chatStream({
        sessionId: session_id,
        message,
        onChunk: (c) => { fullText += c; },
        onDone: (text) => resolve({ response: text, session_id }),
        onError: reject,
      });
    });
  },
  generateReport: (session_id: string, requirement: string, report_title?: string) =>
    generateReport(session_id, requirement, report_title).then(r => ({
      report_id: r.report_id,
      filename: r.filename,
      plan: r.plan as any,
      download_url: r.download_url,
      ai_message: r.ai_message,
    })),
  getDownloadUrl,
};
