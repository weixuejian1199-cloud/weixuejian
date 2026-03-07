/**
 * ATLAS V4.0 — TopBar
 * Manus-inspired minimal header
 * - Mobile: hamburger menu to toggle sidebar
 * - Desktop: breadcrumb + status + user avatar
 */
import { useState, useEffect } from "react";
import { Plus, Loader2, Menu, Bell, HelpCircle, ChevronRight } from "lucide-react";
import { useAtlas } from "@/contexts/AtlasContext";
import { api } from "@/lib/api";
import { toast } from "sonner";

const SECTION_NAMES: Record<string, string> = {
  home:      "工作台",
  dashboard: "数据中枢",
  templates: "模板库",
  history:   "历史记录",
  settings:  "设置",
};

export default function TopBar() {
  const {
    activeNav, setActiveNav,
    sidebarOpen, setSidebarOpen,
    createNewTask,
    user, setShowLoginModal,
  } = useAtlas();

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
    createNewTask();
    setActiveNav("home");
    toast.success("已新建工作区");
  };

  const sectionLabel = SECTION_NAMES[activeNav] || "工作台";

  return (
    <header
      className="flex items-center gap-0 px-3 flex-shrink-0"
      style={{
        height: "var(--atlas-topbar-h)",
        background: "var(--atlas-surface)",
        borderBottom: "1px solid var(--atlas-border)",
        position: "relative",
        zIndex: 40,
      }}
    >
      {/* ── Mobile: Hamburger ── */}
      <button
        className="md:hidden w-8 h-8 rounded-lg flex items-center justify-center mr-2 transition-all"
        style={{ color: "var(--atlas-text-3)" }}
        onClick={() => setSidebarOpen(!sidebarOpen)}
        onMouseEnter={e => {
          (e.currentTarget as HTMLElement).style.background = "var(--atlas-elevated)";
          (e.currentTarget as HTMLElement).style.color = "var(--atlas-text)";
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLElement).style.background = "transparent";
          (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)";
        }}
      >
        <Menu size={16} />
      </button>

      {/* ── Logo (visible on mobile when sidebar is closed) ── */}
      <div className="flex items-center gap-2 mr-4 md:hidden">
        <div className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
          style={{ background: "var(--atlas-accent)" }}>
          <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
            <path d="M7 1L13 12H1L7 1Z" fill="white" fillOpacity="0.9" />
          </svg>
        </div>
        <span className="font-bold tracking-widest text-xs uppercase"
          style={{ color: "var(--atlas-text)", letterSpacing: "0.12em" }}>
          ATLAS
        </span>
      </div>

      {/* ── Breadcrumb (desktop) ── */}
      <div className="hidden md:flex items-center gap-1.5">
        <span className="text-xs" style={{ color: "var(--atlas-text-3)" }}>ATLAS</span>
        <ChevronRight size={11} style={{ color: "var(--atlas-text-3)", opacity: 0.5 }} />
        <span className="text-xs font-medium" style={{ color: "var(--atlas-text-2)" }}>{sectionLabel}</span>
      </div>

      <div className="flex-1" />

      {/* ── Actions ── */}
      <div className="flex items-center gap-1.5">
        {/* New button */}
        <button
          onClick={handleNew}
          className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
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

        {/* Help */}
        <button
          className="w-7 h-7 rounded-lg hidden sm:flex items-center justify-center transition-all"
          style={{ color: "var(--atlas-text-3)" }}
          onClick={() => toast.info("帮助文档即将上线")}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.background = "var(--atlas-elevated)";
            (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-2)";
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.background = "transparent";
            (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)";
          }}
          title="帮助"
        >
          <HelpCircle size={14} />
        </button>

        {/* Notification */}
        <button
          className="w-7 h-7 rounded-lg flex items-center justify-center transition-all relative"
          style={{ color: "var(--atlas-text-3)" }}
          onClick={() => toast.info("暂无新通知")}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.background = "var(--atlas-elevated)";
            (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-2)";
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.background = "transparent";
            (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)";
          }}
          title="通知"
        >
          <Bell size={14} />
        </button>

        {/* Backend status */}
        <div
          className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-lg"
          style={{
            background: "var(--atlas-elevated)",
            border: "1px solid var(--atlas-border)",
          }}
          title={backendOk ? "后端服务正常" : "后端服务离线"}
        >
          {checking ? (
            <Loader2 size={9} className="animate-spin" style={{ color: "var(--atlas-text-3)" }} />
          ) : (
            <div
              className="w-1.5 h-1.5 rounded-full"
              style={{
                background: backendOk === null ? "#F59E0B" : backendOk ? "var(--atlas-success)" : "var(--atlas-danger)",
                boxShadow: backendOk ? "0 0 4px var(--atlas-success)" : "none",
              }}
            />
          )}
          <span
            className="text-xs"
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "10px",
              color: backendOk === null ? "#F59E0B" : backendOk ? "var(--atlas-success)" : "var(--atlas-danger)",
            }}
          >
            {backendOk === null ? "..." : backendOk ? "ONLINE" : "OFFLINE"}
          </span>
        </div>

        {/* Divider */}
        <div className="w-px h-4 mx-1 hidden sm:block" style={{ background: "var(--atlas-border)" }} />

        {/* User Avatar */}
        {user ? (
          <button
            onClick={() => setActiveNav("settings")}
            className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 transition-all"
            style={{
              background: "linear-gradient(135deg, #5B8CFF 0%, #7B5FFF 100%)",
              color: "#fff",
            }}
            title={user.name}
          >
            {user.name[0].toUpperCase()}
          </button>
        ) : (
          <button
            onClick={() => setShowLoginModal(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all"
            style={{
              background: "rgba(91,140,255,0.1)",
              border: "1px solid rgba(91,140,255,0.2)",
              color: "var(--atlas-accent)",
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.background = "rgba(91,140,255,0.18)";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.background = "rgba(91,140,255,0.1)";
            }}
          >
            登录
          </button>
        )}
      </div>
    </header>
  );
}
