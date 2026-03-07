/**
 * ATLAS V5.0 — Sidebar
 * Design: Manus-style minimal, clean whitespace, no aggressive CTAs
 * Nav order: 新建任务(+) → 工作台 → 数据中枢 → 模板库 → 搜索 → 库
 * Bottom: 主题切换 → 设置 → 用户
 * Responsive: auto-collapse <768px, manual toggle on desktop
 */
import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Home, LayoutDashboard, LayoutTemplate, Settings,
  Search, Plus, Sun, Moon, ChevronRight, X,
  CheckCircle2, Clock, AlertCircle, Archive,
  LogIn, LogOut, Loader2, PanelLeftClose, PanelLeftOpen,
} from "lucide-react";
import { useAtlas, type NavItem } from "@/contexts/AtlasContext";
import { toast } from "sonner";

const NAV_MAIN: { id: NavItem; icon: typeof Home; label: string }[] = [
  { id: "home",      icon: Home,            label: "工作台" },
  { id: "dashboard", icon: LayoutDashboard, label: "数据中枢" },
  { id: "templates", icon: LayoutTemplate,  label: "模板库" },
  { id: "search",    icon: Search,          label: "搜索" },
  { id: "library",   icon: Archive,         label: "库" },
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
    theme, toggleTheme,
    user, setUser, setShowLoginModal,
    clearMessages, clearFiles, addTask,
  } = useAtlas();

  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

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

  const filteredTasks = tasks.filter(t =>
    !searchQuery || t.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleNewTask = () => {
    clearMessages();
    clearFiles();
    setActiveTaskId(null);
    setActiveNav("home");
    if (!sidebarOpen) setSidebarOpen(true);
  };

  const handleLogout = () => {
    setUser(null);
    toast.success("已退出登录");
  };

  const collapsed = !sidebarOpen;

  // Nav item renderer
  const NavButton = ({
    id, icon: Icon, label
  }: { id: NavItem; icon: typeof Home; label: string }) => {
    const active = activeNav === id;
    return (
      <button
        key={id}
        onClick={() => setActiveNav(id)}
        className="w-full flex items-center rounded-lg transition-all duration-150"
        style={{
          gap: collapsed ? 0 : 9,
          padding: collapsed ? "8px 0" : "6px 10px",
          justifyContent: collapsed ? "center" : "flex-start",
          background: active ? "var(--atlas-nav-active-bg)" : "transparent",
          color: active ? "var(--atlas-accent)" : "var(--atlas-text-2)",
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
        title={collapsed ? label : undefined}
      >
        <Icon size={15} style={{ flexShrink: 0, opacity: active ? 1 : 0.7 }} />
        {!collapsed && (
          <span className="text-sm font-medium">{label}</span>
        )}
      </button>
    );
  };

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

        {/* ── New Task (subtle) ── */}
        <div className="px-2 pt-2 pb-1 flex-shrink-0">
          {collapsed ? (
            <button
              onClick={handleNewTask}
              className="w-8 h-8 rounded-lg flex items-center justify-center transition-all mx-auto"
              style={{ color: "var(--atlas-text-3)" }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.background = "var(--atlas-elevated)";
                (e.currentTarget as HTMLElement).style.color = "var(--atlas-accent)";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.background = "transparent";
                (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)";
              }}
              title="新建任务"
            >
              <Plus size={15} />
            </button>
          ) : (
            <button
              onClick={handleNewTask}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all"
              style={{
                background: "var(--atlas-elevated)",
                border: "1px solid var(--atlas-border)",
                color: "var(--atlas-text-2)",
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
              <Plus size={13} />
              <span className="font-medium text-xs">新建任务</span>
            </button>
          )}
        </div>

        {/* ── Nav Items ── */}
        <nav className="px-2 space-y-0.5 flex-shrink-0">
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
                className="text-xs font-medium uppercase tracking-wider"
                style={{ color: "var(--atlas-text-3)", fontSize: "10px", letterSpacing: "0.08em" }}
              >
                所有任务
              </span>
              {tasks.length > 0 && (
                <span
                  className="text-xs px-1.5 py-0.5 rounded"
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

            {/* Search within tasks */}
            {tasks.length > 3 && (
              <div className="px-2 mb-1 flex-shrink-0">
                <div
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md"
                  style={{
                    background: "var(--atlas-elevated)",
                    border: `1px solid ${searchFocused ? "rgba(91,140,255,0.3)" : "var(--atlas-border)"}`,
                  }}
                >
                  <Search size={10} style={{ color: "var(--atlas-text-3)", flexShrink: 0 }} />
                  <input
                    ref={searchRef}
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    onFocus={() => setSearchFocused(true)}
                    onBlur={() => setSearchFocused(false)}
                    placeholder="搜索任务..."
                    className="flex-1 bg-transparent text-xs outline-none"
                    style={{ color: "var(--atlas-text)", fontSize: "11px" }}
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
                  {searchQuery ? (
                    <p className="text-xs text-center" style={{ color: "var(--atlas-text-3)" }}>无匹配任务</p>
                  ) : null}
                </div>
              ) : (
                filteredTasks.map((task, i) => {
                  const cfg = STATUS_CONFIG[task.status] || STATUS_CONFIG.uploaded;
                  const StatusIcon = cfg.icon;
                  const isActive = activeTaskId === task.id;

                  return (
                    <motion.button
                      key={task.id}
                      initial={{ opacity: 0, x: -4 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.025 }}
                      onClick={() => {
                        setActiveTaskId(task.id);
                        setActiveNav("home");
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-all group"
                      style={{
                        background: isActive ? "var(--atlas-nav-active-bg)" : "transparent",
                      }}
                      onMouseEnter={e => {
                        if (!isActive) (e.currentTarget as HTMLElement).style.background = "var(--atlas-nav-hover-bg)";
                      }}
                      onMouseLeave={e => {
                        if (!isActive) (e.currentTarget as HTMLElement).style.background = "transparent";
                      }}
                    >
                      {/* Status dot */}
                      <div
                        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{ background: cfg.color }}
                      />
                      <div className="flex-1 min-w-0">
                        <p
                          className="text-xs font-medium truncate"
                          style={{ color: isActive ? "var(--atlas-accent)" : "var(--atlas-text-2)" }}
                        >
                          {task.title}
                        </p>
                        {(task.row_count || task.col_count) && (
                          <p
                            className="text-xs truncate"
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
                      <ChevronRight
                        size={10}
                        className="flex-shrink-0 opacity-0 group-hover:opacity-50 transition-opacity"
                        style={{ color: "var(--atlas-text-3)" }}
                      />
                    </motion.button>
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

        {/* ── Bottom ── */}
        <div
          className="flex-shrink-0 p-2 space-y-0.5"
          style={{ borderTop: "1px solid var(--atlas-border)" }}
        >
          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="w-full flex items-center rounded-lg transition-all duration-150"
            style={{
              gap: collapsed ? 0 : 9,
              padding: collapsed ? "8px 0" : "6px 10px",
              justifyContent: collapsed ? "center" : "flex-start",
              color: "var(--atlas-text-3)",
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.background = "var(--atlas-nav-hover-bg)";
              (e.currentTarget as HTMLElement).style.color = "var(--atlas-text)";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
              (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)";
            }}
            title={theme === "dark" ? "切换浅色" : "切换深色"}
          >
            {theme === "dark"
              ? <Sun size={14} style={{ flexShrink: 0 }} />
              : <Moon size={14} style={{ flexShrink: 0 }} />
            }
            {!collapsed && (
              <span className="text-sm">{theme === "dark" ? "浅色模式" : "深色模式"}</span>
            )}
          </button>

          {/* Settings */}
          <button
            onClick={() => setActiveNav("settings")}
            className="w-full flex items-center rounded-lg transition-all duration-150"
            style={{
              gap: collapsed ? 0 : 9,
              padding: collapsed ? "8px 0" : "6px 10px",
              justifyContent: collapsed ? "center" : "flex-start",
              background: activeNav === "settings" ? "var(--atlas-nav-active-bg)" : "transparent",
              color: activeNav === "settings" ? "var(--atlas-accent)" : "var(--atlas-text-3)",
            }}
            onMouseEnter={e => {
              if (activeNav !== "settings") {
                (e.currentTarget as HTMLElement).style.background = "var(--atlas-nav-hover-bg)";
                (e.currentTarget as HTMLElement).style.color = "var(--atlas-text)";
              }
            }}
            onMouseLeave={e => {
              if (activeNav !== "settings") {
                (e.currentTarget as HTMLElement).style.background = "transparent";
                (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)";
              }
            }}
            title="设置"
          >
            <Settings size={14} style={{ flexShrink: 0, opacity: 0.8 }} />
            {!collapsed && <span className="text-sm">设置</span>}
          </button>

          {/* User */}
          {!collapsed && (
            <div className="pt-0.5">
              {user ? (
                <div
                  className="flex items-center gap-2 px-2.5 py-2 rounded-lg"
                  style={{ background: "var(--atlas-elevated)", border: "1px solid var(--atlas-border)" }}
                >
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                    style={{ background: "linear-gradient(135deg, #5B8CFF 0%, #7B5FFF 100%)", color: "#fff" }}
                  >
                    {user.name[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate" style={{ color: "var(--atlas-text)" }}>{user.name}</p>
                    <p className="text-xs truncate" style={{ color: "var(--atlas-text-3)" }}>
                      {user.plan === "free" ? "免费版" : user.plan === "pro" ? "专业版" : "企业版"}
                    </p>
                  </div>
                  <button
                    onClick={handleLogout}
                    title="退出登录"
                    style={{ color: "var(--atlas-text-3)" }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-danger)"}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)"}
                  >
                    <LogOut size={13} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowLoginModal(true)}
                  className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg transition-all"
                  style={{
                    background: "var(--atlas-elevated)",
                    border: "1px solid var(--atlas-border)",
                    color: "var(--atlas-text-2)",
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.borderColor = "rgba(91,140,255,0.3)";
                    (e.currentTarget as HTMLElement).style.color = "var(--atlas-accent)";
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.borderColor = "var(--atlas-border)";
                    (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-2)";
                  }}
                >
                  <LogIn size={13} />
                  <span className="text-xs font-medium">登录 / 注册</span>
                </button>
              )}
            </div>
          )}
        </div>
      </motion.aside>
    </>
  );
}
