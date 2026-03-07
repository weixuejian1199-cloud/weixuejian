/**
 * ATLAS V8.0 — 搜索页（接入真实 tRPC API）
 * 搜索：会话（上传文件）+ 报表
 */
import { useState, useEffect, useRef, useMemo } from "react";
import { Search, FileText, Database, Clock, CheckCircle2, AlertCircle, Loader2, X, ArrowRight } from "lucide-react";
import { useAtlas } from "@/contexts/AtlasContext";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function SearchPage() {
  const { setActiveNav, setActiveTaskId, templates } = useAtlas();
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debouncedQuery = useDebounce(query.trim(), 300);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Recent data (shown when no query)
  const { data: recent, isLoading: recentLoading } = trpc.search.recent.useQuery(
    undefined,
    { enabled: !!user && !debouncedQuery }
  );

  // Search results (shown when query exists)
  const { data: searchResult, isLoading: searching } = trpc.search.query.useQuery(
    { q: debouncedQuery },
    { enabled: !!user && debouncedQuery.length >= 1 }
  );

  // Template search (local, no API needed)
  const matchedTemplates = useMemo(() => {
    if (!debouncedQuery) return templates.slice(0, 4);
    const q = debouncedQuery.toLowerCase();
    return templates.filter(t =>
      t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)
    ).slice(0, 5);
  }, [debouncedQuery, templates]);

  const sessions = debouncedQuery ? (searchResult?.sessions ?? []) : (recent?.sessions ?? []);
  const reports = debouncedQuery ? (searchResult?.reports ?? []) : (recent?.reports ?? []);
  const isLoading = debouncedQuery ? searching : recentLoading;
  const totalCount = sessions.length + reports.length + matchedTemplates.length;

  const statusIcon = (status: string) => {
    if (status === "completed") return <CheckCircle2 size={12} style={{ color: "#34D399" }} />;
    if (status === "processing") return <Loader2 size={12} style={{ color: "#FBBF24" }} className="animate-spin" />;
    if (status === "failed") return <AlertCircle size={12} style={{ color: "#F87171" }} />;
    return <Clock size={12} style={{ color: "#5B8CFF" }} />;
  };

  const formatDate = (d: Date | string | null | undefined) => {
    if (!d) return "";
    return new Date(d).toLocaleDateString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="h-full overflow-y-auto" style={{ background: "var(--atlas-bg)" }}>
      <div className="max-w-2xl mx-auto px-6 py-10">
        {/* Search input */}
        <div
          className="flex items-center gap-3 px-4 py-3 rounded-xl mb-8 transition-all"
          style={{
            background: "var(--atlas-surface)",
            border: `1px solid ${focused ? "rgba(91,140,255,0.4)" : "var(--atlas-border)"}`,
            boxShadow: focused ? "0 0 0 3px rgba(91,140,255,0.08)" : "none",
          }}
        >
          {isLoading && debouncedQuery
            ? <Loader2 size={18} className="animate-spin flex-shrink-0" style={{ color: "#5B8CFF" }} />
            : <Search size={18} style={{ color: "var(--atlas-text-3)", flexShrink: 0 }} />
          }
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="搜索会话、报表、模板..."
            className="flex-1 bg-transparent outline-none text-base"
            style={{ color: "var(--atlas-text)" }}
          />
          {query && (
            <button onClick={() => setQuery("")} style={{ color: "var(--atlas-text-3)" }}>
              <X size={16} />
            </button>
          )}
        </div>

        {/* Not logged in */}
        {!user && (
          <div className="text-center py-16">
            <Search size={32} style={{ color: "var(--atlas-text-3)", margin: "0 auto 12px" }} />
            <p className="text-sm" style={{ color: "var(--atlas-text-3)" }}>请先登录以搜索您的数据</p>
          </div>
        )}

        {user && (
          <>
            {/* Results summary */}
            {debouncedQuery && !isLoading && (
              <p className="text-sm mb-6" style={{ color: "var(--atlas-text-3)" }}>
                找到 <span style={{ color: "var(--atlas-accent)" }}>{totalCount}</span> 个结果
              </p>
            )}

            {!debouncedQuery && !isLoading && (
              <p className="text-xs mb-6 font-semibold uppercase tracking-wider" style={{ color: "var(--atlas-text-3)", fontSize: "10px", letterSpacing: "0.1em" }}>
                最近使用
              </p>
            )}

            {/* Sessions */}
            {sessions.length > 0 && (
              <section className="mb-8">
                <h3 className="text-xs font-semibold uppercase tracking-wider mb-3"
                  style={{ color: "var(--atlas-text-3)", fontSize: "10px", letterSpacing: "0.1em" }}>
                  会话 ({sessions.length})
                </h3>
                <div className="space-y-1">
                  {sessions.map((session: any) => (
                    <button
                      key={session.id}
                      onClick={() => { setActiveTaskId(session.id); setActiveNav("home"); }}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-all group"
                      style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = "rgba(91,140,255,0.3)"}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--atlas-border)"}
                    >
                      <Database size={14} style={{ color: "#5B8CFF", flexShrink: 0 }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: "var(--atlas-text)" }}>
                          {session.originalName || session.filename}
                        </p>
                        <p className="text-xs truncate" style={{ color: "var(--atlas-text-3)" }}>
                          {session.rowCount ? `${session.rowCount} 行` : ""}{session.colCount ? ` × ${session.colCount} 列` : ""}
                          {session.createdAt ? ` · ${formatDate(session.createdAt)}` : ""}
                        </p>
                      </div>
                      <ArrowRight size={14} className="opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: "#5B8CFF" }} />
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* Reports */}
            {reports.length > 0 && (
              <section className="mb-8">
                <h3 className="text-xs font-semibold uppercase tracking-wider mb-3"
                  style={{ color: "var(--atlas-text-3)", fontSize: "10px", letterSpacing: "0.1em" }}>
                  报表 ({reports.length})
                </h3>
                <div className="space-y-1">
                  {reports.map((report: any) => (
                    <div
                      key={report.id}
                      className="flex items-center gap-3 px-4 py-3 rounded-lg"
                      style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}
                    >
                      <FileText size={14} style={{ color: "#34D399", flexShrink: 0 }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: "var(--atlas-text)" }}>
                          {report.title || report.prompt || "未命名报表"}
                        </p>
                        <p className="text-xs truncate" style={{ color: "var(--atlas-text-3)" }}>
                          {report.filename || ""}{report.createdAt ? ` · ${formatDate(report.createdAt)}` : ""}
                        </p>
                      </div>
                      {report.status && (
                        <span className="text-xs px-2 py-0.5 rounded-full flex-shrink-0"
                          style={{ background: "var(--atlas-elevated)", color: "var(--atlas-text-3)" }}>
                          {report.status === "completed" ? "已完成" : report.status === "processing" ? "处理中" : report.status === "failed" ? "失败" : "待处理"}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Templates */}
            {matchedTemplates.length > 0 && (
              <section className="mb-8">
                <h3 className="text-xs font-semibold uppercase tracking-wider mb-3"
                  style={{ color: "var(--atlas-text-3)", fontSize: "10px", letterSpacing: "0.1em" }}>
                  模板 ({matchedTemplates.length})
                </h3>
                <div className="space-y-1">
                  {matchedTemplates.map(tpl => (
                    <button
                      key={tpl.id}
                      onClick={() => setActiveNav("templates")}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-all group"
                      style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = "rgba(91,140,255,0.3)"}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--atlas-border)"}
                    >
                      <span className="text-base flex-shrink-0">{tpl.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: "var(--atlas-text)" }}>{tpl.name}</p>
                        <p className="text-xs truncate" style={{ color: "var(--atlas-text-3)" }}>{tpl.description}</p>
                      </div>
                      <span className="text-xs px-2 py-0.5 rounded-full flex-shrink-0"
                        style={{ background: "var(--atlas-elevated)", color: "var(--atlas-text-3)" }}>
                        {tpl.category}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* Empty state */}
            {debouncedQuery && !isLoading && totalCount === 0 && (
              <div className="text-center py-16">
                <Search size={32} style={{ color: "var(--atlas-text-3)", margin: "0 auto 12px" }} />
                <p className="text-sm" style={{ color: "var(--atlas-text-3)" }}>没有找到与 "{debouncedQuery}" 相关的内容</p>
                <p className="text-xs mt-2" style={{ color: "var(--atlas-text-3)" }}>尝试使用文件名、报表标题或分析内容关键词</p>
              </div>
            )}

            {/* No query + no data */}
            {!debouncedQuery && !isLoading && totalCount === 0 && (
              <div className="text-center py-16">
                <Search size={32} style={{ color: "var(--atlas-text-3)", margin: "0 auto 12px" }} />
                <p className="text-sm" style={{ color: "var(--atlas-text-3)" }}>输入关键词开始搜索</p>
                <p className="text-xs mt-2" style={{ color: "var(--atlas-text-3)" }}>可搜索会话文件名、报表标题、分析内容</p>
              </div>
            )}

            {/* Loading skeleton */}
            {isLoading && (
              <div className="space-y-2">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-14 rounded-lg animate-pulse" style={{ background: "var(--atlas-surface)" }} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
