/**
 * ATLAS V3.0 — TopBar
 * Style: Manus-inspired dark minimal header
 * - Logo + breadcrumb left
 * - New button + backend status + avatar right
 */
import { useState, useEffect } from "react";
import { Plus, Wifi, WifiOff, Loader2 } from "lucide-react";
import { useAtlas } from "@/contexts/AtlasContext";
import { api } from "@/lib/api";
import { toast } from "sonner";

export default function TopBar() {
  const { activeNav, setActiveNav, clearMessages, clearFiles } = useAtlas();
  const [backendOk, setBackendOk] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const check = async () => {
      setChecking(true);
      try { await api.health(); setBackendOk(true); }
      catch { setBackendOk(false); }
      finally { setChecking(false); }
    };
    check();
    const t = setInterval(check, 30000);
    return () => clearInterval(t);
  }, []);

  const handleNew = () => {
    clearMessages();
    clearFiles();
    setActiveNav("home");
    toast.success("已新建工作区");
  };

  const sectionName: Record<string, string> = {
    home: "工作台",
    reports: "报表中心",
    templates: "模板库",
    history: "历史记录",
    settings: "设置",
  };

  return (
    <header
      className="flex items-center gap-0 px-4 flex-shrink-0"
      style={{
        height: "var(--atlas-topbar-h)",
        background: "var(--atlas-surface)",
        borderBottom: "1px solid var(--atlas-border)",
        position: "relative",
        zIndex: 40,
      }}
    >
      {/* ── Logo ── */}
      <div className="flex items-center gap-2.5 mr-5">
        {/* Icon mark */}
        <div
          className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
          style={{ background: "var(--atlas-accent)" }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 1L13 12H1L7 1Z" fill="white" fillOpacity="0.9" />
          </svg>
        </div>
        <span
          className="font-semibold tracking-widest text-xs uppercase"
          style={{ color: "var(--atlas-text)", letterSpacing: "0.12em" }}
        >
          ATLAS
        </span>
      </div>

      {/* ── Separator ── */}
      <div className="w-px h-4 mr-4" style={{ background: "var(--atlas-border)" }} />

      {/* ── Breadcrumb ── */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs" style={{ color: "var(--atlas-text-3)" }}>
          {sectionName[activeNav] || "工作台"}
        </span>
      </div>

      <div className="flex-1" />

      {/* ── Actions ── */}
      <div className="flex items-center gap-2">
        {/* New workspace button */}
        <button
          onClick={handleNew}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all"
          style={{
            background: "var(--atlas-elevated)",
            border: "1px solid var(--atlas-border)",
            color: "var(--atlas-text-2)",
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.color = "var(--atlas-text)";
            (e.currentTarget as HTMLElement).style.borderColor = "var(--atlas-border-2)";
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-2)";
            (e.currentTarget as HTMLElement).style.borderColor = "var(--atlas-border)";
          }}
        >
          <Plus size={12} />
          新建
        </button>

        {/* Backend status pill */}
        <div
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md"
          style={{
            background: "var(--atlas-elevated)",
            border: "1px solid var(--atlas-border)",
          }}
        >
          {checking ? (
            <Loader2 size={10} className="animate-spin" style={{ color: "var(--atlas-text-3)" }} />
          ) : backendOk === null ? (
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#F59E0B" }} />
          ) : backendOk ? (
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--atlas-success)" }} />
          ) : (
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--atlas-danger)" }} />
          )}
          <span
            className="text-xs"
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              color:
                backendOk === null
                  ? "#F59E0B"
                  : backendOk
                  ? "var(--atlas-success)"
                  : "var(--atlas-danger)",
            }}
          >
            {backendOk === null ? "检测中" : backendOk ? "ONLINE" : "OFFLINE"}
          </span>
        </div>

        {/* Avatar */}
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
          style={{
            background: "linear-gradient(135deg, #5B8CFF 0%, #7B5FFF 100%)",
            color: "#fff",
          }}
        >
          A
        </div>
      </div>
    </header>
  );
}
