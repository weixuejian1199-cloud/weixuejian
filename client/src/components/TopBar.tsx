/**
 * ATLAS V16.3 — Top Bar
 * Left: sidebar toggle + ATLAS logo | Center: tagline | Right: ≡ ⓘ ♥ + user avatar
 */
import { useState } from "react";
import { Menu, Info, Heart, ChevronDown, User, LogOut, LogIn, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useAtlas } from "../contexts/AtlasContext";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface TopBarProps {
  navCollapsed: boolean;
  onToggleNav: () => void;
}

export default function TopBar({ navCollapsed, onToggleNav }: TopBarProps) {
  const { setActiveModule, user, setUser, setShowLoginModal } = useAtlas() as any;
  const [heartOpen, setHeartOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

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
      className="flex items-center justify-between flex-shrink-0 px-3"
      style={{
        height: "48px",
        background: "rgba(255,255,255,0.88)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderBottom: "1px solid rgba(74,144,226,0.12)",
        zIndex: 50,
      }}
    >
      {/* Left: sidebar toggle + Logo */}
      <div className="flex items-center gap-2 flex-shrink-0" style={{ width: navCollapsed ? "auto" : "220px" }}>
        {/* 展开按鈕：侧边栏收起时才显示 */}
        {navCollapsed && (
          <button
            onClick={onToggleNav}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-all flex-shrink-0"
            style={{ color: "var(--atlas-text-3)", background: "transparent" }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.background = "rgba(74,144,226,0.08)";
              (e.currentTarget as HTMLElement).style.color = "var(--atlas-accent)";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
              (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)";
            }}
            title="展开侧栏"
          >
            <PanelLeftOpen size={17} />
          </button>
        )}

        {/* Logo：侧边栏收起时才显示（展开时在侧边栏内显示） */}
        {navCollapsed && (
          <div className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{
                background: "linear-gradient(135deg, #4A90E2 0%, #6BA3F5 100%)",
                boxShadow: "0 2px 8px rgba(74,144,226,0.35)",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 1L13 12H1L7 1Z" fill="white" fillOpacity="0.9" />
                <path d="M7 5L10 11H4L7 5Z" fill="white" fillOpacity="0.4" />
              </svg>
            </div>
            <span className="font-bold text-[15px] tracking-wide" style={{ color: "var(--atlas-text)" }}>
              ATLAS
            </span>
          </div>
        )}
      </div>

      {/* Center: Tagline */}
      <div className="flex-1 flex items-center justify-center">
        <span
          className="text-[14px] select-none font-medium"
          style={{ color: "var(--atlas-text-2)", letterSpacing: "0.02em" }}
        >
          <span style={{ color: "var(--atlas-accent)", fontWeight: 700 }}>ATLAS</span>
          <span style={{ color: "var(--atlas-text-4)", margin: "0 6px" }}>|</span>
          <span style={{ color: "var(--atlas-text-2)" }}>一个模块，一种心智。</span>
        </span>
      </div>

      {/* Right: Icons + User */}
      <div className="flex items-center gap-1 flex-shrink-0" style={{ width: "220px", justifyContent: "flex-end" }}>
        {/* ⓘ Info */}
        <button
          onClick={() => toast.info("功能即将上线")}
          className="w-8 h-8 rounded-lg flex items-center justify-center transition-all"
          style={{ color: "var(--atlas-text-3)", background: "transparent" }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.background = "rgba(74,144,226,0.08)";
            (e.currentTarget as HTMLElement).style.color = "var(--atlas-accent)";
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.background = "transparent";
            (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)";
          }}
          title="帮助"
        >
          <Info size={17} />
        </button>

        {/* ♥ Favorite with dropdown */}
        <div className="relative">
          <button
            onClick={() => setHeartOpen(v => !v)}
            className="flex items-center gap-0.5 px-2 h-8 rounded-lg transition-all"
            style={{ color: "var(--atlas-text-3)", background: "transparent" }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.background = "rgba(74,144,226,0.08)";
              (e.currentTarget as HTMLElement).style.color = "var(--atlas-accent)";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
              (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)";
            }}
            title="收藏"
          >
            <Heart size={17} />
            <ChevronDown size={12} />
          </button>

          {heartOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setHeartOpen(false)} />
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
                <button
                  onClick={() => { toast.success("已收藏当前对话"); setHeartOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[13px] transition-colors"
                  style={{ color: "var(--atlas-text-2)" }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "rgba(74,144,226,0.06)"}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}
                >
                  <Heart size={13} />
                  收藏当前对话
                </button>
                <button
                  onClick={() => { toast.info("功能即将上线"); setHeartOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[13px] transition-colors"
                  style={{ color: "var(--atlas-text-2)" }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "rgba(74,144,226,0.06)"}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}
                >
                  <Heart size={13} />
                  查看收藏列表
                </button>
              </div>
            </>
          )}
        </div>

        {/* Divider */}
        <div className="w-px h-5 mx-1" style={{ background: "rgba(74,144,226,0.15)" }} />

        {/* User avatar / Login button */}
        {user ? (
          <div className="relative">
            <button
              onClick={() => setUserMenuOpen(v => !v)}
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
            {userMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
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
                    onClick={() => { setActiveModule("settings"); setUserMenuOpen(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-[13px] transition-colors"
                    style={{ color: "var(--atlas-text-2)" }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "rgba(74,144,226,0.06)"}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}
                  >
                    <User size={13} />
                    账号设置
                  </button>
                  <button
                    onClick={() => { logoutMutation.mutate(); setUserMenuOpen(false); }}
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
            onClick={() => setShowLoginModal(true)}
            className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-[13px] font-medium transition-all"
            style={{
              background: "linear-gradient(135deg, #4A90E2 0%, #6BA3F5 100%)",
              color: "white",
              boxShadow: "0 2px 8px rgba(74,144,226,0.3)",
            }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = "0.9"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = "1"}
          >
            <LogIn size={14} />
            登录
          </button>
        )}
      </div>
    </div>
  );
}
