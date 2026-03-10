/**
 * ATLAS V15.0 — Knowledge Base Module
 * Enterprise knowledge assets: documents, FAQs, manuals
 */
import { useState } from "react";
import { motion } from "framer-motion";
import { Plus, BookOpen, FileText, MessageSquare, HelpCircle, Search, Upload, Edit2, Trash2, ExternalLink } from "lucide-react";
import { toast } from "sonner";

type KnowledgeCategory = "all" | "faq" | "manual" | "qa";
type KnowledgeSource = "manual" | "ai-extract" | "auto-saved";

interface KnowledgeItem {
  id: string;
  title: string;
  category: Exclude<KnowledgeCategory, "all">;
  source: KnowledgeSource;
  updatedAt: string;
  usageCount: number;
  preview?: string;
}

const MOCK_ITEMS: KnowledgeItem[] = [
  { id: "1", title: "产品手册 v2.0.pdf", category: "manual", source: "manual", updatedAt: "03-08", usageCount: 24, preview: "本手册涵盖产品功能说明、操作流程及常见问题解答..." },
  { id: "2", title: "退款政策说明", category: "faq", source: "manual", updatedAt: "03-05", usageCount: 18, preview: "退款需在7天内提交申请，超出时限将无法处理..." },
  { id: "3", title: "门店管理规范", category: "manual", source: "ai-extract", updatedAt: "03-03", usageCount: 11, preview: "各门店须遵守统一的开店时间、陈列规范和服务标准..." },
  { id: "4", title: "Q: 如何查询订单状态", category: "qa", source: "auto-saved", updatedAt: "03-09", usageCount: 7, preview: "A: 登录后台 → 订单管理 → 输入订单号查询..." },
  { id: "5", title: "薪资核算规则", category: "faq", source: "ai-extract", updatedAt: "03-01", usageCount: 15, preview: "基本工资 + 绩效工资 + 提成，每月25日发放..." },
];

const CATEGORY_CONFIG: Record<KnowledgeCategory, { label: string; icon: React.ReactNode }> = {
  all: { label: "全部", icon: <BookOpen size={13} /> },
  faq: { label: "FAQ", icon: <HelpCircle size={13} /> },
  manual: { label: "手册", icon: <FileText size={13} /> },
  qa: { label: "问答", icon: <MessageSquare size={13} /> },
};

const SOURCE_CONFIG: Record<KnowledgeSource, { label: string; color: string }> = {
  manual: { label: "手动上传", color: "#2563eb" },
  "ai-extract": { label: "AI 自动提取", color: "#10b981" },
  "auto-saved": { label: "对话自动沉淀", color: "#f59e0b" },
};

export default function KnowledgeModule() {
  const [activeCategory, setActiveCategory] = useState<KnowledgeCategory>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedItem, setSelectedItem] = useState<KnowledgeItem | null>(MOCK_ITEMS[0]);

  const filtered = MOCK_ITEMS.filter(item => {
    const matchCategory = activeCategory === "all" || item.category === activeCategory;
    const matchSearch = !searchQuery || item.title.toLowerCase().includes(searchQuery.toLowerCase());
    return matchCategory && matchSearch;
  });

  return (
    <div className="flex h-full overflow-hidden" style={{ background: "#fff" }}>
      {/* Center: Knowledge List */}
      <div
        className="flex flex-col overflow-hidden"
        style={{ width: "50%", borderRight: "1px solid var(--atlas-border)" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-3 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--atlas-border)", height: 48 }}
        >
          <div className="flex items-center gap-2">
            <BookOpen size={14} style={{ color: "#2563eb" }} />
            <span className="text-sm font-semibold" style={{ color: "var(--atlas-text)" }}>知识库</span>
          </div>
          <button
            onClick={() => toast.info("添加知识功能即将上线")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
            style={{ background: "rgba(37,99,235,0.08)", color: "#2563eb", border: "1px solid rgba(37,99,235,0.2)" }}
          >
            <Plus size={12} />
            添加知识
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-2.5 flex-shrink-0" style={{ borderBottom: "1px solid var(--atlas-border)" }}>
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg"
            style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}
          >
            <Search size={13} style={{ color: "var(--atlas-text-3)", flexShrink: 0 }} />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="搜索知识库..."
              className="flex-1 bg-transparent outline-none text-sm"
              style={{ color: "var(--atlas-text)" }}
            />
          </div>
        </div>

        {/* Category tabs */}
        <div className="flex items-center gap-1 px-4 py-2 flex-shrink-0" style={{ borderBottom: "1px solid var(--atlas-border)" }}>
          {(["all", "faq", "manual", "qa"] as KnowledgeCategory[]).map(cat => {
            const cfg = CATEGORY_CONFIG[cat];
            const count = cat === "all" ? MOCK_ITEMS.length : MOCK_ITEMS.filter(i => i.category === cat).length;
            return (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs transition-all"
                style={{
                  background: activeCategory === cat ? "rgba(37,99,235,0.1)" : "transparent",
                  color: activeCategory === cat ? "#2563eb" : "var(--atlas-text-3)",
                  fontWeight: activeCategory === cat ? 600 : 400,
                  border: activeCategory === cat ? "1px solid rgba(37,99,235,0.2)" : "1px solid transparent",
                }}
              >
                {cfg.label}
                <span
                  className="ml-1 px-1 rounded-full text-xs"
                  style={{
                    background: activeCategory === cat ? "rgba(37,99,235,0.15)" : "var(--atlas-surface-2)",
                    color: activeCategory === cat ? "#2563eb" : "var(--atlas-text-4)",
                    fontSize: 10,
                  }}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <BookOpen size={24} style={{ color: "rgba(37,99,235,0.2)" }} />
              <p className="text-sm" style={{ color: "var(--atlas-text-3)" }}>
                {searchQuery ? "未找到相关知识" : "暂无知识条目"}
              </p>
            </div>
          ) : (
            filtered.map(item => {
              const srcCfg = SOURCE_CONFIG[item.source];
              return (
                <motion.button
                  key={item.id}
                  whileHover={{ scale: 1.005 }}
                  onClick={() => setSelectedItem(item)}
                  className="w-full flex flex-col gap-1.5 px-3 py-2.5 rounded-xl text-left transition-all"
                  style={{
                    background: selectedItem?.id === item.id ? "rgba(37,99,235,0.06)" : "var(--atlas-surface)",
                    border: `1px solid ${selectedItem?.id === item.id ? "rgba(37,99,235,0.25)" : "var(--atlas-border)"}`,
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium flex-1 truncate" style={{ color: "var(--atlas-text)" }}>
                      {item.title}
                    </span>
                    <span className="text-xs flex-shrink-0" style={{ color: "var(--atlas-text-4)" }}>
                      {item.updatedAt}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className="text-xs px-1.5 py-0.5 rounded-full"
                      style={{ background: `${srcCfg.color}15`, color: srcCfg.color }}
                    >
                      {srcCfg.label}
                    </span>
                    <span className="text-xs" style={{ color: "var(--atlas-text-4)" }}>
                      被引用 {item.usageCount} 次
                    </span>
                  </div>
                </motion.button>
              );
            })
          )}
        </div>
      </div>

      {/* Right: Detail */}
      <div className="flex flex-col flex-1 overflow-hidden" style={{ background: "var(--atlas-surface)" }}>
        {selectedItem ? (
          <KnowledgeDetail item={selectedItem} />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
            <BookOpen size={28} style={{ color: "rgba(37,99,235,0.25)" }} />
            <p className="text-sm" style={{ color: "var(--atlas-text-3)" }}>选择左侧条目查看详情</p>
          </div>
        )}
      </div>
    </div>
  );
}

function KnowledgeDetail({ item }: { item: KnowledgeItem }) {
  const srcCfg = SOURCE_CONFIG[item.source];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div
        className="flex items-center justify-between px-5 py-3 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--atlas-border)", height: 48, background: "#fff" }}
      >
        <span className="text-sm font-semibold truncate" style={{ color: "var(--atlas-text)" }}>{item.title}</span>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => toast.info("编辑功能即将上线")}
            className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg"
            style={{ background: "rgba(37,99,235,0.08)", color: "#2563eb", border: "1px solid rgba(37,99,235,0.2)" }}
          >
            <Edit2 size={10} /> 编辑
          </button>
          <button
            onClick={() => toast.error("删除功能即将上线")}
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: "var(--atlas-text-3)" }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "#ef4444"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)"}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Meta info */}
        <div className="rounded-xl p-4 space-y-2.5" style={{ background: "#fff", border: "1px solid var(--atlas-border)" }}>
          <div className="flex items-center justify-between">
            <span className="text-xs" style={{ color: "var(--atlas-text-3)" }}>来源</span>
            <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: `${srcCfg.color}15`, color: srcCfg.color }}>
              {srcCfg.label}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs" style={{ color: "var(--atlas-text-3)" }}>更新时间</span>
            <span className="text-xs font-medium" style={{ color: "var(--atlas-text-2)" }}>{item.updatedAt}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs" style={{ color: "var(--atlas-text-3)" }}>AI 引用次数</span>
            <span className="text-xs font-medium" style={{ color: "var(--atlas-text-2)" }}>{item.usageCount} 次</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs" style={{ color: "var(--atlas-text-3)" }}>AI 提取状态</span>
            <span className="text-xs" style={{ color: "#10b981" }}>已完成</span>
          </div>
        </div>

        {/* Preview */}
        {item.preview && (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--atlas-text-3)" }}>
              内容预览
            </div>
            <div
              className="px-4 py-3 rounded-xl text-sm leading-relaxed"
              style={{ background: "#fff", border: "1px solid var(--atlas-border)", color: "var(--atlas-text-2)" }}
            >
              {item.preview}
            </div>
          </div>
        )}

        {/* AI usage hint */}
        <div
          className="flex items-start gap-2.5 px-3 py-3 rounded-xl"
          style={{ background: "rgba(37,99,235,0.04)", border: "1px solid rgba(37,99,235,0.12)" }}
        >
          <BookOpen size={13} style={{ color: "#2563eb", flexShrink: 0, marginTop: 1 }} />
          <p className="text-xs leading-relaxed" style={{ color: "var(--atlas-text-2)" }}>
            此知识条目已被 AI 索引，在对话中提问相关问题时，AI 会自动引用此内容作答。
          </p>
        </div>
      </div>
    </div>
  );
}
