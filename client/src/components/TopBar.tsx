/**
 * ATLAS V1.0 GA — TopBar (Gemini-style)
 * Per UI spec: Background #f0f4f9, NO bottom border, seamless with content
 * Left: ☰ hamburger (mobile only)
 * Center: conversation title (or ATLAS on home)
 * Right: 📎 file clip + ⋮ more + user avatar
 */
import { useState, useEffect, useRef } from "react";
import { Menu, Paperclip, MoreVertical, LogOut, Settings, Loader2 } from "lucide-react";
import { useAtlas, type NavItem } from "@/contexts/AtlasContext";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

// ── UserMenu ────────────────────────────────────────────────────────────────
function UserMenu({
  user,
  setActiveNav,
  setShowLoginModal,
}: {
  user: { name: string; email?: string } | null;
  setActiveNav: (nav: NavItem) => void;
  setShowLoginModal: (v: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const logoutMut = trpc.auth.logout.useMutation({
    onSuccess: () => {
      toast.success("已退出登录");
      setOpen(false);
      window.location.reload();
    },
    onError: () => toast.error("退出失败，请重试"),
  });

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (!user) {
    return (
      <button
        onClick={() => setShowLoginModal(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full font-medium transition-all"
        style={{
          background: "#4f6ef7",
          color: "#ffffff",
          fontSize: "13px",
        }}
        onMouseEnter={e => (e.currentTarget.style.opacity = "0.9")}
        onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
      >
        登录
      </button>
    );
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-8 h-8 rounded-full flex items-center justify-center transition-all"
        onMouseEnter={e => {
          (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.06)";
        }}
        onMouseLeave={e => {
          if (!open) (e.currentTarget as HTMLElement).style.background = "transparent";
        }}
      >
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center font-medium"
          style={{
            background: "linear-gradient(135deg, #4f6ef7 0%, #7c5bf7 100%)",
            color: "#fff",
            fontSize: "12px",
          }}
        >
          {user.name[0].toUpperCase()}
        </div>
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute right-0 top-full mt-2 rounded-xl overflow-hidden"
          style={{
            background: "#ffffff",
            border: "1px solid #e5e7eb",
            boxShadow: "0 4px 16px rgba(0,0,0,0.1)",
            minWidth: "180px",
            zIndex: 100,
          }}
        >
          {/* User info */}
          <div className="px-3 py-3" style={{ borderBottom: "1px solid #f3f4f6" }}>
            <p className="font-medium truncate" style={{ color: "#1f2937", fontSize: "14px" }}>
              {user.name}
            </p>
            {user.email && (
              <p className="truncate mt-0.5" style={{ color: "#9ca3af", fontSize: "12px" }}>
                {user.email}
              </p>
            )}
          </div>
          {/* Menu items */}
          <div className="py-1">
            <button
              onClick={() => { setActiveNav("settings"); setOpen(false); }}
              className="flex items-center gap-2.5 w-full px-3 py-2 transition-all"
              style={{ color: "#1f2937", fontSize: "13px" }}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(0,0,0,0.04)")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            >
              <Settings size={14} />
              设置
            </button>
            <button
              onClick={() => logoutMut.mutate()}
              disabled={logoutMut.isPending}
              className="flex items-center gap-2.5 w-full px-3 py-2 transition-all"
              style={{ color: "#ef4444", fontSize: "13px" }}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(239,68,68,0.06)")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            >
              {logoutMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}
              退出登录
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── TopBar ───────────────────────────────────────────────────────────────────
export default function TopBar() {
  const {
    activeNav, setActiveNav,
    sidebarOpen, setSidebarOpen,
    activeTaskId, tasks,
    user, setShowLoginModal,
  } = useAtlas();

  // Get current conversation title
  const activeTask = tasks.find(t => t.id === activeTaskId);
  const title = activeTask?.title || "";

  // Determine what to show in center
  const isHome = !activeTaskId || activeNav !== "home";
  const sectionLabels: Record<string, string> = {
    settings: "设置",
    library: "库",
    search: "搜索",
  };
  const centerText = activeNav !== "home" ? (sectionLabels[activeNav] || "") : title;

  return (
    <header
      className="flex items-center px-3 flex-shrink-0"
      style={{
        height: 56,
        background: "#f0f4f9",
        /* NO border-bottom — seamless with content per spec */
        position: "relative",
        zIndex: 40,
      }}
    >
      {/* ── Mobile: Hamburger ── */}
      <button
        className="w-9 h-9 rounded-full flex items-center justify-center transition-all flex-shrink-0"
        style={{
          color: "#6b7280",
          display: window.innerWidth < 600 ? "flex" : "none",
        }}
        onClick={() => setSidebarOpen(!sidebarOpen)}
        onMouseEnter={e => {
          (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.04)";
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLElement).style.background = "transparent";
        }}
      >
        <Menu size={20} />
      </button>

      {/* ── Center: Title ── */}
      <div className="flex-1 flex items-center justify-center min-w-0">
        {centerText ? (
          <h1
            className="truncate font-medium"
            style={{ color: "#1f2937", fontSize: "16px", maxWidth: "60%" }}
          >
            {centerText}
          </h1>
        ) : (
          /* ATLAS logo on home with no active task */
          <div className="flex items-center gap-2">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L22 20H2L12 2Z" fill="#4f6ef7" fillOpacity="0.9" />
            </svg>
            <span className="font-semibold tracking-wider" style={{ color: "#1f2937", fontSize: "15px", letterSpacing: "0.1em" }}>
              ATLAS
            </span>
          </div>
        )}
      </div>

      {/* ── Right: Actions ── */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {/* 📎 File clip — toggle file panel */}
        {activeNav === "home" && activeTaskId && (
          <button
            className="w-9 h-9 rounded-full flex items-center justify-center transition-all"
            style={{ color: "#6b7280" }}
            onClick={() => toast.info("文件面板即将上线")}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.04)";
              (e.currentTarget as HTMLElement).style.color = "#1f2937";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
              (e.currentTarget as HTMLElement).style.color = "#6b7280";
            }}
            title="文件"
          >
            <Paperclip size={16} />
          </button>
        )}

        {/* ⋮ More */}
        <button
          className="w-9 h-9 rounded-full flex items-center justify-center transition-all"
          style={{ color: "#6b7280" }}
          onClick={() => toast.info("更多选项即将上线")}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.04)";
            (e.currentTarget as HTMLElement).style.color = "#1f2937";
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.background = "transparent";
            (e.currentTarget as HTMLElement).style.color = "#6b7280";
          }}
          title="更多"
        >
          <MoreVertical size={16} />
        </button>

        {/* User avatar / Login */}
        <UserMenu user={user} setActiveNav={setActiveNav} setShowLoginModal={setShowLoginModal} />
      </div>
    </header>
  );
}
