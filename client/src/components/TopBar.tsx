/**
 * ATLAS V3.0 — TopBar (strict spec compliance)
 *
 * Height: 56px desktop / 48px mobile
 * Background: #f0f4f9, NO bottom border (seamless with content)
 *
 * Desktop:
 *   Left: ATLAS brand name (bold, brand color) — the ONLY logo position
 *   Center: conversation title (hidden on home)
 *   Right: 📎 file clip (with count badge) + ⋮ more menu + user avatar
 *
 * Mobile:
 *   ☰ ATLAS  📎 [avatar]  (no title, no ⋮)
 */
import { useState, useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Menu, Paperclip, MoreVertical, LogOut, Settings, Loader2,
  Pencil, Pin, Trash2, User,
} from "lucide-react";
import { useAtlas, type NavItem } from "@/contexts/AtlasContext";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

/* ── UserMenu ── */
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
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (!user) {
    return (
      <button
        onClick={() => setShowLoginModal(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full font-medium transition-all"
        style={{ background: "#4f6ef7", color: "#ffffff", fontSize: "13px" }}
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
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.06)"; }}
        onMouseLeave={e => { if (!open) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
      >
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center font-medium"
          style={{ background: "linear-gradient(135deg, #4f6ef7 0%, #7c5bf7 100%)", color: "#fff", fontSize: "12px" }}
        >
          {user.name[0].toUpperCase()}
        </div>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 4 }}
            transition={{ duration: 0.12 }}
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
              <p className="font-medium truncate" style={{ color: "#1f2937", fontSize: "14px" }}>{user.name}</p>
              {user.email && (
                <p className="truncate mt-0.5" style={{ color: "#9ca3af", fontSize: "12px" }}>{user.email}</p>
              )}
            </div>
            <div className="py-1">
              <MenuBtn icon={User} label="个人信息" onClick={() => { setActiveNav("settings"); setOpen(false); }} />
              <MenuBtn icon={Settings} label="设置" onClick={() => { setActiveNav("settings"); setOpen(false); }} />
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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MenuBtn({ icon: Icon, label, onClick }: { icon: typeof Settings; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2.5 w-full px-3 py-2 transition-all"
      style={{ color: "#1f2937", fontSize: "13px" }}
      onMouseEnter={e => (e.currentTarget.style.background = "rgba(0,0,0,0.04)")}
      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
    >
      <Icon size={14} />
      {label}
    </button>
  );
}

/* ── MoreMenu (⋮) ── */
function MoreMenu({ onRename, onDelete }: { onRename: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        className="w-9 h-9 rounded-full flex items-center justify-center transition-all"
        style={{ color: "#6b7280" }}
        onClick={() => setOpen(v => !v)}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.04)"; (e.currentTarget as HTMLElement).style.color = "#1f2937"; }}
        onMouseLeave={e => { if (!open) { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#6b7280"; } }}
        title="更多"
      >
        <MoreVertical size={16} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 4 }}
            transition={{ duration: 0.1 }}
            className="absolute right-0 top-full mt-1 rounded-xl overflow-hidden py-1"
            style={{
              background: "#ffffff",
              border: "1px solid #e5e7eb",
              boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
              minWidth: "140px",
              zIndex: 100,
            }}
          >
            <MenuBtn icon={Pencil} label="重命名" onClick={() => { onRename(); setOpen(false); }} />
            <MenuBtn icon={Pin} label="置顶" onClick={() => { toast.info("置顶功能即将上线"); setOpen(false); }} />
            <button
              onClick={() => { onDelete(); setOpen(false); }}
              className="flex items-center gap-2.5 w-full px-3 py-2 transition-all"
              style={{ color: "#ef4444", fontSize: "13px" }}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(239,68,68,0.06)")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            >
              <Trash2 size={14} />
              删除
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── TopBar ── */
export default function TopBar() {
  const {
    activeNav, setActiveNav,
    sidebarOpen, setSidebarOpen,
    activeTaskId, tasks,
    user, setShowLoginModal,
    filePanelOpen, setFilePanelOpen,
    uploadedFiles,
    deleteTask, renameTask,
  } = useAtlas();

  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 600);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 600);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  const deleteSessionMut = trpc.session.delete.useMutation();

  // Current task
  const activeTask = tasks.find(t => t.id === activeTaskId);
  const title = activeTask?.title || "";
  const isInConversation = activeNav === "home" && !!activeTaskId && activeTask?.messages && activeTask.messages.length > 0;

  // File count for badge
  const fileCount = uploadedFiles.length;

  // Section labels for non-home navs
  const sectionLabels: Record<string, string> = {
    settings: "设置",
    library: "库",
    search: "搜索",
  };

  const centerText = activeNav !== "home" ? (sectionLabels[activeNav] || "") : (isInConversation ? title : "");

  const handleRename = () => {
    if (!activeTaskId) return;
    const newName = prompt("重命名对话", title);
    if (newName && newName.trim()) {
      renameTask(activeTaskId, newName.trim());
      toast.success("已重命名");
    }
  };

  const handleDelete = () => {
    if (!activeTaskId) return;
    if (!confirm("确定删除此对话？")) return;
    deleteTask(activeTaskId);
    if (activeTask?.backendSessionId) {
      deleteSessionMut.mutate({ id: activeTask.backendSessionId }, { onError: () => {} });
    }
    toast.success("对话已删除");
  };

  return (
    <header
      className="flex items-center px-3 flex-shrink-0"
      style={{
        height: isMobile ? 48 : 56,
        background: "#f0f4f9",
        position: "relative",
        zIndex: 40,
      }}
    >
      {/* ── Left: Mobile hamburger ── */}
      {isMobile && (
        <button
          className="w-9 h-9 rounded-full flex items-center justify-center transition-all flex-shrink-0"
          style={{ color: "#6b7280" }}
          onClick={() => setSidebarOpen(!sidebarOpen)}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.04)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
        >
          <Menu size={20} />
        </button>
      )}

      {/* ── Left: ATLAS brand name (the ONLY logo position per spec) ── */}
      <div className="flex items-center gap-1.5 flex-shrink-0 mr-3">
        <span
          className="font-bold tracking-wider"
          style={{
            color: "#4f6ef7",
            fontSize: isMobile ? "15px" : "16px",
            letterSpacing: "0.08em",
          }}
        >
          ATLAS
        </span>
      </div>

      {/* ── Center: conversation title (hidden on home / mobile) ── */}
      <div className="flex-1 flex items-center justify-center min-w-0">
        {!isMobile && centerText && (
          <h1
            className="truncate font-medium"
            style={{ color: "#1f2937", fontSize: "15px", maxWidth: "60%" }}
          >
            {centerText}
          </h1>
        )}
      </div>

      {/* ── Right: Actions ── */}
      <div className="flex items-center gap-0.5 flex-shrink-0">
        {/* 📎 File clip — opens file panel */}
        <button
          className="w-9 h-9 rounded-full flex items-center justify-center transition-all relative"
          style={{ color: filePanelOpen ? "#4f6ef7" : "#6b7280" }}
          onClick={() => setFilePanelOpen(!filePanelOpen)}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.04)"; (e.currentTarget as HTMLElement).style.color = "#1f2937"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = filePanelOpen ? "#4f6ef7" : "#6b7280"; }}
          title="文件"
        >
          <Paperclip size={16} />
          {/* Count badge */}
          {fileCount > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 flex items-center justify-center rounded-full"
              style={{
                background: "#4f6ef7",
                color: "#ffffff",
                fontSize: "10px",
                fontWeight: 600,
                width: 16,
                height: 16,
                lineHeight: 1,
              }}
            >
              {fileCount > 9 ? "9+" : fileCount}
            </span>
          )}
        </button>

        {/* ⋮ More menu — only in conversation, not on mobile */}
        {!isMobile && isInConversation && (
          <MoreMenu onRename={handleRename} onDelete={handleDelete} />
        )}

        {/* User avatar / Login */}
        <UserMenu user={user} setActiveNav={setActiveNav} setShowLoginModal={setShowLoginModal} />
      </div>
    </header>
  );
}
