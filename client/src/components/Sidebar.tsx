/**
 * ATLAS V1.0 GA — Sidebar (Gemini-style)
 * Per UI spec: New Chat + History List + Share + Settings
 * No nav items (HR/模板/数据中枢 removed — accessed via quick tags)
 * Width: 200px expanded / 48px collapsed
 */
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Settings, X, LogIn, Loader2,
  PanelLeftClose, PanelLeftOpen,
  Gift, MoreHorizontal,
  Share2, Trash2, Pencil,
} from "lucide-react";
import { useAtlas } from "@/contexts/AtlasContext";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

export default function Sidebar() {
  const {
    activeNav, setActiveNav,
    sidebarOpen, setSidebarOpen,
    activeTaskId, setActiveTaskId,
    tasks,
    user, setShowLoginModal,
    createNewTask, deleteTask, renameTask,
  } = useAtlas();

  const [searchQuery, setSearchQuery] = useState("");
  const [taskMenuOpen, setTaskMenuOpen] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 600);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 600);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  // ── Double-click rename state ─────────────────────────────────────────────
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  // Responsive: auto-collapse on mobile (<600px per spec)
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 600) { setSidebarOpen(false); setIsMobile(true); }
      else { setSidebarOpen(true); setIsMobile(false); }
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [setSidebarOpen]);

  // Close task menu on outside click
  useEffect(() => {
    if (!taskMenuOpen) return;
    const handler = () => setTaskMenuOpen(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [taskMenuOpen]);

  // Focus rename input when editing starts
  useEffect(() => {
    if (editingTaskId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingTaskId]);

  const filteredTasks = tasks.filter(t =>
    !searchQuery || t.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleNewTask = () => {
    createNewTask();
    setActiveNav("home");
    if (isMobile) setSidebarOpen(false);
  };

  const deleteSessionMut = trpc.session.delete.useMutation();

  const handleDeleteTask = (taskId: string, backendSessionId?: string) => {
    deleteTask(taskId);
    toast.success("对话已删除");
    if (backendSessionId) {
      deleteSessionMut.mutate({ id: backendSessionId }, {
        onError: () => { /* silent fail */ }
      });
    }
  };

  // ── Rename handlers ───────────────────────────────────────────────────────
  const startRename = useCallback((taskId: string, currentTitle: string) => {
    setEditingTaskId(taskId);
    setEditingTitle(currentTitle);
  }, []);

  const commitRename = useCallback(() => {
    if (!editingTaskId) return;
    const trimmed = editingTitle.trim();
    if (trimmed) {
      renameTask(editingTaskId, trimmed);
    }
    setEditingTaskId(null);
    setEditingTitle("");
  }, [editingTaskId, editingTitle, renameTask]);

  const cancelRename = useCallback(() => {
    setEditingTaskId(null);
    setEditingTitle("");
  }, []);

  const collapsed = !sidebarOpen;

  // Group tasks by time period
  const groupTasks = (tasks: typeof filteredTasks) => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86400000);
    const weekAgo = new Date(today.getTime() - 7 * 86400000);

    const groups: { label: string; tasks: typeof filteredTasks }[] = [];
    const todayTasks = tasks.filter(t => new Date(t.created_at) >= today);
    const yesterdayTasks = tasks.filter(t => {
      const d = new Date(t.created_at);
      return d >= yesterday && d < today;
    });
    const weekTasks = tasks.filter(t => {
      const d = new Date(t.created_at);
      return d >= weekAgo && d < yesterday;
    });
    const olderTasks = tasks.filter(t => new Date(t.created_at) < weekAgo);

    if (todayTasks.length) groups.push({ label: "今天", tasks: todayTasks });
    if (yesterdayTasks.length) groups.push({ label: "昨天", tasks: yesterdayTasks });
    if (weekTasks.length) groups.push({ label: "过去 7 天", tasks: weekTasks });
    if (olderTasks.length) groups.push({ label: "更早", tasks: olderTasks });

    return groups;
  };

  const taskGroups = groupTasks(filteredTasks);

  return (
    <>
      {/* Mobile overlay backdrop */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-30"
            style={{ background: "rgba(0,0,0,0.4)", display: isMobile ? "block" : "none" }}
            onClick={() => setSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      <motion.aside
        animate={{ width: collapsed ? 48 : 200 }}
        transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
        className="flex flex-col flex-shrink-0 overflow-hidden relative z-40 h-full"
        style={{
          background: "#f0f4f9",
          minHeight: 0,
        }}
      >
        {/* ── Top: Toggle + New Chat ── */}
        <div className="flex items-center flex-shrink-0 px-1.5 pt-2 pb-1" style={{ gap: 4 }}>
          {/* Sidebar toggle */}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="w-9 h-9 rounded-full flex items-center justify-center transition-all flex-shrink-0"
            style={{ color: "#6b7280" }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.04)";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
            }}
            title={collapsed ? "展开侧栏" : "收起侧栏"}
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>

          {/* New Chat button */}
          {!collapsed && (
            <button
              onClick={handleNewTask}
              className="ml-auto w-9 h-9 rounded-full flex items-center justify-center transition-all flex-shrink-0"
              style={{ color: "#6b7280" }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.04)";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.background = "transparent";
              }}
              title="新建对话"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
            </button>
          )}
        </div>

        {/* Collapsed: New Chat icon */}
        {collapsed && (
          <div className="flex flex-col items-center pt-1 flex-shrink-0">
            <button
              onClick={handleNewTask}
              className="w-9 h-9 rounded-full flex items-center justify-center transition-all"
              style={{ color: "#6b7280" }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.04)";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.background = "transparent";
              }}
              title="新建对话"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
            </button>
          </div>
        )}

        {/* ── History List (expanded only) ── */}
        {!collapsed && (
          <div className="flex-1 overflow-hidden flex flex-col min-h-0 pt-2">
            {/* Search (when > 5 conversations) */}
            {tasks.length > 5 && (
              <div className="px-2 mb-2 flex-shrink-0">
                <div
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full"
                  style={{ background: "rgba(0,0,0,0.04)" }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round">
                    <circle cx="11" cy="11" r="8" />
                    <path d="M21 21l-4.35-4.35" />
                  </svg>
                  <input
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="搜索对话..."
                    className="flex-1 bg-transparent outline-none"
                    style={{ color: "#1f2937", fontSize: "13px" }}
                  />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery("")} style={{ color: "#9ca3af" }}>
                      <X size={12} />
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Grouped conversation list */}
            <div className="flex-1 overflow-y-auto px-1.5 pb-2 min-h-0">
              {taskGroups.length === 0 && !searchQuery ? (
                <div className="py-8 px-2 text-center">
                  <p style={{ color: "#9ca3af", fontSize: "13px" }}>暂无对话</p>
                </div>
              ) : taskGroups.length === 0 && searchQuery ? (
                <div className="py-4 px-2 text-center">
                  <p style={{ color: "#9ca3af", fontSize: "12px" }}>无匹配结果</p>
                </div>
              ) : (
                taskGroups.map(group => (
                  <div key={group.label} className="mb-3">
                    {/* Group label */}
                    <div className="px-2 py-1">
                      <span style={{ color: "#6b7280", fontSize: "12px", fontWeight: 500 }}>
                        {group.label}
                      </span>
                    </div>

                    {/* Conversation items */}
                    {group.tasks.map(task => {
                      const isActive = activeTaskId === task.id;
                      const menuOpen = taskMenuOpen === task.id;
                      const isEditing = editingTaskId === task.id;

                      return (
                        <div
                          key={task.id}
                          className="group relative rounded-lg transition-all mb-0.5"
                          style={{
                            background: isActive ? "rgba(79,110,247,0.08)" : "transparent",
                          }}
                          onMouseEnter={e => {
                            if (!isActive) (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.04)";
                            const bar = (e.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-action-bar]");
                            if (bar) bar.style.opacity = "1";
                          }}
                          onMouseLeave={e => {
                            if (!isActive) (e.currentTarget as HTMLElement).style.background = "transparent";
                            const bar = (e.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-action-bar]");
                            if (bar && !menuOpen) bar.style.opacity = "0";
                          }}
                        >
                          {isEditing ? (
                            <div className="px-2 py-1.5">
                              <input
                                ref={editInputRef}
                                value={editingTitle}
                                onChange={e => setEditingTitle(e.target.value)}
                                onBlur={commitRename}
                                onKeyDown={e => {
                                  if (e.key === "Enter") { e.preventDefault(); commitRename(); }
                                  if (e.key === "Escape") { e.preventDefault(); cancelRename(); }
                                }}
                                className="w-full bg-transparent outline-none border-b"
                                style={{
                                  color: "#1f2937",
                                  borderColor: "#4f6ef7",
                                  fontSize: "14px",
                                  paddingBottom: "2px",
                                }}
                              />
                            </div>
                          ) : (
                            <button
                              onClick={() => { setActiveTaskId(task.id); setActiveNav("home"); if (isMobile) setSidebarOpen(false); }}
                              onDoubleClick={e => { e.preventDefault(); startRename(task.id, task.title); }}
                              className="w-full text-left px-2 py-1.5"
                            >
                              <p
                                className="truncate"
                                style={{
                                  color: isActive ? "#1f2937" : "#1f2937",
                                  fontSize: "14px",
                                  fontWeight: isActive ? 500 : 400,
                                  lineHeight: 1.4,
                                }}
                              >
                                {task.title}
                              </p>
                            </button>
                          )}

                          {/* Hover action: ⋮ more menu */}
                          {!isEditing && (
                            <div
                              className="absolute right-1 top-1/2 -translate-y-1/2 transition-opacity"
                              style={{ opacity: menuOpen ? 1 : 0 }}
                              data-action-bar
                            >
                              <div className="relative">
                                <button
                                  onClick={e => {
                                    e.stopPropagation();
                                    setTaskMenuOpen(menuOpen ? null : task.id);
                                  }}
                                  className="w-7 h-7 rounded-full flex items-center justify-center transition-all"
                                  style={{
                                    color: "#6b7280",
                                    background: menuOpen ? "rgba(0,0,0,0.06)" : "transparent",
                                  }}
                                  onMouseEnter={e => {
                                    (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.06)";
                                  }}
                                  onMouseLeave={e => {
                                    if (!menuOpen) (e.currentTarget as HTMLElement).style.background = "transparent";
                                  }}
                                >
                                  <MoreHorizontal size={14} />
                                </button>

                                {/* Dropdown */}
                                <AnimatePresence>
                                  {menuOpen && (
                                    <motion.div
                                      initial={{ opacity: 0, scale: 0.95, y: 4 }}
                                      animate={{ opacity: 1, scale: 1, y: 0 }}
                                      exit={{ opacity: 0, scale: 0.95, y: 4 }}
                                      transition={{ duration: 0.1 }}
                                      className="absolute right-0 top-8 z-50 py-1 rounded-xl min-w-[140px]"
                                      style={{
                                        background: "#ffffff",
                                        border: "1px solid #e5e7eb",
                                        boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                                      }}
                                      onClick={e => e.stopPropagation()}
                                    >
                                      {[
                                        { icon: Pencil, label: "重命名", action: () => startRename(task.id, task.title), danger: false },
                                        { icon: Share2, label: "分享", action: () => toast.success("链接已复制"), danger: false },
                                        { icon: Trash2, label: "删除", action: () => handleDeleteTask(task.id, task.backendSessionId), danger: true },
                                      ].map(({ icon: Icon, label, action, danger }) => (
                                        <button
                                          key={label}
                                          onClick={() => { action(); setTaskMenuOpen(null); }}
                                          className="w-full flex items-center gap-2.5 px-3 py-2 transition-all"
                                          style={{
                                            color: danger ? "#ef4444" : "#1f2937",
                                            fontSize: "13px",
                                          }}
                                          onMouseEnter={e => {
                                            (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.04)";
                                          }}
                                          onMouseLeave={e => {
                                            (e.currentTarget as HTMLElement).style.background = "transparent";
                                          }}
                                        >
                                          <Icon size={14} />
                                          <span>{label}</span>
                                        </button>
                                      ))}
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* ── Bottom: Share + Settings + User ── */}
        <div className="flex-shrink-0 px-1.5 pb-3 pt-1 flex flex-col gap-0.5">
          {/* Share button (expanded) */}
          {!collapsed && (
            <button
              onClick={() => toast.info("分享功能即将上线")}
              className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg transition-all"
              style={{ color: "#6b7280", fontSize: "14px" }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.04)";
                (e.currentTarget as HTMLElement).style.color = "#1f2937";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.background = "transparent";
                (e.currentTarget as HTMLElement).style.color = "#6b7280";
              }}
            >
              <Gift size={16} />
              <span>分享好礼</span>
            </button>
          )}

          {/* Settings button (expanded) */}
          {!collapsed && (
            <button
              onClick={() => setActiveNav("settings")}
              className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg transition-all"
              style={{
                color: activeNav === "settings" ? "#4f6ef7" : "#6b7280",
                fontSize: "14px",
                background: activeNav === "settings" ? "rgba(79,110,247,0.08)" : "transparent",
              }}
              onMouseEnter={e => {
                if (activeNav !== "settings") {
                  (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.04)";
                  (e.currentTarget as HTMLElement).style.color = "#1f2937";
                }
              }}
              onMouseLeave={e => {
                if (activeNav !== "settings") {
                  (e.currentTarget as HTMLElement).style.background = "transparent";
                  (e.currentTarget as HTMLElement).style.color = "#6b7280";
                }
              }}
            >
              <Settings size={16} />
              <span>设置</span>
            </button>
          )}

          {/* Collapsed: icon-only buttons */}
          {collapsed && (
            <div className="flex flex-col items-center gap-1">
              <button
                onClick={() => toast.info("分享功能即将上线")}
                className="w-9 h-9 rounded-full flex items-center justify-center transition-all"
                style={{ color: "#6b7280" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.04)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                title="分享好礼"
              >
                <Gift size={16} />
              </button>
              <button
                onClick={() => setActiveNav("settings")}
                className="w-9 h-9 rounded-full flex items-center justify-center transition-all"
                style={{ color: activeNav === "settings" ? "#4f6ef7" : "#6b7280" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.04)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                title="设置"
              >
                <Settings size={16} />
              </button>
            </div>
          )}

          {/* User avatar / Login */}
          <div className="flex items-center" style={{ justifyContent: collapsed ? "center" : "flex-start", paddingLeft: collapsed ? 0 : 2 }}>
            {user ? (
              <button
                title={user.name}
                className="flex items-center gap-2.5 rounded-lg transition-all py-1.5 px-1"
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.04)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center font-medium flex-shrink-0"
                  style={{
                    background: "linear-gradient(135deg, #4f6ef7 0%, #7c5bf7 100%)",
                    color: "#fff",
                    fontSize: "12px",
                  }}
                >
                  {user.name[0].toUpperCase()}
                </div>
                {!collapsed && (
                  <span className="truncate" style={{ color: "#1f2937", fontSize: "13px" }}>
                    {user.name}
                  </span>
                )}
              </button>
            ) : (
              <button
                onClick={() => setShowLoginModal(true)}
                title="登录"
                className="flex items-center gap-2.5 rounded-lg transition-all py-1.5 px-1"
                style={{ color: "#6b7280" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.04)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                <LogIn size={16} />
                {!collapsed && <span style={{ fontSize: "13px" }}>登录</span>}
              </button>
            )}
          </div>
        </div>
      </motion.aside>
    </>
  );
}
