/**
 * OpenClawMonitor.tsx — 小虾米质量监控面板 (V14.0)
 * 仅 admin 账户可见
 * 功能：
 *   - 实时显示小虾米连接状态
 *   - 展示 Qwen 回复日志流（Level 1 监控）
 *   - 对话质量统计（消息数、平均长度、活跃用户）
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Zap, Circle, RefreshCw, MessageSquare, Users,
  BarChart2, Clock, ChevronDown, ChevronUp, Copy, Check,
  AlertTriangle, Activity, Wifi, WifiOff,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAtlas } from "@/contexts/AtlasContext";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────

interface QwenReplyLog {
  id: string;
  conversationId: string;
  userId: number;
  userName: string;
  userMessage: string;
  qwenReply: string;
  model: string;
  timestamp: number;
  expanded: boolean;
}

// ── Hook: WebSocket monitor connection ────────────────────────────────────────

function useMonitorWs(token: string | null, onQwenReply: (log: QwenReplyLog) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [openClawOnline, setOpenClawOnline] = useState(false);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!token) return;

    const wsUrl = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws/im?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      pingRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, 25000);
    };

    ws.onclose = () => {
      setConnected(false);
      setOpenClawOnline(false);
      if (pingRef.current) clearInterval(pingRef.current);
    };

    ws.onerror = () => setConnected(false);

    ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string);
        switch (msg.type) {
          case "openclaw_status":
            setOpenClawOnline(msg.connected ?? false);
            break;
          case "atlas_qwen_reply_mirror":
            // Server mirrors Qwen replies to admin monitors
            onQwenReply({
              id: `${Date.now()}-${Math.random()}`,
              conversationId: msg.conversationId,
              userId: msg.userId,
              userName: msg.userName,
              userMessage: msg.userMessage,
              qwenReply: msg.qwenReply,
              model: msg.model,
              timestamp: msg.timestamp,
              expanded: false,
            });
            break;
        }
      } catch {
        // ignore
      }
    };

    return () => {
      if (pingRef.current) clearInterval(pingRef.current);
      ws.close();
    };
  }, [token, onQwenReply]);

  return { connected, openClawOnline };
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, color }: {
  icon: typeof Activity;
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <div
      className="rounded-xl p-4 flex items-center gap-3"
      style={{ background: "var(--atlas-elevated)", border: "1px solid var(--atlas-border)" }}
    >
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: `${color}18`, color }}
      >
        <Icon size={18} />
      </div>
      <div>
        <div className="text-xs" style={{ color: "var(--atlas-text-3)" }}>{label}</div>
        <div className="text-lg font-bold" style={{ color: "var(--atlas-text)" }}>{value}</div>
      </div>
    </div>
  );
}

// ── Log Entry ─────────────────────────────────────────────────────────────────

function LogEntry({ log, onToggle, onCopy }: {
  log: QwenReplyLog;
  onToggle: () => void;
  onCopy: (text: string) => void;
}) {
  const timeStr = new Date(log.timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const replyLen = log.qwenReply.length;
  const hasAtlasTable = log.qwenReply.includes("atlas-table");
  const hasSuggestions = log.qwenReply.includes("<suggestions>");

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="rounded-xl overflow-hidden"
      style={{ border: "1px solid var(--atlas-border)", background: "var(--atlas-elevated)" }}
    >
      {/* Header row */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer"
        onClick={onToggle}
        style={{ borderBottom: log.expanded ? "1px solid var(--atlas-border)" : "none" }}
      >
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold"
          style={{ background: "var(--atlas-accent)", color: "#fff" }}
        >
          {log.userName.slice(0, 1).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium" style={{ color: "var(--atlas-text)" }}>
              {log.userName}
            </span>
            <span className="text-xs" style={{ color: "var(--atlas-text-3)" }}>
              {timeStr}
            </span>
            <span
              className="text-xs px-1.5 py-0.5 rounded-full"
              style={{ background: "rgba(91,140,255,0.12)", color: "#5B8CFF" }}
            >
              {log.model}
            </span>
            {hasAtlasTable && (
              <span
                className="text-xs px-1.5 py-0.5 rounded-full"
                style={{ background: "rgba(52,211,153,0.12)", color: "#34D399" }}
              >
                含表格
              </span>
            )}
            {hasSuggestions && (
              <span
                className="text-xs px-1.5 py-0.5 rounded-full"
                style={{ background: "rgba(251,191,36,0.12)", color: "#FBBF24" }}
              >
                含追问
              </span>
            )}
          </div>
          <div className="text-xs truncate mt-0.5" style={{ color: "var(--atlas-text-3)" }}>
            用户: {log.userMessage.slice(0, 80)}{log.userMessage.length > 80 ? "…" : ""}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs" style={{ color: "var(--atlas-text-3)" }}>
            {replyLen} 字
          </span>
          {log.expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </div>

      {/* Expanded content */}
      <AnimatePresence>
        {log.expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="px-4 py-3 space-y-3">
              {/* User message */}
              <div>
                <div className="text-xs font-medium mb-1" style={{ color: "var(--atlas-text-3)" }}>
                  用户输入
                </div>
                <div
                  className="text-sm rounded-lg px-3 py-2"
                  style={{
                    background: "var(--atlas-surface)",
                    color: "var(--atlas-text-2)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {log.userMessage}
                </div>
              </div>

              {/* Qwen reply */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="text-xs font-medium" style={{ color: "var(--atlas-text-3)" }}>
                    Qwen 回复
                  </div>
                  <button
                    onClick={() => onCopy(log.qwenReply)}
                    className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-md transition-all"
                    style={{ color: "var(--atlas-text-3)", background: "var(--atlas-surface)" }}
                  >
                    <Copy size={11} />
                    复制
                  </button>
                </div>
                <div
                  className="text-sm rounded-lg px-3 py-2 max-h-64 overflow-y-auto"
                  style={{
                    background: "var(--atlas-surface)",
                    color: "var(--atlas-text)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontFamily: "monospace",
                    fontSize: 12,
                  }}
                >
                  {log.qwenReply}
                </div>
              </div>

              {/* Meta */}
              <div className="flex items-center gap-3 text-xs" style={{ color: "var(--atlas-text-3)" }}>
                <span>对话 ID: {log.conversationId.slice(0, 12)}…</span>
                <span>用户 ID: {log.userId}</span>
                <span>回复长度: {replyLen} 字符</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function OpenClawMonitor() {
  const { user } = useAtlas();
  const [logs, setLogs] = useState<QwenReplyLog[]>([]);
  const [filter, setFilter] = useState<"all" | "table" | "suggestions">("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Fetch WS token
  const { data: tokenData } = trpc.im.getWsToken.useQuery(undefined, {
    refetchOnWindowFocus: false,
    retry: false,
    enabled: user?.role === "admin",
  });

  // Poll OpenClaw status via tRPC
  const { data: statusData, refetch: refetchStatus } = trpc.im.getOpenClawStatus.useQuery(undefined, {
    refetchOnWindowFocus: false,
    refetchInterval: 8000,
    enabled: user?.role === "admin",
  });

  const handleQwenReply = useCallback((log: QwenReplyLog) => {
    setLogs(prev => [log, ...prev].slice(0, 200)); // Keep last 200 logs
  }, []);

  const { connected: wsConnected, openClawOnline } = useMonitorWs(
    tokenData?.token ?? null,
    handleQwenReply
  );

  // Auto-scroll to top (newest logs at top)
  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  const toggleLog = (id: string) => {
    setLogs(prev => prev.map(l => l.id === id ? { ...l, expanded: !l.expanded } : l));
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      toast.success("已复制到剪贴板");
    });
  };

  const filteredLogs = logs.filter(l => {
    if (filter === "table") return l.qwenReply.includes("atlas-table");
    if (filter === "suggestions") return l.qwenReply.includes("<suggestions>");
    return true;
  });

  // Stats
  const totalLogs = logs.length;
  const tableLogs = logs.filter(l => l.qwenReply.includes("atlas-table")).length;
  const avgLen = totalLogs > 0
    ? Math.round(logs.reduce((s, l) => s + l.qwenReply.length, 0) / totalLogs)
    : 0;
  const uniqueUsers = new Set(logs.map(l => l.userId)).size;

  if (user?.role !== "admin") {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <AlertTriangle size={40} style={{ color: "var(--atlas-text-3)", opacity: 0.4 }} />
        <p className="text-sm" style={{ color: "var(--atlas-text-3)" }}>
          仅管理员可访问此页面
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: "var(--atlas-bg)" }}>
      {/* ── Header ── */}
      <div
        className="flex items-center gap-3 px-6 flex-shrink-0"
        style={{
          height: 56,
          borderBottom: "1px solid var(--atlas-border)",
          background: "var(--atlas-surface)",
        }}
      >
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center"
          style={{ background: "linear-gradient(135deg, #f97316 0%, #f59e0b 100%)" }}
        >
          <Zap size={16} fill="white" color="white" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm" style={{ color: "var(--atlas-text)" }}>
              小虾米监控面板
            </span>
            <span
              className="text-xs px-1.5 py-0.5 rounded-full"
              style={{ background: "rgba(249,115,22,0.15)", color: "#f97316", fontSize: 10 }}
            >
              V14 · Level 1
            </span>
          </div>
          <div className="text-xs" style={{ color: "var(--atlas-text-3)" }}>
            实时监控 Qwen 回复质量
          </div>
        </div>

        <div className="ml-auto flex items-center gap-3">
          {/* OpenClaw status */}
          <div className="flex items-center gap-1.5">
            {openClawOnline || statusData?.connected ? (
              <Wifi size={14} style={{ color: "#34D399" }} />
            ) : (
              <WifiOff size={14} style={{ color: "#6B7280" }} />
            )}
            <span className="text-xs" style={{ color: openClawOnline || statusData?.connected ? "#34D399" : "#6B7280" }}>
              小虾米 {openClawOnline || statusData?.connected ? "已连接" : "未连接"}
            </span>
          </div>

          {/* WS status */}
          <div className="flex items-center gap-1.5">
            <Circle
              size={7}
              fill={wsConnected ? "#5B8CFF" : "#6B7280"}
              style={{ color: wsConnected ? "#5B8CFF" : "#6B7280" }}
            />
            <span className="text-xs" style={{ color: "var(--atlas-text-3)" }}>
              {wsConnected ? "监控中" : "连接中"}
            </span>
          </div>

          <button
            onClick={() => refetchStatus()}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
            style={{ background: "var(--atlas-elevated)", color: "var(--atlas-text-3)" }}
            title="刷新状态"
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* ── Stats Row ── */}
      <div className="grid grid-cols-4 gap-3 px-6 py-4 flex-shrink-0">
        <StatCard icon={MessageSquare} label="监控消息数" value={totalLogs} color="#5B8CFF" />
        <StatCard icon={BarChart2} label="含表格回复" value={tableLogs} color="#34D399" />
        <StatCard icon={Activity} label="平均回复长度" value={avgLen > 0 ? `${avgLen} 字` : "—"} color="#FBBF24" />
        <StatCard icon={Users} label="活跃用户数" value={uniqueUsers} color="#f97316" />
      </div>

      {/* ── Filter Bar ── */}
      <div className="flex items-center gap-2 px-6 pb-3 flex-shrink-0">
        <span className="text-xs" style={{ color: "var(--atlas-text-3)" }}>筛选：</span>
        {(["all", "table", "suggestions"] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="text-xs px-3 py-1 rounded-full transition-all"
            style={{
              background: filter === f ? "var(--atlas-accent)" : "var(--atlas-elevated)",
              color: filter === f ? "#fff" : "var(--atlas-text-3)",
              border: `1px solid ${filter === f ? "var(--atlas-accent)" : "var(--atlas-border)"}`,
            }}
          >
            {f === "all" ? "全部" : f === "table" ? "含表格" : "含追问"}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setAutoScroll(v => !v)}
            className="text-xs px-3 py-1 rounded-full transition-all flex items-center gap-1"
            style={{
              background: autoScroll ? "rgba(52,211,153,0.12)" : "var(--atlas-elevated)",
              color: autoScroll ? "#34D399" : "var(--atlas-text-3)",
              border: `1px solid ${autoScroll ? "rgba(52,211,153,0.3)" : "var(--atlas-border)"}`,
            }}
          >
            <Clock size={11} />
            自动滚动
          </button>
          {logs.length > 0 && (
            <button
              onClick={() => setLogs([])}
              className="text-xs px-3 py-1 rounded-full transition-all"
              style={{
                background: "var(--atlas-elevated)",
                color: "var(--atlas-text-3)",
                border: "1px solid var(--atlas-border)",
              }}
            >
              清空日志
            </button>
          )}
        </div>
      </div>

      {/* ── Log Stream ── */}
      <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-2">
        {filteredLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 py-20">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center"
              style={{ background: "rgba(249,115,22,0.1)" }}
            >
              <Zap size={28} style={{ color: "#f97316", opacity: 0.6 }} />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium mb-1" style={{ color: "var(--atlas-text-2)" }}>
                等待 Qwen 回复...
              </p>
              <p className="text-xs" style={{ color: "var(--atlas-text-3)" }}>
                当用户在主工作台发起对话时，Qwen 的回复将实时出现在这里
              </p>
            </div>
            {!wsConnected && (
              <div
                className="rounded-lg px-4 py-3 max-w-sm"
                style={{ background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.2)" }}
              >
                <p className="text-xs" style={{ color: "#FBBF24" }}>
                  ⚠️ WebSocket 未连接，请确保已登录并刷新页面
                </p>
              </div>
            )}
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {filteredLogs.map(log => (
              <LogEntry
                key={log.id}
                log={log}
                onToggle={() => toggleLog(log.id)}
                onCopy={handleCopy}
              />
            ))}
          </AnimatePresence>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
