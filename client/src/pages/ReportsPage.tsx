/**
 * ATLAS V7.1 — Reports Page
 * 报表中心：从真实 API 加载，支持下载/重新运行/定时/删除操作
 */
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BarChart2, Download, FileSpreadsheet, Calendar,
  RefreshCw, Clock, Trash2, MoreHorizontal, Play,
  Loader2, CheckCircle, XCircle, Plus,
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

  // Load from real API
  const { data: reports = [], isLoading } = trpc.report.list.useQuery();

  const handleRerun = (sessionId: string, title: string) => {
    // Navigate to workspace and pre-fill the prompt
    setActiveNav("home");
    toast.info(`已切换到工作台，请重新上传文件并输入：${title}`);
  };

  return (
    <div className="h-full overflow-y-auto p-6" style={{ background: "var(--atlas-bg)" }}>
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: "rgba(91,140,255,0.1)", border: "1px solid rgba(91,140,255,0.2)" }}>
              <BarChart2 size={18} style={{ color: "var(--atlas-accent)" }} />
            </div>
            <div>
              <h1 className="text-lg font-semibold" style={{ color: "var(--atlas-text)" }}>报表中心</h1>
              <p className="text-xs" style={{ color: "var(--atlas-text-3)" }}>
                {isLoading ? "加载中..." : `共 ${reports.length} 份报表`}
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
            {reports.map((r, i) => (
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
            ))}
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
