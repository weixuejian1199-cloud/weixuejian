/**
 * ATLAS V16 — Top Bar
 * Left: ATLAS logo | Center: tagline | Right: ≡ ⓘ ♥
 */
import { useState } from "react";
import { Menu, Info, Heart, ChevronDown } from "lucide-react";
import { useAtlas } from "../contexts/AtlasContext";
import { toast } from "sonner";

export default function TopBar() {
  const { setActiveModule } = useAtlas() as any;
  const [heartOpen, setHeartOpen] = useState(false);

  return (
    <div
      className="flex items-center justify-between flex-shrink-0 px-5"
      style={{
        height: "48px",
        background: "rgba(255,255,255,0.88)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderBottom: "1px solid rgba(74,144,226,0.12)",
        zIndex: 50,
      }}
    >
      {/* Left: Logo */}
      <div className="flex items-center gap-2.5 flex-shrink-0" style={{ width: "220px" }}>
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

      {/* Center: Tagline */}
      <div className="flex-1 flex items-center justify-center">
        <span
          className="text-[13px] select-none"
          style={{ color: "var(--atlas-text-3)", letterSpacing: "0.01em" }}
        >
          ATLAS &nbsp;|&nbsp; 一个模块，一种心智。
        </span>
      </div>

      {/* Right: Icons */}
      <div className="flex items-center gap-1 flex-shrink-0" style={{ width: "220px", justifyContent: "flex-end" }}>
        {/* ≡ Menu */}
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
          title="菜单"
        >
          <Menu size={17} />
        </button>

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
      </div>
    </div>
  );
}
