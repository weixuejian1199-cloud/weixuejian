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

export interface SuggestedAction {
  icon: string;
  label: string;
  prompt: string; // empty string = open custom input
}

export interface UploadResponse {
  session_id: string;
  filename: string;
  file_url: string;
  status?: "processing" | "ready" | "error";
  df_info: DataFrameInfo;
  ai_analysis: string;
  suggested_actions?: SuggestedAction[];
  quality_issues?: string[];  // P0-B: data quality hints
  outlier_details?: Array<{  // P0-B UI: structured outlier details for clickable warning
    fieldName: string;
    median: number;
    threshold: number;
    outlierRows: Array<{ rowIndex: number; value: number }>;
  }>;
  field_mapping_hint?: Array<{  // P0-C: structured field mapping for UI hint block
    original: string;
    canonical: string;
  }>;
}

// ── Poll Upload Status ───────────────────────────────────────────────────────────────────────────────────
// Polls /api/atlas/status/:sessionId until status=ready or error.
// Calls onProgress(35..92) while waiting, resolves with full UploadResponse.
export async function pollUploadStatus(
  sessionId: string,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal
): Promise<UploadResponse> {
  const POLL_INTERVAL = 2000; // 2s
  const MAX_WAIT_MS = 5 * 60 * 1000; // 5 minutes
  const start = Date.now();
  let progress = 35; // start from 35% (upload done)

  while (true) {
    if (signal?.aborted) throw new Error("上传已取消");
    if (Date.now() - start > MAX_WAIT_MS) throw new Error("处理超时，请重试");

    const res = await fetch(`/api/atlas/status/${sessionId}`, { credentials: "include", signal });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const err = await res.json(); msg = err.error || msg; } catch {}
      throw new Error(msg);
    }
    const data = await res.json();

    if (data.status === "ready" && data.ai_analysis) {
      if (onProgress) onProgress(100);
      return data as UploadResponse;
    }
    if (data.status === "error") {
      throw new Error(data.error || "文件处理失败，请重试");
    }

    // Still processing — advance progress bar slowly (35% → 92%)
    if (onProgress && progress < 92) {
      progress = Math.min(progress + 3, 92);
      onProgress(progress);
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }
}

export interface GenerateReportResponse {
  report_id: string;
  filename: string;
  download_url: string;
  ai_message: string;
  plan: {
    title: string;
    sheets: Array<{ name: string; headers: string[]; rows: (string | number)[][]; summary: string }>;
    insights: string;
  };
}

// ── Upload ────────────────────────────────────────────────────────────────────

export async function uploadFile(
  file: File,
  onProgress?: (percent: number) => void
): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.withCredentials = true;

    // Upload progress
    if (onProgress) {
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 100);
          onProgress(percent);
        }
      });
    }

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error("服务器返回了无效的响应格式"));
        }
      } else {
        let msg = `HTTP ${xhr.status}`;
        try {
          const err = JSON.parse(xhr.responseText);
          msg = err.error || msg;
        } catch {}
        // User-friendly error messages
        if (xhr.status === 413) msg = "文件太大，请上传 50MB 以内的文件";
        else if (xhr.status === 415) msg = "不支持的文件格式，请上传 Excel 或 CSV 文件";
        else if (xhr.status === 401) msg = "登录已过期，请重新登录";
        else if (xhr.status === 429) msg = "请求过于频繁，请稍后再试";
        else if (xhr.status >= 500) msg = "服务器处理失败，请稍后重试";
        reject(new Error(msg));
      }
    });

    xhr.addEventListener("error", () => {
      reject(new Error("网络连接失败，请检查网络后重试"));
    });

    xhr.addEventListener("timeout", () => {
      reject(new Error("上传超时，请检查网络或尝试上传较小的文件"));
    });

    xhr.timeout = 120_000; // 2 minutes
    xhr.open("POST", "/api/atlas/upload");
    xhr.send(form);
  });
}

// ── Chat (streaming) ──────────────────────────────────────────────────────────

export interface ChatStreamOptions {
  sessionId?: string;
  sessionIds?: string[];  // Support multiple files in same conversation
  message: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  signal?: AbortSignal;  // AbortController signal for cancellation
  conversationId?: string;  // V13.10: persist conversation across turns
  onChunk: (chunk: string) => void;
  onDone: (fullText: string, conversationId?: string) => void;  // returns conversation_id from server
  onError: (err: Error) => void;
}

export async function chatStream(opts: ChatStreamOptions): Promise<void> {
  const { sessionId, sessionIds, message, history, signal, conversationId, onChunk, onDone, onError } = opts;
  const ids = sessionIds?.length ? sessionIds : sessionId ? [sessionId] : [];

  try {
    const res = await fetch("/api/atlas/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      signal,
      body: JSON.stringify({ session_ids: ids, session_id: ids[0], message, history, conversation_id: conversationId }),
    });
    // V13.10: extract conversation_id from response header
    const returnedConvId = res.headers.get("X-Conversation-Id") ?? conversationId;

    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const err = await res.json(); msg = err.error || msg; } catch {}
      // User-friendly error messages for chat
      if (res.status === 401) msg = "登录已过期，请点击登录按鈕重新登录";
      else if (res.status === 429) msg = "请求过于频繁（每分钟最多 20 条），请稍后再试";
      else if (res.status === 413) msg = "消息内容过长，请精简描述需求";
      else if (res.status >= 500) msg = "服务器处理异常，请稍后重试或刷新页面";
      throw new Error(msg);
    }

    // Parse streaming response
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      // Unexpected JSON response — treat as error
      const json = await res.json() as { error?: string; message?: string };
      throw new Error(json.error || json.message || "Unknown error");
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

    onDone(fullText, returnedConvId ?? undefined);
  } catch (err) {
    // AbortError means user cancelled — treat as normal completion with partial text
    if (err instanceof Error && err.name === "AbortError") {
      return; // silently stop, caller handles UI state
    }
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
    if (res.status === 401) msg = "登录已过期，请重新登录";
    else if (res.status === 429) msg = "请求过于频繁，请稍后再试";
    else if (res.status >= 500) msg = "报告生成失败，请稍后重试";
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

// ── Template Stream (V13.7) ────────────────────────────────────────────────────
// Call a personal template with input fields, stream the AI calculation result

export interface TemplateStreamOptions {
  templateId: string;
  inputs: Record<string, string>;
  signal?: AbortSignal;
  onChunk: (chunk: string) => void;
  onDone: (fullText: string) => void;
  onError: (err: Error) => void;
}

export async function templateStream(opts: TemplateStreamOptions): Promise<void> {
  const { templateId, inputs, signal, onChunk, onDone, onError } = opts;
  try {
    const res = await fetch(`/api/atlas/templates/${templateId}/use`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      signal,
      body: JSON.stringify({ inputs }),
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
    if (err instanceof Error && err.name === "AbortError") return;
    onError(err instanceof Error ? err : new Error(String(err)));
  }
}

// ── Personal Templates CRUD (V13.7) ───────────────────────────────────────────

export interface PersonalTemplate {
  id: string;
  name: string;
  description?: string;
  category: string;
  systemPrompt: string;
  inputFields?: Array<{ key: string; label: string; type: string; unit?: string }>;
  useCount: number;
  createdAt: string;
  updatedAt: string;
}

export async function fetchPersonalTemplates(): Promise<PersonalTemplate[]> {
  const res = await fetch("/api/atlas/templates", { credentials: "include" });
  if (!res.ok) return [];
  const data = await res.json();
  return data.templates || [];
}

export async function savePersonalTemplate(tmpl: {
  name: string;
  description?: string;
  category?: string;
  systemPrompt: string;
  inputFields?: Array<{ key: string; label: string; type: string; unit?: string }>;
}): Promise<{ id: string }> {
  const res = await fetch("/api/atlas/templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(tmpl),
  });
  if (!res.ok) throw new Error("Failed to save template");
  return res.json();
}

export async function deletePersonalTemplate(id: string): Promise<void> {
  await fetch(`/api/atlas/templates/${id}`, { method: "DELETE", credentials: "include" });
}
