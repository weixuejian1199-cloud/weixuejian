/**
 * ATLAS V14.9 — Sidebar
 * Nav: 对话 / 数据中枢 / HR 中心 / 模板库
 * Bottom: 库图标 · 设置 · 用户头像（无退出按钮，退出在顶栏用户菜单）
 * Task list: 双击标题重命名（Enter/blur 保存，Esc 取消）
 * Width: 360px (--atlas-sidebar-w)
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard, LayoutTemplate, Settings,
  ChevronRight, X,
  CheckCircle2, Clock, AlertCircle, Archive,
  LogIn, Loader2, PanelLeftClose, PanelLeftOpen,
  Gift, RefreshCw, Download, Timer, MoreHorizontal,
  Star, Share2, Trash2, Users, MessageSquare,
} from "lucide-react";
import { useAtlas, type NavItem } from "@/contexts/AtlasContext";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

// ── Main nav items (no search / library — those are in topbar / bottom) ──────
const NAV_MAIN: { id: NavItem; icon: typeof LayoutDashboard; label: string }[] = [
  { id: "home",      icon: MessageSquare,   label: "对话" },
  { id: "dashboard", icon: LayoutDashboard, label: "数据中枢" },
  { id: "hr",        icon: Users,           label: "HR 中心" },
  { id: "templates", icon: LayoutTemplate,  label: "模板库" },
];

const STATUS_CONFIG = {
  uploaded:   { icon: Clock,        color: "#5B8CFF", label: "待处理" },
  processing: { icon: Loader2,      color: "#FBBF24", label: "处理中", spin: true },
  completed:  { icon: CheckCircle2, color: "#34D399", label: "已完成" },
  failed:     { icon: AlertCircle,  color: "#F87171", label: "失败" },
};

export default function Sidebar() {
  const {
    activeNav, setActiveNav,
    sidebarOpen, setSidebarOpen,
    activeTaskId, setActiveTaskId,
    tasks,
    user, setShowLoginModal,
    createNewTask, deleteTask,
  } = useAtlas();

  const [searchQuery, setSearchQuery] = useState("");
  const [taskMenuOpen, setTaskMenuOpen] = useState<string | null>(null);

  // ── Double-click rename state ─────────────────────────────────────────────
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  // Responsive: auto-collapse on mobile
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) setSidebarOpen(false);
      else setSidebarOpen(true);
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
    if (!sidebarOpen) setSidebarOpen(true);
  };

  const deleteSessionMut = trpc.session.delete.useMutation();

  const handleDeleteTask = (taskId: string, backendSessionId?: string) => {
    deleteTask(taskId);
    toast.success("任务已删除");
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
      // Update task title in context
      // We use a direct mutation on the tasks array via the context's updateTaskTitle if available,
      // otherwise fall back to a local approach
      const ctx = (window as any).__atlasUpdateTaskTitle;
      if (ctx) ctx(editingTaskId, trimmed);
      else {
        // Fallback: dispatch a custom event that AtlasContext can listen to
        window.dispatchEvent(new CustomEvent("atlas:renameTask", {
          detail: { taskId: editingTaskId, title: trimmed }
        }));
      }
    }
    setEditingTaskId(null);
    setEditingTitle("");
  }, [editingTaskId, editingTitle]);

  const cancelRename = useCallback(() => {
    setEditingTaskId(null);
    setEditingTitle("");
  }, []);

  const collapsed = !sidebarOpen;

  // ── Nav item ─────────────────────────────────────────────────────────────
  const NavButton = ({
    id, icon: Icon, label
  }: { id: NavItem; icon: typeof LayoutDashboard; label: string }) => {
    const active = activeNav === id;
    return (
      <button
        onClick={() => setActiveNav(id)}
        className="w-full flex items-center rounded-lg transition-all duration-150"
        style={{
          gap: collapsed ? 0 : 9,
          padding: collapsed ? "8px 0" : "7px 10px",
          justifyContent: collapsed ? "center" : "flex-start",
          background: active ? "var(--atlas-nav-active-bg)" : "transparent",
          color: active ? "var(--atlas-accent)" : "var(--atlas-text-2)",
          fontSize: "14px",
        }}
        onMouseEnter={e => {
          if (!active) {
            (e.currentTarget as HTMLElement).style.background = "var(--atlas-nav-hover-bg)";
            (e.currentTarget as HTMLElement).style.color = "var(--atlas-text)";
          }
        }}
        onMouseLeave={e => {
          if (!active) {
            (e.currentTarget as HTMLElement).style.background = "transparent";
            (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-2)";
          }
        }}
        title={label}
      >
        <Icon size={16} style={{ flexShrink: 0, opacity: active ? 1 : 0.7 }} />
        {!collapsed && (
          <span className="font-medium" style={{ fontSize: "14px" }}>{label}</span>
        )}
      </button>
    );
  };

  // ── Bottom icon button ────────────────────────────────────────────────────
  const BottomIconBtn = ({
    icon: Icon, label, onClick, active = false,
  }: {
    icon: typeof Settings;
    label: string;
    onClick: () => void;
    active?: boolean;
  }) => (
    <button
      onClick={onClick}
      title={label}
      className="w-8 h-8 rounded-lg flex items-center justify-center transition-all flex-shrink-0"
      style={{
        color: active ? "var(--atlas-accent)" : "var(--atlas-text-3)",
        background: active ? "var(--atlas-nav-active-bg)" : "transparent",
      }}
      onMouseEnter={e => {
        if (!active) {
          (e.currentTarget as HTMLElement).style.background = "var(--atlas-elevated)";
          (e.currentTarget as HTMLElement).style.color = "var(--atlas-text)";
        }
      }}
      onMouseLeave={e => {
        if (!active) {
          (e.currentTarget as HTMLElement).style.background = "transparent";
          (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)";
        }
      }}
    >
      <Icon size={16} />
    </button>
  );

  return (
    <>
      {/* Mobile overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-30 md:hidden"
            style={{ background: "rgba(0,0,0,0.45)" }}
            onClick={() => setSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      <motion.aside
        animate={{ width: collapsed ? 52 : "var(--atlas-sidebar-w)" }}
        transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
        className="flex flex-col flex-shrink-0 overflow-hidden relative z-40"
        style={{
          background: "var(--atlas-surface)",
          borderRight: "1px solid var(--atlas-border)",
          minHeight: 0,
        }}
      >
        {/* ── Logo + Toggle ── */}
        <div
          className="flex items-center flex-shrink-0 px-2"
          style={{ height: "var(--atlas-topbar-h)", borderBottom: "1px solid var(--atlas-border)" }}
        >
          <AnimatePresence>
            {!collapsed && (
              <motion.div
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: "auto" }}
                exit={{ opacity: 0, width: 0 }}
                className="flex items-center gap-2 flex-1 px-1 overflow-hidden"
              >
                <div
                  className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
                  style={{ background: "var(--atlas-accent)" }}
                >
                  <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
                    <path d="M7 1L13 12H1L7 1Z" fill="white" fillOpacity="0.9" />
                  </svg>
                </div>
                <span
                  className="font-bold tracking-widest text-xs uppercase whitespace-nowrap"
                  style={{ color: "var(--atlas-text)", letterSpacing: "0.12em" }}
                >
                  ATLAS
                </span>
              </motion.div>
            )}
          </AnimatePresence>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-all flex-shrink-0 ml-auto"
            style={{ color: "var(--atlas-text-3)" }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.background = "var(--atlas-elevated)";
              (e.currentTarget as HTMLElement).style.color = "var(--atlas-text)";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
              (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)";
            }}
            title={collapsed ? "展开侧栏" : "收起侧栏"}
          >
            {collapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
          </button>
        </div>

        {/* ── Nav Items ── */}
        <nav className="px-2 pt-2 space-y-0.5 flex-shrink-0">
          {NAV_MAIN.map(item => (
            <NavButton key={item.id} {...item} />
          ))}
        </nav>

        {/* ── Divider ── */}
        <div className="mx-3 my-2 flex-shrink-0" style={{ height: 1, background: "var(--atlas-border)" }} />

        {/* ── Task List (expanded only) ── */}
        {!collapsed && (
          <div className="flex-1 overflow-hidden flex flex-col min-h-0">
            {/* Section header */}
            <div className="px-3 mb-1 flex items-center justify-between flex-shrink-0">
              <span
                className="font-medium uppercase tracking-wider"
                style={{ color: "var(--atlas-text-3)", fontSize: "11px", letterSpacing: "0.08em" }}
              >
                所有任务
              </span>
              {tasks.length > 0 && (
                <span
                  className="px-1.5 py-0.5 rounded"
                  style={{
                    background: "var(--atlas-elevated)",
                    color: "var(--atlas-text-3)",
                    fontFamily: "monospace",
                    fontSize: "10px",
                  }}
                >
                  {tasks.length}
                </span>
              )}
            </div>

            {/* New Task button — below "所有任务" title */}
            <div className="px-2 mb-1.5 flex-shrink-0">
              <button
                onClick={handleNewTask}
                className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all"
                style={{
                  background: "var(--atlas-elevated)",
                  border: "1px solid var(--atlas-border)",
                  color: "var(--atlas-text-2)",
                  fontSize: "13px",
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = "rgba(91,140,255,0.35)";
                  (e.currentTarget as HTMLElement).style.color = "var(--atlas-accent)";
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = "var(--atlas-border)";
                  (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-2)";
                }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0 }}>
                  <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <span className="font-medium">新建任务</span>
              </button>
            </div>

            {/* Search within tasks (only when > 3 tasks) */}
            {tasks.length > 3 && (
              <div className="px-2 mb-1 flex-shrink-0">
                <div
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md"
                  style={{ background: "var(--atlas-elevated)", border: "1px solid var(--atlas-border)" }}
                >
                  <svg width="10" height="10" viewBox="0 0 14 14" fill="none" style={{ color: "var(--atlas-text-3)", flexShrink: 0 }}>
                    <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M9.5 9.5L12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  <input
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="搜索任务..."
                    className="flex-1 bg-transparent outline-none"
                    style={{ color: "var(--atlas-text)", fontSize: "12px" }}
                  />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery("")} style={{ color: "var(--atlas-text-3)" }}>
                      <X size={10} />
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Task items */}
            <div className="flex-1 overflow-y-auto px-2 space-y-0.5 pb-2 min-h-0">
              {filteredTasks.length === 0 ? (
                <div className="py-4 px-2">
                  {searchQuery && (
                    <p className="text-center" style={{ color: "var(--atlas-text-3)", fontSize: "12px" }}>无匹配任务</p>
                  )}
                </div>
              ) : (
                filteredTasks.map((task, i) => {
                  const cfg = STATUS_CONFIG[task.status] || STATUS_CONFIG.uploaded;
                  const isActive = activeTaskId === task.id;
                  const menuOpen = taskMenuOpen === task.id;
                  const isEditing = editingTaskId === task.id;

                  return (
                    <motion.div
                      key={task.id}
                      initial={{ opacity: 0, x: -4 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.025 }}
                      className="group relative rounded-lg transition-all"
                      style={{
                        background: isActive ? "var(--atlas-nav-active-bg)" : "transparent",
                        borderLeft: isActive ? "2px solid var(--atlas-accent)" : "2px solid transparent",
                      }}
                      onMouseEnter={e => {
                        if (!isActive) (e.currentTarget as HTMLElement).style.background = "var(--atlas-nav-hover-bg)";
                        const bar = (e.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-action-bar]");
                        if (bar) bar.style.opacity = "1";
                      }}
                      onMouseLeave={e => {
                        if (!isActive) (e.currentTarget as HTMLElement).style.background = "transparent";
                        const bar = (e.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-action-bar]");
                        if (bar && !menuOpen) bar.style.opacity = "0";
                      }}
                    >
                      {/* Rename input (shown when editing) */}
                      {isEditing ? (
                        <div className="px-2.5 py-2">
                          <input
                            ref={editInputRef}
                            value={editingTitle}
                            onChange={e => setEditingTitle(e.target.value)}
                            onBlur={commitRename}
                            onKeyDown={e => {
                              if (e.key === "Enter") { e.preventDefault(); commitRename(); }
                              if (e.key === "Escape") { e.preventDefault(); cancelRename(); }
                            }}
                            className="w-full bg-transparent outline-none border-b font-medium"
                            style={{
                              color: "var(--atlas-text)",
                              borderColor: "var(--atlas-accent)",
                              fontSize: "13px",
                              paddingBottom: "2px",
                            }}
                          />
                        </div>
                      ) : (
                        /* Main click area — double-click to rename */
                        <button
                          onClick={() => { setActiveTaskId(task.id); setActiveNav("home"); }}
                          onDoubleClick={e => { e.preventDefault(); startRename(task.id, task.title); }}
                          className="w-full flex items-center gap-2 px-2.5 py-2 text-left"
                        >
                          {/* Status dot */}
                          <div
                            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                            style={{ background: cfg.color }}
                          />
                          <div className="flex-1 min-w-0">
                            <p
                              className="font-medium truncate"
                              style={{
                                color: isActive ? "var(--atlas-accent)" : "var(--atlas-text-2)",
                                fontSize: "13px",
                              }}
                            >
                              {task.title}
                            </p>
                            {(task.row_count || task.col_count) && (
                              <p
                                className="truncate"
                                style={{
                                  color: "var(--atlas-text-3)",
                                  fontFamily: "'JetBrains Mono', monospace",
                                  fontSize: "10px",
                                }}
                              >
                                {task.row_count ? `${task.row_count.toLocaleString()} 行` : ""}
                                {task.row_count && task.col_count ? " · " : ""}
                                {task.col_count ? `${task.col_count} 列` : ""}
                              </p>
                            )}
                          </div>
                        </button>
                      )}

                      {/* Action buttons — visible on hover or when menu is open */}
                      {!isEditing && (
                        <div
                          className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 transition-opacity"
                          style={{
                            background: "var(--atlas-surface)",
                            borderRadius: 6,
                            padding: "2px",
                            opacity: menuOpen ? 1 : 0,
                          }}
                          data-action-bar
                        >
                          {/* Rerun */}
                          <button
                            onClick={e => { e.stopPropagation(); toast.success("重新运行中..."); }}
                            title="重新运行"
                            className="w-5 h-5 rounded flex items-center justify-center transition-all"
                            style={{ color: "var(--atlas-text-3)" }}
                            onMouseEnter={e => {
                              (e.currentTarget as HTMLElement).style.background = "var(--atlas-elevated)";
                              (e.currentTarget as HTMLElement).style.color = "var(--atlas-accent)";
                            }}
                            onMouseLeave={e => {
                              (e.currentTarget as HTMLElement).style.background = "transparent";
                              (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)";
                            }}
                          >
                            <RefreshCw size={10} />
                          </button>

                          {/* Download */}
                          {task.report_filename && (
                            <button
                              onClick={e => { e.stopPropagation(); toast.success("下载报表..."); }}
                              title="下载报表"
                              className="w-5 h-5 rounded flex items-center justify-center transition-all"
                              style={{ color: "var(--atlas-text-3)" }}
                              onMouseEnter={e => {
                                (e.currentTarget as HTMLElement).style.background = "var(--atlas-elevated)";
                                (e.currentTarget as HTMLElement).style.color = "#34D399";
                              }}
                              onMouseLeave={e => {
                                (e.currentTarget as HTMLElement).style.background = "transparent";
                                (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)";
                              }}
                            >
                              <Download size={10} />
                            </button>
                          )}

                          {/* Schedule */}
                          <button
                            onClick={e => { e.stopPropagation(); toast.info("定时功能即将上线"); }}
                            title="设置定时"
                            className="w-5 h-5 rounded flex items-center justify-center transition-all"
                            style={{ color: "var(--atlas-text-3)" }}
                            onMouseEnter={e => {
                              (e.currentTarget as HTMLElement).style.background = "var(--atlas-elevated)";
                              (e.currentTarget as HTMLElement).style.color = "#FBBF24";
                            }}
                            onMouseLeave={e => {
                              (e.currentTarget as HTMLElement).style.background = "transparent";
                              (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)";
                            }}
                          >
                            <Timer size={10} />
                          </button>

                          {/* More */}
                          <div className="relative">
                            <button
                              onClick={e => {
                                e.stopPropagation();
                                setTaskMenuOpen(menuOpen ? null : task.id);
                              }}
                              title="更多操作"
                              className="w-5 h-5 rounded flex items-center justify-center transition-all"
                              style={{
                                color: menuOpen ? "var(--atlas-text)" : "var(--atlas-text-3)",
                                background: menuOpen ? "var(--atlas-elevated)" : "transparent",
                              }}
                              onMouseEnter={e => {
                                (e.currentTarget as HTMLElement).style.background = "var(--atlas-elevated)";
                                (e.currentTarget as HTMLElement).style.color = "var(--atlas-text)";
                              }}
                              onMouseLeave={e => {
                                if (!menuOpen) {
                                  (e.currentTarget as HTMLElement).style.background = "transparent";
                                  (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)";
                                }
                              }}
                            >
                              <MoreHorizontal size={10} />
                            </button>

                            {/* Dropdown menu */}
                            <AnimatePresence>
                              {menuOpen && (
                                <motion.div
                                  initial={{ opacity: 0, scale: 0.95, y: 4 }}
                                  animate={{ opacity: 1, scale: 1, y: 0 }}
                                  exit={{ opacity: 0, scale: 0.95, y: 4 }}
                                  transition={{ duration: 0.1 }}
                                  className="absolute right-0 top-6 z-50 py-1 rounded-lg shadow-xl min-w-[120px]"
                                  style={{
                                    background: "var(--atlas-elevated)",
                                    border: "1px solid var(--atlas-border)",
                                  }}
                                  onClick={e => e.stopPropagation()}
                                >
                                  {[
                                    { icon: Star,   label: "收藏",   color: "#FBBF24", action: () => toast.success("已收藏"), danger: false },
                                    { icon: Share2, label: "共享链接", color: "var(--atlas-accent)", action: () => toast.success("链接已复制"), danger: false },
                                    { icon: Trash2, label: "删除任务", color: "#F87171", action: () => handleDeleteTask(task.id, task.backendSessionId), danger: true },
                                  ].map(({ icon: Icon, label, color, action, danger }) => (
                                    <button
                                      key={label}
                                      onClick={() => { action(); setTaskMenuOpen(null); }}
                                      className="w-full flex items-center gap-2 px-3 py-1.5 transition-all"
                                      style={{ color: danger ? "#F87171" : "var(--atlas-text-2)", fontSize: "12px" }}
                                      onMouseEnter={e => {
                                        (e.currentTarget as HTMLElement).style.background = "var(--atlas-nav-hover-bg)";
                                        (e.currentTarget as HTMLElement).style.color = color;
                                      }}
                                      onMouseLeave={e => {
                                        (e.currentTarget as HTMLElement).style.background = "transparent";
                                        (e.currentTarget as HTMLElement).style.color = danger ? "#F87171" : "var(--atlas-text-2)";
                                      }}
                                    >
                                      <Icon size={11} />
                                      <span>{label}</span>
                                    </button>
                                  ))}
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        </div>
                      )}
                    </motion.div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Collapsed: task status dots */}
        {collapsed && tasks.length > 0 && (
          <div className="flex-1 flex flex-col items-center pt-2 gap-1.5">
            {tasks.slice(0, 6).map(task => {
              const cfg = STATUS_CONFIG[task.status] || STATUS_CONFIG.uploaded;
              return (
                <button
                  key={task.id}
                  onClick={() => { setActiveTaskId(task.id); setActiveNav("home"); setSidebarOpen(true); }}
                  className="w-1.5 h-1.5 rounded-full transition-transform hover:scale-150"
                  style={{ background: cfg.color }}
                  title={task.title}
                />
              );
            })}
          </div>
        )}

        {/* ── Bottom area ── */}
        <div
          className="flex-shrink-0 px-3 py-3 flex flex-col gap-1"
          style={{ borderTop: "1px solid var(--atlas-border)" }}
        >
          {/* Invite / Share */}
          {!collapsed && (
            <button
              onClick={() => setActiveNav("invite")}
              className="w-full flex items-center rounded-xl transition-all duration-150 mb-1"
              style={{
                gap: 10,
                padding: "8px 10px",
                background: activeNav === "invite" ? "var(--atlas-nav-active-bg)" : "transparent",
                color: activeNav === "invite" ? "var(--atlas-accent)" : "var(--atlas-text-2)",
              }}
              onMouseEnter={e => {
                if (activeNav !== "invite") {
                  (e.currentTarget as HTMLElement).style.background = "var(--atlas-elevated)";
                  (e.currentTarget as HTMLElement).style.color = "var(--atlas-text)";
                }
              }}
              onMouseLeave={e => {
                if (activeNav !== "invite") {
                  (e.currentTarget as HTMLElement).style.background = "transparent";
                  (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-2)";
                }
              }}
              title="与好友分享 ATLAS"
            >
              <div
                className="flex-shrink-0 flex items-center justify-center rounded-lg"
                style={{
                  width: 28, height: 28,
                  background: activeNav === "invite" ? "rgba(91,140,255,0.15)" : "rgba(91,140,255,0.08)",
                }}
              >
                <Gift size={15} style={{ color: activeNav === "invite" ? "var(--atlas-accent)" : "#5B8CFF" }} />
              </div>
              <span className="font-medium truncate" style={{ fontSize: "14px" }}>与好友分享 ATLAS</span>
            </button>
          )}

          {/* Bottom icon row: 库 · 设置 · 用户头像 */}
          <div className="flex items-center" style={{ gap: 6, justifyContent: collapsed ? "center" : "flex-start" }}>
            {/* Library */}
            <BottomIconBtn
              icon={Archive}
              label="库"
              active={activeNav === "library"}
              onClick={() => setActiveNav("library")}
            />

            {/* Settings */}
            <BottomIconBtn
              icon={Settings}
              label="设置"
              active={activeNav === "settings"}
              onClick={() => setActiveNav("settings")}
            />

            {/* User avatar / Login */}
            {user ? (
              <button
                title={user.name}
                className="flex items-center justify-center rounded-xl transition-all flex-shrink-0"
                style={{ width: 32, height: 32 }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.background = "var(--atlas-elevated)";
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.background = "transparent";
                }}
              >
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center font-bold"
                  style={{
                    background: "linear-gradient(135deg, #5B8CFF 0%, #7B5FFF 100%)",
                    color: "#fff",
                    fontSize: "11px",
                  }}
                >
                  {user.name[0].toUpperCase()}
                </div>
              </button>
            ) : (
              <button
                onClick={() => setShowLoginModal(true)}
                title="登录 / 注册"
                className="flex items-center justify-center rounded-xl transition-all flex-shrink-0"
                style={{ width: 32, height: 32, color: "var(--atlas-text-3)" }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.background = "var(--atlas-elevated)";
                  (e.currentTarget as HTMLElement).style.color = "var(--atlas-text)";
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.background = "transparent";
                  (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)";
                }}
              >
                <LogIn size={16} />
              </button>
            )}
          </div>
        </div>
      </motion.aside>
    </>
  );
}
