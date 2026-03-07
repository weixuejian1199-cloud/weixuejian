/**
 * ATLAS V3.0 — Left Sidebar
 * Style: Manus-inspired dark minimal sidebar
 * - Logo section at top (handled by TopBar)
 * - Nav items: Home, Reports, Templates, History
 * - Recent files section (dynamic)
 * - Settings at bottom
 */
import { motion } from "framer-motion";
import {
  Home, BarChart2, LayoutTemplate, Clock, Settings,
  FileSpreadsheet, ChevronRight,
} from "lucide-react";
import { useAtlas, type NavItem } from "@/contexts/AtlasContext";

const NAV_ITEMS: {
  id: NavItem;
  icon: typeof Home;
  label: string;
  sublabel?: string;
}[] = [
  { id: "home",      icon: Home,          label: "首页",     sublabel: "工作台" },
  { id: "reports",   icon: BarChart2,      label: "报表中心", sublabel: "Reports" },
  { id: "templates", icon: LayoutTemplate, label: "模板库",   sublabel: "Templates" },
  { id: "history",   icon: Clock,          label: "历史记录", sublabel: "History" },
];

export default function Sidebar() {
  const { activeNav, setActiveNav, history, reports } = useAtlas();

  const badge: Partial<Record<NavItem, number>> = {
    reports: reports.length || undefined,
    history: history.length || undefined,
  };

  return (
    <aside
      className="flex flex-col flex-shrink-0 overflow-hidden"
      style={{
        width: "var(--atlas-sidebar-w)",
        background: "var(--atlas-surface)",
        borderRight: "1px solid var(--atlas-border)",
      }}
    >
      {/* ── Main Nav ── */}
      <nav className="flex-1 overflow-y-auto p-2 pt-3 space-y-0.5">
        {NAV_ITEMS.map((item, idx) => {
          const active = activeNav === item.id;
          const count = badge[item.id];

          return (
            <motion.button
              key={item.id}
              onClick={() => setActiveNav(item.id)}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.04 }}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-all"
              style={{
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
            >
              <item.icon
                size={15}
                style={{ flexShrink: 0, opacity: active ? 1 : 0.7 }}
              />
              <span className="flex-1 text-sm font-medium">{item.label}</span>
              {count != null && count > 0 && (
                <span
                  className="text-xs px-1.5 py-0.5 rounded-md"
                  style={{
                    background: active ? "rgba(91,140,255,0.2)" : "var(--atlas-elevated)",
                    color: active ? "var(--atlas-accent)" : "var(--atlas-text-3)",
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: "10px",
                  }}
                >
                  {count}
                </span>
              )}
            </motion.button>
          );
        })}

        {/* ── Recent Files Section ── */}
        {history.length > 0 && (
          <div className="pt-3">
            <div className="flex items-center justify-between px-2.5 mb-1.5">
              <span
                className="text-xs font-medium uppercase tracking-wider"
                style={{ color: "var(--atlas-text-3)", fontSize: "10px", letterSpacing: "0.08em" }}
              >
                最近文件
              </span>
            </div>
            <div className="space-y-0.5">
              {history.slice(0, 6).map((h, i) => (
                <motion.button
                  key={h.id}
                  onClick={() => setActiveNav("history")}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.03 }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left transition-all group"
                  style={{ color: "var(--atlas-text-3)" }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)";
                    (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-2)";
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.background = "transparent";
                    (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)";
                  }}
                >
                  {/* Status dot */}
                  <div
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{
                      background:
                        h.status === "completed"
                          ? "var(--atlas-success)"
                          : h.status === "uploaded"
                          ? "var(--atlas-accent)"
                          : "var(--atlas-text-3)",
                    }}
                  />
                  <span className="text-xs truncate flex-1">{h.filename}</span>
                  <ChevronRight
                    size={10}
                    className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  />
                </motion.button>
              ))}
            </div>
          </div>
        )}
      </nav>

      {/* ── Bottom Settings ── */}
      <div
        className="p-2"
        style={{ borderTop: "1px solid var(--atlas-border)" }}
      >
        <button
          onClick={() => setActiveNav("settings")}
          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-all"
          style={{
            background: activeNav === "settings" ? "rgba(91,140,255,0.1)" : "transparent",
            color: activeNav === "settings" ? "var(--atlas-accent)" : "var(--atlas-text-3)",
            border: activeNav === "settings" ? "1px solid rgba(91,140,255,0.15)" : "1px solid transparent",
          }}
          onMouseEnter={e => {
            if (activeNav !== "settings") {
              (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)";
              (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-2)";
            }
          }}
          onMouseLeave={e => {
            if (activeNav !== "settings") {
              (e.currentTarget as HTMLElement).style.background = "transparent";
              (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)";
            }
          }}
        >
          <Settings size={15} style={{ opacity: 0.7, flexShrink: 0 }} />
          <span className="text-sm font-medium">设置</span>
        </button>
      </div>
    </aside>
  );
}
