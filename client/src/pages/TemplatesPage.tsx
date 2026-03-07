/**
 * ATLAS V3.0 — Templates Page
 */
import { motion } from "framer-motion";
import { LayoutTemplate, ChevronRight } from "lucide-react";
import { useAtlas, SYSTEM_TEMPLATES } from "@/contexts/AtlasContext";
import { toast } from "sonner";

export default function TemplatesPage() {
  const { setActiveNav } = useAtlas();

  return (
    <div className="h-full overflow-y-auto p-6" style={{ background: "var(--atlas-bg)" }}>
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.2)" }}>
            <LayoutTemplate size={18} style={{ color: "#A78BFA" }} />
          </div>
          <div>
            <h1 className="text-lg font-semibold" style={{ color: "var(--atlas-text)" }}>模板库</h1>
            <p className="text-xs" style={{ color: "var(--atlas-text-3)" }}>选择模板快速生成报表</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SYSTEM_TEMPLATES.map((t, i) => (
            <motion.button key={t.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              onClick={() => { setActiveNav("home"); toast.info(`已选择模板：${t.name}，请先上传数据文件`); }}
              className="flex flex-col gap-3 p-4 rounded-xl text-left transition-all group"
              style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--atlas-accent)"}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--atlas-border)"}>
              <div className="flex items-start justify-between">
                <span className="text-2xl">{t.icon}</span>
                <span className="text-xs px-2 py-0.5 rounded" style={{
                  background: "var(--atlas-elevated)", color: "var(--atlas-text-3)",
                  border: "1px solid var(--atlas-border)",
                }}>{t.category}</span>
              </div>
              <div>
                <p className="text-sm font-semibold mb-1" style={{ color: "var(--atlas-text)" }}>{t.name}</p>
                <p className="text-xs leading-relaxed" style={{ color: "var(--atlas-text-2)" }}>{t.description}</p>
              </div>
              <div className="flex items-center gap-1 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ color: "var(--atlas-accent)" }}>
                使用此模板 <ChevronRight size={11} />
              </div>
            </motion.button>
          ))}
        </div>
      </div>
    </div>
  );
}
