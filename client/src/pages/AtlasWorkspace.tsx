/**
 * ATLAS V8.0 — AtlasWorkspace
 * Three-column layout: Left Nav (220px) | Center Chat (flex) | Right Analysis Panel (320px)
 * Global bottom input bar spans all three columns
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MessageSquare, BarChart2, CheckSquare, FolderOpen,
  Plus, FileSpreadsheet, Clock, Sparkles, Send,
  Paperclip, Download, Loader2, Copy, Check,
  ChevronDown, ChevronRight, MoreHorizontal, X,
  TrendingUp, TrendingDown, Minus, RefreshCw,
  Home, LayoutDashboard, LayoutTemplate, Settings,
  Search, Archive, Users, Zap, LogIn, LogOut, User,
} from "lucide-react";
import { Streamdown } from "streamdown";
import { AtlasTableRenderer, parseAtlasTableBlocks } from "@/components/AtlasTableRenderer";
import { AtlasChartRenderer, parseAtlasChartBlocks } from "@/components/AtlasChartRenderer";
import { useAtlas, type NavItem, type UploadedFile, type Message } from "@/contexts/AtlasContext";
import { uploadFile, chatStream, generateReport, getDownloadUrl, type SuggestedAction } from "@/lib/api";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { nanoid } from "nanoid";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChartBlock {
  type: "bar" | "line" | "pie" | "area";
  title?: string;
  xKey: string;
  yKey: string | string[];
  unit?: string;
  data: Record<string, string | number>[];
}

interface MetricCard {
  label: string;
  value: string;
  change?: string;
  trend?: "up" | "down" | "neutral";
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_ACTIONS: SuggestedAction[] = [
  { icon: "📊", label: "生成汇总表", prompt: "帮我生成数据汇总表，包含关键指标和统计" },
  { icon: "🔍", label: "数据分析", prompt: "帮我分析这份数据，找出关键规律和异常值" },
  { icon: "🏆", label: "排名 Top10", prompt: "帮我找出数据中排名前10和后10的记录" },
  { icon: "✨", label: "自定义需求", prompt: "" },
];

const FOLLOWUP_ACTIONS: SuggestedAction[] = [
  { icon: "🔄", label: "再细化一下", prompt: "请对刚才的结果进行细化，增加更多维度的分析" },
  { icon: "📈", label: "换个格式", prompt: "请换一种格式重新生成，更清晰地展示数据" },
  { icon: "📋", label: "生成新报表", prompt: "我想生成另一份报表" },
  { icon: "💬", label: "继续分析", prompt: "请继续深入分析这份数据" },
];

const CHART_COLORS = [
  "#2563eb", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#06b6d4", "#f97316", "#84cc16", "#ec4899", "#14b8a6",
];

// ── Left Sidebar Nav ──────────────────────────────────────────────────────────

const NAV_ITEMS: { id: NavItem; icon: typeof Home; label: string }[] = [
  { id: "home",      icon: MessageSquare,   label: "Chat" },
  { id: "dashboard", icon: BarChart2,       label: "Analysis" },
  { id: "templates", icon: LayoutTemplate,  label: "Templates" },
  { id: "library",   icon: Archive,         label: "Files" },
];

const NAV_BOTTOM: { id: NavItem; icon: typeof Home; label: string }[] = [
  { id: "settings",  icon: Settings,        label: "Settings" },
];

// ── Left Sidebar Component ────────────────────────────────────────────────────

function LeftSidebar({
  onNewChat,
}: {
  onNewChat: () => void;
}) {
  const {
    activeNav, setActiveNav,
    tasks, activeTaskId, setActiveTaskId,
    uploadedFiles,
    user, setShowLoginModal,
  } = useAtlas();

  const logoutMut = trpc.auth.logout.useMutation({
    onSuccess: () => {
      toast.success("已退出登录");
      window.location.reload();
    },
  });

  const recentTasks = tasks.slice(0, 8);

  return (
    <div
      className="flex flex-col h-full"
      style={{
        width: 220,
        flexShrink: 0,
        borderRight: "1px solid var(--atlas-border)",
        background: "var(--atlas-surface)",
      }}
    >
      {/* Logo */}
      <div
        className="flex items-center gap-2.5 px-4 py-3.5"
        style={{ borderBottom: "1px solid var(--atlas-border)" }}
      >
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: "rgba(37,99,235,0.12)", border: "1px solid rgba(37,99,235,0.2)" }}
        >
          <Sparkles size={14} style={{ color: "#2563eb" }} />
        </div>
        <span className="font-bold text-sm tracking-tight" style={{ color: "var(--atlas-text)" }}>
          ATLAS
        </span>
      </div>

      {/* New Chat Button */}
      <div className="px-3 pt-3 pb-2">
        <button
          onClick={onNewChat}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all"
          style={{
            background: "#2563eb",
            color: "#fff",
          }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "#1d4ed8"}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "#2563eb"}
        >
          <Plus size={14} />
          新建对话
        </button>
      </div>

      {/* Main Nav */}
      <div className="px-2 py-1">
        {NAV_ITEMS.map(item => {
          const Icon = item.icon;
          const isActive = activeNav === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveNav(item.id)}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all mb-0.5"
              style={{
                background: isActive ? "rgba(37,99,235,0.1)" : "transparent",
                color: isActive ? "#2563eb" : "var(--atlas-text-2)",
                fontWeight: isActive ? 600 : 400,
              }}
              onMouseEnter={e => {
                if (!isActive) (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.04)";
              }}
              onMouseLeave={e => {
                if (!isActive) (e.currentTarget as HTMLElement).style.background = "transparent";
              }}
            >
              <Icon size={15} />
              {item.label}
            </button>
          );
        })}
      </div>

      {/* Divider */}
      <div className="mx-3 my-1" style={{ height: 1, background: "var(--atlas-border)" }} />

      {/* Recent Chats */}
      <div className="flex-1 overflow-y-auto px-2 py-1">
        <div
          className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--atlas-text-3)" }}
        >
          Recent Chats
        </div>
        {recentTasks.length === 0 ? (
          <div className="px-3 py-2 text-xs" style={{ color: "var(--atlas-text-3)" }}>
            暂无对话记录
          </div>
        ) : (
          recentTasks.map(task => {
            const isActive = task.id === activeTaskId;
            return (
              <button
                key={task.id}
                onClick={() => {
                  setActiveTaskId(task.id);
                  setActiveNav("home");
                }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-all mb-0.5 text-left"
                style={{
                  background: isActive ? "rgba(37,99,235,0.08)" : "transparent",
                  color: isActive ? "#2563eb" : "var(--atlas-text-2)",
                }}
                onMouseEnter={e => {
                  if (!isActive) (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.04)";
                }}
                onMouseLeave={e => {
                  if (!isActive) (e.currentTarget as HTMLElement).style.background = "transparent";
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ background: isActive ? "#2563eb" : "var(--atlas-text-3)" }}
                />
                <span className="truncate flex-1">{task.title || "新建对话"}</span>
              </button>
            );
          })
        )}

        {/* Files section */}
        {uploadedFiles.length > 0 && (
          <>
            <div className="mx-1 my-2" style={{ height: 1, background: "var(--atlas-border)" }} />
            <div
              className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider"
              style={{ color: "var(--atlas-text-3)" }}
            >
              Files
            </div>
            {uploadedFiles.slice(0, 5).map(f => (
              <div
                key={f.id}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs"
                style={{ color: "var(--atlas-text-2)" }}
              >
                <FileSpreadsheet size={12} style={{ color: "#10b981", flexShrink: 0 }} />
                <span className="truncate flex-1">{f.name}</span>
                {f.status === "ready" && f.dfInfo && (
                  <span style={{ color: "var(--atlas-text-3)", flexShrink: 0 }}>
                    {f.dfInfo.row_count.toLocaleString()}行
                  </span>
                )}
              </div>
            ))}
          </>
        )}
      </div>

      {/* Bottom Nav */}
      <div
        className="px-2 py-2"
        style={{ borderTop: "1px solid var(--atlas-border)" }}
      >
        {NAV_BOTTOM.map(item => {
          const Icon = item.icon;
          const isActive = activeNav === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveNav(item.id)}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all mb-0.5"
              style={{
                background: isActive ? "rgba(37,99,235,0.1)" : "transparent",
                color: isActive ? "#2563eb" : "var(--atlas-text-2)",
              }}
              onMouseEnter={e => {
                if (!isActive) (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.04)";
              }}
              onMouseLeave={e => {
                if (!isActive) (e.currentTarget as HTMLElement).style.background = "transparent";
              }}
            >
              <Icon size={15} />
              {item.label}
            </button>
          );
        })}

        {/* User */}
        <div className="flex items-center gap-2 px-3 py-2 mt-1">
          <div
            className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(37,99,235,0.12)", border: "1px solid rgba(37,99,235,0.2)" }}
          >
            <User size={12} style={{ color: "#2563eb" }} />
          </div>
          {user ? (
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate" style={{ color: "var(--atlas-text)" }}>
                {user.name}
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowLoginModal(true)}
              className="text-xs"
              style={{ color: "#2563eb" }}
            >
              登录
            </button>
          )}
          {user && (
            <button
              onClick={() => logoutMut.mutate()}
              className="flex-shrink-0"
              title="退出登录"
            >
              <LogOut size={13} style={{ color: "var(--atlas-text-3)" }} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Right Analysis Panel ──────────────────────────────────────────────────────

interface AnalysisPanelProps {
  charts: ChartBlock[];
  metrics: MetricCard[];
  title: string;
  isLoading?: boolean;
}

function AnalysisPanel({ charts, metrics, title, isLoading }: AnalysisPanelProps) {
  const [activeChartIdx, setActiveChartIdx] = useState(0);

  const hasContent = charts.length > 0 || metrics.length > 0;

  return (
    <div
      className="flex flex-col h-full"
      style={{
        width: 320,
        flexShrink: 0,
        borderLeft: "1px solid var(--atlas-border)",
        background: "var(--atlas-surface)",
      }}
    >
      {/* Panel Header */}
      <div
        className="flex items-center justify-between px-4 py-3 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--atlas-border)" }}
      >
        <div className="flex items-center gap-2">
          <BarChart2 size={14} style={{ color: "#2563eb" }} />
          <span className="text-sm font-semibold" style={{ color: "var(--atlas-text)" }}>
            {title || "Analysis"}
          </span>
        </div>
        <button
          className="p-1 rounded transition-colors"
          style={{ color: "var(--atlas-text-3)" }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-2)"}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)"}
        >
          <MoreHorizontal size={14} />
        </button>
      </div>

      {/* Panel Content */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <Loader2 size={20} className="animate-spin" style={{ color: "#2563eb" }} />
            <span className="text-xs" style={{ color: "var(--atlas-text-3)" }}>分析中...</span>
          </div>
        ) : !hasContent ? (
          <EmptyAnalysisPanel />
        ) : (
          <div className="p-4 space-y-4">
            {/* Charts */}
            {charts.length > 0 && (
              <div>
                {/* Chart tabs if multiple */}
                {charts.length > 1 && (
                  <div className="flex gap-1 mb-3 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
                    {charts.map((chart, idx) => (
                      <button
                        key={idx}
                        onClick={() => setActiveChartIdx(idx)}
                        className="px-2.5 py-1 rounded-md text-xs whitespace-nowrap flex-shrink-0 transition-all"
                        style={{
                          background: activeChartIdx === idx ? "rgba(37,99,235,0.1)" : "transparent",
                          color: activeChartIdx === idx ? "#2563eb" : "var(--atlas-text-3)",
                          border: activeChartIdx === idx ? "1px solid rgba(37,99,235,0.25)" : "1px solid transparent",
                          fontWeight: activeChartIdx === idx ? 600 : 400,
                        }}
                      >
                        {chart.title || `图表 ${idx + 1}`}
                      </button>
                    ))}
                  </div>
                )}

                {/* Active chart */}
                {charts[activeChartIdx] && (
                  <RightPanelChart chart={charts[activeChartIdx]} />
                )}
              </div>
            )}

            {/* Metric Cards */}
            {metrics.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--atlas-text-3)" }}>
                  Key Metrics
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {metrics.map((metric, idx) => (
                    <MetricCardView key={idx} metric={metric} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyAnalysisPanel() {
  return (
    <div className="flex flex-col items-center justify-center h-full px-6 text-center gap-4">
      <div
        className="w-14 h-14 rounded-2xl flex items-center justify-center"
        style={{
          background: "rgba(37,99,235,0.06)",
          border: "1px solid rgba(37,99,235,0.12)",
        }}
      >
        <BarChart2 size={24} style={{ color: "rgba(37,99,235,0.4)" }} />
      </div>
      <div>
        <p className="text-sm font-medium mb-1" style={{ color: "var(--atlas-text-2)" }}>
          Analysis Panel
        </p>
        <p className="text-xs leading-relaxed" style={{ color: "var(--atlas-text-3)" }}>
          上传数据并开始对话后，图表和关键指标将在此显示
        </p>
      </div>
      <div className="space-y-2 w-full">
        {["Revenue Growth", "Regional Sales", "Top Products"].map((label, i) => (
          <div
            key={i}
            className="flex items-center gap-2 px-3 py-2 rounded-lg"
            style={{ background: "rgba(0,0,0,0.03)", border: "1px solid var(--atlas-border)" }}
          >
            <div
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ background: `rgba(37,99,235,${0.3 - i * 0.08})` }}
            />
            <span className="text-xs" style={{ color: "var(--atlas-text-3)" }}>{label}</span>
            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--atlas-border)" }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${60 - i * 15}%`,
                  background: `rgba(37,99,235,${0.25 - i * 0.05})`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RightPanelChart({ chart }: { chart: ChartBlock }) {
  const yKeys = Array.isArray(chart.yKey) ? chart.yKey : [chart.yKey];
  const tickStyle = { fill: "var(--atlas-text-3)", fontSize: 10 };

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ border: "1px solid var(--atlas-border)", background: "#fff" }}
    >
      {chart.title && (
        <div
          className="px-3 py-2.5 text-xs font-semibold"
          style={{
            color: "var(--atlas-text)",
            borderBottom: "1px solid var(--atlas-border)",
          }}
        >
          {chart.title}
        </div>
      )}
      <div className="px-2 py-3" style={{ height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          {chart.type === "pie" ? (
            <PieChart>
              <Pie
                data={chart.data}
                dataKey={yKeys[0]}
                nameKey={chart.xKey}
                cx="50%"
                cy="50%"
                outerRadius={70}
                innerRadius={35}
                paddingAngle={2}
              >
                {chart.data.map((_, index) => (
                  <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} stroke="none" />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: number) => [`${value.toLocaleString()}${chart.unit || ""}`, ""]}
                contentStyle={{
                  background: "var(--atlas-surface)",
                  border: "1px solid var(--atlas-border)",
                  borderRadius: 8,
                  fontSize: 11,
                }}
              />
              <Legend
                formatter={(value) => (
                  <span style={{ color: "var(--atlas-text-2)", fontSize: 10 }}>{value}</span>
                )}
              />
            </PieChart>
          ) : chart.type === "line" ? (
            <LineChart data={chart.data} margin={{ top: 4, right: 8, left: -20, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--atlas-border)" vertical={false} />
              <XAxis dataKey={chart.xKey} tick={tickStyle} axisLine={false} tickLine={false} />
              <YAxis tick={tickStyle} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{
                  background: "var(--atlas-surface)",
                  border: "1px solid var(--atlas-border)",
                  borderRadius: 8,
                  fontSize: 11,
                }}
              />
              {yKeys.map((key, i) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={CHART_COLORS[i % CHART_COLORS.length]}
                  strokeWidth={2}
                  dot={{ r: 2, fill: CHART_COLORS[i % CHART_COLORS.length] }}
                />
              ))}
            </LineChart>
          ) : (
            <BarChart data={chart.data} margin={{ top: 4, right: 8, left: -20, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--atlas-border)" vertical={false} />
              <XAxis dataKey={chart.xKey} tick={tickStyle} axisLine={false} tickLine={false} />
              <YAxis tick={tickStyle} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{
                  background: "var(--atlas-surface)",
                  border: "1px solid var(--atlas-border)",
                  borderRadius: 8,
                  fontSize: 11,
                }}
              />
              {yKeys.map((key, i) => (
                <Bar
                  key={key}
                  dataKey={key}
                  fill={CHART_COLORS[i % CHART_COLORS.length]}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={36}
                />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function MetricCardView({ metric }: { metric: MetricCard }) {
  const TrendIcon = metric.trend === "up" ? TrendingUp : metric.trend === "down" ? TrendingDown : Minus;
  const trendColor = metric.trend === "up" ? "#10b981" : metric.trend === "down" ? "#ef4444" : "var(--atlas-text-3)";

  return (
    <div
      className="flex items-center justify-between px-3 py-2.5 rounded-lg"
      style={{
        background: "#fff",
        border: "1px solid var(--atlas-border)",
      }}
    >
      <div>
        <div className="text-xs mb-0.5" style={{ color: "var(--atlas-text-3)" }}>
          {metric.label}
        </div>
        <div className="text-sm font-bold" style={{ color: "var(--atlas-text)" }}>
          {metric.value}
        </div>
      </div>
      {metric.change && (
        <div className="flex items-center gap-1">
          <TrendIcon size={12} style={{ color: trendColor }} />
          <span className="text-xs font-medium" style={{ color: trendColor }}>
            {metric.change}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Center Chat Area ──────────────────────────────────────────────────────────

function ChatArea({
  messages,
  isGenerating,
  onDownload,
  onQuickAction,
}: {
  messages: (Message & { suggestedActions?: SuggestedAction[] })[];
  isGenerating: boolean;
  onDownload: (id: string, filename: string) => void;
  onQuickAction: (prompt: string) => void;
}) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-6 overflow-y-auto">
        <EmptyState />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="w-full max-w-3xl mx-auto px-6 py-5 space-y-4">
        {messages.map((msg, idx) => {
          const isLastAssistant = msg.role === "assistant" && idx === messages.length - 1;
          return (
            <MessageBubble
              key={msg.id}
              message={msg}
              onDownload={onDownload}
              onQuickAction={isLastAssistant && !msg.isStreaming ? onQuickAction : undefined}
              isLastAssistant={isLastAssistant}
            />
          );
        })}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-lg text-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="flex flex-col items-center gap-3"
      >
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center"
          style={{
            background: "linear-gradient(135deg, rgba(37,99,235,0.12) 0%, rgba(37,99,235,0.05) 100%)",
            border: "1px solid rgba(37,99,235,0.18)",
          }}
        >
          <BarChart2 size={28} style={{ color: "#2563eb" }} />
        </div>
        <div>
          <h2 className="font-bold text-xl tracking-tight mb-1" style={{ color: "var(--atlas-text)" }}>
            ATLAS
          </h2>
          <p className="text-sm" style={{ color: "#2563eb", fontWeight: 500 }}>
            行政 · 财务 · 数据分析 三合一智能助手
          </p>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="w-full flex gap-2.5 text-left"
      >
        <div
          className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
          style={{ background: "rgba(37,99,235,0.1)", border: "1px solid rgba(37,99,235,0.18)" }}
        >
          <Sparkles size={12} style={{ color: "#2563eb" }} />
        </div>
        <div
          className="flex-1 px-4 py-3.5 rounded-2xl"
          style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}
        >
          <p style={{ color: "var(--atlas-text)", fontSize: "14px", lineHeight: "1.75" }}>
            我是 ATLAS，专注行政、财务与数据分析的智能助手。
          </p>
          <p style={{ color: "var(--atlas-text-2)", fontSize: "14px", lineHeight: "1.75", marginTop: 6 }}>
            上传 Excel 或 CSV 文件，用一句话告诉我需求——比如「生成工资条」「汇总各店销售」「做考勤统计」。
          </p>
          <div className="flex items-center gap-0 mt-4">
            {[
              { icon: "📁", label: "上传文件" },
              { icon: "💬", label: "说需求" },
              { icon: "📊", label: "下载报表" },
            ].map((step, i) => (
              <div key={i} className="flex items-center">
                <div
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full"
                  style={{
                    background: `rgba(37,99,235,${0.12 - i * 0.03})`,
                    border: `1px solid rgba(37,99,235,${0.25 - i * 0.06})`,
                  }}
                >
                  <span style={{ fontSize: 12 }}>{step.icon}</span>
                  <span style={{ fontSize: 11, fontWeight: 500, color: `rgba(37,99,235,${0.9 - i * 0.15})` }}>
                    {step.label}
                  </span>
                </div>
                {i < 2 && (
                  <ChevronRight size={12} style={{ color: "rgba(37,99,235,0.3)", margin: "0 2px" }} />
                )}
              </div>
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ── Message Bubble ────────────────────────────────────────────────────────────

function MessageBubble({
  message,
  onDownload,
  onQuickAction,
  isLastAssistant,
}: {
  message: Message & { suggestedActions?: SuggestedAction[] };
  onDownload: (id: string, filename: string) => void;
  onQuickAction?: (prompt: string) => void;
  isLastAssistant?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [showThinking, setShowThinking] = useState(false);
  const actions: SuggestedAction[] = (message as any).suggestedActions || [];

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (message.role === "user") {
    return (
      <motion.div initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} className="flex justify-end">
        <div
          className="max-w-[72%] px-4 py-2.5 rounded-2xl"
          style={{
            background: "#2563eb",
            color: "#fff",
          }}
        >
          <p style={{ fontSize: 14, lineHeight: "1.6" }}>{message.content}</p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} className="flex gap-2.5">
      {/* Avatar */}
      <div
        className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{ background: "rgba(37,99,235,0.1)", border: "1px solid rgba(37,99,235,0.18)" }}
      >
        <Sparkles size={12} style={{ color: "#2563eb" }} />
      </div>

      <div className="flex-1 min-w-0">
        {/* Thinking steps */}
        {message.thinkingSteps && message.thinkingSteps.length > 0 && message.content && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="mb-2">
            <button
              onClick={() => setShowThinking(v => !v)}
              className="flex items-center gap-1.5 text-xs transition-colors"
              style={{ color: "var(--atlas-text-3)" }}
            >
              <span style={{ fontWeight: 500 }}>思考过程</span>
              <ChevronDown size={12} style={{ transform: showThinking ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
            </button>
            <AnimatePresence>
              {showThinking && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden mt-2 space-y-1.5"
                >
                  {message.thinkingSteps.map((step, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <div className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: "#2563eb", opacity: 0.5 }} />
                      <span style={{ fontSize: 12, color: "var(--atlas-text-3)", lineHeight: "1.6" }}>{step}</span>
                    </div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}

        {/* Message bubble */}
        <div
          className="px-4 py-3 rounded-2xl"
          style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}
        >
          {message.isStreaming && !message.content ? (
            <div className="flex items-center gap-2 py-0.5">
              <div className="flex items-center gap-1">
                {[0, 1, 2].map(i => (
                  <div key={i} className="atlas-thinking-dot" style={{ animationDelay: `${i * 0.2}s` }} />
                ))}
              </div>
              <span style={{ fontSize: 13, color: "var(--atlas-text-3)" }}>ATLAS 正在思考…</span>
            </div>
          ) : (() => {
            const { segments: tableSegs } = parseAtlasTableBlocks(message.content || "");
            const allSegments: Array<{ type: "text" | "table" | "chart"; content: string }> = [];
            for (const seg of tableSegs) {
              if (seg.type === "table") {
                allSegments.push(seg);
              } else {
                const chartParts = parseAtlasChartBlocks(seg.content);
                for (const part of chartParts) {
                  allSegments.push(part);
                }
              }
            }
            const hasSpecialBlocks = allSegments.some(s => s.type !== "text");
            if (!hasSpecialBlocks) {
              return (
                <div className="atlas-prose" style={{ fontSize: 14, lineHeight: "1.7" }}>
                  <Streamdown>{message.content}</Streamdown>
                </div>
              );
            }
            return (
              <div>
                {allSegments.map((seg, idx) =>
                  seg.type === "text" ? (
                    seg.content.trim() ? (
                      <div key={idx} className="atlas-prose" style={{ fontSize: 14, lineHeight: "1.7" }}>
                        <Streamdown>{seg.content}</Streamdown>
                      </div>
                    ) : null
                  ) : seg.type === "chart" ? (
                    <AtlasChartRenderer key={idx} rawJson={seg.content} />
                  ) : (
                    <AtlasTableRenderer key={idx} rawJson={seg.content} onAdjust={onQuickAction} />
                  )
                )}
              </div>
            );
          })()}
        </div>

        {/* Download button */}
        {message.report_id && message.report_filename && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="mt-2">
            <button
              onClick={() => onDownload(message.report_id!, message.report_filename!)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl font-medium transition-all text-sm"
              style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.25)", color: "#10b981" }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "rgba(16,185,129,0.18)"}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "rgba(16,185,129,0.1)"}
            >
              <Download size={14} />
              下载 {message.report_filename}
            </button>
          </motion.div>
        )}

        {/* Copy button */}
        {message.content && !message.isStreaming && (
          <div className="flex items-center gap-3 mt-1.5">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 text-xs transition-colors"
              style={{ color: copied ? "#10b981" : "var(--atlas-text-3)" }}
            >
              {copied ? <Check size={10} /> : <Copy size={10} />}
              {copied ? "已复制" : "复制"}
            </button>
          </div>
        )}

        {/* Suggested actions */}
        {isLastAssistant && !message.isStreaming && actions.length > 0 && onQuickAction && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="mt-3 flex flex-wrap gap-1.5"
          >
            {actions.map((action, i) => (
              <button
                key={i}
                onClick={() => onQuickAction(action.prompt)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={{
                  background: "var(--atlas-elevated)",
                  border: "1px solid var(--atlas-border)",
                  color: "var(--atlas-text-2)",
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = "rgba(37,99,235,0.4)";
                  (e.currentTarget as HTMLElement).style.color = "#2563eb";
                  (e.currentTarget as HTMLElement).style.background = "rgba(37,99,235,0.06)";
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = "var(--atlas-border)";
                  (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-2)";
                  (e.currentTarget as HTMLElement).style.background = "var(--atlas-elevated)";
                }}
              >
                <span>{action.icon}</span>
                <span>{action.label}</span>
              </button>
            ))}
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

// ── Bottom Input Bar ──────────────────────────────────────────────────────────

function BottomInputBar({
  value,
  onChange,
  onSend,
  onFileUpload,
  isGenerating,
  onStop,
  hasFiles,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: (text: string) => void;
  onFileUpload: (files: FileList) => void;
  isGenerating: boolean;
  onStop: () => void;
  hasFiles: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + "px";
    }
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isGenerating && value.trim()) onSend(value);
    }
  };

  return (
    <div
      className="flex-shrink-0 px-4 py-3"
      style={{
        borderTop: "1px solid var(--atlas-border)",
        background: "#fff",
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={e => e.target.files && onFileUpload(e.target.files)}
      />

      <div
        className="flex items-end gap-2 rounded-xl px-3 py-2"
        style={{
          border: "1.5px solid var(--atlas-border)",
          background: "#fff",
          boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
        }}
        onFocus={e => (e.currentTarget as HTMLElement).style.borderColor = "rgba(37,99,235,0.5)"}
        onBlur={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--atlas-border)"}
      >
        {/* Attachment button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex-shrink-0 p-1.5 rounded-lg transition-colors"
          style={{ color: "var(--atlas-text-3)" }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "#2563eb"}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)"}
          title="上传 Excel/CSV"
        >
          <Paperclip size={16} />
        </button>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={hasFiles ? "描述你的需求，例如：生成汇总表、分析趋势..." : "Ask ATLAS anything..."}
          rows={1}
          className="flex-1 resize-none outline-none bg-transparent text-sm"
          style={{
            color: "var(--atlas-text)",
            lineHeight: "1.6",
            minHeight: 24,
            maxHeight: 120,
          }}
          disabled={isGenerating}
        />

        {/* Send / Stop button */}
        {isGenerating ? (
          <button
            onClick={onStop}
            className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all"
            style={{ background: "#ef4444", color: "#fff" }}
          >
            <span style={{ fontSize: 10, fontWeight: 700 }}>■</span>
          </button>
        ) : (
          <button
            onClick={() => value.trim() && onSend(value)}
            disabled={!value.trim()}
            className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all"
            style={{
              background: value.trim() ? "#2563eb" : "rgba(37,99,235,0.15)",
              color: value.trim() ? "#fff" : "rgba(37,99,235,0.4)",
            }}
          >
            <Send size={14} />
          </button>
        )}
      </div>

      <div className="flex items-center gap-1 mt-1.5 px-1">
        <span className="text-xs" style={{ color: "var(--atlas-text-3)" }}>
          Enter 发送 · Shift+Enter 换行 · 支持拖拽文件
        </span>
      </div>
    </div>
  );
}

// ── Main AtlasWorkspace Component ─────────────────────────────────────────────

export default function AtlasWorkspace() {
  const {
    uploadedFiles, addUploadedFile, updateUploadedFile, removeUploadedFile, clearFiles,
    messages, addMessage, updateLastMessage, clearMessages,
    isProcessing, setIsProcessing,
    addReport,
    activeTaskId, createNewTask, updateTask,
    tasks,
  } = useAtlas();

  const [input, setInput] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [pendingActions, setPendingActions] = useState<SuggestedAction[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);

  // Right panel state
  const [panelCharts, setPanelCharts] = useState<ChartBlock[]>([]);
  const [panelMetrics, setPanelMetrics] = useState<MetricCard[]>([]);
  const [panelTitle, setPanelTitle] = useState("Analysis");
  const [panelLoading, setPanelLoading] = useState(false);

  const openClawPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPollTimestampRef = useRef<number>(Date.now());
  const abortControllerRef = useRef<AbortController | null>(null);

  const readyFiles = uploadedFiles.filter(f => f.status === "ready");
  const hasFiles = readyFiles.length > 0;

  const handleStop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsGenerating(false);
    setIsProcessing(false);
  }, [setIsProcessing]);

  // Helper: parse <suggestions> block
  const parseSuggestions = useCallback((text: string): { cleanText: string; suggestions: SuggestedAction[] } => {
    const match = text.match(/<suggestions>\s*([\s\S]*?)\s*<\/suggestions>/);
    if (!match) return { cleanText: text, suggestions: [] };
    const cleanText = text.replace(/<suggestions>[\s\S]*?<\/suggestions>/, "").trimEnd();
    try {
      const arr: string[] = JSON.parse(match[1].trim());
      const icons = ["💬", "📊", "🔍", "📝", "⚡", "📋"];
      const suggestions: SuggestedAction[] = arr.slice(0, 3).map((label, i) => ({
        icon: icons[i % icons.length],
        label,
        prompt: label,
      }));
      return { cleanText, suggestions };
    } catch {
      return { cleanText, suggestions: [] };
    }
  }, []);

  // Helper: parse inline options 【①】
  const parseInlineOptions = useCallback((text: string): SuggestedAction[] => {
    const matches = Array.from(text.matchAll(/【([①②③④⑤⑥⑦⑧⑨⑩\d])】\s*([^\n【]+)/g));
    if (matches.length === 0) return FOLLOWUP_ACTIONS;
    const icons = ['📊', '📈', '🔍', '⚡', '🎯', '📋', '💡', '🔢'];
    return [
      ...matches.map((m, i) => ({
        label: m[2].trim(),
        prompt: m[2].trim(),
        icon: icons[i % icons.length],
      })),
      { label: '自定义需求', prompt: '', icon: '✏️' },
    ];
  }, []);

  // Extract charts from AI message and push to right panel
  const extractAndPushCharts = useCallback((text: string) => {
    const chartBlocks = parseAtlasChartBlocks(text).filter(b => b.type === "chart");
    if (chartBlocks.length === 0) return;

    const newCharts: ChartBlock[] = [];
    for (const block of chartBlocks) {
      try {
        const parsed = JSON.parse(block.content) as ChartBlock;
        if (parsed && parsed.data && parsed.xKey && parsed.yKey) {
          newCharts.push(parsed);
        }
      } catch {
        // ignore parse errors
      }
    }

    if (newCharts.length > 0) {
      setPanelCharts(prev => {
        // Merge: keep existing charts, add new ones (avoid duplicates by title)
        const existingTitles = new Set(prev.map(c => c.title));
        const toAdd = newCharts.filter(c => !c.title || !existingTitles.has(c.title));
        return [...prev, ...toAdd];
      });
      // Set panel title from first chart
      if (newCharts[0].title) {
        setPanelTitle(newCharts[0].title);
      }
    }
  }, []);

  // File processing
  const processFile = useCallback(async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["xlsx", "xls", "csv"].includes(ext || "")) {
      toast.error(`不支持 .${ext} 格式，请上传 Excel 或 CSV`);
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      toast.error(`${file.name} 超过 50MB 限制`);
      return;
    }

    const tempId = nanoid();
    addUploadedFile({ id: tempId, name: file.name, size: file.size, status: "uploading", uploadedAt: new Date() });

    try {
      const result = await uploadFile(file);
      updateUploadedFile(tempId, {
        status: "ready",
        sessionId: result.session_id,
        dfInfo: {
          row_count: result.df_info.row_count,
          col_count: result.df_info.col_count,
          columns: (result.df_info.fields || []).map((f: any) => ({
            name: f.name,
            dtype: f.dtype,
            non_null_count: result.df_info.row_count - (f.null_count || 0),
            sample_values: f.sample || [],
            inferred_type: f.type || "text",
          })),
          preview: result.df_info.preview || [],
          file_size_kb: Math.round(file.size / 1024),
        },
      });

      if (activeTaskId) {
        const currentTask = tasks.find(t => t.id === activeTaskId);
        if (currentTask && currentTask.title === "新建任务") {
          updateTask(activeTaskId, { title: result.filename });
        }
      }

      if (result.suggested_actions?.length) {
        setPendingActions(result.suggested_actions);
      } else {
        setPendingActions(DEFAULT_ACTIONS);
      }

      addMessage({
        role: "assistant",
        content: result.ai_analysis,
        // @ts-ignore
        suggestedActions: result.suggested_actions || DEFAULT_ACTIONS,
      });

    } catch (err: any) {
      updateUploadedFile(tempId, { status: "error" });
      toast.error(`${file.name} 上传失败：${err.message}`);
    }
  }, [addUploadedFile, updateUploadedFile, addMessage, activeTaskId, tasks, updateTask]);

  const handleFiles = useCallback((files: FileList | File[]) => {
    if (!activeTaskId) createNewTask();
    Array.from(files).forEach(processFile);
  }, [processFile, activeTaskId, createNewTask]);

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  // Send message
  const handleSend = useCallback(async (text?: string) => {
    const msg = (text || input).trim();
    if (!msg || isGenerating) return;

    setInput("");
    setIsGenerating(true);
    setPendingActions([]);
    setPanelLoading(true);

    addMessage({ role: "user", content: msg });
    const steps = hasFiles
      ? ["解析文件数据", "理解你的需求", "生成回复"]
      : ["理解你的需求", "生成回复"];
    addMessage({ role: "assistant", content: "", isStreaming: true, thinkingSteps: steps });

    // Auto-generate task title
    if (activeTaskId) {
      const currentTask = tasks.find(t => t.id === activeTaskId);
      const isFirstMessage = currentTask?.messages.filter(m => m.role === "user").length === 0;
      if (isFirstMessage && (currentTask?.title === "新建任务" || !currentTask?.title)) {
        const autoTitle = msg.replace(/[，。！？,.!?]+$/, "").slice(0, 20) + (msg.length > 20 ? "..." : "");
        updateTask(activeTaskId, { title: autoTitle });
      }
    }

    const sessionIds = readyFiles.map(f => f.sessionId).filter(Boolean) as string[];
    const primarySessionId = sessionIds[0];

    const isReport = /生成报表|导出表格|excel表|xlsx表|日报生成|(帮我|(帮我)?生成|(帮我)?制作|(帮我)?做一份|(帮我)?做个|(帮我)?输出|(帮我)?整理成|(帮我)?提取).{0,8}(工资条|工资单|薪资表|薪酬表|分红明细|考勤表|出勤表|财务报表|销售报表|绩效表|奖金表|扣款表|个税表|实发明细|表格)|排名表|对比表/i.test(msg);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      if (isReport && primarySessionId) {
        setIsProcessing(true);
        updateLastMessage("好的，马上为您生成...");

        let result;
        try {
          result = await generateReport(primarySessionId, msg);
        } catch (reportErr: any) {
          const errMsg = reportErr.message || "未知错误";
          updateLastMessage(`生成失败：${errMsg}\n\n请检查数据格式或换个描述方式重试。`);
          toast.error(`生成失败：${errMsg}`);
          setInput(msg);
          return;
        }

        updateLastMessage(result.ai_message, {
          report_id: result.report_id,
          report_filename: result.filename,
          tableData: result.plan?.sheets || [],
          // @ts-ignore
          suggestedActions: FOLLOWUP_ACTIONS,
        });

        addReport({
          id: result.report_id,
          title: msg.slice(0, 30),
          filename: result.filename,
          created_at: new Date().toISOString(),
          session_id: primarySessionId,
          status: "completed",
        });

        toast.success("报表生成成功！");

      } else {
        const history = messages
          .filter(m => m.role === "user" || (m.role === "assistant" && m.content && !m.isStreaming))
          .slice(-8)
          .map(m => ({ role: m.role as "user" | "assistant", content: m.content }));

        let accumulated = "";
        await chatStream({
          sessionIds,
          message: msg,
          history,
          signal: abortController.signal,
          conversationId,
          onChunk: (chunk) => {
            accumulated += chunk;
            const visibleText = accumulated
              .replace(/<suggestions>[\s\S]*?<\/suggestions>/, "")
              .replace(/<suggestions>[\s\S]*$/, "");
            updateLastMessage(visibleText, { isStreaming: true });
          },
          onDone: (fullText, returnedConvId) => {
            const finalText = fullText || accumulated;
            if (returnedConvId) {
              setConversationId(returnedConvId);
              if (openClawPollRef.current) clearInterval(openClawPollRef.current);
              lastPollTimestampRef.current = Date.now();
              let pollCount = 0;
              openClawPollRef.current = setInterval(async () => {
                pollCount++;
                if (pollCount > 60) {
                  clearInterval(openClawPollRef.current!);
                  openClawPollRef.current = null;
                  return;
                }
                try {
                  const r = await fetch(
                    `/api/atlas/chat-replies?conversationId=${returnedConvId}&after=${lastPollTimestampRef.current}`,
                    { credentials: "include" }
                  );
                  if (!r.ok) return;
                  const data = await r.json() as { messages: Array<{ id: string; content: string; createdAt: string }> };
                  if (data.messages && data.messages.length > 0) {
                    const latestMsg = data.messages[data.messages.length - 1];
                    addMessage({ role: "assistant", content: `🦐 **小虾米回复**\n\n${latestMsg.content}` });
                    lastPollTimestampRef.current = new Date(latestMsg.createdAt).getTime();
                    clearInterval(openClawPollRef.current!);
                    openClawPollRef.current = null;
                  }
                } catch (e) {
                  console.warn("[Poll] chat-replies error:", e);
                }
              }, 5_000);
            }

            const { cleanText, suggestions } = parseSuggestions(finalText);
            const parsedActions = suggestions.length > 0 ? suggestions : parseInlineOptions(cleanText);
            updateLastMessage(cleanText, {
              // @ts-ignore
              suggestedActions: parsedActions,
            });

            // Extract charts and push to right panel
            extractAndPushCharts(cleanText);
            setPanelLoading(false);
          },
          onError: (err) => {
            const errMsg = err.message || "请求失败";
            updateLastMessage(`对话失败：${errMsg}\n\n请稍后重试。`);
            toast.error("对话失败，请重试");
            setInput(msg);
            setPanelLoading(false);
          },
          onTelegramTask: (taskId, pendingMsg) => {
            updateLastMessage(pendingMsg, { isStreaming: false });
            let attempts = 0;
            const pollInterval = setInterval(async () => {
              attempts++;
              try {
                const r = await fetch(`/api/atlas/task/${taskId}/status`, { credentials: "include" });
                if (!r.ok) return;
                const data = await r.json() as { status: string; reply?: string; error_msg?: string; output_files?: Array<{ name: string; fileUrl: string }> };
                if (data.status === "completed" && data.reply) {
                  clearInterval(pollInterval);
                  const parsedActions = parseInlineOptions(data.reply);
                  let finalMsg = data.reply;
                  if (data.output_files && data.output_files.length > 0) {
                    finalMsg += "\n\n📄 **输出文件**\n" + data.output_files.map(f => `- [${f.name}](${f.fileUrl})`).join("\n");
                  }
                  updateLastMessage(finalMsg, { suggestedActions: parsedActions } as any);
                  extractAndPushCharts(finalMsg);
                  toast.success("任务已完成！");
                  setIsGenerating(false);
                  setPanelLoading(false);
                } else if (data.status === "failed" || data.status === "error") {
                  clearInterval(pollInterval);
                  updateLastMessage(`❌ ${data.error_msg || "处理失败，请重试"}`);
                  setIsGenerating(false);
                  setPanelLoading(false);
                } else if (attempts >= 60) {
                  clearInterval(pollInterval);
                  updateLastMessage(pendingMsg + "\n\n⏰ 任务超时，请重新发送消息重试。");
                  setIsGenerating(false);
                  setPanelLoading(false);
                }
              } catch (e) {
                console.warn("[Poll] task status error:", e);
              }
            }, 10_000);
          },
        });
      }
    } catch (err: any) {
      const errMsg = err.message || "请检查网络连接";
      updateLastMessage(`处理失败：${errMsg}`);
      toast.error("请求失败，请重试");
      setInput(msg);
      setPanelLoading(false);
    } finally {
      abortControllerRef.current = null;
      setIsGenerating(false);
      setIsProcessing(false);
    }
  }, [input, isGenerating, hasFiles, readyFiles, messages, addMessage, updateLastMessage, setIsProcessing, addReport, parseSuggestions, parseInlineOptions, conversationId, extractAndPushCharts, activeTaskId, tasks, updateTask]);

  const handleDownload = (reportId: string, filename: string) => {
    const a = document.createElement("a");
    a.href = getDownloadUrl(reportId);
    a.download = filename;
    a.click();
    toast.success("开始下载");
  };

  const handleNewChat = () => {
    createNewTask();
    clearFiles();
    clearMessages();
    setPendingActions([]);
    setPanelCharts([]);
    setPanelMetrics([]);
    setPanelTitle("Analysis");
  };

  // Reset panel when switching tasks
  useEffect(() => {
    setPanelCharts([]);
    setPanelMetrics([]);
    setPanelTitle("Analysis");
    setPanelLoading(false);
  }, [activeTaskId]);

  return (
    <div
      className="flex h-full overflow-hidden relative"
      style={{ background: "#fff" }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Left Sidebar */}
      <LeftSidebar onNewChat={handleNewChat} />

      {/* Center: Chat + Input */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Chat header */}
        <div
          className="flex items-center gap-2.5 px-5 py-2.5 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--atlas-border)" }}
        >
          <div
            className="w-6 h-6 rounded-md flex items-center justify-center"
            style={{ background: "rgba(37,99,235,0.1)" }}
          >
            <Sparkles size={13} style={{ color: "#2563eb" }} />
          </div>
          <span className="text-sm font-semibold" style={{ color: "var(--atlas-text)" }}>ATLAS AI</span>

          {/* File chips */}
          {uploadedFiles.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {uploadedFiles.map(f => (
                <span
                  key={f.id}
                  className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
                  style={{
                    background: f.status === "ready" ? "rgba(16,185,129,0.08)" : "rgba(37,99,235,0.08)",
                    color: f.status === "ready" ? "#10b981" : "#2563eb",
                    border: `1px solid ${f.status === "ready" ? "rgba(16,185,129,0.2)" : "rgba(37,99,235,0.2)"}`,
                  }}
                >
                  {f.status === "uploading"
                    ? <Loader2 size={9} className="animate-spin" />
                    : <FileSpreadsheet size={9} />
                  }
                  <span className="max-w-[100px] truncate">{f.name}</span>
                  {f.status === "ready" && f.dfInfo && (
                    <span style={{ opacity: 0.7 }}>{f.dfInfo.row_count.toLocaleString()}行</span>
                  )}
                  {f.status !== "uploading" && (
                    <button
                      onClick={e => { e.stopPropagation(); removeUploadedFile(f.id); }}
                      className="ml-0.5 rounded-full flex items-center justify-center"
                      style={{ width: 14, height: 14, flexShrink: 0 }}
                    >
                      <X size={9} />
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}

          <div className="flex-1" />

          {isProcessing && (
            <div className="flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin" style={{ color: "#2563eb" }} />
              <span className="text-xs" style={{ color: "var(--atlas-text-2)" }}>生成中...</span>
            </div>
          )}

          {(uploadedFiles.length > 0 || messages.length > 0) && (
            <button
              onClick={() => { clearFiles(); clearMessages(); setPendingActions([]); }}
              className="text-xs transition-colors"
              style={{ color: "var(--atlas-text-3)" }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-2)"}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)"}
            >
              清空
            </button>
          )}
        </div>

        {/* Chat messages */}
        <ChatArea
          messages={messages as any}
          isGenerating={isGenerating}
          onDownload={handleDownload}
          onQuickAction={(prompt) => {
            if (prompt) handleSend(prompt);
          }}
        />

        {/* Bottom input */}
        <BottomInputBar
          value={input}
          onChange={setInput}
          onSend={handleSend}
          onFileUpload={handleFiles}
          isGenerating={isGenerating}
          onStop={handleStop}
          hasFiles={hasFiles}
        />
      </div>

      {/* Right Analysis Panel */}
      <AnalysisPanel
        charts={panelCharts}
        metrics={panelMetrics}
        title={panelTitle}
        isLoading={panelLoading}
      />

      {/* Drag overlay */}
      <AnimatePresence>
        {isDragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none"
            style={{
              background: "rgba(37,99,235,0.06)",
              border: "2px dashed rgba(37,99,235,0.4)",
            }}
          >
            <div className="text-center">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
                style={{ background: "rgba(37,99,235,0.12)", border: "1px solid rgba(37,99,235,0.3)" }}
              >
                <FileSpreadsheet size={28} style={{ color: "#2563eb" }} />
              </div>
              <p className="text-lg font-semibold mb-1" style={{ color: "var(--atlas-text)" }}>
                松开，把数据交给 ATLAS
              </p>
              <p className="text-sm" style={{ color: "var(--atlas-text-2)" }}>
                支持 Excel / CSV，可同时拖入多个文件
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
