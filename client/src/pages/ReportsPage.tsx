/**
 * ATLAS V7.1 — Reports Page
 * 报表中心：从真实 API 加载，支持下载/重新运行/定时/删除操作
 */
import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BarChart2, Download, FileSpreadsheet, Calendar,
  RefreshCw, Clock, Trash2, MoreHorizontal, Play,
  Loader2, CheckCircle, XCircle, Plus, Search, Filter, X, Star,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAtlas } from "@/contexts/AtlasContext";
import { api } from "@/lib/api";
import { toast } from "sonner";

// ── Quick Schedule Dialog ─────────────────────────────────────────────────────

const CRON_PRESETS = [
  { label: "每天 09:00", cron: "0 0 9 * * *", desc: "每天早上9点" },
  { label: "每天 18:00", cron: "0 0 18 * * *", desc: "每天下午6点" },
  { label: "每周一 08:00", cron: "0 0 8 * * 1", desc: "每周一早上8点" },
  { label: "每月1日 09:00", cron: "0 0 9 1 * *", desc: "每月1日早上9点" },
];

function QuickScheduleDialog({
  reportTitle,
  onClose,
}: {
  reportTitle: string;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [name, setName] = useState(`定时 - ${reportTitle.slice(0, 20)}`);
  const [preset, setPreset] = useState(CRON_PRESETS[0]);
  const [email, setEmail] = useState("");

  const createMut = trpc.scheduledTask.create.useMutation({
    onSuccess: () => {
      utils.scheduledTask.list.invalidate();
      toast.success("定时任务已创建！前往设置页查看");
      onClose();
    },
    onError: (e) => toast.error(`创建失败：${e.message}`),
  });

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="w-full max-w-md mx-4 rounded-2xl p-6 space-y-4"
        style={{ background: "var(--atlas-card)", border: "1px solid var(--atlas-border-2)" }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: "rgba(91,140,255,0.1)" }}>
            <Clock size={16} style={{ color: "var(--atlas-accent)" }} />
          </div>
          <div>
            <h3 className="text-sm font-semibold" style={{ color: "var(--atlas-text)" }}>创建定时任务</h3>
            <p className="text-xs" style={{ color: "var(--atlas-text-3)" }}>基于此报表自动定时生成</p>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--atlas-text-2)" }}>任务名称</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm outline-none"
              style={{ background: "var(--atlas-elevated)", border: "1px solid var(--atlas-border)", color: "var(--atlas-text)" }}
            />
          </div>
          <div>
            <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--atlas-text-2)" }}>执行频率</label>
            <select
              value={preset.cron}
              onChange={e => setPreset(CRON_PRESETS.find(p => p.cron === e.target.value) || CRON_PRESETS[0])}
              className="w-full px-3 py-2 rounded-lg text-sm outline-none"
              style={{ background: "var(--atlas-elevated)", border: "1px solid var(--atlas-border)", color: "var(--atlas-text)" }}
            >
              {CRON_PRESETS.map(p => <option key={p.cron} value={p.cron}>{p.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--atlas-text-2)" }}>通知邮箱（可选）</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="boss@company.com"
              className="w-full px-3 py-2 rounded-lg text-sm outline-none"
              style={{ background: "var(--atlas-elevated)", border: "1px solid var(--atlas-border)", color: "var(--atlas-text)" }}
            />
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <button
            onClick={() => createMut.mutate({
              name: name.trim() || reportTitle,
              templatePrompt: `重新生成报表：${reportTitle}`,
              templateName: reportTitle.slice(0, 30),
              cronExpr: preset.cron,
              scheduleDesc: preset.desc,
              notifyEmail: email.trim() || undefined,
            })}
            disabled={createMut.isPending}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium"
            style={{ background: "var(--atlas-accent)", color: "#fff", opacity: createMut.isPending ? 0.7 : 1 }}
          >
            {createMut.isPending && <Loader2 size={12} className="animate-spin" />}
            创建定时任务
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm"
            style={{ background: "var(--atlas-elevated)", color: "var(--atlas-text-2)", border: "1px solid var(--atlas-border)" }}
          >
            取消
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Report Card ───────────────────────────────────────────────────────────────

function StarRating({ reportId, isCompleted }: { reportId: string; isCompleted: boolean }) {
  const [hovered, setHovered] = useState(0);
  const [showRating, setShowRating] = useState(false);
  const utils = trpc.useUtils();

  const { data: existing } = trpc.feedback.getMine.useQuery(
    { reportId },
    { enabled: isCompleted }
  );

  const submitMut = trpc.feedback.submit.useMutation({
    onSuccess: () => {
      utils.feedback.getMine.invalidate({ reportId });
      toast.success("感谢评分！系统将持续学习优化 ✨");
      setShowRating(false);
    },
    onError: (e) => toast.error(`评分失败：${e.message}`),
  });

  if (!isCompleted) return null;

  const currentRating = existing?.rating ?? 0;

  return (
    <div className="relative">
      <button
        onClick={() => setShowRating(!showRating)}
        title={currentRating ? `已评 ${currentRating} 星` : "评分此报表"}
        className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
        style={{
          background: currentRating ? "rgba(251,191,36,0.15)" : "rgba(251,191,36,0.08)",
          color: currentRating ? "#FBBF24" : "var(--atlas-text-3)",
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(251,191,36,0.2)"; (e.currentTarget as HTMLElement).style.color = "#FBBF24"; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = currentRating ? "rgba(251,191,36,0.15)" : "rgba(251,191,36,0.08)"; (e.currentTarget as HTMLElement).style.color = currentRating ? "#FBBF24" : "var(--atlas-text-3)"; }}
      >
        <Star size={13} fill={currentRating ? "#FBBF24" : "none"} />
      </button>
      <AnimatePresence>
        {showRating && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            className="absolute right-0 top-9 z-20 rounded-xl p-3 min-w-[160px]"
            style={{ background: "var(--atlas-card)", border: "1px solid var(--atlas-border-2)", boxShadow: "0 8px 24px rgba(0,0,0,0.3)" }}
          >
            <p className="text-xs mb-2 font-medium" style={{ color: "var(--atlas-text-2)" }}>报表质量评分</p>
            <div className="flex gap-1 justify-center">
              {[1, 2, 3, 4, 5].map(star => (
                <button
                  key={star}
                  onMouseEnter={() => setHovered(star)}
                  onMouseLeave={() => setHovered(0)}
                  onClick={() => submitMut.mutate({ reportId, rating: star })}
                  className="p-1 transition-transform hover:scale-125"
                  disabled={submitMut.isPending}
                >
                  <Star
                    size={18}
                    fill={(hovered || currentRating) >= star ? "#FBBF24" : "none"}
                    stroke={(hovered || currentRating) >= star ? "#FBBF24" : "var(--atlas-text-3)"}
                  />
                </button>
              ))}
            </div>
            <p className="text-xs mt-2 text-center" style={{ color: "var(--atlas-text-3)" }}>
              {hovered === 1 ? "😕 需要改进" : hovered === 2 ? "😐 一般" : hovered === 3 ? "🙂 还不错" : hovered === 4 ? "😄 很好" : hovered === 5 ? "🌟 完美" : "点击星星评分"}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ReportCard({
  report,
  index,
  onSchedule,
  onRerun,
}: {
  report: { id: string; title: string; filename: string; fileUrl?: string | null; fileSizeKb?: number | null; status: string; createdAt: Date | null; sessionId: string };
  index: number;
  onSchedule: (title: string) => void;
  onRerun: (sessionId: string, title: string) => void;
}) {
  const [showMore, setShowMore] = useState(false);
  const utils = trpc.useUtils();

  const deleteMut = trpc.report.delete?.useMutation?.({
    onSuccess: () => { utils.report.list.invalidate(); toast.success("报表已删除"); },
    onError: (e: any) => toast.error(`删除失败：${e.message}`),
  });

  const handleDownload = () => {
    if (report.fileUrl) {
      const a = document.createElement("a");
      a.href = report.fileUrl;
      a.download = report.filename;
      a.target = "_blank";
      a.click();
      toast.success("开始下载");
    } else {
      const a = document.createElement("a");
      a.href = api.getDownloadUrl(report.id);
      a.download = report.filename;
      a.click();
      toast.success("开始下载");
    }
  };

  const isCompleted = report.status === "completed";

  // Expiry: reports expire 24h after creation
  const expiryInfo = (() => {
    if (!report.createdAt || !isCompleted) return null;
    const createdMs = new Date(report.createdAt).getTime();
    const expiresAt = createdMs + 24 * 60 * 60 * 1000;
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) return { label: "已过期", color: "#F87171", urgent: true };
    const hours = Math.floor(remaining / (60 * 60 * 1000));
    const mins = Math.floor((remaining % (60 * 60 * 1000)) / 60000);
    if (hours < 1) return { label: `${mins}分钟后过期`, color: "#F87171", urgent: true };
    if (hours < 6) return { label: `${hours}小时后过期`, color: "#FBBF24", urgent: true };
    return { label: `${hours}小时后过期`, color: "var(--atlas-text-3)", urgent: false };
  })();

  return (
    <motion.div
      key={report.id}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className="flex items-center gap-4 px-4 py-3.5 rounded-xl group"
      style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}
    >
      {/* Icon */}
      <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: isCompleted ? "rgba(91,140,255,0.1)" : "rgba(248,113,113,0.1)" }}>
        <FileSpreadsheet size={16} style={{ color: isCompleted ? "var(--atlas-accent)" : "var(--atlas-danger)" }} />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate" style={{ color: "var(--atlas-text)" }}>{report.title || report.filename}</p>
        <div className="flex items-center gap-3 mt-0.5">
          <div className="flex items-center gap-1">
            <Calendar size={10} style={{ color: "var(--atlas-text-3)" }} />
            <span className="text-xs" style={{ color: "var(--atlas-text-3)", fontFamily: "'JetBrains Mono', monospace" }}>
              {report.createdAt ? new Date(report.createdAt).toLocaleString("zh-CN") : ""}
            </span>
          </div>
          {report.fileSizeKb && (
            <span className="text-xs" style={{ color: "var(--atlas-text-3)" }}>
              {report.fileSizeKb > 1024 ? `${(report.fileSizeKb / 1024).toFixed(1)} MB` : `${report.fileSizeKb} KB`}
            </span>
          )}
          {expiryInfo && (
            <span
              className="text-xs px-1.5 py-0.5 rounded-md"
              style={{
                color: expiryInfo.color,
                background: expiryInfo.urgent ? `${expiryInfo.color}18` : "transparent",
                border: expiryInfo.urgent ? `1px solid ${expiryInfo.color}40` : "none",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "10px",
              }}
            >
              {expiryInfo.label}
            </span>
          )}
        </div>
      </div>

      {/* Status badge */}
      <div className="flex items-center gap-1.5">
        {isCompleted
          ? <CheckCircle size={13} style={{ color: "var(--atlas-success)" }} />
          : <XCircle size={13} style={{ color: "var(--atlas-danger)" }} />}
        <span className="text-xs" style={{
          color: isCompleted ? "var(--atlas-success)" : "var(--atlas-danger)",
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          {isCompleted ? "已完成" : "失败"}
        </span>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {/* Download */}
        {isCompleted && (
          <button
            onClick={handleDownload}
            title="下载报表"
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
            style={{ background: "rgba(91,140,255,0.1)", color: "var(--atlas-accent)" }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "rgba(91,140,255,0.2)"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "rgba(91,140,255,0.1)"}
          >
            <Download size={13} />
          </button>
        )}

        {/* Re-run */}
        <button
          onClick={() => onRerun(report.sessionId, report.title)}
          title="重新运行"
          className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
          style={{ background: "rgba(52,211,153,0.1)", color: "var(--atlas-success)" }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "rgba(52,211,153,0.2)"}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "rgba(52,211,153,0.1)"}
        >
          <Play size={12} />
        </button>

        {/* Star Rating */}
        <StarRating reportId={report.id} isCompleted={isCompleted} />

        {/* Schedule */}
        <button
          onClick={() => onSchedule(report.title)}
          title="创建定时任务"
          className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
          style={{ background: "rgba(167,139,250,0.1)", color: "#A78BFA" }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "rgba(167,139,250,0.2)"}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "rgba(167,139,250,0.1)"}
        >
          <Clock size={13} />
        </button>

        {/* More (delete) */}
        <div className="relative">
          <button
            onClick={() => setShowMore(!showMore)}
            title="更多操作"
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
            style={{ background: "var(--atlas-elevated)", color: "var(--atlas-text-3)" }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-text)"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)"}
          >
            <MoreHorizontal size={13} />
          </button>
          <AnimatePresence>
            {showMore && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -4 }}
                className="absolute right-0 top-8 z-10 rounded-xl py-1 min-w-[120px]"
                style={{ background: "var(--atlas-card)", border: "1px solid var(--atlas-border-2)", boxShadow: "0 8px 24px rgba(0,0,0,0.3)" }}
              >
                <button
                  onClick={() => {
                    setShowMore(false);
                    if (deleteMut) {
                      deleteMut.mutate({ id: report.id });
                    } else {
                      toast.info("删除功能即将上线");
                    }
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs transition-all"
                  style={{ color: "var(--atlas-danger)" }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "rgba(248,113,113,0.08)"}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}
                >
                  <Trash2 size={12} /> 删除报表
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const { setActiveNav } = useAtlas();
  const [scheduleTarget, setScheduleTarget] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFilter, setDateFilter] = useState<"all" | "today" | "week" | "month">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "completed" | "failed">("all");

  // Load from real API
  const { data: reports = [], isLoading } = trpc.report.list.useQuery();

  // Filtered reports
  const filteredReports = useMemo(() => {
    const now = Date.now();
    return reports.filter(r => {
      // Search filter
      if (searchQuery && !r.title.toLowerCase().includes(searchQuery.toLowerCase()) &&
          !r.filename.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      // Status filter
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      // Date filter
      if (dateFilter !== "all" && r.createdAt) {
        const ts = new Date(r.createdAt).getTime();
        if (dateFilter === "today" && now - ts > 24 * 60 * 60 * 1000) return false;
        if (dateFilter === "week" && now - ts > 7 * 24 * 60 * 60 * 1000) return false;
        if (dateFilter === "month" && now - ts > 30 * 24 * 60 * 60 * 1000) return false;
      }
      return true;
    });
  }, [reports, searchQuery, dateFilter, statusFilter]);

  const handleRerun = (sessionId: string, title: string) => {
    // Navigate to workspace and pre-fill the prompt
    setActiveNav("home");
    toast.info(`已切换到工作台，请重新上传文件并输入：${title}`);
  };

  return (
    <div className="h-full overflow-y-auto p-6" style={{ background: "var(--atlas-bg)" }}>
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: "rgba(91,140,255,0.1)", border: "1px solid rgba(91,140,255,0.2)" }}>
              <BarChart2 size={18} style={{ color: "var(--atlas-accent)" }} />
            </div>
            <div>
              <h1 className="text-lg font-semibold" style={{ color: "var(--atlas-text)" }}>报表中心</h1>
              <p className="text-xs" style={{ color: "var(--atlas-text-3)" }}>
                {isLoading ? "加载中..." : `共 ${reports.length} 份报表${filteredReports.length !== reports.length ? `，筛选后 ${filteredReports.length} 份` : ""}`}
              </p>
            </div>
          </div>
          <button
            onClick={() => setActiveNav("home")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
            style={{ background: "var(--atlas-accent)", color: "#fff" }}
          >
            <Plus size={12} /> 生成新报表
          </button>
        </div>

        {/* Search & Filter Bar */}
        {!isLoading && reports.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {/* Search */}
            <div className="flex items-center gap-2 flex-1 min-w-[200px] px-3 py-2 rounded-lg"
              style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}>
              <Search size={13} style={{ color: "var(--atlas-text-3)", flexShrink: 0 }} />
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="搜索报表名称..."
                className="flex-1 bg-transparent outline-none text-sm"
                style={{ color: "var(--atlas-text)" }}
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")}>
                  <X size={12} style={{ color: "var(--atlas-text-3)" }} />
                </button>
              )}
            </div>

            {/* Date filter */}
            <div className="flex items-center gap-1">
              <Filter size={12} style={{ color: "var(--atlas-text-3)", marginRight: 2 }} />
              {(["all", "today", "week", "month"] as const).map(f => (
                <button key={f} onClick={() => setDateFilter(f)}
                  className="px-2.5 py-1.5 rounded-lg text-xs transition-all"
                  style={{
                    background: dateFilter === f ? "rgba(91,140,255,0.15)" : "var(--atlas-surface)",
                    color: dateFilter === f ? "var(--atlas-accent)" : "var(--atlas-text-3)",
                    border: dateFilter === f ? "1px solid rgba(91,140,255,0.3)" : "1px solid var(--atlas-border)",
                  }}>
                  {{ all: "全部", today: "今天", week: "本周", month: "本月" }[f]}
                </button>
              ))}
            </div>

            {/* Status filter */}
            <div className="flex items-center gap-1">
              {(["all", "completed", "failed"] as const).map(s => (
                <button key={s} onClick={() => setStatusFilter(s)}
                  className="px-2.5 py-1.5 rounded-lg text-xs transition-all"
                  style={{
                    background: statusFilter === s ? (s === "failed" ? "rgba(248,113,113,0.15)" : "rgba(52,211,153,0.1)") : "var(--atlas-surface)",
                    color: statusFilter === s ? (s === "failed" ? "var(--atlas-danger)" : s === "completed" ? "var(--atlas-success)" : "var(--atlas-accent)") : "var(--atlas-text-3)",
                    border: statusFilter === s ? `1px solid ${s === "failed" ? "rgba(248,113,113,0.3)" : s === "completed" ? "rgba(52,211,153,0.3)" : "rgba(91,140,255,0.3)"}` : "1px solid var(--atlas-border)",
                  }}>
                  {{ all: "全部状态", completed: "已完成", failed: "失败" }[s]}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-24 gap-2" style={{ color: "var(--atlas-text-3)" }}>
            <Loader2 size={16} className="animate-spin" />
            <span className="text-sm">加载报表列表...</span>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && reports.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}>
              <FileSpreadsheet size={24} style={{ color: "var(--atlas-text-3)" }} />
            </div>
            <p className="text-sm" style={{ color: "var(--atlas-text-2)" }}>暂无报表，前往工作台生成</p>
            <button
              onClick={() => setActiveNav("home")}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium"
              style={{ background: "var(--atlas-accent)", color: "#fff" }}
            >
              <RefreshCw size={13} /> 前往工作台
            </button>
          </div>
        )}

        {/* Report list */}
        {!isLoading && reports.length > 0 && (
          <div className="space-y-2">
            {filteredReports.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <Search size={24} style={{ color: "var(--atlas-text-3)" }} />
                <p className="text-sm" style={{ color: "var(--atlas-text-2)" }}>没有符合条件的报表</p>
                <button
                  onClick={() => { setSearchQuery(""); setDateFilter("all"); setStatusFilter("all"); }}
                  className="text-xs px-3 py-1.5 rounded-lg"
                  style={{ background: "var(--atlas-elevated)", color: "var(--atlas-accent)", border: "1px solid rgba(91,140,255,0.2)" }}
                >
                  清除筛选条件
                </button>
              </div>
            ) : (
              filteredReports.map((r, i) => (
                <ReportCard
                  key={r.id}
                  report={{
                    id: r.id,
                    title: r.title,
                    filename: r.filename,
                    fileUrl: r.fileUrl,
                    fileSizeKb: r.fileSizeKb,
                    status: r.status,
                    createdAt: r.createdAt,
                    sessionId: r.sessionId,
                  }}
                  index={i}
                  onSchedule={(title) => setScheduleTarget(title)}
                  onRerun={handleRerun}
                />
              ))
            )}
          </div>
        )}
      </div>

      {/* Quick Schedule Dialog */}
      <AnimatePresence>
        {scheduleTarget && (
          <QuickScheduleDialog
            reportTitle={scheduleTarget}
            onClose={() => setScheduleTarget(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
