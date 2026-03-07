/**
 * ATLAS V4.0 — Global State Context
 * Manages: layout, theme, auth, files, chat, reports, templates, platforms
 */
import React, { createContext, useContext, useState, useCallback, useEffect } from "react";

export type NavItem = "home" | "dashboard" | "templates" | "settings";
export type Theme = "dark" | "light";

// ── Types ──────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  plan: "free" | "pro" | "enterprise";
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
  messages?: Message[];
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
}

export interface ReportRecord {
  id: string;
  title: string;
  filename: string;
  created_at: string;
  session_id: string;
  status: "completed" | "failed";
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

  // Tasks (Manus-style task list)
  tasks: Task[];
  addTask: (t: Task) => void;
  updateTask: (id: string, updates: Partial<Task>) => void;

  // Files (current session)
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
  // legacy compat
  apiKey: string;
  setApiKey: (key: string) => void;
  history: Task[];
  setHistory: React.Dispatch<React.SetStateAction<Task[]>>;
  addHistory: (h: Task) => void;
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
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem("atlas_theme") as Theme) || "dark");
  const [user, setUser] = useState<User | null>(null);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
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

  const toggleTheme = useCallback(() => {
    setTheme(t => t === "dark" ? "light" : "dark");
  }, []);

  const addTask = useCallback((t: Task) => setTasks(prev => [t, ...prev]), []);
  const updateTask = useCallback((id: string, updates: Partial<Task>) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  }, []);

  const addUploadedFile = useCallback((file: UploadedFile) => setUploadedFiles(prev => [file, ...prev]), []);
  const updateUploadedFile = useCallback((id: string, updates: Partial<UploadedFile>) => {
    setUploadedFiles(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f));
  }, []);
  const removeUploadedFile = useCallback((id: string) => setUploadedFiles(prev => prev.filter(f => f.id !== id)), []);
  const clearFiles = useCallback(() => setUploadedFiles([]), []);

  const addMessage = useCallback((msg: Omit<Message, "id" | "timestamp">) => {
    setMessages(prev => [...prev, { ...msg, id: genId(), timestamp: new Date() }]);
  }, []);
  const updateLastMessage = useCallback((content: string, extra?: Partial<Message>) => {
    setMessages(prev => {
      if (!prev.length) return prev;
      return [...prev.slice(0, -1), { ...prev[prev.length - 1], content, isStreaming: false, ...extra }];
    });
  }, []);
  const clearMessages = useCallback(() => setMessages([]), []);

  const addReport = useCallback((r: ReportRecord) => setReports(prev => [r, ...prev]), []);

  const addTemplate = useCallback((t: Template) => setTemplates(prev => [t, ...prev]), []);
  const updateTemplate = useCallback((id: string, updates: Partial<Template>) => {
    setTemplates(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  }, []);
  const removeTemplate = useCallback((id: string) => setTemplates(prev => prev.filter(t => t.id !== id)), []);
  const pinTemplate = useCallback((id: string) => {
    setTemplates(prev => prev.map(t => t.id === id ? { ...t, isPinned: !t.isPinned } : t));
  }, []);

  const addPlatform = useCallback((p: PlatformConnection) => setPlatforms(prev => [p, ...prev]), []);
  const updatePlatform = useCallback((id: string, updates: Partial<PlatformConnection>) => {
    setPlatforms(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  }, []);
  const removePlatform = useCallback((id: string) => setPlatforms(prev => prev.filter(p => p.id !== id)), []);

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

  const addScheduledTask = useCallback((t: ScheduledTask) => setScheduledTasks(prev => [...prev, t]), []);
  const updateScheduledTask = useCallback((id: string, updates: Partial<ScheduledTask>) => {
    setScheduledTasks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  }, []);
  const removeScheduledTask = useCallback((id: string) => setScheduledTasks(prev => prev.filter(t => t.id !== id)), []);

  const setBackendUrl = useCallback((url: string) => {
    setBackendUrlState(url);
    localStorage.setItem("atlas_backend_url", url);
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

  return (
    <AtlasContext.Provider value={{
      activeNav, setActiveNav,
      sidebarOpen, setSidebarOpen,
      activeTaskId, setActiveTaskId,
      theme, toggleTheme, setTheme,
      user, setUser,
      showLoginModal, setShowLoginModal,
      tasks, addTask, updateTask,
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
      history: tasks, setHistory: setTasks, addHistory: addTask,
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
