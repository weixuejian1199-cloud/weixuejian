/**
 * ATLAS V4.0 — Sidebar
 * Manus-style: collapsible, task list, search, theme toggle
 * Responsive: auto-collapse on mobile (<768px)
 */
import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Home, LayoutDashboard, LayoutTemplate, Settings,
  Search, Plus, Sun, Moon, ChevronRight, X,
  FileSpreadsheet, CheckCircle2, Clock, AlertCircle,
  LogIn, LogOut, User, Loader2, PanelLeftClose, PanelLeftOpen,
} from "lucide-react";
import { useAtlas, type NavItem } from "@/contexts/AtlasContext";
import { toast } from "sonner";

const NAV_ITEMS: { id: NavItem; icon: typeof Home; label: string }[] = [
  { id: "home",      icon: Home,            label: "工作台" },
  { id: "dashboard", icon: LayoutDashboard, label: "数据中枢" },
  { id: "templates", icon: LayoutTemplate,  label: "模板库" },
];

const STATUS_ICON = {
  uploaded:   { icon: Clock,         color: "#5B8CFF" },
  processing: { icon: Loader2,       color: "#FBBF24" },
  completed:  { icon: CheckCircle2,  color: "#34D399" },
  failed:     { icon: AlertCircle,   color: "#F87171" },
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

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // Responsive: auto-collapse on mobile
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        setSidebarOpen(false);
      } else {
        setSidebarOpen(true);
      }
    };
    // Set initial state
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [setSidebarOpen]);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  const filteredTasks = tasks.filter(t =>
    !searchQuery || t.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleNewTask = () => {
    clearMessages();
    clearFiles();
    setActiveTaskId(null);
    setActiveNav("home");
    toast.success("已新建工作区");
  };

  const handleLogout = () => {
    setUser(null);
    toast.success("已退出登录");
  };

  // Collapsed icon-only sidebar
  const collapsed = !sidebarOpen;

  return (
    <>
      {/* Mobile overlay */}
      <AnimatePresence>
        {sidebarOpen && window.innerWidth < 768 && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-30 md:hidden"
            style={{ background: "rgba(0,0,0,0.5)" }}
            onClick={() => setSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      <aside
        className="atlas-sidebar flex flex-col flex-shrink-0 overflow-hidden relative z-40"
        style={{
          width: collapsed ? 52 : "var(--atlas-sidebar-w)",
          background: "var(--atlas-surface)",
          borderRight: "1px solid var(--atlas-border)",
        }}
      >
        {/* ── Top: Logo + Toggle ── */}
        <div
          className="flex items-center flex-shrink-0 px-2"
          style={{
            height: "var(--atlas-topbar-h)",
            borderBottom: "1px solid var(--atlas-border)",
          }}
        >
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="flex items-center gap-2 flex-1 px-1"
            >
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
            </motion.div>
          )}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-all flex-shrink-0"
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
            {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          </button>
        </div>

        {/* ── Search ── */}
        <div className="px-2 py-2 flex-shrink-0">
          {collapsed ? (
            <button
              onClick={() => { setSidebarOpen(true); setSearchOpen(true); }}
              className="w-8 h-8 rounded-lg flex items-center justify-center transition-all mx-auto"
              style={{ color: "var(--atlas-text-3)" }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.background = "var(--atlas-elevated)";
                (e.currentTarget as HTMLElement).style.color = "var(--atlas-text)";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.background = "transparent";
                (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)";
              }}
              title="搜索"
            >
              <Search size={15} />
            </button>
          ) : searchOpen ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
              style={{ background: "var(--atlas-elevated)", border: "1px solid rgba(91,140,255,0.3)" }}>
              <Search size={12} style={{ color: "var(--atlas-accent)", flexShrink: 0 }} />
              <input
                ref={searchRef}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="搜索任务..."
                className="flex-1 bg-transparent text-xs outline-none"
                style={{ color: "var(--atlas-text)" }}
              />
              <button onClick={() => { setSearchOpen(false); setSearchQuery(""); }}
                style={{ color: "var(--atlas-text-3)" }}>
                <X size={12} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setSearchOpen(true)}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition-all text-left"
              style={{ color: "var(--atlas-text-3)", background: "var(--atlas-elevated)", border: "1px solid var(--atlas-border)" }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-2)"}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)"}
            >
              <Search size={12} />
              <span className="text-xs">搜索...</span>
              <span className="ml-auto text-xs px-1 rounded" style={{ background: "var(--atlas-card)", color: "var(--atlas-text-3)", fontFamily: "monospace", fontSize: "10px" }}>⌘K</span>
            </button>
          )}
        </div>

        {/* ── New Task Button ── */}
        <div className="px-2 pb-2 flex-shrink-0">
          {collapsed ? (
            <button
              onClick={handleNewTask}
              className="w-8 h-8 rounded-lg flex items-center justify-center transition-all mx-auto"
              style={{ background: "var(--atlas-accent)", color: "#fff" }}
              title="新建报表"
            >
              <Plus size={15} />
            </button>
          ) : (
            <button
              onClick={handleNewTask}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all"
              style={{ background: "var(--atlas-accent)", color: "#fff" }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = "0.88"}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = "1"}
            >
              <Plus size={14} />
              新建报表
            </button>
          )}
        </div>

        {/* ── Nav Items ── */}
        <nav className="px-2 space-y-0.5 flex-shrink-0">
          {NAV_ITEMS.map(item => {
            const active = activeNav === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveNav(item.id)}
                className="w-full flex items-center rounded-lg transition-all"
                style={{
                  gap: collapsed ? 0 : 8,
                  padding: collapsed ? "8px 0" : "7px 10px",
                  justifyContent: collapsed ? "center" : "flex-start",
                  background: active ? "rgba(91,140,255,0.1)" : "transparent",
                  color: active ? "var(--atlas-accent)" : "var(--atlas-text-2)",
                  border: active ? "1px solid rgba(91,140,255,0.15)" : "1px solid transparent",
                }}
                onMouseEnter={e => {
                  if (!active) {
                    (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)";
                    (e.currentTarget as HTMLElement).style.color = "var(--atlas-text)";
                  }
                }}
                onMouseLeave={e => {
                  if (!active) {
                    (e.currentTarget as HTMLElement).style.background = "transparent";
                    (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-2)";
                  }
                }}
                title={collapsed ? item.label : undefined}
              >
                <item.icon size={15} style={{ flexShrink: 0, opacity: active ? 1 : 0.75 }} />
                {!collapsed && <span className="text-sm font-medium">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        {/* ── Divider ── */}
        <div className="mx-3 my-2 flex-shrink-0" style={{ height: 1, background: "var(--atlas-border)" }} />

        {/* ── All Tasks Section ── */}
        {!collapsed && (
          <div className="flex-1 overflow-hidden flex flex-col">
            <div className="px-3 mb-1.5 flex items-center justify-between flex-shrink-0">
              <span className="text-xs font-medium uppercase tracking-wider"
                style={{ color: "var(--atlas-text-3)", fontSize: "10px", letterSpacing: "0.08em" }}>
                所有任务
              </span>
              <span className="text-xs px-1.5 py-0.5 rounded"
                style={{ background: "var(--atlas-elevated)", color: "var(--atlas-text-3)", fontFamily: "monospace", fontSize: "10px" }}>
                {tasks.length}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto px-2 space-y-0.5 pb-2">
              {filteredTasks.length === 0 ? (
                <div className="px-2 py-6 text-center">
                  <FileSpreadsheet size={20} className="mx-auto mb-2" style={{ color: "var(--atlas-text-3)" }} />
                  <p className="text-xs" style={{ color: "var(--atlas-text-3)" }}>
                    {searchQuery ? "无匹配任务" : "上传文件开始"}
                  </p>
                </div>
              ) : (
                filteredTasks.map((task, i) => {
                  const statusInfo = STATUS_ICON[task.status] || STATUS_ICON.uploaded;
                  const StatusIcon = statusInfo.icon;
                  const isActive = activeTaskId === task.id;

                  return (
                    <motion.button
                      key={task.id}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.03 }}
                      onClick={() => {
                        setActiveTaskId(task.id);
                        setActiveNav("home");
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-all group"
                      style={{
                        background: isActive ? "rgba(91,140,255,0.08)" : "transparent",
                        border: isActive ? "1px solid rgba(91,140,255,0.12)" : "1px solid transparent",
                      }}
                      onMouseEnter={e => {
                        if (!isActive) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)";
                      }}
                      onMouseLeave={e => {
                        if (!isActive) (e.currentTarget as HTMLElement).style.background = "transparent";
                      }}
                    >
                      <StatusIcon
                        size={12}
                        className={task.status === "processing" ? "animate-spin" : ""}
                        style={{ color: statusInfo.color, flexShrink: 0 }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate"
                          style={{ color: isActive ? "var(--atlas-accent)" : "var(--atlas-text-2)" }}>
                          {task.title}
                        </p>
                        <p className="text-xs truncate"
                          style={{ color: "var(--atlas-text-3)", fontFamily: "'JetBrains Mono', monospace", fontSize: "10px" }}>
                          {task.row_count ? `${task.row_count.toLocaleString()} 行` : ""}
                          {task.row_count && task.col_count ? " · " : ""}
                          {task.col_count ? `${task.col_count} 列` : ""}
                        </p>
                      </div>
                      <ChevronRight size={10} className="flex-shrink-0 opacity-0 group-hover:opacity-60 transition-opacity"
                        style={{ color: "var(--atlas-text-3)" }} />
                    </motion.button>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Collapsed: just show task count dot */}
        {collapsed && tasks.length > 0 && (
          <div className="flex-1 flex flex-col items-center pt-2 gap-1">
            {tasks.slice(0, 5).map(task => {
              const statusInfo = STATUS_ICON[task.status] || STATUS_ICON.uploaded;
              return (
                <div key={task.id} className="w-1.5 h-1.5 rounded-full"
                  style={{ background: statusInfo.color }} />
              );
            })}
          </div>
        )}

        {/* ── Bottom Actions ── */}
        <div
          className="flex-shrink-0 p-2 space-y-0.5"
          style={{ borderTop: "1px solid var(--atlas-border)" }}
        >
          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="w-full flex items-center rounded-lg transition-all"
            style={{
              gap: collapsed ? 0 : 8,
              padding: collapsed ? "8px 0" : "7px 10px",
              justifyContent: collapsed ? "center" : "flex-start",
              color: "var(--atlas-text-3)",
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)";
              (e.currentTarget as HTMLElement).style.color = "var(--atlas-text)";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
              (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)";
            }}
            title="切换主题"
          >
            {theme === "dark"
              ? <Sun size={15} style={{ flexShrink: 0 }} />
              : <Moon size={15} style={{ flexShrink: 0 }} />
            }
            {!collapsed && (
              <span className="text-sm">{theme === "dark" ? "浅色模式" : "深色模式"}</span>
            )}
          </button>

          {/* Settings */}
          <button
            onClick={() => setActiveNav("settings")}
            className="w-full flex items-center rounded-lg transition-all"
            style={{
              gap: collapsed ? 0 : 8,
              padding: collapsed ? "8px 0" : "7px 10px",
              justifyContent: collapsed ? "center" : "flex-start",
              background: activeNav === "settings" ? "rgba(91,140,255,0.1)" : "transparent",
              color: activeNav === "settings" ? "var(--atlas-accent)" : "var(--atlas-text-3)",
              border: activeNav === "settings" ? "1px solid rgba(91,140,255,0.15)" : "1px solid transparent",
            }}
            onMouseEnter={e => {
              if (activeNav !== "settings") {
                (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)";
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
            <Settings size={15} style={{ flexShrink: 0, opacity: 0.8 }} />
            {!collapsed && <span className="text-sm">设置</span>}
          </button>

          {/* User / Login */}
          {!collapsed && (
            <div className="pt-1">
              {user ? (
                <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg"
                  style={{ background: "var(--atlas-elevated)", border: "1px solid var(--atlas-border)" }}>
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                    style={{ background: "linear-gradient(135deg, #5B8CFF 0%, #7B5FFF 100%)", color: "#fff" }}>
                    {user.name[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate" style={{ color: "var(--atlas-text)" }}>{user.name}</p>
                    <p className="text-xs truncate" style={{ color: "var(--atlas-text-3)" }}>{user.plan === "free" ? "免费版" : "专业版"}</p>
                  </div>
                  <button onClick={handleLogout} title="退出登录"
                    style={{ color: "var(--atlas-text-3)" }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-danger)"}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)"}>
                    <LogOut size={13} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowLoginModal(true)}
                  className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg transition-all"
                  style={{ background: "var(--atlas-elevated)", border: "1px solid var(--atlas-border)", color: "var(--atlas-text-2)" }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.borderColor = "rgba(91,140,255,0.3)";
                    (e.currentTarget as HTMLElement).style.color = "var(--atlas-accent)";
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.borderColor = "var(--atlas-border)";
                    (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-2)";
                  }}
                >
                  <LogIn size={14} />
                  <span className="text-xs font-medium">登录 / 注册</span>
                </button>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
