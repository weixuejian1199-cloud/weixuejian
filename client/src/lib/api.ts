/**
 * ATLAS API Client
 * Connects to FastAPI backend at port 8000
 */

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

export interface FieldInfo {
  name: string;
  type: "numeric" | "text" | "datetime";
  dtype: string;
  null_count: number;
  unique_count: number;
  sample: (string | number)[];
  stats: {
    min?: number;
    max?: number;
    mean?: number;
  };
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
  df_info: DataFrameInfo;
  ai_analysis: string;
}

export interface ChatResponse {
  response: string;
  session_id: string;
}

export interface ReportPlan {
  title: string;
  description: string;
  sheets: Array<{
    name: string;
    type: string;
    group_by: string[];
    metrics: Array<{ field: string; agg: string; alias: string }>;
  }>;
  insights: string;
}

export interface GenerateReportResponse {
  report_id: string;
  filename: string;
  plan: ReportPlan;
  download_url: string;
  ai_message: string;
}

export interface HistoryItem {
  id: string;
  filename: string;
  created_at: string;
  status: "uploaded" | "completed" | "failed";
  row_count: number;
  col_count: number;
  report_id?: string;
  report_filename?: string;
}

export interface SessionInfo {
  session_id: string;
  filename: string;
  df_info: DataFrameInfo;
  messages: Array<{
    role: "user" | "assistant";
    content: string;
    timestamp: string;
    report_id?: string;
    report_filename?: string;
  }>;
  last_report?: {
    report_id: string;
    filename: string;
    plan: ReportPlan;
    created_at: string;
  };
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...options?.headers,
    },
  });

  if (!res.ok) {
    let errorMsg = `HTTP ${res.status}`;
    try {
      const err = await res.json();
      errorMsg = err.detail || errorMsg;
    } catch {}
    throw new Error(errorMsg);
  }

  return res.json();
}

export const api = {
  health: () => request<{ status: string; version: string; ai_enabled: boolean }>("/api/health"),

  upload: async (file: File): Promise<UploadResponse> => {
    const form = new FormData();
    form.append("file", file);
    return request<UploadResponse>("/api/upload", {
      method: "POST",
      body: form,
    });
  },

  chat: (session_id: string, message: string): Promise<ChatResponse> =>
    request<ChatResponse>("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id, message }),
    }),

  generateReport: (
    session_id: string,
    requirement: string,
    report_title?: string
  ): Promise<GenerateReportResponse> =>
    request<GenerateReportResponse>("/api/generate-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id, requirement, report_title }),
    }),

  getSession: (session_id: string): Promise<SessionInfo> =>
    request<SessionInfo>(`/api/session/${session_id}`),

  getHistory: (): Promise<{ history: HistoryItem[] }> =>
    request<{ history: HistoryItem[] }>("/api/history"),

  deleteSession: (session_id: string): Promise<{ status: string }> =>
    request<{ status: string }>(`/api/session/${session_id}`, { method: "DELETE" }),

  getDownloadUrl: (report_id: string): string =>
    `${API_BASE}/api/download/${report_id}`,

  setBaseUrl: (url: string): void => {
    (api as any)._baseUrl = url;
  },
};
