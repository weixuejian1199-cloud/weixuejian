/**
 * ATLAS V5.0 — 库 (Library / Report Storage Center)
 * 所有已生成报表的归档中心，支持下载、预览、搜索
 */
import { useState } from "react";
import { Archive, FileText, Download, Search, X, Filter, CheckCircle2, AlertCircle, Calendar } from "lucide-react";
import { useAtlas } from "@/contexts/AtlasContext";

type SortKey = "date" | "name" | "status";
type FilterStatus = "all" | "completed" | "failed";

export default function LibraryPage() {
  const { reports, backendUrl } = useAtlas();
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [searchFocused, setSearchFocused] = useState(false);

  const filtered = reports
    .filter(r => {
      if (filterStatus !== "all" && r.status !== filterStatus) return false;
      if (query && !r.title.toLowerCase().includes(query.toLowerCase()) &&
          !r.filename.toLowerCase().includes(query.toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortKey === "name") return a.title.localeCompare(b.title);
      if (sortKey === "status") return a.status.localeCompare(b.status);
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  const handleDownload = (report: typeof reports[0]) => {
    const url = `${backendUrl}/download/${report.id}`;
    window.open(url, "_blank");
  };

  return (
    <div className="h-full overflow-y-auto" style={{ background: "var(--atlas-bg)" }}>
      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-1">
            <Archive size={20} style={{ color: "var(--atlas-accent)" }} />
            <h1 className="text-xl font-bold" style={{ color: "var(--atlas-text)" }}>库</h1>
          </div>
          <p className="text-sm" style={{ color: "var(--atlas-text-3)" }}>
            所有已生成的报表归档于此，支持下载和重新查看。
          </p>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-3 mb-6">
          {/* Search */}
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg flex-1"
            style={{
              background: "var(--atlas-surface)",
              border: `1px solid ${searchFocused ? "rgba(91,140,255,0.35)" : "var(--atlas-border)"}`,
              transition: "border-color 0.15s",
            }}
          >
            <Search size={13} style={{ color: "var(--atlas-text-3)", flexShrink: 0 }} />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              placeholder="搜索报表..."
              className="flex-1 bg-transparent outline-none text-sm"
              style={{ color: "var(--atlas-text)" }}
            />
            {query && (
              <button onClick={() => setQuery("")} style={{ color: "var(--atlas-text-3)" }}>
                <X size={12} />
              </button>
            )}
          </div>

          {/* Filter */}
          <div className="flex items-center gap-1">
            {(["all", "completed", "failed"] as FilterStatus[]).map(s => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={{
                  background: filterStatus === s ? "var(--atlas-accent)" : "var(--atlas-surface)",
                  color: filterStatus === s ? "#fff" : "var(--atlas-text-2)",
                  border: `1px solid ${filterStatus === s ? "transparent" : "var(--atlas-border)"}`,
                }}
              >
                {s === "all" ? "全部" : s === "completed" ? "已完成" : "失败"}
              </button>
            ))}
          </div>

          {/* Sort */}
          <select
            value={sortKey}
            onChange={e => setSortKey(e.target.value as SortKey)}
            className="px-3 py-1.5 rounded-lg text-xs outline-none"
            style={{
              background: "var(--atlas-surface)",
              border: "1px solid var(--atlas-border)",
              color: "var(--atlas-text-2)",
            }}
          >
            <option value="date">按时间</option>
            <option value="name">按名称</option>
            <option value="status">按状态</option>
          </select>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { label: "全部报表", value: reports.length, color: "var(--atlas-accent)" },
            { label: "已完成", value: reports.filter(r => r.status === "completed").length, color: "#34D399" },
            { label: "失败", value: reports.filter(r => r.status === "failed").length, color: "#F87171" },
          ].map(stat => (
            <div
              key={stat.label}
              className="px-4 py-3 rounded-lg"
              style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}
            >
              <p
                className="text-2xl font-bold"
                style={{ color: stat.color, fontFamily: "'JetBrains Mono', monospace" }}
              >
                {stat.value}
              </p>
              <p className="text-xs mt-0.5" style={{ color: "var(--atlas-text-3)" }}>{stat.label}</p>
            </div>
          ))}
        </div>

        {/* Report list */}
        {filtered.length === 0 ? (
          <div className="text-center py-20">
            <Archive size={40} style={{ color: "var(--atlas-text-3)", margin: "0 auto 12px", opacity: 0.4 }} />
            <p className="text-sm font-medium mb-1" style={{ color: "var(--atlas-text-2)" }}>
              {query || filterStatus !== "all" ? "没有匹配的报表" : "暂无报表"}
            </p>
            <p className="text-xs" style={{ color: "var(--atlas-text-3)" }}>
              {query || filterStatus !== "all" ? "尝试调整筛选条件" : "在工作台生成报表后，它们会出现在这里"}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(report => (
              <div
                key={report.id}
                className="flex items-center gap-4 px-4 py-3.5 rounded-xl transition-all"
                style={{
                  background: "var(--atlas-surface)",
                  border: "1px solid var(--atlas-border)",
                }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = "rgba(91,140,255,0.25)"}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--atlas-border)"}
              >
                {/* Icon */}
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: report.status === "completed" ? "rgba(52,211,153,0.1)" : "rgba(248,113,113,0.1)" }}
                >
                  {report.status === "completed"
                    ? <FileText size={16} style={{ color: "#34D399" }} />
                    : <AlertCircle size={16} style={{ color: "#F87171" }} />
                  }
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: "var(--atlas-text)" }}>
                    {report.title}
                  </p>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-xs truncate" style={{ color: "var(--atlas-text-3)", fontFamily: "'JetBrains Mono', monospace" }}>
                      {report.filename}
                    </span>
                    <span className="flex items-center gap-1 text-xs" style={{ color: "var(--atlas-text-3)", flexShrink: 0 }}>
                      <Calendar size={10} />
                      {report.created_at}
                    </span>
                  </div>
                </div>

                {/* Status badge */}
                <div
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full flex-shrink-0"
                  style={{
                    background: report.status === "completed" ? "rgba(52,211,153,0.1)" : "rgba(248,113,113,0.1)",
                    border: `1px solid ${report.status === "completed" ? "rgba(52,211,153,0.2)" : "rgba(248,113,113,0.2)"}`,
                  }}
                >
                  {report.status === "completed"
                    ? <CheckCircle2 size={10} style={{ color: "#34D399" }} />
                    : <AlertCircle size={10} style={{ color: "#F87171" }} />
                  }
                  <span className="text-xs" style={{ color: report.status === "completed" ? "#34D399" : "#F87171" }}>
                    {report.status === "completed" ? "已完成" : "失败"}
                  </span>
                </div>

                {/* Download */}
                {report.status === "completed" && (
                  <button
                    onClick={() => handleDownload(report)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-all"
                    style={{ color: "var(--atlas-text-3)" }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLElement).style.background = "rgba(91,140,255,0.1)";
                      (e.currentTarget as HTMLElement).style.color = "var(--atlas-accent)";
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLElement).style.background = "transparent";
                      (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)";
                    }}
                    title="下载报表"
                  >
                    <Download size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
