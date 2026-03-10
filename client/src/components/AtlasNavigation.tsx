/**
 * ATLAS V15.0 — Left Navigation
 * 20% width, fixed sidebar with module switching
 */
import React, { useState } from "react";
import { useAtlas, ActiveModule, Task } from "../contexts/AtlasContext";
import {
  MessageSquare, FolderOpen, Wrench, Zap, BookOpen,
  Settings, Gift, Plus, ChevronDown, ChevronRight,
  Bot, MoreHorizontal, Trash2, Edit2, LogOut, User
} from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

// ── Module config ────────────────────────────────────────────────────────────

interface ModuleItem {
  id: ActiveModule;
  label: string;
  icon: React.ReactNode;
}

const MODULES: ModuleItem[] = [
  { id: "chat",       label: "对话",     icon: <MessageSquare size={16} /> },
  { id: "files",      label: "文件",     icon: <FolderOpen size={16} /> },
  { id: "ai-tools",   label: "AI 工具",  icon: <Wrench size={16} /> },
  { id: "automation", label: "AI 自动化", icon: <Zap size={16} /> },
  { id: "knowledge",  label: "知识库",   icon: <BookOpen size={16} /> },
];

// ── Sub-components ───────────────────────────────────────────────────────────

function NavLogo({ user, onLogout }: { user: any; onLogout: () => void }) {
  const [showMenu, setShowMenu] = useState(false);

  return (
    <div className="flex items-center justify-between px-4 h-14 border-b border-[var(--atlas-border)] flex-shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-[var(--atlas-accent)] flex items-center justify-center flex-shrink-0">
          <span className="text-white font-bold text-xs">A</span>
        </div>
        <span className="font-semibold text-[13px] text-[var(--atlas-text)] tracking-wide">ATLAS</span>
      </div>

      {/* User avatar */}
      {user && (
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="w-7 h-7 rounded-full bg-[var(--atlas-surface-2)] border border-[var(--atlas-border)] flex items-center justify-center hover:bg-[var(--atlas-surface)] transition-colors overflow-hidden"
          >
            {user.avatar ? (
              <img src={user.avatar} alt={user.name} className="w-full h-full object-cover" />
            ) : (
              <User size={13} className="text-[var(--atlas-text-3)]" />
            )}
          </button>
          {showMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
              <div className="absolute right-0 top-9 z-50 bg-[var(--atlas-elevated)] border border-[var(--atlas-border)] rounded-lg shadow-lg py-1 w-44 animate-atlas-fade-in">
                <div className="px-3 py-2 border-b border-[var(--atlas-border)]">
                  <p className="text-[12px] font-medium text-[var(--atlas-text)] truncate">{user.name}</p>
                  <p className="text-[11px] text-[var(--atlas-text-3)] truncate">{user.email}</p>
                </div>
                <button
                  onClick={() => { onLogout(); setShowMenu(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-[var(--atlas-text-2)] hover:bg-[var(--atlas-surface)] transition-colors"
                >
                  <LogOut size={13} />
                  退出登录
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ModuleNav({ activeModule, setActiveModule }: { activeModule: ActiveModule; setActiveModule: (m: ActiveModule) => void }) {
  const [chatExpanded, setChatExpanded] = useState(true);

  return (
    <div className="px-2 pt-2">
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
                "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-all duration-150 group",
                isActive
                  ? "bg-[var(--atlas-accent-light)] text-[var(--atlas-accent)] font-medium"
                  : "text-[var(--atlas-text-2)] hover:bg-[var(--atlas-surface)] hover:text-[var(--atlas-text)]"
              )}
            >
              <span className={cn("flex-shrink-0", isActive ? "text-[var(--atlas-accent)]" : "text-[var(--atlas-text-3)] group-hover:text-[var(--atlas-text-2)]")}>
                {mod.icon}
              </span>
              <span className="flex-1 text-left">{mod.label}</span>
              {isChat && (
                <span className="text-[var(--atlas-text-4)]">
                  {chatExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </span>
              )}
            </button>

            {/* Chat sub-items */}
            {isChat && chatExpanded && (
              <div className="ml-4 mt-0.5 mb-1 border-l border-[var(--atlas-border)] pl-3 space-y-0.5">
                <ChatSubItem label="ATLAS" isDefault isActive={isActive} onClick={() => setActiveModule("chat")} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ChatSubItem({ label, isDefault, isActive, onClick }: { label: string; isDefault?: boolean; isActive: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[12px] transition-colors",
        isActive
          ? "bg-[var(--atlas-accent-light)] text-[var(--atlas-accent)]"
          : "text-[var(--atlas-text-3)] hover:bg-[var(--atlas-surface)] hover:text-[var(--atlas-text-2)]"
      )}
    >
      <Bot size={12} className="flex-shrink-0" />
      <span className="flex-1 text-left truncate">{label}</span>
      {isDefault && (
        <span className="text-[10px] text-[var(--atlas-text-4)] bg-[var(--atlas-surface-2)] px-1.5 py-0.5 rounded">默认</span>
      )}
    </button>
  );
}

function RecentChats({ tasks, activeTaskId, setActiveTaskId, createNewTask, deleteTask }: {
  tasks: Task[];
  activeTaskId: string | null;
  setActiveTaskId: (id: string | null) => void;
  createNewTask: () => string;
  deleteTask: (id: string) => void;
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const recentTasks = tasks.slice(0, 20);

  return (
    <div className="flex-1 overflow-y-auto px-2 py-2 min-h-0">
      {/* Section header */}
      <div className="flex items-center justify-between px-2 mb-1.5">
        <span className="text-[11px] font-medium text-[var(--atlas-text-4)] uppercase tracking-wider">最近对话</span>
        <button
          onClick={() => createNewTask()}
          className="w-5 h-5 rounded flex items-center justify-center text-[var(--atlas-text-4)] hover:text-[var(--atlas-accent)] hover:bg-[var(--atlas-accent-light)] transition-colors"
          title="新建对话"
        >
          <Plus size={12} />
        </button>
      </div>

      {recentTasks.length === 0 ? (
        <div className="px-2 py-4 text-center">
          <p className="text-[11px] text-[var(--atlas-text-4)]">暂无对话记录</p>
          <p className="text-[11px] text-[var(--atlas-text-4)] mt-0.5">上传文件开始分析</p>
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
                className={cn(
                  "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[12px] transition-colors text-left",
                  activeTaskId === task.id
                    ? "bg-[var(--atlas-surface-2)] text-[var(--atlas-text)]"
                    : "text-[var(--atlas-text-3)] hover:bg-[var(--atlas-surface)] hover:text-[var(--atlas-text-2)]"
                )}
              >
                <MessageSquare size={11} className="flex-shrink-0 text-[var(--atlas-text-4)]" />
                <span className="flex-1 truncate">{task.title || "未命名对话"}</span>
              </button>
              {hoveredId === task.id && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteTask(task.id);
                  }}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded flex items-center justify-center text-[var(--atlas-text-4)] hover:text-[var(--atlas-danger)] hover:bg-[var(--atlas-danger-bg)] transition-colors"
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

function NavBottom({ setActiveModule }: { setActiveModule: (m: ActiveModule) => void }) {
  return (
    <div className="flex-shrink-0 border-t border-[var(--atlas-border)] px-2 py-2 space-y-0.5">
      <button
        onClick={() => toast.info("分享好礼功能即将上线")}
        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] text-[var(--atlas-text-2)] hover:bg-[var(--atlas-surface)] hover:text-[var(--atlas-text)] transition-colors"
      >
        <Gift size={15} className="text-[var(--atlas-text-3)]" />
        分享好礼
      </button>
      <button
        onClick={() => setActiveModule("settings")}
        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] text-[var(--atlas-text-2)] hover:bg-[var(--atlas-surface)] hover:text-[var(--atlas-text)] transition-colors"
      >
        <Settings size={15} className="text-[var(--atlas-text-3)]" />
        设置
      </button>
    </div>
  );
}

// ── Main Navigation ──────────────────────────────────────────────────────────

export default function AtlasNavigation() {
  const {
    activeModule, setActiveModule,
    user, setUser,
    tasks, activeTaskId, setActiveTaskId, createNewTask, deleteTask,
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

  return (
    <div
      className="flex flex-col h-full bg-[var(--atlas-surface)] border-r border-[var(--atlas-border)] select-none"
      style={{ width: "var(--atlas-nav-w)", minWidth: "var(--atlas-nav-w)" }}
    >
      {/* Logo + User */}
      <NavLogo user={user} onLogout={() => logoutMutation.mutate()} />

      {/* Module navigation — top 50% */}
      <div className="flex-shrink-0 py-1">
        <ModuleNav activeModule={activeModule} setActiveModule={setActiveModule} />
      </div>

      {/* Divider */}
      <div className="mx-4 border-t border-[var(--atlas-border)]" />

      {/* Recent chats — bottom 50% (scrollable) */}
      <RecentChats
        tasks={tasks}
        activeTaskId={activeTaskId}
        setActiveTaskId={(id) => {
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

      {/* Bottom actions */}
      <NavBottom setActiveModule={setActiveModule} />
    </div>
  );
}
