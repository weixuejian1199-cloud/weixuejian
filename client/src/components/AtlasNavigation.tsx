/**
 * ATLAS V16 — Left Navigation
 * 220px width, light blue-gray theme
 * 字体调大参考设计稿，AI引擎分组，底部分享好礼卡片
 */
import React, { useState } from "react";
import { useAtlas, ActiveModule, Task } from "../contexts/AtlasContext";
import {
  MessageSquare, FolderOpen, Wrench, Zap, BookOpen,
  Settings, Gift, Plus, ChevronDown, ChevronRight,
  Bot, Trash2, LogOut, User, LogIn, FileText, PanelLeftClose
} from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

// ── Module config ─────────────────────────────────────────────────────────────

interface ModuleItem {
  id: ActiveModule;
  label: string;
  icon: React.ReactNode;
}

const MODULES: ModuleItem[] = [
  { id: "chat",       label: "对话",      icon: <MessageSquare size={18} /> },
  { id: "files",      label: "文件",      icon: <FolderOpen size={18} /> },
  { id: "ai-tools",   label: "AI 工具",   icon: <Wrench size={18} /> },
  { id: "automation", label: "AI 自动化", icon: <Zap size={18} /> },
];

// AI引擎快捷任务
const AI_ENGINE_TASKS = [
  { id: "store-export",  label: "门店导出",   icon: <FileText size={14} /> },
  { id: "march-collect", label: "3月即存集",  icon: <FileText size={14} /> },
  { id: "cq-extract",    label: "重庆劝拨江", icon: <FileText size={14} /> },
];

// ── NavLogo ───────────────────────────────────────────────────────────────────

function NavLogo({ user, onLogout, onLogin }: {
  user: any;
  onLogout: () => void;
  onLogin: () => void;
}) {
  const [showMenu, setShowMenu] = useState(false);

  return (
    <div
      className="flex items-center justify-between px-4 flex-shrink-0"
      style={{ height: "48px", borderBottom: "1px solid var(--atlas-border)" }}
    >
      {/* Logo */}
      <div className="flex items-center gap-2.5">
        <div
          className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{
            background: "linear-gradient(135deg, #4A90E2 0%, #6BA3F5 100%)",
            boxShadow: "0 2px 8px rgba(74,144,226,0.3)",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 14 14" fill="none">
            <path d="M7 1L13 12H1L7 1Z" fill="white" fillOpacity="0.9" />
            <path d="M7 5L10 11H4L7 5Z" fill="white" fillOpacity="0.4" />
          </svg>
        </div>
        <span className="font-bold text-[15px] tracking-wide" style={{ color: "var(--atlas-text)" }}>
          ATLAS
        </span>
      </div>

      {/* User area */}
      {user ? (
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="w-8 h-8 rounded-full flex items-center justify-center overflow-hidden transition-all"
            style={{
              border: "2px solid rgba(74,144,226,0.3)",
              background: "rgba(74,144,226,0.1)",
            }}
            title={user.name}
          >
            {user.avatar ? (
              <img src={user.avatar} alt={user.name} className="w-full h-full object-cover" />
            ) : (
              <User size={14} style={{ color: "var(--atlas-accent)" }} />
            )}
          </button>
          {showMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
              <div
                className="absolute right-0 top-10 z-50 py-1 w-44 animate-atlas-fade-in"
                style={{
                  background: "rgba(255,255,255,0.96)",
                  backdropFilter: "blur(16px)",
                  border: "1px solid rgba(74,144,226,0.15)",
                  borderRadius: "10px",
                  boxShadow: "0 8px 24px rgba(74,144,226,0.15)",
                }}
              >
                <div className="px-3 py-2.5" style={{ borderBottom: "1px solid var(--atlas-border)" }}>
                  <p className="text-[13px] font-medium truncate" style={{ color: "var(--atlas-text)" }}>{user.name}</p>
                  <p className="text-[11px] truncate mt-0.5" style={{ color: "var(--atlas-text-3)" }}>{user.email || "未设置邮箱"}</p>
                </div>
                <button
                  onClick={() => { onLogout(); setShowMenu(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[13px] transition-colors"
                  style={{ color: "var(--atlas-text-2)" }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "rgba(74,144,226,0.06)"}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}
                >
                  <LogOut size={13} />
                  退出登录
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <button
          onClick={onLogin}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-medium transition-all"
          style={{
            color: "var(--atlas-accent)",
            border: "1px solid rgba(74,144,226,0.3)",
            background: "rgba(74,144,226,0.06)",
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.background = "var(--atlas-accent)";
            (e.currentTarget as HTMLElement).style.color = "#fff";
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.background = "rgba(74,144,226,0.06)";
            (e.currentTarget as HTMLElement).style.color = "var(--atlas-accent)";
          }}
        >
          <LogIn size={12} />
          登录
        </button>
      )}
    </div>
  );
}

// ── ModuleNav ─────────────────────────────────────────────────────────────────

function ModuleNav({
  activeModule,
  setActiveModule,
}: {
  activeModule: ActiveModule;
  setActiveModule: (m: ActiveModule) => void;
}) {
  const [chatExpanded, setChatExpanded] = useState(true);

  return (
    <div className="px-3 pt-3 pb-1">
      {MODULES.map(mod => {
        const isActive = activeModule === mod.id;
        const isChat = mod.id === "chat";

        return (
          <div key={mod.id}>
            <button
              onClick={() => {
                setActiveModule(mod.id);
                if (isChat) setChatExpanded(v => !v);
              }}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[15px] transition-all duration-150 group mb-0.5",
                isActive
                  ? "font-semibold"
                  : "font-normal"
              )}
              style={isActive ? {
                background: "linear-gradient(135deg, #4A90E2 0%, #6BA3F5 100%)",
                color: "#fff",
                boxShadow: "0 2px 8px rgba(74,144,226,0.3)",
              } : {
                color: "var(--atlas-text-2)",
                background: "transparent",
              }}
              onMouseEnter={e => {
                if (!isActive) {
                  (e.currentTarget as HTMLElement).style.background = "rgba(74,144,226,0.08)";
                  (e.currentTarget as HTMLElement).style.color = "var(--atlas-accent)";
                }
              }}
              onMouseLeave={e => {
                if (!isActive) {
                  (e.currentTarget as HTMLElement).style.background = "transparent";
                  (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-2)";
                }
              }}
            >
              <span className="flex-shrink-0">{mod.icon}</span>
              <span className="flex-1 text-left">{mod.label}</span>
              {isChat && (
                <span style={{ opacity: 0.7 }}>
                  {chatExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </span>
              )}
            </button>


          </div>
        );
      })}
    </div>
  );
}

function ChatSubItem({
  label,
  isActive,
  onClick,
  hasArrow,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
  hasArrow?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-[14px] transition-colors"
      style={isActive ? {
        background: "rgba(74,144,226,0.1)",
        color: "var(--atlas-accent)",
      } : {
        color: "var(--atlas-text-3)",
      }}
      onMouseEnter={e => {
        if (!isActive) {
          (e.currentTarget as HTMLElement).style.background = "rgba(74,144,226,0.06)";
          (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-2)";
        }
      }}
      onMouseLeave={e => {
        if (!isActive) {
          (e.currentTarget as HTMLElement).style.background = "transparent";
          (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)";
        }
      }}
    >
      <Bot size={13} className="flex-shrink-0" />
      <span className="flex-1 text-left truncate">{label}</span>
      {hasArrow && <ChevronRight size={12} style={{ opacity: 0.5 }} />}
    </button>
  );
}

// ── AI Engine Section ─────────────────────────────────────────────────────────

function AIEngineSection({ onTaskClick }: { onTaskClick: (label: string) => void }) {
  return (
    <div className="px-3 pb-2">
      <div className="px-3 mb-2 mt-1">
        <span
          className="text-[11px] font-semibold uppercase tracking-widest"
          style={{ color: "var(--atlas-text-4)" }}
        >
          AI 引擎
        </span>
      </div>
      {AI_ENGINE_TASKS.map(task => (
        <button
          key={task.id}
          onClick={() => onTaskClick(task.label)}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-[14px] transition-all mb-0.5"
          style={{ color: "var(--atlas-text-3)", background: "transparent" }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.background = "rgba(74,144,226,0.06)";
            (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-2)";
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.background = "transparent";
            (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)";
          }}
        >
          <span className="flex-shrink-0" style={{ color: "var(--atlas-text-4)" }}>{task.icon}</span>
          <span className="flex-1 text-left truncate">{task.label}</span>
        </button>
      ))}
    </div>
  );
}

// ── Recent Chats ──────────────────────────────────────────────────────────────

function RecentChats({
  tasks,
  activeTaskId,
  setActiveTaskId,
  createNewTask,
  deleteTask,
}: {
  tasks: Task[];
  activeTaskId: string | null;
  setActiveTaskId: (id: string | null) => void;
  createNewTask: () => string;
  deleteTask: (id: string) => void;
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const recentTasks = tasks.slice(0, 20);

  return (
    <div className="flex-1 overflow-y-auto px-3 py-2 min-h-0">
      <div className="flex items-center justify-between px-2 mb-2">
        <span
          className="text-[12px] font-semibold uppercase tracking-widest"
          style={{ color: "var(--atlas-text-4)" }}
        >
          最近对话
        </span>
        <button
          onClick={() => createNewTask()}
          className="w-5 h-5 rounded-md flex items-center justify-center transition-colors"
          style={{ color: "var(--atlas-text-4)" }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.background = "rgba(74,144,226,0.1)";
            (e.currentTarget as HTMLElement).style.color = "var(--atlas-accent)";
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.background = "transparent";
            (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-4)";
          }}
          title="新建对话"
        >
          <Plus size={12} />
        </button>
      </div>

      {recentTasks.length === 0 ? (
        <div className="px-2 py-4 text-center">
          <p className="text-[12px]" style={{ color: "var(--atlas-text-4)" }}>暂无对话记录</p>
        </div>
      ) : (
        <div className="space-y-0.5">
          {recentTasks.map(task => (
            <div
              key={task.id}
              className="relative group"
              onMouseEnter={() => setHoveredId(task.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              <button
                onClick={() => setActiveTaskId(task.id)}
                className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-[13.5px] transition-colors text-left"
                style={activeTaskId === task.id ? {
                  background: "rgba(74,144,226,0.1)",
                  color: "var(--atlas-text)",
                } : {
                  color: "var(--atlas-text-3)",
                }}
                onMouseEnter={e => {
                  if (activeTaskId !== task.id) {
                    (e.currentTarget as HTMLElement).style.background = "rgba(74,144,226,0.06)";
                    (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-2)";
                  }
                }}
                onMouseLeave={e => {
                  if (activeTaskId !== task.id) {
                    (e.currentTarget as HTMLElement).style.background = "transparent";
                    (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)";
                  }
                }}
              >
                <MessageSquare size={12} className="flex-shrink-0" style={{ color: "var(--atlas-text-4)" }} />
                <span className="flex-1 truncate">{task.title || "未命名对话"}</span>
              </button>
              {hoveredId === task.id && (
                <button
                  onClick={e => { e.stopPropagation(); deleteTask(task.id); }}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded flex items-center justify-center transition-colors"
                  style={{ color: "var(--atlas-text-4)" }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.color = "#DC2626";
                    (e.currentTarget as HTMLElement).style.background = "rgba(220,38,38,0.08)";
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-4)";
                    (e.currentTarget as HTMLElement).style.background = "transparent";
                  }}
                >
                  <Trash2 size={11} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── NavBottom ─────────────────────────────────────────────────────────────────

function NavBottom({ setActiveModule }: { setActiveModule: (m: ActiveModule) => void }) {
  return (
    <div className="flex-shrink-0 px-3 pb-3 space-y-1" style={{ borderTop: "1px solid var(--atlas-border)", paddingTop: "12px" }}>
      {/* 分享好礼卡片 */}
      <button
        onClick={() => setActiveModule("invite" as any)}
        className="w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-all text-left"
        style={{
          background: "rgba(255,255,255,0.7)",
          backdropFilter: "blur(8px)",
          border: "1px solid rgba(74,144,226,0.15)",
          boxShadow: "0 2px 8px rgba(74,144,226,0.08)",
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.9)";
          (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 16px rgba(74,144,226,0.15)";
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.7)";
          (e.currentTarget as HTMLElement).style.boxShadow = "0 2px 8px rgba(74,144,226,0.08)";
        }}
      >
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: "linear-gradient(135deg, #FF6B9D 0%, #FF8E53 100%)" }}
        >
          <Gift size={13} color="white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-medium truncate" style={{ color: "var(--atlas-text)" }}>与好友分享 ATLAS</p>
          <p className="text-[11px]" style={{ color: "var(--atlas-text-3)" }}>各得 500 积分</p>
        </div>
        <ChevronRight size={14} style={{ color: "var(--atlas-text-4)", flexShrink: 0 }} />
      </button>

      {/* 设置 + 知识库（图标按钮） */}
      <div className="flex gap-1 pt-1">
        <button
          onClick={() => setActiveModule("settings")}
          className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg text-[14px] transition-all"
          style={{ color: "var(--atlas-text-3)" }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.background = "rgba(74,144,226,0.08)";
            (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-2)";
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.background = "transparent";
            (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)";
          }}
          title="设置"
        >
          <Settings size={16} />
          <span>设置</span>
        </button>
        <button
          onClick={() => setActiveModule("knowledge" as any)}
          className="w-9 h-9 flex items-center justify-center rounded-lg transition-all flex-shrink-0"
          style={{ color: "var(--atlas-text-3)" }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.background = "rgba(74,144,226,0.08)";
            (e.currentTarget as HTMLElement).style.color = "var(--atlas-accent)";
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.background = "transparent";
            (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)";
          }}
          title="知识库"
        >
          <BookOpen size={16} />
        </button>
      </div>
    </div>
  );
}

// ── Main Navigation ─────────────────────────────────────────────────────────────────────────────────

export default function AtlasNavigation({ onCollapse }: { onCollapse?: () => void }) {
  const {
    activeModule, setActiveModule,
    user, setUser,
    tasks, activeTaskId, setActiveTaskId, createNewTask, deleteTask,
    setShowLoginModal,
  } = useAtlas();

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      setUser(null);
      toast.success("已退出登录");
    },
    onError: () => {
      toast.error("退出失败，请重试");
    },
  });

  const handleTaskClick = (label: string) => {
    setActiveModule("chat");
    toast.info(`已选择：${label}`);
  };

  return (
    <div
      className="flex flex-col h-full select-none"
      style={{
        width: "var(--atlas-nav-w)",
        minWidth: "var(--atlas-nav-w)",
        background: "var(--atlas-surface)",
        borderRight: "1px solid var(--atlas-border)",
      }}
    >
      {/* Top: Logo + Collapse button */}
      <div
        className="flex items-center justify-between px-3 flex-shrink-0"
        style={{ height: "48px", borderBottom: "1px solid var(--atlas-border)" }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{
              background: "linear-gradient(135deg, #4A90E2 0%, #6BA3F5 100%)",
              boxShadow: "0 2px 8px rgba(74,144,226,0.3)",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 1L13 12H1L7 1Z" fill="white" fillOpacity="0.9" />
              <path d="M7 5L10 11H4L7 5Z" fill="white" fillOpacity="0.4" />
            </svg>
          </div>
          <span className="font-bold text-[15px] tracking-wide" style={{ color: "var(--atlas-text)" }}>ATLAS</span>
        </div>
        {onCollapse && (
          <button
            onClick={onCollapse}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
            style={{ color: "var(--atlas-text-4)", background: "transparent" }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.background = "rgba(74,144,226,0.08)";
              (e.currentTarget as HTMLElement).style.color = "var(--atlas-accent)";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
              (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-4)";
            }}
            title="收起侧栏"
          >
            <PanelLeftClose size={15} />
          </button>
        )}
      </div>

      {/* Module navigation */}
      <div className="flex-shrink-0">
        <ModuleNav activeModule={activeModule} setActiveModule={setActiveModule} />
      </div>

      {/* Divider */}
      <div className="mx-4 my-1" style={{ borderTop: "1px solid var(--atlas-border)" }} />

      {/* Recent chats */}
      <RecentChats
        tasks={tasks}
        activeTaskId={activeTaskId}
        setActiveTaskId={id => {
          setActiveTaskId(id);
          setActiveModule("chat");
        }}
        createNewTask={() => {
          const id = createNewTask();
          setActiveModule("chat");
          return id;
        }}
        deleteTask={deleteTask}
      />

      {/* Bottom */}
      <NavBottom setActiveModule={setActiveModule} />
    </div>
  );
}
