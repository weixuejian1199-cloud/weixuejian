/**
 * ATLAS V3.0 — Sidebar (Gemini-style, strict spec compliance)
 *
 * Layout (expanded 200px):
 *   Top row: ☰ toggle + 🔍 search icon
 *   ✏️ New Chat button
 *   ── Function modules ──
 *   "聊天" section label → grouped history list
 *   Bottom: 🎁 分享好礼 + ⚙️ 设置
 *
 * Layout (collapsed 48px):
 *   ☰ → ✏️ → (spacer) → 🎁 → ⚙️
 *
 * Background: #e8ecf1 (slightly darker than main #f0f4f9 for hierarchy)
 * Active conversation: left blue bar + light bg
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Settings, X,
  PanelLeftClose, PanelLeftOpen,
  Gift, MoreHorizontal, Search,
  Share2, Trash2, Pencil, Copy, Check,
  FileText, BarChart3, Users, FolderOpen,
} from "lucide-react";
import { useAtlas } from "@/contexts/AtlasContext";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

/* ── Constants ── */
const SIDEBAR_BG = "#e8ecf4"; // matches --atlas-sidebar-bg
const SIDEBAR_EXPANDED = 200;
const SIDEBAR_COLLAPSED = 48;

/* ── Function module definitions ── */
const FUNCTION_MODULES = [
  { id: "templates", icon: FileText, label: "模板库", available: true, action: "template" },
  { id: "hr", icon: Users, label: "HR 中心", available: true, action: "hr" },
  { id: "datahub", icon: BarChart3, label: "数据中枢", available: false },
  { id: "files", icon: FolderOpen, label: "文件", available: false },
] as const;

export default function Sidebar() {
  const {
    activeNav, setActiveNav,
    sidebarOpen, setSidebarOpen,
    activeTaskId, setActiveTaskId,
    tasks,
    user, setShowLoginModal,
    createNewTask, deleteTask, renameTask,
  } = useAtlas();

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [taskMenuOpen, setTaskMenuOpen] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 600);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Share overlay state
  const [showShareOverlay, setShowShareOverlay] = useState(false);
  const [copied, setCopied] = useState(false);

  // Module section collapsed state
  const [modulesCollapsed, setModulesCollapsed] = useState(false);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 600);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  // ── Double-click rename state ──
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  // Responsive: auto-collapse on mobile (<600px), auto-expand on desktop
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 600) { setSidebarOpen(false); setIsMobile(true); }
      else if (window.innerWidth < 768) { setSidebarOpen(false); setIsMobile(false); }
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

  // Focus rename input
  useEffect(() => {
    if (editingTaskId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingTaskId]);

  // Focus search input
  useEffect(() => {
    if (searchOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [searchOpen]);

  const filteredTasks = tasks.filter(t => {
    // 过滤掉无操作的空任务（非当前活跃任务、标题为默认、无消息、无文件）
    const isEmpty = t.title === "新建任务" &&
      (!t.messages || t.messages.length === 0) &&
      (!t.uploadedFiles || t.uploadedFiles.length === 0);
    if (isEmpty && t.id !== activeTaskId) return false;
    return !searchQuery || t.title.toLowerCase().includes(searchQuery.toLowerCase());
  });

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
        onError: () => { /* silent */ }
      });
    }
  };

  const startRename = useCallback((taskId: string, currentTitle: string) => {
    setEditingTaskId(taskId);
    setEditingTitle(currentTitle);
  }, []);

  const commitRename = useCallback(() => {
    if (!editingTaskId) return;
    const trimmed = editingTitle.trim();
    if (trimmed) renameTask(editingTaskId, trimmed);
    setEditingTaskId(null);
    setEditingTitle("");
  }, [editingTaskId, editingTitle, renameTask]);

  const cancelRename = useCallback(() => {
    setEditingTaskId(null);
    setEditingTitle("");
  }, []);

  // Share link copy
  const handleCopyShareLink = useCallback(() => {
    const link = `${window.location.origin}?ref=${user?.id || "atlas"}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      toast.success("邀请链接已复制到剪贴板");
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      toast.error("复制失败，请手动复制");
    });
  }, [user]);

  // Handle function module click
  const handleModuleClick = useCallback((mod: typeof FUNCTION_MODULES[number]) => {
    if (!mod.available) {
      toast.info(`${mod.label} 即将上线，敬请期待`);
      return;
    }
    // For available modules, send a message to the chat
    if (mod.action === "template") {
      createNewTask();
      setActiveNav("home");
      // Will be handled by MainWorkspace to auto-send template message
      toast.info("请在对话框中选择模板");
    } else if (mod.action === "hr") {
      createNewTask();
      setActiveNav("home");
      toast.info("请在对话框中选择 HR 功能");
    }
    if (isMobile) setSidebarOpen(false);
  }, [createNewTask, setActiveNav, isMobile, setSidebarOpen]);

  const collapsed = !sidebarOpen;

  // Group tasks by time period
  const groupTasks = (taskList: typeof filteredTasks) => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86400000);
    const weekAgo = new Date(today.getTime() - 7 * 86400000);

    const groups: { label: string; tasks: typeof filteredTasks }[] = [];
    const todayTasks = taskList.filter(t => new Date(t.created_at) >= today);
    const yesterdayTasks = taskList.filter(t => {
      const d = new Date(t.created_at);
      return d >= yesterday && d < today;
    });
    const weekTasks = taskList.filter(t => {
      const d = new Date(t.created_at);
      return d >= weekAgo && d < yesterday;
    });
    const olderTasks = taskList.filter(t => new Date(t.created_at) < weekAgo);

    if (todayTasks.length) groups.push({ label: "今天", tasks: todayTasks });
    if (yesterdayTasks.length) groups.push({ label: "昨天", tasks: yesterdayTasks });
    if (weekTasks.length) groups.push({ label: "过去 7 天", tasks: weekTasks });
    if (olderTasks.length) groups.push({ label: "更早", tasks: olderTasks });

    return groups;
  };

  const taskGroups = groupTasks(filteredTasks);

  /* ── Reusable icon button ── */
  const IconBtn = ({ onClick, title, children, active, className }: {
    onClick: () => void; title: string; children: React.ReactNode; active?: boolean; className?: string;
  }) => (
    <button
      onClick={onClick}
      className={`w-9 h-9 rounded-full flex items-center justify-center transition-all flex-shrink-0 ${className || ""}`}
      style={{ color: active ? "#4f6ef7" : "#5f6368" }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.06)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
      title={title}
    >
      {children}
    </button>
  );

  return (
    <>
      {/* Mobile overlay backdrop */}
      <AnimatePresence>
        {sidebarOpen && isMobile && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-30"
            style={{ background: "rgba(0,0,0,0.4)" }}
            onClick={() => setSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      <motion.aside
        animate={{ width: collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED }}
        transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
        className={`flex flex-col flex-shrink-0 overflow-hidden relative h-full ${isMobile && sidebarOpen ? "fixed left-0 top-0 z-40" : "z-40"}`}
        style={{
          background: SIDEBAR_BG,
          minHeight: 0,
          borderRight: "1px solid rgba(0,0,0,0.06)",
          ...(isMobile && sidebarOpen ? { height: "100vh" } : {}),
        }}
      >
        {/* ═══ Top: ☰ Toggle (left) + 🔍 Search (right) ═══ */}
        <div className="flex items-center flex-shrink-0 px-1.5 pt-2.5 pb-1" style={{ gap: 2 }}>
          <IconBtn
            onClick={() => setSidebarOpen(!sidebarOpen)}
            title={collapsed ? "展开侧栏" : "收起侧栏"}
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </IconBtn>

          {/* Spacer to push search to right */}
          {!collapsed && <div className="flex-1" />}

          {/* 🔍 Search icon — expanded only, right side */}
          {!collapsed && (
            <IconBtn
              onClick={() => { setSearchOpen(!searchOpen); if (searchOpen) setSearchQuery(""); }}
              title="搜索对话"
              active={searchOpen}
            >
              <Search size={18} />
            </IconBtn>
          )}
        </div>

        {/* Inline search bar (slides in) */}
        <AnimatePresence>
          {searchOpen && !collapsed && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="px-2 overflow-hidden flex-shrink-0"
            >
              <div
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg mb-1"
                style={{ background: "rgba(0,0,0,0.06)" }}
              >
                <Search size={14} style={{ color: "#9ca3af", flexShrink: 0 }} />
                <input
                  ref={searchInputRef}
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="搜索对话..."
                  className="flex-1 bg-transparent outline-none"
                  style={{ color: "#1f2937", fontSize: "13px" }}
                />
                {searchQuery && (
                  <button onClick={() => { setSearchQuery(""); setSearchOpen(false); }} style={{ color: "#9ca3af" }}>
                    <X size={12} />
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ═══ ✏️ New Chat ═══ */}
        {!collapsed ? (
          <div className="px-2 pt-1 pb-1 flex-shrink-0">
            <button
              onClick={handleNewTask}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-all"
              style={{ color: "#1f2937", fontSize: "14px", fontWeight: 500 }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.06)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            >
              <Pencil size={16} style={{ color: "#5f6368" }} />
              <span>新建对话</span>
            </button>
          </div>
        ) : (
          /* Collapsed: ☰ already rendered, now ✏️ */
          <div className="flex flex-col items-center pt-1 gap-0.5 flex-shrink-0">
            <IconBtn onClick={() => { setSidebarOpen(true); setSearchOpen(true); }} title="搜索">
              <Search size={18} />
            </IconBtn>
            <IconBtn onClick={handleNewTask} title="新建对话">
              <Pencil size={18} />
            </IconBtn>
          </div>
        )}

        {/* ═══ Function Modules (expanded only) ═══ */}
        {!collapsed && (
          <div className="px-2 pt-1 pb-1 flex-shrink-0">
            <button
              onClick={() => setModulesCollapsed(!modulesCollapsed)}
              className="flex items-center gap-1 px-1 py-0.5 w-full"
            >
              <span style={{ color: "#80868b", fontSize: "11px", fontWeight: 600, letterSpacing: "0.02em" }}>
                功能
              </span>
              <svg
                width="10" height="10" viewBox="0 0 10 10"
                style={{
                  color: "#80868b",
                  transform: modulesCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
                  transition: "transform 150ms ease",
                }}
              >
                <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
              </svg>
            </button>

            <AnimatePresence>
              {!modulesCollapsed && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="overflow-hidden"
                >
                  {FUNCTION_MODULES.map(mod => {
                    const Icon = mod.icon;
                    return (
                      <button
                        key={mod.id}
                        onClick={() => handleModuleClick(mod)}
                        className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg transition-all"
                        style={{
                          color: mod.available ? "#3c4043" : "#9ca3af",
                          fontSize: "13px",
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.04)"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                      >
                        <Icon size={15} style={{ flexShrink: 0 }} />
                        <span className="truncate flex-1 text-left">{mod.label}</span>
                        {!mod.available && (
                          <span
                            className="flex-shrink-0 px-1.5 py-0.5 rounded-full"
                            style={{
                              fontSize: "10px",
                              background: "rgba(0,0,0,0.06)",
                              color: "#9ca3af",
                              lineHeight: 1.2,
                            }}
                          >
                            即将上线
                          </span>
                        )}
                      </button>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* ═══ History List (expanded only) ═══ */}
        {!collapsed && (
          <div className="flex-1 overflow-hidden flex flex-col min-h-0 pt-1">
            <div className="px-3 py-1 flex-shrink-0">
              <span style={{ color: "#80868b", fontSize: "12px", fontWeight: 600, letterSpacing: "0.02em" }}>
                聊天
              </span>
            </div>

            <div className="flex-1 overflow-y-auto px-1.5 pb-2 min-h-0" style={{ scrollbarWidth: "thin" }}>
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
                  <div key={group.label} className="mb-2">
                    <div className="px-2 py-1">
                      <span style={{ color: "#80868b", fontSize: "11px", fontWeight: 500 }}>
                        {group.label}
                      </span>
                    </div>

                    {group.tasks.map(task => {
                      const isActive = activeTaskId === task.id;
                      const menuOpen = taskMenuOpen === task.id;
                      const isEditing = editingTaskId === task.id;

                      return (
                        <div
                          key={task.id}
                          className="group relative rounded-lg transition-all mb-0.5"
                          style={{
                            background: isActive ? "rgba(79,110,247,0.1)" : "transparent",
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
                          {/* Active indicator: left blue bar */}
                          {isActive && (
                            <div
                              className="absolute left-0 top-1/2 -translate-y-1/2 rounded-r"
                              style={{ width: 3, height: "60%", background: "#4f6ef7" }}
                            />
                          )}

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
                                style={{ color: "#1f2937", borderColor: "#4f6ef7", fontSize: "13px", paddingBottom: "2px" }}
                              />
                            </div>
                          ) : (
                            <button
                              onClick={() => { setActiveTaskId(task.id); setActiveNav("home"); if (isMobile) setSidebarOpen(false); }}
                              onDoubleClick={e => { e.preventDefault(); startRename(task.id, task.title); }}
                              className="w-full text-left px-2.5 py-1.5"
                            >
                              <p
                                className="truncate"
                                style={{
                                  color: isActive ? "#4f6ef7" : "#3c4043",
                                  fontSize: "13px",
                                  fontWeight: isActive ? 500 : 400,
                                  lineHeight: 1.4,
                                }}
                              >
                                {task.title}
                              </p>
                            </button>
                          )}

                          {/* Hover: ⋮ more */}
                          {!isEditing && (
                            <div
                              className="absolute right-1 top-1/2 -translate-y-1/2 transition-opacity"
                              style={{ opacity: menuOpen ? 1 : 0 }}
                              data-action-bar
                            >
                              <div className="relative">
                                <button
                                  onClick={e => { e.stopPropagation(); setTaskMenuOpen(menuOpen ? null : task.id); }}
                                  className="w-7 h-7 rounded-full flex items-center justify-center transition-all"
                                  style={{ color: "#5f6368", background: menuOpen ? "rgba(0,0,0,0.08)" : "transparent" }}
                                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.08)"; }}
                                  onMouseLeave={e => { if (!menuOpen) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                                >
                                  <MoreHorizontal size={14} />
                                </button>

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
                                        boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                                      }}
                                      onClick={e => e.stopPropagation()}
                                    >
                                      {[
                                        { icon: Pencil, label: "重命名", action: () => startRename(task.id, task.title), danger: false },
                                        { icon: Share2, label: "分享", action: () => { navigator.clipboard.writeText(`${window.location.origin}?task=${task.id}`); toast.success("对话链接已复制"); }, danger: false },
                                        { icon: Trash2, label: "删除", action: () => handleDeleteTask(task.id, task.backendSessionId), danger: true },
                                      ].map(({ icon: Icon, label, action, danger }) => (
                                        <button
                                          key={label}
                                          onClick={() => { action(); setTaskMenuOpen(null); }}
                                          className="w-full flex items-center gap-2.5 px-3 py-2 transition-all"
                                          style={{ color: danger ? "#ef4444" : "#3c4043", fontSize: "13px" }}
                                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.04)"; }}
                                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
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

        {/* Collapsed: spacer to push bottom icons down */}
        {collapsed && <div className="flex-1" />}

        {/* ═══ Bottom: 🎁 Share + ⚙️ Settings ═══ */}
        <div className="flex-shrink-0 px-1.5 pb-3 pt-1 flex flex-col gap-0.5">
          {/* --- Expanded bottom --- */}
          {!collapsed && (
            <>
              <button
                onClick={() => setShowShareOverlay(true)}
                className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg transition-all"
                style={{ color: "#5f6368", fontSize: "13px" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.06)"; (e.currentTarget as HTMLElement).style.color = "#3c4043"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#5f6368"; }}
              >
                <Gift size={16} />
                <span>分享好礼</span>
              </button>

              <button
                onClick={() => setActiveNav("settings")}
                className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg transition-all"
                style={{
                  color: activeNav === "settings" ? "#4f6ef7" : "#5f6368",
                  fontSize: "13px",
                  background: activeNav === "settings" ? "rgba(79,110,247,0.1)" : "transparent",
                }}
                onMouseEnter={e => { if (activeNav !== "settings") { (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.06)"; (e.currentTarget as HTMLElement).style.color = "#3c4043"; } }}
                onMouseLeave={e => { if (activeNav !== "settings") { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#5f6368"; } }}
              >
                <Settings size={16} />
                <span>设置</span>
              </button>
            </>
          )}

          {/* --- Collapsed bottom --- */}
          {collapsed && (
            <div className="flex flex-col items-center gap-1">
              <IconBtn onClick={() => setShowShareOverlay(true)} title="分享好礼">
                <Gift size={16} />
              </IconBtn>
              <IconBtn onClick={() => { setSidebarOpen(true); setActiveNav("settings"); }} title="设置" active={activeNav === "settings"}>
                <Settings size={16} />
              </IconBtn>
            </div>
          )}

          {/* User info removed — shown in TopBar only */}
        </div>
      </motion.aside>

      {/* ═══ Share Overlay ═══ */}
      <AnimatePresence>
        {showShareOverlay && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.5)" }}
            onClick={e => { if (e.target === e.currentTarget) setShowShareOverlay(false); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ duration: 0.2 }}
              className="rounded-2xl overflow-hidden"
              style={{
                background: "#ffffff",
                width: "min(420px, 90vw)",
                boxShadow: "0 16px 48px rgba(0,0,0,0.15)",
              }}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid #f3f4f6" }}>
                <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#1f2937" }}>与好友分享 ATLAS</h2>
                <button
                  onClick={() => setShowShareOverlay(false)}
                  className="w-8 h-8 rounded-full flex items-center justify-center transition-all"
                  style={{ color: "#6b7280" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.06)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                >
                  <X size={16} />
                </button>
              </div>

              {/* Body */}
              <div className="px-5 py-5 space-y-4">
                <p style={{ color: "#6b7280", fontSize: "14px", lineHeight: 1.6 }}>
                  邀请好友使用 ATLAS，一起提升数据处理效率。复制下方链接发送给好友即可。
                </p>

                {/* Invite link */}
                <div
                  className="flex items-center gap-2 px-3 py-2.5 rounded-xl"
                  style={{ background: "#f9fafb", border: "1px solid #e5e7eb" }}
                >
                  <span className="flex-1 truncate" style={{ color: "#1f2937", fontSize: "13px" }}>
                    {`${window.location.origin}?ref=${user?.id || "atlas"}`}
                  </span>
                  <button
                    onClick={handleCopyShareLink}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all flex-shrink-0"
                    style={{
                      background: copied ? "#10b981" : "#4f6ef7",
                      color: "#ffffff",
                      fontSize: "13px",
                    }}
                  >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {copied ? "已复制" : "复制"}
                  </button>
                </div>

                {/* Reward info */}
                <div
                  className="px-4 py-3 rounded-xl"
                  style={{ background: "#eff2fe" }}
                >
                  <p style={{ color: "#4f6ef7", fontSize: "13px", fontWeight: 500 }}>
                    🎁 邀请奖励
                  </p>
                  <p style={{ color: "#6b7280", fontSize: "12px", marginTop: 4, lineHeight: 1.5 }}>
                    每成功邀请一位好友注册，双方均可获得额外使用额度。
                  </p>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
