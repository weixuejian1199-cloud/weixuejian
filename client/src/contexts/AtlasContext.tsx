/**
 * ATLAS V3.0 — Global State Context
 * Three-panel layout: Left nav + Center upload + Right chat
 */
import React, { createContext, useContext, useState, useCallback } from "react";

export type NavItem = "home" | "reports" | "templates" | "history" | "settings";

export interface UploadedFile {
  id: string;
  name: string;
  size: number;
  sessionId?: string;
  dfInfo?: DataFrameInfo;
  status: "uploading" | "ready" | "error";
  uploadedAt: Date;
}

export interface DataFrameInfo {
  row_count: number;
  col_count: number;
  columns: ColumnInfo[];
  preview: Record<string, any>[];
  file_size_kb: number;
  sheet_names?: string[];
}

export interface ColumnInfo {
  name: string;
  dtype: string;
  non_null_count: number;
  sample_values: any[];
  inferred_type: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  report_id?: string;
  report_filename?: string;
  attachedFileIds?: string[];
}

export interface ReportRecord {
  id: string;
  title: string;
  filename: string;
  created_at: string;
  session_id: string;
  status: "completed" | "failed";
}

export interface HistoryRecord {
  id: string;
  filename: string;
  created_at: string;
  status: "uploaded" | "completed" | "failed";
  row_count?: number;
  col_count?: number;
  report_id?: string;
  report_filename?: string;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  prompt: string;
  icon: string;
  category: string;
}

interface AtlasContextType {
  activeNav: NavItem;
  setActiveNav: (nav: NavItem) => void;

  // Files
  uploadedFiles: UploadedFile[];
  addUploadedFile: (file: UploadedFile) => void;
  updateUploadedFile: (id: string, updates: Partial<UploadedFile>) => void;
  removeUploadedFile: (id: string) => void;
  clearFiles: () => void;

  // Chat
  messages: Message[];
  addMessage: (msg: Omit<Message, "id" | "timestamp">) => void;
  updateLastMessage: (content: string, extra?: Partial<Message>) => void;
  clearMessages: () => void;

  // Processing
  isProcessing: boolean;
  setIsProcessing: (v: boolean) => void;

  // Reports
  reports: ReportRecord[];
  addReport: (r: ReportRecord) => void;

  // History
  history: HistoryRecord[];
  setHistory: React.Dispatch<React.SetStateAction<HistoryRecord[]>>;
  addHistory: (h: HistoryRecord) => void;

  // Settings
  apiKey: string;
  setApiKey: (key: string) => void;
  backendUrl: string;
  setBackendUrl: (url: string) => void;
}

const AtlasContext = createContext<AtlasContextType | null>(null);

let msgId = 0;
const genId = () => `m${++msgId}-${Date.now()}`;

export function AtlasProvider({ children }: { children: React.ReactNode }) {
  const [activeNav, setActiveNav] = useState<NavItem>("home");
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [apiKey, setApiKeyState] = useState(() => localStorage.getItem("atlas_api_key") || "");
  const [backendUrl, setBackendUrlState] = useState(
    () => localStorage.getItem("atlas_backend_url") || "http://localhost:8000"
  );

  const addUploadedFile = useCallback((file: UploadedFile) => {
    setUploadedFiles(prev => [file, ...prev]);
  }, []);

  const updateUploadedFile = useCallback((id: string, updates: Partial<UploadedFile>) => {
    setUploadedFiles(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f));
  }, []);

  const removeUploadedFile = useCallback((id: string) => {
    setUploadedFiles(prev => prev.filter(f => f.id !== id));
  }, []);

  const clearFiles = useCallback(() => setUploadedFiles([]), []);

  const addMessage = useCallback((msg: Omit<Message, "id" | "timestamp">) => {
    setMessages(prev => [...prev, { ...msg, id: genId(), timestamp: new Date() }]);
  }, []);

  const updateLastMessage = useCallback((content: string, extra?: Partial<Message>) => {
    setMessages(prev => {
      if (!prev.length) return prev;
      const last = { ...prev[prev.length - 1], content, isStreaming: false, ...extra };
      return [...prev.slice(0, -1), last];
    });
  }, []);

  const clearMessages = useCallback(() => setMessages([]), []);

  const addReport = useCallback((r: ReportRecord) => {
    setReports(prev => [r, ...prev]);
  }, []);

  const addHistory = useCallback((h: HistoryRecord) => {
    setHistory(prev => [h, ...prev]);
  }, []);

  const setApiKey = useCallback((key: string) => {
    setApiKeyState(key);
    localStorage.setItem("atlas_api_key", key);
  }, []);

  const setBackendUrl = useCallback((url: string) => {
    setBackendUrlState(url);
    localStorage.setItem("atlas_backend_url", url);
  }, []);

  return (
    <AtlasContext.Provider value={{
      activeNav, setActiveNav,
      uploadedFiles, addUploadedFile, updateUploadedFile, removeUploadedFile, clearFiles,
      messages, addMessage, updateLastMessage, clearMessages,
      isProcessing, setIsProcessing,
      reports, addReport,
      history, setHistory, addHistory,
      apiKey, setApiKey,
      backendUrl, setBackendUrl,
    }}>
      {children}
    </AtlasContext.Provider>
  );
}

export function useAtlas() {
  const ctx = useContext(AtlasContext);
  if (!ctx) throw new Error("useAtlas must be used within AtlasProvider");
  return ctx;
}

// ── Built-in Templates ─────────────────────────────────────────
export const SYSTEM_TEMPLATES: Template[] = [
  {
    id: "store-sales",
    name: "门店销售汇总",
    description: "汇总多门店销售，含销售额、订单量、客单价",
    prompt: "帮我汇总所有门店的销售数据，按门店分组，显示销售额、订单数量、客单价，并标注排名",
    icon: "🏪",
    category: "销售",
  },
  {
    id: "platform-compare",
    name: "平台销售对比",
    description: "对比抖音/天猫/商城等平台销售占比",
    prompt: "对比各平台的销售数据，生成平台销售对比报表，包含销售额、占比、环比变化",
    icon: "📊",
    category: "销售",
  },
  {
    id: "product-rank",
    name: "商品销售排行",
    description: "按销售额生成商品 TOP 排行榜",
    prompt: "生成商品销售排行榜，按销售额从高到低排序，显示商品名称、销售数量、销售额、占比",
    icon: "🏆",
    category: "商品",
  },
  {
    id: "refund-analysis",
    name: "订单与退款分析",
    description: "分析退款率、退款原因分布",
    prompt: "分析订单和退款数据，生成退款分析报表，包含退款金额、退款率、退款原因分布",
    icon: "↩️",
    category: "财务",
  },
  {
    id: "daily-report",
    name: "经营日报",
    description: "GMV、订单量、退款率的经营日报",
    prompt: "生成今日经营日报，包含总销售额GMV、订单数量、退款金额和退款率、客单价、平台占比，并标注异常数据",
    icon: "📋",
    category: "综合",
  },
  {
    id: "finance-summary",
    name: "财务汇总表",
    description: "多维度财务数据汇总，含实际到账",
    prompt: "生成财务汇总报表，包含销售额、实际到账金额、退款金额、净收入，按时间和分类汇总",
    icon: "💰",
    category: "财务",
  },
];
