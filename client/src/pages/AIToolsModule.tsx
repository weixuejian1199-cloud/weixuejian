/**
 * ATLAS V15.0 — AI Tools Module
 * Data source connections + BI analysis
 */
import { useState } from "react";
import { motion } from "framer-motion";
import { Plus, Zap, Link2, BarChart2, RefreshCw, ChevronRight, Settings, AlertCircle } from "lucide-react";
import { toast } from "sonner";

interface DataSource {
  id: string;
  name: string;
  platform: string;
  icon: string;
  status: "connected" | "disconnected";
  lastSync?: string;
  shopName?: string;
}

const MOCK_SOURCES: DataSource[] = [
  { id: "1", name: "淘宝旗舰店", platform: "taobao", icon: "🛒", status: "connected", lastSync: "10分钟前", shopName: "品牌旗舰店" },
  { id: "2", name: "抖音小店", platform: "douyin", icon: "🎵", status: "connected", lastSync: "2小时前", shopName: "品牌抖音店" },
];

const AVAILABLE_PLATFORMS = [
  { id: "taobao", name: "淘宝", icon: "🛒" },
  { id: "tmall", name: "天猫", icon: "🐱" },
  { id: "jd", name: "京东", icon: "🔴" },
  { id: "pinduoduo", name: "拼多多", icon: "🛍️" },
  { id: "douyin", name: "抖音", icon: "🎵" },
  { id: "shipinhao", name: "视频号", icon: "📹" },
  { id: "xiaohongshu", name: "小红书", icon: "📕" },
  { id: "wangdiantong", name: "旺店通", icon: "🏪" },
  { id: "database", name: "数据库", icon: "🗄️" },
  { id: "api", name: "自定义 API", icon: "⚡" },
];

const QUICK_ACTIONS = [
  { icon: "📦", label: "查今日订单" },
  { icon: "📊", label: "生成销售报表" },
  { icon: "⚠️", label: "查库存预警" },
  { icon: "💰", label: "对账核查" },
];

export default function AIToolsModule() {
  const [selectedSource, setSelectedSource] = useState<DataSource | null>(MOCK_SOURCES[0]);
  const [showAddPanel, setShowAddPanel] = useState(false);

  return (
    <div className="flex h-full overflow-hidden" style={{ background: "#fff" }}>
      {/* Center: Data Source List */}
      <div
        className="flex flex-col overflow-hidden"
        style={{
          width: "20%",
          minWidth: "200px",
          borderRight: "1px solid var(--atlas-border)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-3 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--atlas-border)", height: 48 }}
        >
          <div className="flex items-center gap-2">
            <Zap size={14} style={{ color: "#2563eb" }} />
            <span className="text-sm font-semibold" style={{ color: "var(--atlas-text)" }}>AI 工具</span>
          </div>
          <button
            onClick={() => setShowAddPanel(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
            style={{ background: "rgba(37,99,235,0.08)", color: "#2563eb", border: "1px solid rgba(37,99,235,0.2)" }}
          >
            <Plus size={12} />
            添加数据源
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Connected sources */}
          {MOCK_SOURCES.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--atlas-text-3)" }}>
                已连接 ({MOCK_SOURCES.length})
              </div>
              <div className="space-y-2">
                {MOCK_SOURCES.map(source => (
                  <motion.button
                    key={source.id}
                    whileHover={{ scale: 1.005 }}
                    onClick={() => { setSelectedSource(source); setShowAddPanel(false); }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all"
                    style={{
                      background: selectedSource?.id === source.id ? "rgba(37,99,235,0.06)" : "var(--atlas-surface)",
                      border: `1px solid ${selectedSource?.id === source.id ? "rgba(37,99,235,0.25)" : "var(--atlas-border)"}`,
                    }}
                  >
                    <span style={{ fontSize: 20 }}>{source.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium" style={{ color: "var(--atlas-text)" }}>{source.name}</span>
                        <span
                          className="text-xs px-1.5 py-0.5 rounded-full"
                          style={{ background: "rgba(16,185,129,0.1)", color: "#10b981" }}
                        >
                          已连接
                        </span>
                      </div>
                      <div className="text-xs mt-0.5" style={{ color: "var(--atlas-text-3)" }}>
                        最后同步：{source.lastSync}
                      </div>
                    </div>
                    <ChevronRight size={14} style={{ color: "var(--atlas-text-4)", flexShrink: 0 }} />
                  </motion.button>
                ))}
              </div>
            </div>
          )}

          {/* Add source CTA */}
          <button
            onClick={() => setShowAddPanel(true)}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all"
            style={{
              background: showAddPanel ? "rgba(37,99,235,0.04)" : "transparent",
              border: "1.5px dashed var(--atlas-border)",
            }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = "rgba(37,99,235,0.35)"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--atlas-border)"}
          >
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: "rgba(37,99,235,0.08)", border: "1px solid rgba(37,99,235,0.15)" }}
            >
              <Plus size={14} style={{ color: "#2563eb" }} />
            </div>
            <span className="text-sm" style={{ color: "var(--atlas-text-3)" }}>添加新数据源</span>
          </button>
        </div>
      </div>

      {/* Center: Detail / Add Panel — 35% */}
      <div className="flex flex-col overflow-hidden" style={{ width: "35%", background: "var(--atlas-surface)", borderRight: "1px solid var(--atlas-border)" }}>
        {showAddPanel ? (
          <AddSourcePanel onClose={() => setShowAddPanel(false)} />
        ) : selectedSource ? (
          <SourceDetailPanel source={selectedSource} />
        ) : (
          <EmptyDetail />
        )}
      </div>

      {/* Right: Analysis Panel — 45% */}
      <div
        className="flex flex-col items-center justify-center h-full"
        style={{ width: "45%", background: "var(--atlas-bg)", padding: "24px 20px" }}
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center"
            style={{ background: "rgba(37,99,235,0.08)", border: "1px solid rgba(37,99,235,0.15)" }}
          >
            <BarChart2 size={22} style={{ color: "#2563eb" }} />
          </div>
          <p className="text-sm font-medium" style={{ color: "var(--atlas-text-2)" }}>分析结果将在这里展示</p>
          <p className="text-xs" style={{ color: "var(--atlas-text-4)" }}>连接数据源后，选择快捷分析或向 AI 提问</p>
        </div>
      </div>
    </div>
  );
}

function SourceDetailPanel({ source }: { source: DataSource }) {
  const HISTORY = [
    { date: "03-10", label: "本周销售汇总", status: "success" },
    { date: "03-09", label: "库存预警报告", status: "success" },
    { date: "03-08", label: "退款订单分析", status: "success" },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-3 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--atlas-border)", height: 48, background: "#fff" }}
      >
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 18 }}>{source.icon}</span>
          <span className="text-sm font-semibold" style={{ color: "var(--atlas-text)" }}>{source.name}</span>
          <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: "rgba(16,185,129,0.1)", color: "#10b981" }}>
            已连接
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="flex items-center gap-1 text-xs transition-colors"
            style={{ color: "var(--atlas-text-3)" }}
            onClick={() => toast.success("数据同步中...")}
          >
            <RefreshCw size={12} />
            同步
          </button>
          <button className="p-1.5 rounded-lg transition-colors" style={{ color: "var(--atlas-text-3)" }}>
            <Settings size={13} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Quick actions */}
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider mb-2.5" style={{ color: "var(--atlas-text-3)" }}>
            快捷分析
          </div>
          <div className="grid grid-cols-2 gap-2">
            {QUICK_ACTIONS.map((action, i) => (
              <button
                key={i}
                onClick={() => toast.info("功能即将上线，敬请期待")}
                className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-left transition-all"
                style={{ background: "#fff", border: "1px solid var(--atlas-border)" }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = "rgba(37,99,235,0.3)";
                  (e.currentTarget as HTMLElement).style.background = "rgba(37,99,235,0.03)";
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = "var(--atlas-border)";
                  (e.currentTarget as HTMLElement).style.background = "#fff";
                }}
              >
                <span style={{ fontSize: 16 }}>{action.icon}</span>
                <span className="text-xs font-medium" style={{ color: "var(--atlas-text-2)" }}>{action.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Ask AI */}
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider mb-2.5" style={{ color: "var(--atlas-text-3)" }}>
            或者直接问 AI
          </div>
          <div
            className="flex items-center gap-2 px-3 py-2.5 rounded-xl"
            style={{ background: "#fff", border: "1px solid var(--atlas-border)" }}
          >
            <input
              className="flex-1 text-sm bg-transparent outline-none"
              placeholder="帮我查昨天的退款订单..."
              style={{ color: "var(--atlas-text)" }}
              onKeyDown={e => e.key === "Enter" && toast.info("功能即将上线")}
            />
            <button
              className="text-xs px-2.5 py-1 rounded-lg font-medium"
              style={{ background: "rgba(37,99,235,0.1)", color: "#2563eb" }}
              onClick={() => toast.info("功能即将上线")}
            >
              发送
            </button>
          </div>
          <p className="text-xs mt-1.5" style={{ color: "var(--atlas-text-4)" }}>
            或 <button className="underline" onClick={() => toast.info("功能即将上线")} style={{ color: "#2563eb" }}>发送到对话工作台</button> 继续分析
          </p>
        </div>

        {/* History */}
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider mb-2.5" style={{ color: "var(--atlas-text-3)" }}>
            最近分析
          </div>
          <div className="space-y-1.5">
            {HISTORY.map((item, i) => (
              <div
                key={i}
                className="flex items-center gap-3 px-3 py-2 rounded-lg"
                style={{ background: "#fff", border: "1px solid var(--atlas-border)" }}
              >
                <span className="text-xs font-mono" style={{ color: "var(--atlas-text-3)", flexShrink: 0 }}>{item.date}</span>
                <span className="text-xs flex-1" style={{ color: "var(--atlas-text-2)" }}>{item.label}</span>
                <span className="text-xs" style={{ color: "#10b981" }}>✓</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function AddSourcePanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div
        className="flex items-center justify-between px-5 py-3 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--atlas-border)", height: 48, background: "#fff" }}
      >
        <span className="text-sm font-semibold" style={{ color: "var(--atlas-text)" }}>选择数据源</span>
        <button onClick={onClose} className="text-xs" style={{ color: "var(--atlas-text-3)" }}>取消</button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider mb-2.5" style={{ color: "var(--atlas-text-3)" }}>
            电商平台
          </div>
          <div className="grid grid-cols-3 gap-2">
            {AVAILABLE_PLATFORMS.map(p => (
              <button
                key={p.id}
                onClick={() => toast.info("数据源接入功能即将上线，敬请期待")}
                className="flex flex-col items-center gap-1.5 py-3 rounded-xl transition-all"
                style={{ background: "#fff", border: "1px solid var(--atlas-border)" }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = "rgba(37,99,235,0.3)";
                  (e.currentTarget as HTMLElement).style.background = "rgba(37,99,235,0.03)";
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = "var(--atlas-border)";
                  (e.currentTarget as HTMLElement).style.background = "#fff";
                }}
              >
                <span style={{ fontSize: 22 }}>{p.icon}</span>
                <span className="text-xs" style={{ color: "var(--atlas-text-2)" }}>{p.name}</span>
              </button>
            ))}
          </div>
        </div>

        <div
          className="flex items-start gap-2.5 px-3 py-3 rounded-xl"
          style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)" }}
        >
          <AlertCircle size={14} style={{ color: "#f59e0b", flexShrink: 0, marginTop: 1 }} />
          <p className="text-xs leading-relaxed" style={{ color: "var(--atlas-text-2)" }}>
            数据源接入功能正在开发中，即将上线。目前可通过上传 Excel/CSV 文件进行数据分析。
          </p>
        </div>
      </div>
    </div>
  );
}

function EmptyDetail() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
      <Link2 size={28} style={{ color: "rgba(37,99,235,0.25)" }} />
      <p className="text-sm" style={{ color: "var(--atlas-text-3)" }}>选择左侧数据源查看详情</p>
    </div>
  );
}
