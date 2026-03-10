/**
 * ATLAS V15.0 — Settings Module
 * Bot management, account settings, API keys
 */
import { useState } from "react";
import { Settings, Bot, Key, User, Shield, Plus, Trash2, Edit2, ChevronRight, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useAtlas } from "@/contexts/AtlasContext";

type SettingsSection = "bots" | "account" | "api" | "security";

const SECTION_CONFIG: Record<SettingsSection, { label: string; icon: React.ReactNode }> = {
  bots: { label: "机器人管理", icon: <Bot size={14} /> },
  account: { label: "账号信息", icon: <User size={14} /> },
  api: { label: "API 密钥", icon: <Key size={14} /> },
  security: { label: "安全设置", icon: <Shield size={14} /> },
};

const MOCK_BOTS = [
  { id: "atlas", name: "ATLAS", description: "行政财务数据分析助手", icon: "⬡", isDefault: true, status: "active" as const },
  { id: "openclaw", name: "OpenClaw", description: "电商运营智能助手", icon: "🦞", isDefault: false, status: "active" as const },
];

export default function SettingsModule() {
  const [activeSection, setActiveSection] = useState<SettingsSection>("bots");
  const { user } = useAtlas();

  return (
    <div className="flex h-full overflow-hidden" style={{ background: "#fff" }}>
      {/* Left nav within settings */}
      <div
        className="flex flex-col overflow-hidden flex-shrink-0"
        style={{ width: 200, borderRight: "1px solid var(--atlas-border)", background: "var(--atlas-surface)" }}
      >
        <div
          className="px-4 py-3 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--atlas-border)", height: 48, display: "flex", alignItems: "center" }}
        >
          <div className="flex items-center gap-2">
            <Settings size={14} style={{ color: "#2563eb" }} />
            <span className="text-sm font-semibold" style={{ color: "var(--atlas-text)" }}>设置</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {(Object.keys(SECTION_CONFIG) as SettingsSection[]).map(section => {
            const cfg = SECTION_CONFIG[section];
            return (
              <button
                key={section}
                onClick={() => setActiveSection(section)}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all"
                style={{
                  background: activeSection === section ? "rgba(37,99,235,0.08)" : "transparent",
                  color: activeSection === section ? "#2563eb" : "var(--atlas-text-2)",
                  fontWeight: activeSection === section ? 600 : 400,
                }}
              >
                {cfg.icon}
                <span className="text-sm">{cfg.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeSection === "bots" && <BotsSection />}
        {activeSection === "account" && <AccountSection user={user} />}
        {activeSection === "api" && <ApiSection />}
        {activeSection === "security" && <SecuritySection />}
      </div>
    </div>
  );
}

function BotsSection() {
  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div>
        <h2 className="text-base font-semibold mb-1" style={{ color: "var(--atlas-text)" }}>机器人管理</h2>
        <p className="text-sm" style={{ color: "var(--atlas-text-3)" }}>
          管理你的 AI 助手，添加后将出现在左侧对话导航中。
        </p>
      </div>

      <div className="space-y-2">
        {MOCK_BOTS.map(bot => (
          <div
            key={bot.id}
            className="flex items-center gap-3 px-4 py-3 rounded-xl"
            style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}
          >
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(37,99,235,0.08)", fontSize: 18 }}
            >
              {bot.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium" style={{ color: "var(--atlas-text)" }}>{bot.name}</span>
                {bot.isDefault && (
                  <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: "rgba(37,99,235,0.1)", color: "#2563eb" }}>
                    默认
                  </span>
                )}
                <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: "rgba(16,185,129,0.1)", color: "#10b981" }}>
                  已启用
                </span>
              </div>
              <p className="text-xs mt-0.5" style={{ color: "var(--atlas-text-3)" }}>{bot.description}</p>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={() => toast.info("编辑功能即将上线")}
                className="p-1.5 rounded-lg transition-colors"
                style={{ color: "var(--atlas-text-3)" }}
              >
                <Edit2 size={13} />
              </button>
              {!bot.isDefault && (
                <button
                  onClick={() => toast.error("删除功能即将上线")}
                  className="p-1.5 rounded-lg transition-colors"
                  style={{ color: "var(--atlas-text-3)" }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "#ef4444"}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)"}
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={() => toast.info("添加机器人功能即将上线")}
        className="flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all w-full"
        style={{ border: "1.5px dashed var(--atlas-border)", color: "var(--atlas-text-3)" }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLElement).style.borderColor = "rgba(37,99,235,0.35)";
          (e.currentTarget as HTMLElement).style.color = "#2563eb";
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLElement).style.borderColor = "var(--atlas-border)";
          (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)";
        }}
      >
        <Plus size={14} />
        <span className="text-sm">添加机器人</span>
      </button>
    </div>
  );
}

function AccountSection({ user }: { user: any }) {
  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div>
        <h2 className="text-base font-semibold mb-1" style={{ color: "var(--atlas-text)" }}>账号信息</h2>
        <p className="text-sm" style={{ color: "var(--atlas-text-3)" }}>查看和管理你的账号信息。</p>
      </div>

      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--atlas-border)" }}>
        {[
          { label: "用户名", value: user?.name || "未登录" },
          { label: "邮箱", value: user?.email || "—" },
          { label: "套餐", value: user?.plan === "pro" ? "Pro 版" : user?.plan === "enterprise" ? "企业版" : "免费版" },
          { label: "角色", value: user?.role === "admin" ? "管理员" : "普通用户" },
        ].map((item, i) => (
          <div
            key={i}
            className="flex items-center justify-between px-4 py-3"
            style={{
              borderBottom: i < 3 ? "1px solid var(--atlas-border)" : "none",
              background: "#fff",
            }}
          >
            <span className="text-sm" style={{ color: "var(--atlas-text-3)" }}>{item.label}</span>
            <span className="text-sm font-medium" style={{ color: "var(--atlas-text)" }}>{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ApiSection() {
  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div>
        <h2 className="text-base font-semibold mb-1" style={{ color: "var(--atlas-text)" }}>API 密钥</h2>
        <p className="text-sm" style={{ color: "var(--atlas-text-3)" }}>管理 AI 服务的 API 密钥配置。</p>
      </div>

      <div
        className="flex items-start gap-2.5 px-4 py-3 rounded-xl"
        style={{ background: "rgba(37,99,235,0.04)", border: "1px solid rgba(37,99,235,0.12)" }}
      >
        <Key size={14} style={{ color: "#2563eb", flexShrink: 0, marginTop: 1 }} />
        <p className="text-sm leading-relaxed" style={{ color: "var(--atlas-text-2)" }}>
          系统已内置 AI 服务密钥，无需额外配置。如需使用自定义 API 密钥，请联系管理员。
        </p>
      </div>
    </div>
  );
}

function SecuritySection() {
  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div>
        <h2 className="text-base font-semibold mb-1" style={{ color: "var(--atlas-text)" }}>安全设置</h2>
        <p className="text-sm" style={{ color: "var(--atlas-text-3)" }}>管理账号安全和访问权限。</p>
      </div>

      <div className="space-y-2">
        {[
          { label: "修改密码", desc: "定期更新密码以保护账号安全" },
          { label: "登录记录", desc: "查看最近的登录历史" },
          { label: "退出所有设备", desc: "强制退出所有已登录设备" },
        ].map((item, i) => (
          <button
            key={i}
            onClick={() => toast.info("功能即将上线")}
            className="w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all"
            style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = "rgba(37,99,235,0.25)"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--atlas-border)"}
          >
            <div className="text-left">
              <div className="text-sm font-medium" style={{ color: "var(--atlas-text)" }}>{item.label}</div>
              <div className="text-xs mt-0.5" style={{ color: "var(--atlas-text-3)" }}>{item.desc}</div>
            </div>
            <ChevronRight size={14} style={{ color: "var(--atlas-text-4)" }} />
          </button>
        ))}
      </div>
    </div>
  );
}
