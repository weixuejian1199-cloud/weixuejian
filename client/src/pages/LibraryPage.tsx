/**
 * ATLAS V7.4 — 库 (Library)
 * 双标签页：会话文件管理 + 报表归档，全部使用真实 tRPC API
 */
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Archive, FileText, Download, Search, X,
  CheckCircle2, AlertCircle, Calendar, Database, Trash2, FileSpreadsheet,
  Rows3, RefreshCw, Loader2, Table2,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAtlas } from "@/contexts/AtlasContext";
import { toast } from "sonner";
import { STANDARD_FIELDS } from "@shared/fieldAliases";

type Tab = "sessions" | "reports" | "fields";
type FilterStatus = "all" | "completed" | "failed";

// ── Sessions Tab ──────────────────────────────────────────────────────────────

function SessionsTab({ query }: { query: string }) {
  const { setActiveNav, setActiveTaskId } = useAtlas();
  const utils = trpc.useUtils();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data: sessions = [], isLoading } = trpc.session.list.useQuery();

  const deleteMut = trpc.session.delete.useMutation({
    onSuccess: () => {
      utils.session.list.invalidate();
      toast.success("文件已删除");
      setDeletingId(null);
    },
    onError: (e) => {
      toast.error("删除失败：" + e.message);
      setDeletingId(null);
    },
  });

  const lq = query.toLowerCase();
  const filtered = sessions.filter((s) => {
    if (!query) return true;
    return (
      (s.originalName ?? "").toLowerCase().includes(lq) ||
      (s.filename ?? "").toLowerCase().includes(lq)
    );
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3 mt-4">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-16 rounded-xl animate-pulse"
            style={{ background: "var(--atlas-surface)" }}
          />
        ))}
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="text-center py-20">
        <Database
          size={40}
          style={{ color: "var(--atlas-text-3)", margin: "0 auto 12px", opacity: 0.4 }}
        />
        <p className="text-sm font-medium mb-1" style={{ color: "var(--atlas-text-2)" }}>
          {query ? "没有匹配的文件" : "暂无上传文件"}
        </p>
        <p className="text-xs" style={{ color: "var(--atlas-text-3)" }}>
          {query ? "尝试调整搜索词" : "在工作台上传 Excel 文件后，它们会出现在这里"}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 mt-4">
      {filtered.map((session, i) => (
        <motion.div
          key={session.id}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.03 }}
          className="flex items-center gap-4 px-4 py-3.5 rounded-xl group transition-all"
          style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}
          onMouseEnter={(e) =>
            ((e.currentTarget as HTMLElement).style.borderColor = "rgba(91,140,255,0.25)")
          }
          onMouseLeave={(e) =>
            ((e.currentTarget as HTMLElement).style.borderColor = "var(--atlas-border)")
          }
        >
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(91,140,255,0.1)" }}
          >
            <FileSpreadsheet size={16} style={{ color: "var(--atlas-accent)" }} />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate" style={{ color: "var(--atlas-text)" }}>
              {session.originalName || session.filename}
            </p>
            <div className="flex items-center gap-3 mt-0.5 flex-wrap">
              {session.rowCount != null && (
                <span
                  className="flex items-center gap-1 text-xs"
                  style={{ color: "var(--atlas-text-3)" }}
                >
                  <Rows3 size={10} />
                  {session.rowCount.toLocaleString()} 行
                </span>
              )}
              {session.colCount != null && (
                <span className="text-xs" style={{ color: "var(--atlas-text-3)" }}>
                  {session.colCount} 列
                </span>
              )}
              {session.fileSizeKb != null && (
                <span className="text-xs" style={{ color: "var(--atlas-text-3)" }}>
                  {session.fileSizeKb > 1024
                    ? `${(session.fileSizeKb / 1024).toFixed(1)} MB`
                    : `${session.fileSizeKb} KB`}
                </span>
              )}
              {session.createdAt && (
                <span
                  className="flex items-center gap-1 text-xs"
                  style={{
                    color: "var(--atlas-text-3)",
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  <Calendar size={10} />
                  {new Date(session.createdAt).toLocaleDateString("zh-CN")}
                </span>
              )}
              {session.isMerged ? (
                <span
                  className="text-xs px-1.5 py-0.5 rounded-md"
                  style={{
                    background: "rgba(167,139,250,0.1)",
                    color: "#A78BFA",
                    border: "1px solid rgba(167,139,250,0.2)",
                    fontSize: "10px",
                  }}
                >
                  合并文件
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-1.5 opacity-30 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => {
                setActiveTaskId(session.id);
                setActiveNav("home");
              }}
              title="在工作台继续分析"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={{ background: "rgba(91,140,255,0.1)", color: "var(--atlas-accent)" }}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLElement).style.background = "rgba(91,140,255,0.2)")
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLElement).style.background = "rgba(91,140,255,0.1)")
              }
            >
              <RefreshCw size={11} />
              继续分析
            </button>
            <button
              onClick={() => {
                setDeletingId(session.id);
                deleteMut.mutate({ id: session.id });
              }}
              title="删除文件"
              disabled={deletingId === session.id}
              className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
              style={{ background: "rgba(248,113,113,0.1)", color: "#F87171" }}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLElement).style.background = "rgba(248,113,113,0.2)")
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLElement).style.background = "rgba(248,113,113,0.1)")
              }
            >
              {deletingId === session.id ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Trash2 size={12} />
              )}
            </button>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

// ── Reports Tab ───────────────────────────────────────────────────────────────

function ReportsTab({
  query,
  filterStatus,
}: {
  query: string;
  filterStatus: FilterStatus;
}) {
  const utils = trpc.useUtils();
  const { data: reports = [], isLoading } = trpc.report.list.useQuery();

  const deleteMut = trpc.report.delete?.useMutation?.({
    onSuccess: () => {
      utils.report.list.invalidate();
      toast.success("报表已删除");
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "未知错误";
      toast.error("删除失败：" + msg);
    },
  });

  const lq = query.toLowerCase();
  const filtered = reports
    .filter((r) => {
      if (filterStatus !== "all" && r.status !== filterStatus) return false;
      if (
        query &&
        !(r.title ?? "").toLowerCase().includes(lq) &&
        !(r.filename ?? "").toLowerCase().includes(lq)
      )
        return false;
      return true;
    })
    .sort((a, b) => {
      const aT = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bT = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bT - aT;
    });

  // Reports are now stored permanently, no expiry display needed

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3 mt-4">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-16 rounded-xl animate-pulse"
            style={{ background: "var(--atlas-surface)" }}
          />
        ))}
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="text-center py-20">
        <Archive
          size={40}
          style={{ color: "var(--atlas-text-3)", margin: "0 auto 12px", opacity: 0.4 }}
        />
        <p className="text-sm font-medium mb-1" style={{ color: "var(--atlas-text-2)" }}>
          {query || filterStatus !== "all" ? "没有匹配的报表" : "暂无报表"}
        </p>
        <p className="text-xs" style={{ color: "var(--atlas-text-3)" }}>
          {query || filterStatus !== "all"
            ? "尝试调整筛选条件"
            : "在工作台生成报表后，它们会出现在这里"}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 mt-4">
      {filtered.map((report, i) => {
        const ok = report.status === "completed";
        return (
          <motion.div
            key={report.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03 }}
            className="flex items-center gap-4 px-4 py-3.5 rounded-xl group transition-all"
            style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLElement).style.borderColor = "rgba(91,140,255,0.25)")
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLElement).style.borderColor = "var(--atlas-border)")
            }
          >
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: ok ? "rgba(52,211,153,0.1)" : "rgba(248,113,113,0.1)" }}
            >
              {ok ? (
                <FileText size={16} style={{ color: "#34D399" }} />
              ) : (
                <AlertCircle size={16} style={{ color: "#F87171" }} />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate" style={{ color: "var(--atlas-text)" }}>
                {report.title || report.filename}
              </p>
              <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                <span
                  className="flex items-center gap-1 text-xs"
                  style={{
                    color: "var(--atlas-text-3)",
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  <Calendar size={10} />
                  {report.createdAt
                    ? new Date(report.createdAt).toLocaleString("zh-CN")
                    : ""}
                </span>
                {report.fileSizeKb && (
                  <span className="text-xs" style={{ color: "var(--atlas-text-3)" }}>
                    {report.fileSizeKb > 1024
                      ? `${(report.fileSizeKb / 1024).toFixed(1)} MB`
                      : `${report.fileSizeKb} KB`}
                  </span>
                )}

              </div>
            </div>

            <div className="flex items-center gap-1.5 flex-shrink-0">
              {ok ? (
                <CheckCircle2 size={13} style={{ color: "#34D399" }} />
              ) : (
                <AlertCircle size={13} style={{ color: "#F87171" }} />
              )}
              <span
                className="text-xs"
                style={{
                  color: ok ? "#34D399" : "#F87171",
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                {ok ? "已完成" : "失败"}
              </span>
            </div>

            <div className="flex items-center gap-1.5 opacity-30 group-hover:opacity-100 transition-opacity">
              {ok && (
                <button
                  onClick={() => {
                    if (report.fileUrl) {
                      const a = document.createElement("a");
                      a.href = report.fileUrl;
                      a.download = report.filename;
                      a.target = "_blank";
                      a.click();
                      toast.success("开始下载");
                    } else {
                      toast.error("下载链接不可用，请重新生成报表");
                    }
                  }}
                  title="下载报表"
                  className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
                  style={{ background: "rgba(91,140,255,0.1)", color: "var(--atlas-accent)" }}
                  onMouseEnter={(e) =>
                    ((e.currentTarget as HTMLElement).style.background = "rgba(91,140,255,0.2)")
                  }
                  onMouseLeave={(e) =>
                    ((e.currentTarget as HTMLElement).style.background = "rgba(91,140,255,0.1)")
                  }
                >
                  <Download size={13} />
                </button>
              )}
              <button
                onClick={() => deleteMut?.mutate({ id: report.id })}
                title="删除报表"
                className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
                style={{ background: "rgba(248,113,113,0.1)", color: "#F87171" }}
                onMouseEnter={(e) =>
                  ((e.currentTarget as HTMLElement).style.background = "rgba(248,113,113,0.2)")
                }
                onMouseLeave={(e) =>
                  ((e.currentTarget as HTMLElement).style.background = "rgba(248,113,113,0.1)")
                }
              >
                <Trash2 size={12} />
              </button>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

// ── Fields Tab ────────────────────────────────────────────────────────────────

function FieldsTab({ query }: { query: string }) {
  const lq = query.toLowerCase();
  const filtered = STANDARD_FIELDS.filter(f =>
    !lq ||
    f.name.toLowerCase().includes(lq) ||
    f.displayName.includes(lq) ||
    f.description.includes(lq) ||
    [...f.aliases.common, ...f.aliases.douyin, ...f.aliases.tmall, ...f.aliases.pdd, ...f.aliases.jd].some(a => a.includes(lq))
  );

  const typeLabel: Record<string, string> = {
    string: "文本",
    number: "数值",
    integer: "整数",
    datetime: "日期",
  };

  return (
    <div className="mt-4">
      <p className="text-xs mb-4" style={{ color: "var(--atlas-text-3)" }}>
        共 {STANDARD_FIELDS.length} 个标准字段，覆盖抖音、天猫、拼多多、京东平台别名
      </p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--atlas-border)" }}>
              {["标准字段名", "显示名称", "类型", "说明", "别名（抖音/通用）"].map(h => (
                <th key={h} style={{ textAlign: "left", padding: "6px 10px", color: "var(--atlas-text-3)", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((f, i) => (
              <tr
                key={f.name}
                style={{
                  borderBottom: "1px solid var(--atlas-border)",
                  background: i % 2 === 0 ? "transparent" : "var(--atlas-surface)",
                }}
              >
                <td style={{ padding: "6px 10px", color: "var(--atlas-accent)", fontFamily: "monospace", whiteSpace: "nowrap" }}>{f.name}</td>
                <td style={{ padding: "6px 10px", color: "var(--atlas-text)", fontWeight: 500, whiteSpace: "nowrap" }}>{f.displayName}</td>
                <td style={{ padding: "6px 10px", color: "var(--atlas-text-3)", whiteSpace: "nowrap" }}>
                  <span style={{ padding: "2px 6px", borderRadius: 4, background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)", fontSize: 11 }}>
                    {typeLabel[f.type] ?? f.type}
                  </span>
                </td>
                <td style={{ padding: "6px 10px", color: "var(--atlas-text-2)" }}>{f.description}</td>
                <td style={{ padding: "6px 10px", color: "var(--atlas-text-3)", maxWidth: 200 }}>
                  <span style={{ fontSize: 11 }}>
                    {[...f.aliases.douyin, ...f.aliases.common].slice(0, 4).join("、")}
                    {f.aliases.douyin.length + f.aliases.common.length > 4 ? "…" : ""}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="text-center py-12" style={{ color: "var(--atlas-text-3)", fontSize: 13 }}>
            没有匹配的字段
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function LibraryPage() {
  const [tab, setTab] = useState<Tab>("sessions");
  const [query, setQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [searchFocused, setSearchFocused] = useState(false);

  const { data: sessions = [] } = trpc.session.list.useQuery();
  const { data: reports = [] } = trpc.report.list.useQuery();

  const TABS = [
    { id: "sessions" as Tab, label: "数据文件", icon: Database, count: sessions.length },
    { id: "reports" as Tab, label: "报表归档", icon: Archive, count: reports.length },
    { id: "fields" as Tab, label: "字段对照", icon: Table2, count: STANDARD_FIELDS.length },
  ];

  return (
    <div className="h-full overflow-y-auto" style={{ background: "var(--atlas-bg)" }}>
      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-1">
            <Archive size={20} style={{ color: "var(--atlas-accent)" }} />
            <h1 className="text-xl font-bold" style={{ color: "var(--atlas-text)" }}>
              库
            </h1>
          </div>
          <p className="text-sm" style={{ color: "var(--atlas-text-3)" }}>
            管理已上传的数据文件和生成的报表归档
          </p>
        </div>

        {/* Tabs */}
        <div
          className="flex items-center gap-1 mb-6 p-1 rounded-xl"
          style={{
            background: "var(--atlas-surface)",
            border: "1px solid var(--atlas-border)",
            width: "fit-content",
          }}
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
              style={{
                background: tab === t.id ? "var(--atlas-elevated)" : "transparent",
                color: tab === t.id ? "var(--atlas-text)" : "var(--atlas-text-3)",
                border:
                  tab === t.id
                    ? "1px solid var(--atlas-border-2)"
                    : "1px solid transparent",
              }}
            >
              <t.icon size={13} />
              {t.label}
              <span
                className="text-xs px-1.5 py-0.5 rounded-full"
                style={{
                  background:
                    tab === t.id ? "rgba(91,140,255,0.15)" : "var(--atlas-surface)",
                  color:
                    tab === t.id ? "var(--atlas-accent)" : "var(--atlas-text-3)",
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                {t.count}
              </span>
            </button>
          ))}
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-3">
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg flex-1"
            style={{
              background: "var(--atlas-surface)",
              border: `1px solid ${
                searchFocused ? "rgba(91,140,255,0.35)" : "var(--atlas-border)"
              }`,
              transition: "border-color 0.15s",
            }}
          >
            <Search size={13} style={{ color: "var(--atlas-text-3)", flexShrink: 0 }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              placeholder={tab === "sessions" ? "搜索文件名..." : "搜索报表..."}
              className="flex-1 bg-transparent outline-none text-sm"
              style={{ color: "var(--atlas-text)" }}
            />
            {query && (
              <button onClick={() => setQuery("")} style={{ color: "var(--atlas-text-3)" }}>
                <X size={12} />
              </button>
            )}
          </div>

          {tab === "reports" && (
            <div className="flex items-center gap-1">
              {(["all", "completed", "failed"] as FilterStatus[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilterStatus(f)}
                  className="px-3 py-2 rounded-lg text-xs font-medium transition-all"
                  style={{
                    background:
                      filterStatus === f
                        ? "rgba(91,140,255,0.1)"
                        : "var(--atlas-surface)",
                    color:
                      filterStatus === f
                        ? "var(--atlas-accent)"
                        : "var(--atlas-text-3)",
                    border: `1px solid ${
                      filterStatus === f
                        ? "rgba(91,140,255,0.3)"
                        : "var(--atlas-border)"
                    }`,
                  }}
                >
                  {f === "all" ? "全部" : f === "completed" ? "已完成" : "失败"}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
          >
            {tab === "sessions" ? (
              <SessionsTab query={query} />
            ) : tab === "reports" ? (
              <ReportsTab query={query} filterStatus={filterStatus} />
            ) : (
              <FieldsTab query={query} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
