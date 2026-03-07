/**
 * ATLAS V5.0 — Global State Context
 * Multi-task architecture: each task has its own messages + files
 * Switching activeTaskId instantly restores the full session
 */
import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";

export type NavItem = "home" | "dashboard" | "templates" | "settings" | "search" | "library" | "invite" | "hr";
export type Theme = "dark" | "light";

// ── Types ──────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  plan: "free" | "pro" | "enterprise";
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

export interface UploadedFile {
  id: string;
  name: string;
  size: number;
  sessionId?: string;
  dfInfo?: DataFrameInfo;
  status: "uploading" | "ready" | "error";
  uploadedAt: Date;
}

export interface TableSheet {
  name: string;
  headers: string[];
  rows: (string | number)[][];
  summary?: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  report_id?: string;
  report_filename?: string;
  download_url?: string;
  tableData?: TableSheet[];
}

export interface ReportRecord {
  id: string;
  title: string;
  filename: string;
  created_at: string;
  session_id: string;
  status: "completed" | "failed";
}

// A Task now owns its own messages and files
export interface Task {
  id: string;
  title: string;
  filename: string;
  created_at: string;
  status: "uploaded" | "processing" | "completed" | "failed";
  row_count?: number;
  col_count?: number;
  report_id?: string;
  report_filename?: string;
  // Per-task session data
  messages: Message[];
  uploadedFiles: UploadedFile[];
}

export interface Template {
  id: string;
  name: string;
  description: string;
  prompt: string;
  icon: string;
  category: string;
  isPinned?: boolean;
  isCustom?: boolean;
  createdAt?: string;
}

export interface PlatformConnection {
  id: string;
  platform: "tmall" | "taobao" | "douyin" | "pinduoduo" | "jd" | "xiaochengxu" | "wangdiantong";
  name: string;
  shopName?: string;
  appKey?: string;
  appSecret?: string;
  accessToken?: string;
  status: "connected" | "disconnected" | "expired";
  connectedAt?: string;
}

export interface ApiKeyConfig {
  id: string;
  label: string;
  key: string;
  model: string;
  provider: string;
  isDefault?: boolean;
}

export interface ScheduledTask {
  id: string;
  name: string;
  templateId: string;
  cron: string;
  email?: string;
  enabled: boolean;
  lastRun?: string;
  nextRun?: string;
}

// ── Context Type ────────────────────────────────────────────────────────────

interface AtlasContextType {
  // Layout
  activeNav: NavItem;
  setActiveNav: (nav: NavItem) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  activeTaskId: string | null;
  setActiveTaskId: (id: string | null) => void;

  // Theme
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;

  // Auth
  user: User | null;
  setUser: (user: User | null) => void;
  showLoginModal: boolean;
  setShowLoginModal: (v: boolean) => void;

  // Tasks
  tasks: Task[];
  addTask: (t: Task) => void;
  updateTask: (id: string, updates: Partial<Omit<Task, "messages" | "uploadedFiles">>) => void;
  createNewTask: () => string; // returns new task id

  // Current task's files (scoped to activeTaskId)
  uploadedFiles: UploadedFile[];
  addUploadedFile: (file: UploadedFile) => void;
  updateUploadedFile: (id: string, updates: Partial<UploadedFile>) => void;
  removeUploadedFile: (id: string) => void;
  clearFiles: () => void;

  // Current task's messages (scoped to activeTaskId)
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

  // Templates
  templates: Template[];
  addTemplate: (t: Template) => void;
  updateTemplate: (id: string, updates: Partial<Template>) => void;
  removeTemplate: (id: string) => void;
  pinTemplate: (id: string) => void;

  // Platforms
  platforms: PlatformConnection[];
  addPlatform: (p: PlatformConnection) => void;
  updatePlatform: (id: string, updates: Partial<PlatformConnection>) => void;
  removePlatform: (id: string) => void;

  // API Keys
  apiKeys: ApiKeyConfig[];
  addApiKey: (k: ApiKeyConfig) => void;
  updateApiKey: (id: string, updates: Partial<ApiKeyConfig>) => void;
  removeApiKey: (id: string) => void;

  // Scheduled Tasks
  scheduledTasks: ScheduledTask[];
  addScheduledTask: (t: ScheduledTask) => void;
  updateScheduledTask: (id: string, updates: Partial<ScheduledTask>) => void;
  removeScheduledTask: (id: string) => void;

  // Settings
  backendUrl: string;
  setBackendUrl: (url: string) => void;

  // Legacy compat
  apiKey: string;
  setApiKey: (key: string) => void;
  history: Task[];
  setHistory: React.Dispatch<React.SetStateAction<Task[]>>;
  addHistory: (h: Omit<Task, "messages" | "uploadedFiles">) => void;
}

const AtlasContext = createContext<AtlasContextType | null>(null);

let msgId = 0;
const genId = () => `m${++msgId}-${Date.now()}`;

// ── Built-in Templates ──────────────────────────────────────────────────────

export const SYSTEM_TEMPLATES: Template[] = [
  { id: "store-sales", name: "门店销售汇总", description: "汇总多门店销售，含销售额、订单量、客单价", prompt: "帮我汇总所有门店的销售数据，按门店分组，显示销售额、订单数量、客单价，并标注排名", icon: "🏪", category: "销售" },
  { id: "platform-compare", name: "平台销售对比", description: "对比抖音/天猫/商城等平台销售占比", prompt: "对比各平台的销售数据，生成平台销售对比报表，包含销售额、占比、环比变化", icon: "📊", category: "销售" },
  { id: "product-rank", name: "商品销售排行", description: "按销售额生成商品 TOP 排行榜", prompt: "生成商品销售排行榜，按销售额从高到低排序，显示商品名称、销售数量、销售额、占比", icon: "🏆", category: "商品" },
  { id: "refund-analysis", name: "订单与退款分析", description: "分析退款率、退款原因分布", prompt: "分析订单和退款数据，生成退款分析报表，包含退款金额、退款率、退款原因分布", icon: "↩️", category: "财务" },
  { id: "daily-report", name: "经营日报", description: "GMV、订单量、退款率的经营日报", prompt: "生成今日经营日报，包含总销售额GMV、订单数量、退款金额和退款率、客单价、平台占比，并标注异常数据", icon: "📋", category: "综合" },
  { id: "finance-summary", name: "财务汇总表", description: "多维度财务数据汇总，含实际到账", prompt: "生成财务汇总报表，包含销售额、实际到账金额、退款金额、净收入，按时间和分类汇总", icon: "💰", category: "财务" },
  { id: "inventory-alert", name: "库存预警报表", description: "识别低库存商品，自动预警", prompt: "分析库存数据，生成库存预警报表，标注低库存商品、滞销商品，并给出补货建议", icon: "📦", category: "库存" },
  { id: "weekly-summary", name: "周度经营汇总", description: "本周 vs 上周核心指标对比", prompt: "生成本周经营汇总报表，对比上周数据，显示GMV、订单量、退款率、客单价的环比变化，标注增减幅度", icon: "📅", category: "综合" },
];

// ── Provider ────────────────────────────────────────────────────────────────

export function AtlasProvider({ children }: { children: React.ReactNode }) {
  const [activeNav, setActiveNav] = useState<NavItem>("home");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeTaskId, setActiveTaskIdState] = useState<string | null>(() => localStorage.getItem("atlas_active_task"));
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem("atlas_theme") as Theme) || "dark");
  const [user, setUser] = useState<User | null>(null);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [tasks, setTasks] = useState<Task[]>(() => {
    try {
      const saved = localStorage.getItem("atlas_tasks");
      if (!saved) return [];
      const parsed = JSON.parse(saved) as Task[];
      // Restore Date objects and clear streaming state
      return parsed.map(t => ({
        ...t,
        messages: t.messages.map(m => ({
          ...m,
          timestamp: new Date(m.timestamp),
          isStreaming: false,
        })),
        uploadedFiles: t.uploadedFiles.map(f => ({
          ...f,
          uploadedAt: new Date(f.uploadedAt),
        })),
      }));
    } catch { return []; }
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [templates, setTemplates] = useState<Template[]>(SYSTEM_TEMPLATES);
  const [platforms, setPlatforms] = useState<PlatformConnection[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKeyConfig[]>(() => {
    try { return JSON.parse(localStorage.getItem("atlas_api_keys") || "[]"); } catch { return []; }
  });
  const [scheduledTasks, setScheduledTasks] = useState<ScheduledTask[]>([]);
  const [backendUrl, setBackendUrlState] = useState(() => localStorage.getItem("atlas_backend_url") || "http://localhost:8000");

  // Apply theme to document
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.classList.toggle("light", theme === "light");
    localStorage.setItem("atlas_theme", theme);
  }, [theme]);
  // Persist tasks to localStorage (debounced to avoid excessive writes)
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        // Limit stored tasks to last 20 to avoid localStorage quota issues
        const toStore = tasks.slice(0, 20).map(t => ({
          ...t,
          // Limit messages per task to last 50 to save space
          messages: t.messages.slice(-50).map(m => ({
            ...m,
            isStreaming: false,
            // Truncate very long content to avoid quota issues
            content: m.content.length > 10000 ? m.content.slice(0, 10000) + '...' : m.content,
          })),
          // Don't persist file binary data
          uploadedFiles: t.uploadedFiles.map(f => ({ ...f })),
        }));
        localStorage.setItem("atlas_tasks", JSON.stringify(toStore));
      } catch (e) {
        // If quota exceeded, clear old tasks
        try { localStorage.removeItem("atlas_tasks"); } catch {}
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [tasks]);
  // Persist activeTaskId
  useEffect(() => {
    if (activeTaskId) localStorage.setItem("atlas_active_task", activeTaskId);
    else localStorage.removeItem("atlas_active_task");
  }, [activeTaskId]);

  // Responsive: auto-close sidebar on small screens
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) setSidebarOpen(false);
      else setSidebarOpen(true);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Listen for unauthorized API errors
  useEffect(() => {
    const handleUnauthorized = () => setShowLoginModal(true);
    window.addEventListener("atlas:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("atlas:unauthorized", handleUnauthorized);
  }, []);

  // ── Task management ──────────────────────────────────────────────────────

  // Create a brand-new empty task and activate it
  const createNewTask = useCallback((): string => {
    const id = `task-${Date.now()}`;
    const newTask: Task = {
      id,
      title: "新建任务",
      filename: "",
      created_at: new Date().toISOString(),
      status: "uploaded",
      messages: [],
      uploadedFiles: [],
    };
    setTasks(prev => [newTask, ...prev]);
    setActiveTaskIdState(id);
    return id;
  }, []);

  const setActiveTaskId = useCallback((id: string | null) => {
    setActiveTaskIdState(id);
  }, []);

  const addTask = useCallback((t: Task) => {
    setTasks(prev => [t, ...prev]);
  }, []);

  const updateTask = useCallback((id: string, updates: Partial<Omit<Task, "messages" | "uploadedFiles">>) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  }, []);

  // ── Per-task files (scoped to activeTaskId) ──────────────────────────────

  // Get current task (memoized by activeTaskId)
  const activeTask = tasks.find(t => t.id === activeTaskId) ?? null;
  const uploadedFiles = activeTask?.uploadedFiles ?? [];
  const messages = activeTask?.messages ?? [];

  const addUploadedFile = useCallback((file: UploadedFile) => {
    setTasks(prev => prev.map(t =>
      t.id === activeTaskId
        ? { ...t, uploadedFiles: [file, ...t.uploadedFiles] }
        : t
    ));
  }, [activeTaskId]);

  const updateUploadedFile = useCallback((id: string, updates: Partial<UploadedFile>) => {
    setTasks(prev => prev.map(t =>
      t.id === activeTaskId
        ? { ...t, uploadedFiles: t.uploadedFiles.map(f => f.id === id ? { ...f, ...updates } : f) }
        : t
    ));
  }, [activeTaskId]);

  const removeUploadedFile = useCallback((id: string) => {
    setTasks(prev => prev.map(t =>
      t.id === activeTaskId
        ? { ...t, uploadedFiles: t.uploadedFiles.filter(f => f.id !== id) }
        : t
    ));
  }, [activeTaskId]);

  const clearFiles = useCallback(() => {
    setTasks(prev => prev.map(t =>
      t.id === activeTaskId ? { ...t, uploadedFiles: [] } : t
    ));
  }, [activeTaskId]);

  // ── Per-task messages ────────────────────────────────────────────────────

  const addMessage = useCallback((msg: Omit<Message, "id" | "timestamp">) => {
    const newMsg: Message = { ...msg, id: genId(), timestamp: new Date() };
    setTasks(prev => prev.map(t =>
      t.id === activeTaskId
        ? { ...t, messages: [...t.messages, newMsg] }
        : t
    ));
  }, [activeTaskId]);

  const updateLastMessage = useCallback((content: string, extra?: Partial<Message>) => {
    setTasks(prev => prev.map(t => {
      if (t.id !== activeTaskId) return t;
      if (!t.messages.length) return t;
      const msgs = [...t.messages];
      msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content, isStreaming: false, ...extra };
      return { ...t, messages: msgs };
    }));
  }, [activeTaskId]);

  const clearMessages = useCallback(() => {
    setTasks(prev => prev.map(t =>
      t.id === activeTaskId ? { ...t, messages: [] } : t
    ));
  }, [activeTaskId]);

  // ── Reports ──────────────────────────────────────────────────────────────

  const addReport = useCallback((r: ReportRecord) => setReports(prev => [r, ...prev]), []);

  // ── Templates ────────────────────────────────────────────────────────────

  const addTemplate = useCallback((t: Template) => setTemplates(prev => [t, ...prev]), []);
  const updateTemplate = useCallback((id: string, updates: Partial<Template>) => {
    setTemplates(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  }, []);
  const removeTemplate = useCallback((id: string) => setTemplates(prev => prev.filter(t => t.id !== id)), []);
  const pinTemplate = useCallback((id: string) => {
    setTemplates(prev => prev.map(t => t.id === id ? { ...t, isPinned: !t.isPinned } : t));
  }, []);

  // ── Platforms ────────────────────────────────────────────────────────────

  const addPlatform = useCallback((p: PlatformConnection) => setPlatforms(prev => [p, ...prev]), []);
  const updatePlatform = useCallback((id: string, updates: Partial<PlatformConnection>) => {
    setPlatforms(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  }, []);
  const removePlatform = useCallback((id: string) => setPlatforms(prev => prev.filter(p => p.id !== id)), []);

  // ── API Keys ─────────────────────────────────────────────────────────────

  const addApiKey = useCallback((k: ApiKeyConfig) => {
    setApiKeys(prev => {
      const next = [...prev, k];
      localStorage.setItem("atlas_api_keys", JSON.stringify(next));
      return next;
    });
  }, []);
  const updateApiKey = useCallback((id: string, updates: Partial<ApiKeyConfig>) => {
    setApiKeys(prev => {
      const next = prev.map(k => k.id === id ? { ...k, ...updates } : k);
      localStorage.setItem("atlas_api_keys", JSON.stringify(next));
      return next;
    });
  }, []);
  const removeApiKey = useCallback((id: string) => {
    setApiKeys(prev => {
      const next = prev.filter(k => k.id !== id);
      localStorage.setItem("atlas_api_keys", JSON.stringify(next));
      return next;
    });
  }, []);

  // ── Scheduled Tasks ──────────────────────────────────────────────────────

  const addScheduledTask = useCallback((t: ScheduledTask) => setScheduledTasks(prev => [...prev, t]), []);
  const updateScheduledTask = useCallback((id: string, updates: Partial<ScheduledTask>) => {
    setScheduledTasks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  }, []);
  const removeScheduledTask = useCallback((id: string) => setScheduledTasks(prev => prev.filter(t => t.id !== id)), []);

  const setBackendUrl = useCallback((url: string) => {
    setBackendUrlState(url);
    localStorage.setItem("atlas_backend_url", url);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(t => t === "dark" ? "light" : "dark");
  }, []);

  // Legacy compat
  const apiKey = apiKeys.find(k => k.isDefault)?.key || apiKeys[0]?.key || "";
  const setApiKey = useCallback((key: string) => {
    if (apiKeys.length === 0) {
      addApiKey({ id: "default", label: "默认 Key", key, model: "glm-5", provider: "智谱 AI", isDefault: true });
    } else {
      updateApiKey(apiKeys[0].id, { key });
    }
  }, [apiKeys, addApiKey, updateApiKey]);

  // addHistory: creates a task with empty messages/files (legacy compat for processFile)
  const addHistory = useCallback((h: Omit<Task, "messages" | "uploadedFiles">) => {
    setTasks(prev => {
      // If task already exists (same id), just update metadata
      if (prev.some(t => t.id === h.id)) {
        return prev.map(t => t.id === h.id ? { ...t, ...h } : t);
      }
      return [{ ...h, messages: [], uploadedFiles: [] }, ...prev];
    });
  }, []);

  return (
    <AtlasContext.Provider value={{
      activeNav, setActiveNav,
      sidebarOpen, setSidebarOpen,
      activeTaskId, setActiveTaskId,
      theme, toggleTheme, setTheme,
      user, setUser,
      showLoginModal, setShowLoginModal,
      tasks, addTask, updateTask, createNewTask,
      uploadedFiles, addUploadedFile, updateUploadedFile, removeUploadedFile, clearFiles,
      messages, addMessage, updateLastMessage, clearMessages,
      isProcessing, setIsProcessing,
      reports, addReport,
      templates, addTemplate, updateTemplate, removeTemplate, pinTemplate,
      platforms, addPlatform, updatePlatform, removePlatform,
      apiKeys, addApiKey, updateApiKey, removeApiKey,
      scheduledTasks, addScheduledTask, updateScheduledTask, removeScheduledTask,
      backendUrl, setBackendUrl,
      apiKey, setApiKey,
      history: tasks, setHistory: setTasks as any, addHistory,
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
