/**
 * ATLAS V5.0 — 搜索页
 * 全局搜索：任务、报表、模板
 */
import { useState, useEffect, useRef } from "react";
import { Search, FileText, LayoutTemplate, Clock, CheckCircle2, AlertCircle, Loader2, X } from "lucide-react";
import { useAtlas } from "@/contexts/AtlasContext";

export default function SearchPage() {
  const { tasks, reports, templates, setActiveNav, setActiveTaskId } = useAtlas();
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const q = query.toLowerCase().trim();

  const matchedTasks = q
    ? tasks.filter(t => t.title.toLowerCase().includes(q) || t.filename.toLowerCase().includes(q))
    : tasks.slice(0, 5);

  const matchedReports = q
    ? reports.filter(r => r.title.toLowerCase().includes(q) || r.filename.toLowerCase().includes(q))
    : reports.slice(0, 5);

  const matchedTemplates = q
    ? templates.filter(t => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q))
    : templates.slice(0, 5);

  const totalCount = matchedTasks.length + matchedReports.length + matchedTemplates.length;

  const statusIcon = (status: string) => {
    if (status === "completed") return <CheckCircle2 size={12} style={{ color: "#34D399" }} />;
    if (status === "processing") return <Loader2 size={12} style={{ color: "#FBBF24" }} className="animate-spin" />;
    if (status === "failed") return <AlertCircle size={12} style={{ color: "#F87171" }} />;
    return <Clock size={12} style={{ color: "#5B8CFF" }} />;
  };

  return (
    <div className="h-full overflow-y-auto" style={{ background: "var(--atlas-bg)" }}>
      <div className="max-w-2xl mx-auto px-6 py-10">
        {/* Search input */}
        <div
          className="flex items-center gap-3 px-4 py-3 rounded-xl mb-8"
          style={{
            background: "var(--atlas-surface)",
            border: `1px solid ${focused ? "rgba(91,140,255,0.4)" : "var(--atlas-border)"}`,
            boxShadow: focused ? "0 0 0 3px rgba(91,140,255,0.08)" : "none",
            transition: "all 0.15s",
          }}
        >
          <Search size={18} style={{ color: "var(--atlas-text-3)", flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="搜索任务、报表、模板..."
            className="flex-1 bg-transparent outline-none text-base"
            style={{ color: "var(--atlas-text)" }}
          />
          {query && (
            <button onClick={() => setQuery("")} style={{ color: "var(--atlas-text-3)" }}>
              <X size={16} />
            </button>
          )}
        </div>

        {/* Results summary */}
        {q && (
          <p className="text-sm mb-6" style={{ color: "var(--atlas-text-3)" }}>
            找到 <span style={{ color: "var(--atlas-accent)" }}>{totalCount}</span> 个结果
          </p>
        )}

        {/* Tasks */}
        {matchedTasks.length > 0 && (
          <section className="mb-8">
            <h3
              className="text-xs font-semibold uppercase tracking-wider mb-3"
              style={{ color: "var(--atlas-text-3)", fontSize: "10px", letterSpacing: "0.1em" }}
            >
              任务 ({matchedTasks.length})
            </h3>
            <div className="space-y-1">
              {matchedTasks.map(task => (
                <button
                  key={task.id}
                  onClick={() => { setActiveTaskId(task.id); setActiveNav("home"); }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-all"
                  style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = "rgba(91,140,255,0.3)"}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--atlas-border)"}
                >
                  {statusIcon(task.status)}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: "var(--atlas-text)" }}>{task.title}</p>
                    <p className="text-xs truncate" style={{ color: "var(--atlas-text-3)" }}>{task.filename}</p>
                  </div>
                  <span
                    className="text-xs px-2 py-0.5 rounded-full flex-shrink-0"
                    style={{
                      background: "var(--atlas-elevated)",
                      color: "var(--atlas-text-3)",
                    }}
                  >
                    {task.status === "completed" ? "已完成" : task.status === "processing" ? "处理中" : task.status === "failed" ? "失败" : "待处理"}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Reports */}
        {matchedReports.length > 0 && (
          <section className="mb-8">
            <h3
              className="text-xs font-semibold uppercase tracking-wider mb-3"
              style={{ color: "var(--atlas-text-3)", fontSize: "10px", letterSpacing: "0.1em" }}
            >
              报表 ({matchedReports.length})
            </h3>
            <div className="space-y-1">
              {matchedReports.map(report => (
                <div
                  key={report.id}
                  className="flex items-center gap-3 px-4 py-3 rounded-lg"
                  style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}
                >
                  <FileText size={14} style={{ color: "#34D399", flexShrink: 0 }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: "var(--atlas-text)" }}>{report.title}</p>
                    <p className="text-xs truncate" style={{ color: "var(--atlas-text-3)" }}>{report.created_at}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Templates */}
        {matchedTemplates.length > 0 && (
          <section className="mb-8">
            <h3
              className="text-xs font-semibold uppercase tracking-wider mb-3"
              style={{ color: "var(--atlas-text-3)", fontSize: "10px", letterSpacing: "0.1em" }}
            >
              模板 ({matchedTemplates.length})
            </h3>
            <div className="space-y-1">
              {matchedTemplates.map(tpl => (
                <button
                  key={tpl.id}
                  onClick={() => setActiveNav("templates")}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-all"
                  style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = "rgba(91,140,255,0.3)"}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--atlas-border)"}
                >
                  <span className="text-base flex-shrink-0">{tpl.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: "var(--atlas-text)" }}>{tpl.name}</p>
                    <p className="text-xs truncate" style={{ color: "var(--atlas-text-3)" }}>{tpl.description}</p>
                  </div>
                  <span
                    className="text-xs px-2 py-0.5 rounded-full flex-shrink-0"
                    style={{ background: "var(--atlas-elevated)", color: "var(--atlas-text-3)" }}
                  >
                    {tpl.category}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Empty state */}
        {q && totalCount === 0 && (
          <div className="text-center py-16">
            <Search size={32} style={{ color: "var(--atlas-text-3)", margin: "0 auto 12px" }} />
            <p className="text-sm" style={{ color: "var(--atlas-text-3)" }}>没有找到与 "{query}" 相关的内容</p>
          </div>
        )}

        {/* No query state */}
        {!q && totalCount === 0 && (
          <div className="text-center py-16">
            <Search size={32} style={{ color: "var(--atlas-text-3)", margin: "0 auto 12px" }} />
            <p className="text-sm" style={{ color: "var(--atlas-text-3)" }}>输入关键词开始搜索</p>
          </div>
        )}
      </div>
    </div>
  );
}
