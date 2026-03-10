/**
 * ATLAS V15.0 — Global State Context
 * Six-module architecture: chat / files / ai-tools / automation / knowledge / settings
 */
import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";

// ── Module Types ────────────────────────────────────────────────────────────
export type ActiveModule = "chat" | "files" | "ai-tools" | "automation" | "knowledge" | "settings";

// Legacy compat
export type NavItem = "home" | "dashboard" | "templates" | "settings" | "search" | "library" | "invite" | "hr" | "im" | "openclaw-monitor";
export type Theme = "dark" | "light";

// ── Core Types ──────────────────────────────────────────────────────────────

export interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  plan: "free" | "pro" | "enterprise";
  role?: "user" | "admin";
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
  thinkingSteps?: string[];
}

export interface ReportRecord {
  id: string;
  title: string;
  filename: string;
  created_at: string;
  session_id: string;
  status: "completed" | "failed";
}

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
  backendSessionId?: string;
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
  // V15 Module Navigation
  activeModule: ActiveModule;
  setActiveModule: (m: ActiveModule) => void;

  // Legacy nav (kept for compat)
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
  deleteTask: (id: string) => void;
  createNewTask: () => string;

  // Current task's files
  uploadedFiles: UploadedFile[];
  addUploadedFile: (file: UploadedFile) => void;
  updateUploadedFile: (id: string, updates: Partial<UploadedFile>) => void;
  removeUploadedFile: (id: string) => void;
  clearFiles: () => void;

  // Current task's messages
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
  { id: "attendance", name: "考勤统计", description: "员工考勤汇总，含迟到、早退、缺勤", prompt: "分析考勤数据，生成考勤统计报表，包含出勤率、迟到次数、早退次数、缺勤天数，按员工汇总", icon: "⏰", category: "HR" },
  { id: "payroll", name: "工资条生成", description: "根据考勤和绩效自动生成工资条", prompt: "根据提供的考勤和绩效数据，生成工资条，包含基本工资、绩效奖金、扣款明细、实发工资", icon: "💳", category: "HR" },
];

// ── Provider ────────────────────────────────────────────────────────────────

export function AtlasProvider({ children }: { children: React.ReactNode }) {
  const [activeModule, setActiveModuleState] = useState<ActiveModule>(() => {
    const saved = localStorage.getItem("atlas_active_module");
    return (saved as ActiveModule) || "chat";
  });
  const [activeNav, setActiveNav] = useState<NavItem>("home");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeTaskId, setActiveTaskIdState] = useState<string | null>(() => localStorage.getItem("atlas_active_task"));
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem("atlas_theme");
    return (saved as Theme) || "light";
  });
  const [user, setUserState] = useState<User | null>(null);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [tasks, setTasks] = useState<Task[]>(() => {
    try {
      const saved = localStorage.getItem("atlas_tasks_v3");
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed.map((t: any) => ({
          ...t,
          messages: (t.messages || []).map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) })),
          uploadedFiles: (t.uploadedFiles || []).map((f: any) => ({ ...f, uploadedAt: new Date(f.uploadedAt) })),
        }));
      }
    } catch { /* ignore */ }
    return [];
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [templates, setTemplates] = useState<Template[]>(SYSTEM_TEMPLATES);
  const [platforms, setPlatforms] = useState<PlatformConnection[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKeyConfig[]>([]);
  const [scheduledTasks, setScheduledTasks] = useState<ScheduledTask[]>([]);
  const [backendUrl, setBackendUrl] = useState("");
  const [apiKey, setApiKey] = useState("");

  // Persist tasks
  useEffect(() => {
    localStorage.setItem("atlas_tasks_v3", JSON.stringify(tasks));
  }, [tasks]);

  // Persist theme
  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    localStorage.setItem("atlas_theme", t);
    document.documentElement.classList.toggle("dark", t === "dark");
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  // Apply theme on mount
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, []);

  const setActiveModule = useCallback((m: ActiveModule) => {
    setActiveModuleState(m);
    localStorage.setItem("atlas_active_module", m);
  }, []);

  const setActiveTaskId = useCallback((id: string | null) => {
    setActiveTaskIdState(id);
    if (id) localStorage.setItem("atlas_active_task", id);
    else localStorage.removeItem("atlas_active_task");
  }, []);

  const setUser = useCallback((u: User | null) => setUserState(u), []);

  // Task helpers
  const addTask = useCallback((t: Task) => {
    setTasks(prev => [t, ...prev]);
  }, []);

  const updateTask = useCallback((id: string, updates: Partial<Omit<Task, "messages" | "uploadedFiles">>) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  }, []);

  const deleteTask = useCallback((id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id));
    setActiveTaskIdState(prev => prev === id ? null : prev);
  }, []);

  const createNewTask = useCallback((): string => {
    const id = `task-${Date.now()}`;
    const newTask: Task = {
      id,
      title: "新对话",
      filename: "",
      created_at: new Date().toISOString(),
      status: "uploaded",
      messages: [],
      uploadedFiles: [],
    };
    setTasks(prev => [newTask, ...prev]);
    setActiveTaskId(id);
    return id;
  }, [setActiveTaskId]);

  // Current task's files
  const currentTask = tasks.find(t => t.id === activeTaskId);
  const uploadedFiles = currentTask?.uploadedFiles ?? [];

  const addUploadedFile = useCallback((file: UploadedFile) => {
    setTasks(prev => prev.map(t =>
      t.id === activeTaskId ? { ...t, uploadedFiles: [...t.uploadedFiles, file] } : t
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
      t.id === activeTaskId ? { ...t, uploadedFiles: t.uploadedFiles.filter(f => f.id !== id) } : t
    ));
  }, [activeTaskId]);

  const clearFiles = useCallback(() => {
    setTasks(prev => prev.map(t =>
      t.id === activeTaskId ? { ...t, uploadedFiles: [] } : t
    ));
  }, [activeTaskId]);

  // Current task's messages
  const messages = currentTask?.messages ?? [];

  const addMessage = useCallback((msg: Omit<Message, "id" | "timestamp">) => {
    const full: Message = { ...msg, id: genId(), timestamp: new Date() };
    setTasks(prev => prev.map(t =>
      t.id === activeTaskId ? { ...t, messages: [...t.messages, full] } : t
    ));
  }, [activeTaskId]);

  const updateLastMessage = useCallback((content: string, extra?: Partial<Message>) => {
    setTasks(prev => prev.map(t => {
      if (t.id !== activeTaskId) return t;
      const msgs = [...t.messages];
      if (msgs.length === 0) return t;
      msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content, ...extra };
      return { ...t, messages: msgs };
    }));
  }, [activeTaskId]);

  const clearMessages = useCallback(() => {
    setTasks(prev => prev.map(t =>
      t.id === activeTaskId ? { ...t, messages: [] } : t
    ));
  }, [activeTaskId]);

  // Reports
  const addReport = useCallback((r: ReportRecord) => {
    setReports(prev => [r, ...prev]);
  }, []);

  // Templates
  const addTemplate = useCallback((t: Template) => setTemplates(prev => [...prev, t]), []);
  const updateTemplate = useCallback((id: string, updates: Partial<Template>) => {
    setTemplates(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  }, []);
  const removeTemplate = useCallback((id: string) => {
    setTemplates(prev => prev.filter(t => t.id !== id));
  }, []);
  const pinTemplate = useCallback((id: string) => {
    setTemplates(prev => prev.map(t => t.id === id ? { ...t, isPinned: !t.isPinned } : t));
  }, []);

  // Platforms
  const addPlatform = useCallback((p: PlatformConnection) => setPlatforms(prev => [...prev, p]), []);
  const updatePlatform = useCallback((id: string, updates: Partial<PlatformConnection>) => {
    setPlatforms(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  }, []);
  const removePlatform = useCallback((id: string) => setPlatforms(prev => prev.filter(p => p.id !== id)), []);

  // API Keys
  const addApiKey = useCallback((k: ApiKeyConfig) => setApiKeys(prev => [...prev, k]), []);
  const updateApiKey = useCallback((id: string, updates: Partial<ApiKeyConfig>) => {
    setApiKeys(prev => prev.map(k => k.id === id ? { ...k, ...updates } : k));
  }, []);
  const removeApiKey = useCallback((id: string) => setApiKeys(prev => prev.filter(k => k.id !== id)), []);

  // Scheduled Tasks
  const addScheduledTask = useCallback((t: ScheduledTask) => setScheduledTasks(prev => [...prev, t]), []);
  const updateScheduledTask = useCallback((id: string, updates: Partial<ScheduledTask>) => {
    setScheduledTasks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  }, []);
  const removeScheduledTask = useCallback((id: string) => setScheduledTasks(prev => prev.filter(t => t.id !== id)), []);

  // Legacy history compat
  const [history, setHistory] = useState<Task[]>([]);
  const addHistory = useCallback((h: Omit<Task, "messages" | "uploadedFiles">) => {
    setHistory(prev => [{ ...h, messages: [], uploadedFiles: [] }, ...prev]);
  }, []);

  const value: AtlasContextType = {
    activeModule, setActiveModule,
    activeNav, setActiveNav,
    sidebarOpen, setSidebarOpen,
    activeTaskId, setActiveTaskId,
    theme, toggleTheme, setTheme,
    user, setUser,
    showLoginModal, setShowLoginModal,
    tasks, addTask, updateTask, deleteTask, createNewTask,
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
    history, setHistory, addHistory,
  };

  return <AtlasContext.Provider value={value}>{children}</AtlasContext.Provider>;
}

export function useAtlas() {
  const ctx = useContext(AtlasContext);
  if (!ctx) throw new Error("useAtlas must be used within AtlasProvider");
  return ctx;
}
