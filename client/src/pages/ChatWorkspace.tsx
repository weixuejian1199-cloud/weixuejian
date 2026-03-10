/**
 * ATLAS V15.0 — Chat Workspace (Center 40% + Right 40%)
 * Preserved all AI logic from AtlasWorkspace V8.0
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BarChart2, Plus, FileSpreadsheet, Sparkles, Send,
  Paperclip, Download, Loader2, Copy, Check,
  ChevronDown, ChevronRight, MoreHorizontal, X,
  TrendingUp, TrendingDown, Minus, Puzzle, Workflow,
} from "lucide-react";
import { Streamdown } from "streamdown";
import { AtlasTableRenderer, parseAtlasTableBlocks } from "@/components/AtlasTableRenderer";
import { AtlasChartRenderer, parseAtlasChartBlocks } from "@/components/AtlasChartRenderer";
import { useAtlas, type UploadedFile, type Message } from "@/contexts/AtlasContext";
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

// ── Right Analysis Panel ──────────────────────────────────────────────────────

function AnalysisPanel({ charts, metrics, title, isLoading }: {
  charts: ChartBlock[];
  metrics: MetricCard[];
  title: string;
  isLoading?: boolean;
}) {
  const [activeChartIdx, setActiveChartIdx] = useState(0);
  const hasContent = charts.length > 0 || metrics.length > 0;

  return (
    <div
      className="flex flex-col h-full flex-shrink-0"
      style={{
        width: "40%",
        borderLeft: "1px solid rgba(74,144,226,0.15)",
        background: "rgba(255,255,255,0.6)",
        backdropFilter: "blur(20px)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--atlas-border)" }}
      >
        <div className="flex items-center gap-2">
          <BarChart2 size={14} style={{ color: "#2563eb" }} />
          <span className="text-sm font-semibold" style={{ color: "var(--atlas-text)" }}>
            {title || "数据分析"}
          </span>
          {isLoading && (
            <div className="flex items-center gap-1 ml-1">
              <div className="w-1 h-1 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: "0ms" }} />
              <div className="w-1 h-1 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: "150ms" }} />
              <div className="w-1 h-1 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          )}
        </div>
        <button className="p-1 rounded transition-colors" style={{ color: "var(--atlas-text-3)" }}>
          <MoreHorizontal size={14} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {!hasContent ? (
          <EmptyAnalysisPanel />
        ) : (
          <div className="p-4 space-y-4">
            {charts.length > 0 && (
              <div>
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
                {charts[activeChartIdx] && <RightPanelChart chart={charts[activeChartIdx]} />}
              </div>
            )}

            {metrics.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--atlas-text-3)" }}>
                  关键指标
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
    <div className="flex flex-col items-center justify-center h-full px-6 gap-6" style={{ position: "relative", overflow: "hidden" }}>
      {/* 3D 数据球 */}
      <div className="relative flex items-center justify-center" style={{ width: 200, height: 200 }}>
        {/* 外圈光晓 */}
        <div
          className="absolute inset-0 rounded-full animate-atlas-glow"
          style={{
            background: "radial-gradient(circle, rgba(74,144,226,0.15) 0%, rgba(74,144,226,0.05) 50%, transparent 70%)",
          }}
        />
        {/* 球体主体 */}
        <div
          className="relative rounded-full"
          style={{
            width: 140,
            height: 140,
            background: "radial-gradient(circle at 35% 35%, rgba(255,255,255,0.9) 0%, rgba(147,197,253,0.6) 30%, rgba(74,144,226,0.4) 60%, rgba(37,99,235,0.3) 100%)",
            boxShadow: "0 8px 32px rgba(74,144,226,0.3), inset 0 -4px 16px rgba(37,99,235,0.2), inset 0 4px 8px rgba(255,255,255,0.6)",
          }}
        >
          {/* 旋转网格线 SVG */}
          <svg
            className="absolute inset-0 animate-atlas-sphere"
            width="140" height="140" viewBox="0 0 140 140"
            style={{ opacity: 0.35 }}
          >
            {/* 经线 */}
            <ellipse cx="70" cy="70" rx="68" ry="20" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="0.8" />
            <ellipse cx="70" cy="70" rx="68" ry="40" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="0.8" />
            <ellipse cx="70" cy="70" rx="68" ry="60" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="0.8" />
            {/* 纬线 */}
            <ellipse cx="70" cy="70" rx="20" ry="68" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="0.8" />
            <ellipse cx="70" cy="70" rx="40" ry="68" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="0.8" />
            <ellipse cx="70" cy="70" rx="60" ry="68" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="0.8" />
          </svg>
          {/* 节点点 */}
          <svg className="absolute inset-0" width="140" height="140" viewBox="0 0 140 140">
            {[
              [70, 30], [100, 50], [110, 80], [90, 110], [50, 115],
              [25, 90], [30, 55], [55, 35], [85, 70], [45, 75],
            ].map(([cx, cy], i) => (
              <circle
                key={i}
                cx={cx} cy={cy} r="3"
                fill="rgba(255,255,255,0.9)"
                style={{ animation: `atlas-pulse-glow ${1.5 + i * 0.3}s ease-in-out infinite` }}
              />
            ))}
            {/* 连线 */}
            <line x1="70" y1="30" x2="100" y2="50" stroke="rgba(255,255,255,0.4)" strokeWidth="0.8" />
            <line x1="100" y1="50" x2="110" y2="80" stroke="rgba(255,255,255,0.4)" strokeWidth="0.8" />
            <line x1="110" y1="80" x2="85" y2="70" stroke="rgba(255,255,255,0.4)" strokeWidth="0.8" />
            <line x1="85" y1="70" x2="45" y2="75" stroke="rgba(255,255,255,0.4)" strokeWidth="0.8" />
            <line x1="45" y1="75" x2="30" y2="55" stroke="rgba(255,255,255,0.4)" strokeWidth="0.8" />
            <line x1="30" y1="55" x2="55" y2="35" stroke="rgba(255,255,255,0.4)" strokeWidth="0.8" />
            <line x1="55" y1="35" x2="70" y2="30" stroke="rgba(255,255,255,0.4)" strokeWidth="0.8" />
          </svg>
        </div>

        {/* 浮动图表卡片 — 左上 */}
        <div
          className="absolute animate-atlas-float"
          style={{
            top: 10, left: -20,
            background: "rgba(255,255,255,0.92)",
            backdropFilter: "blur(8px)",
            border: "1px solid rgba(74,144,226,0.2)",
            borderRadius: 10,
            padding: "8px 12px",
            boxShadow: "0 4px 16px rgba(74,144,226,0.15)",
            minWidth: 80,
          }}
        >
          <div style={{ fontSize: 9, color: "var(--atlas-text-3)", marginBottom: 4 }}>门店销售</div>
          <svg width="60" height="28" viewBox="0 0 60 28">
            <polyline points="0,22 12,16 24,18 36,8 48,12 60,4" fill="none" stroke="#4A90E2" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <polyline points="0,22 12,16 24,18 36,8 48,12 60,4" fill="url(#g1)" opacity="0.2" />
            <defs>
              <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#4A90E2" />
                <stop offset="100%" stopColor="transparent" />
              </linearGradient>
            </defs>
          </svg>
        </div>

        {/* 浮动图表卡片 — 右上 */}
        <div
          className="absolute animate-atlas-float-delay"
          style={{
            top: 5, right: -25,
            background: "rgba(255,255,255,0.92)",
            backdropFilter: "blur(8px)",
            border: "1px solid rgba(74,144,226,0.2)",
            borderRadius: 10,
            padding: "8px 10px",
            boxShadow: "0 4px 16px rgba(74,144,226,0.15)",
          }}
        >
          <div style={{ fontSize: 9, color: "var(--atlas-text-3)", marginBottom: 4 }}>收入分布</div>
          <div className="flex items-end gap-1">
            {[14, 20, 16, 24, 18].map((h, i) => (
              <div
                key={i}
                style={{
                  width: 7, height: h,
                  borderRadius: 2,
                  background: `rgba(74,144,226,${0.4 + i * 0.1})`,
                }}
              />
            ))}
          </div>
        </div>

        {/* 浮动卡片 — 左下 */}
        <div
          className="absolute animate-atlas-float"
          style={{
            bottom: 15, left: -15,
            background: "rgba(255,255,255,0.92)",
            backdropFilter: "blur(8px)",
            border: "1px solid rgba(74,144,226,0.2)",
            borderRadius: 10,
            padding: "6px 10px",
            boxShadow: "0 4px 16px rgba(74,144,226,0.15)",
            animationDelay: "0.8s",
          }}
        >
          <div className="flex items-center gap-1.5">
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#10b981" }} />
            <span style={{ fontSize: 10, color: "var(--atlas-text-2)", fontWeight: 500 }}>1:44</span>
          </div>
        </div>
      </div>

      {/* 文字说明 */}
      <div className="text-center">
        <p className="text-[13px] font-medium mb-1" style={{ color: "var(--atlas-text-2)" }}>
          数据结果将在这里展示
        </p>
        <p className="text-[12px] leading-relaxed" style={{ color: "var(--atlas-text-3)" }}>
          上传数据并开始对话后，图表和关键指标将实时渲染
        </p>
      </div>
    </div>
  );
}

function RightPanelChart({ chart }: { chart: ChartBlock }) {
  const yKeys = Array.isArray(chart.yKey) ? chart.yKey : [chart.yKey];
  const tickStyle = { fill: "var(--atlas-text-3)", fontSize: 10 };

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--atlas-border)", background: "#fff" }}>
      {chart.title && (
        <div className="px-3 py-2.5 text-xs font-semibold" style={{ color: "var(--atlas-text)", borderBottom: "1px solid var(--atlas-border)" }}>
          {chart.title}
        </div>
      )}
      <div className="px-2 py-3" style={{ height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          {chart.type === "pie" ? (
            <PieChart>
              <Pie data={chart.data} dataKey={yKeys[0]} nameKey={chart.xKey} cx="50%" cy="50%" outerRadius={70} innerRadius={35} paddingAngle={2}>
                {chart.data.map((_, index) => (
                  <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} stroke="none" />
                ))}
              </Pie>
              <Tooltip formatter={(value: number) => [`${value.toLocaleString()}${chart.unit || ""}`, ""]} contentStyle={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)", borderRadius: 8, fontSize: 11 }} />
              <Legend formatter={(value) => <span style={{ color: "var(--atlas-text-2)", fontSize: 10 }}>{value}</span>} />
            </PieChart>
          ) : chart.type === "line" ? (
            <LineChart data={chart.data} margin={{ top: 4, right: 8, left: -20, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--atlas-border)" vertical={false} />
              <XAxis dataKey={chart.xKey} tick={tickStyle} axisLine={false} tickLine={false} />
              <YAxis tick={tickStyle} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)", borderRadius: 8, fontSize: 11 }} />
              {yKeys.map((key, i) => (
                <Line key={key} type="monotone" dataKey={key} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} dot={{ r: 2, fill: CHART_COLORS[i % CHART_COLORS.length] }} />
              ))}
            </LineChart>
          ) : (
            <BarChart data={chart.data} margin={{ top: 4, right: 8, left: -20, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--atlas-border)" vertical={false} />
              <XAxis dataKey={chart.xKey} tick={tickStyle} axisLine={false} tickLine={false} />
              <YAxis tick={tickStyle} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)", borderRadius: 8, fontSize: 11 }} />
              {yKeys.map((key, i) => (
                <Bar key={key} dataKey={key} fill={CHART_COLORS[i % CHART_COLORS.length]} radius={[3, 3, 0, 0]} maxBarSize={36} />
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
    <div className="flex items-center justify-between px-3 py-2.5 rounded-lg" style={{ background: "#fff", border: "1px solid var(--atlas-border)" }}>
      <div>
        <div className="text-xs mb-0.5" style={{ color: "var(--atlas-text-3)" }}>{metric.label}</div>
        <div className="text-sm font-bold" style={{ color: "var(--atlas-text)" }}>{metric.value}</div>
      </div>
      {metric.change && (
        <div className="flex items-center gap-1">
          <TrendIcon size={12} style={{ color: trendColor }} />
          <span className="text-xs font-medium" style={{ color: trendColor }}>{metric.change}</span>
        </div>
      )}
    </div>
  );
}

// ── Center Chat Area ──────────────────────────────────────────────────────────

function ChatArea({ messages, isGenerating, onDownload, onQuickAction }: {
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
      <div className="flex-1 overflow-hidden" style={{ position: "relative" }}>
        <EmptyState onSuggestion={onQuickAction} />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="w-full max-w-2xl mx-auto px-5 py-5 space-y-4">
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

function EmptyState({ onSuggestion }: { onSuggestion?: (prompt: string) => void }) {
  const QUICK_SUGGESTIONS = [
    { label: "合并14家门店销售表", prompt: "请帮我合并14家门店的销售数据，生成汇总表" },
    { label: "数据多店铺行款水", prompt: "请帮我整理多店铺的行款流水数据" },
    { label: "把不同格式账单汇总一条线", prompt: "请把不同格式的账单数据汇总成一条线" },
  ];

  return (
    <div className="w-full h-full flex flex-col justify-end pb-8 pl-5 pr-[40%]">
      {/* 用户气泡 — 参考设计稿，靠左，正常大小 */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex items-start gap-2.5 mb-4"
      >
        {/* 用户头像 */}
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden"
          style={{
            background: "linear-gradient(135deg, #4A90E2 0%, #9B8FF5 100%)",
            boxShadow: "0 2px 8px rgba(74,144,226,0.3)",
            border: "2px solid rgba(255,255,255,0.8)",
          }}
        >
          <span style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>U</span>
        </div>

        {/* 气泡 */}
        <div
          className="px-4 py-2.5 rounded-2xl rounded-tl-sm"
          style={{
            background: "linear-gradient(135deg, #5B9CF6 0%, #8B7CF5 100%)",
            boxShadow: "0 4px 16px rgba(91,156,246,0.35), inset 0 1px 0 rgba(255,255,255,0.25)",
            maxWidth: 320,
          }}
        >
          <p style={{ color: "#fff", fontSize: 14, lineHeight: "1.6", fontWeight: 500 }}>
            把多份数据拖进来，按我的汇总成一份总表。
          </p>
        </div>
      </motion.div>

      {/* 快捷建议卡片 */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="space-y-2 ml-10"
      >
        {QUICK_SUGGESTIONS.map((s, i) => (
          <motion.button
            key={i}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 + i * 0.06 }}
            onClick={() => onSuggestion?.(s.prompt)}
            className="flex items-center gap-3 w-full px-4 py-2.5 rounded-xl text-left transition-all"
            style={{
              background: "rgba(255,255,255,0.75)",
              backdropFilter: "blur(12px)",
              border: "1px solid rgba(74,144,226,0.18)",
              boxShadow: "0 2px 8px rgba(74,144,226,0.08)",
              maxWidth: 320,
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.95)";
              (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 16px rgba(74,144,226,0.15)";
              (e.currentTarget as HTMLElement).style.borderColor = "rgba(74,144,226,0.35)";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.75)";
              (e.currentTarget as HTMLElement).style.boxShadow = "0 2px 8px rgba(74,144,226,0.08)";
              (e.currentTarget as HTMLElement).style.borderColor = "rgba(74,144,226,0.18)";
            }}
          >
            {/* 图标 */}
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(74,144,226,0.1)" }}
            >
              <FileSpreadsheet size={14} style={{ color: "var(--atlas-accent)" }} />
            </div>
            <span className="flex-1 text-[13px]" style={{ color: "var(--atlas-text-2)" }}>{s.label}</span>
            <ChevronRight size={14} style={{ color: "var(--atlas-text-4)", flexShrink: 0 }} />
          </motion.button>
        ))}
      </motion.div>
    </div>
  );
}

// ── Message Bubble ────────────────────────────────────────────────────────────

function MessageBubble({ message, onDownload, onQuickAction, isLastAssistant }: {
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
          className="max-w-[72%] px-4 py-2.5 rounded-2xl rounded-tr-sm"
          style={{
            background: "linear-gradient(135deg, #5B9CF6 0%, #8B7CF5 100%)",
            boxShadow: "0 4px 16px rgba(91,156,246,0.3), inset 0 1px 0 rgba(255,255,255,0.2)",
            color: "#fff",
          }}
        >
          <p style={{ fontSize: 14, lineHeight: "1.6", fontWeight: 500 }}>{message.content}</p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} className="flex gap-2.5">
      <div
        className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{ background: "rgba(37,99,235,0.1)", border: "1px solid rgba(37,99,235,0.15)" }}
      >
        <Sparkles size={12} style={{ color: "#2563eb" }} />
      </div>

      <div className="flex-1 min-w-0">
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
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden mt-2 space-y-1.5">
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

        <div className="px-4 py-3 rounded-2xl" style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}>
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

        {message.report_id && message.report_filename && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="mt-2">
            <button
              onClick={() => onDownload(message.report_id!, message.report_filename!)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl font-medium transition-all text-sm"
              style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.25)", color: "#10b981" }}
            >
              <Download size={14} />
              下载 {message.report_filename}
            </button>
          </motion.div>
        )}

        {message.content && !message.isStreaming && (
          <div className="flex items-center gap-3 mt-1.5">
            <button onClick={handleCopy} className="flex items-center gap-1 text-xs transition-colors" style={{ color: copied ? "#10b981" : "var(--atlas-text-3)" }}>
              {copied ? <Check size={10} /> : <Copy size={10} />}
              {copied ? "已复制" : "复制"}
            </button>
          </div>
        )}

        {isLastAssistant && !message.isStreaming && actions.length > 0 && onQuickAction && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="mt-3 flex flex-wrap gap-1.5">
            {actions.map((action, i) => (
              <button
                key={i}
                onClick={() => onQuickAction(action.prompt)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={{ background: "var(--atlas-elevated)", border: "1px solid var(--atlas-border)", color: "var(--atlas-text-2)" }}
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

function BottomInputBar({ value, onChange, onSend, onFileUpload, isGenerating, onStop, hasFiles }: {
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
    <div className="flex-shrink-0 px-4 pb-4 pt-2" style={{ background: "var(--atlas-bg)" }}>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={e => e.target.files && onFileUpload(e.target.files)}
      />

      <div
        className="rounded-2xl overflow-hidden"
        style={{
          border: "1.5px solid rgba(74,144,226,0.2)",
          background: "rgba(255,255,255,0.88)",
          backdropFilter: "blur(12px)",
          boxShadow: "0 4px 16px rgba(74,144,226,0.1)",
        }}
      >
        {/* Textarea */}
        <div className="px-4 pt-3 pb-2">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={e => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={hasFiles ? "描述你的需求，例如：生成汇总表、分析趋势..." : "上传文件或直接提问..."}
            rows={1}
            className="w-full resize-none outline-none bg-transparent text-sm"
            style={{
              color: "var(--atlas-text)",
              lineHeight: "1.6",
              minHeight: 24,
              maxHeight: 120,
            }}
            disabled={isGenerating}
          />
        </div>

        {/* Bottom toolbar */}
        <div className="flex items-center justify-between px-3 pb-2.5">
          {/* Left: action icons */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
              style={{ background: "var(--atlas-surface-2)", color: "var(--atlas-text-3)" }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "#2563eb"}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)"}
              title="上传文件"
            >
              <Plus size={15} />
            </button>
            <button
              onClick={() => toast.info("工作流功能即将上线")}
              className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
              style={{ background: "var(--atlas-surface-2)", color: "var(--atlas-text-3)" }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "#2563eb"}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)"}
              title="工作流"
            >
              <Workflow size={14} />
            </button>
            <button
              onClick={() => toast.info("模板中心即将上线")}
              className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
              style={{ background: "var(--atlas-surface-2)", color: "var(--atlas-text-3)" }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "#2563eb"}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)"}
              title="模板中心"
            >
              <Puzzle size={14} />
            </button>
          </div>

          {/* Right: send button */}
          {isGenerating ? (
            <button
              onClick={onStop}
              className="w-8 h-8 rounded-full flex items-center justify-center transition-all"
              style={{ background: "#ef4444", color: "#fff" }}
            >
              <span style={{ fontSize: 10, fontWeight: 700 }}>■</span>
            </button>
          ) : (
            <button
              onClick={() => value.trim() && onSend(value)}
              disabled={!value.trim()}
              className="w-8 h-8 rounded-full flex items-center justify-center transition-all"
              style={{
                background: value.trim() ? "#2563eb" : "rgba(37,99,235,0.12)",
                color: value.trim() ? "#fff" : "rgba(37,99,235,0.35)",
              }}
            >
              <Send size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 mt-1.5 px-1">
        <span className="text-xs" style={{ color: "var(--atlas-text-4)" }}>
          Enter 发送 · Shift+Enter 换行 · 支持拖拽文件
        </span>
      </div>
    </div>
  );
}

// ── Main ChatWorkspace Component ──────────────────────────────────────────────

export default function ChatWorkspace() {
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

  const [panelCharts, setPanelCharts] = useState<ChartBlock[]>([]);
  const [panelMetrics, setPanelMetrics] = useState<MetricCard[]>([]);
  const [panelTitle, setPanelTitle] = useState("数据分析");
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
      } catch { /* ignore */ }
    }
    if (newCharts.length > 0) {
      setPanelCharts(prev => {
        const existingTitles = new Set(prev.map(c => c.title));
        const toAdd = newCharts.filter(c => !c.title || !existingTitles.has(c.title));
        return [...prev, ...toAdd];
      });
      if (newCharts[0].title) setPanelTitle(newCharts[0].title);
    }
  }, []);

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
    setPanelTitle("数据分析");
  };

  useEffect(() => {
    setPanelCharts([]);
    setPanelMetrics([]);
    setPanelTitle("数据分析");
    setPanelLoading(false);
  }, [activeTaskId]);

  return (
    <div
      className="flex h-full overflow-hidden relative"
      style={{ background: "var(--atlas-bg)" }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Center: Chat + Input — 60% of the 80% = effectively 40% of total */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden" style={{ minWidth: 0 }}>
        {/* Chat header */}
        <div
          className="flex items-center gap-2.5 px-5 py-2.5 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--atlas-border)", height: 48 }}
        >
          <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: "rgba(37,99,235,0.1)" }}>
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

      {/* Right Analysis Panel — 40% of total */}
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
              background: "rgba(37,99,235,0.04)",
              border: "2px dashed rgba(37,99,235,0.35)",
            }}
          >
            <div className="text-center">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
                style={{ background: "rgba(37,99,235,0.1)", border: "1px solid rgba(37,99,235,0.25)" }}
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
