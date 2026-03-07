/**
 * ATLAS V3.0 — Reports Page
 */
import { motion } from "framer-motion";
import { BarChart2, Download, FileSpreadsheet, Calendar } from "lucide-react";
import { useAtlas } from "@/contexts/AtlasContext";
import { api } from "@/lib/api";
import { toast } from "sonner";

export default function ReportsPage() {
  const { reports } = useAtlas();

  const handleDownload = (reportId: string, filename: string) => {
    const a = document.createElement("a");
    a.href = api.getDownloadUrl(reportId);
    a.download = filename;
    a.click();
    toast.success("开始下载");
  };

  return (
    <div className="h-full overflow-y-auto p-6" style={{ background: "var(--atlas-bg)" }}>
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: "rgba(91,140,255,0.1)", border: "1px solid rgba(91,140,255,0.2)" }}>
            <BarChart2 size={18} style={{ color: "var(--atlas-accent)" }} />
          </div>
          <div>
            <h1 className="text-lg font-semibold" style={{ color: "var(--atlas-text)" }}>报表中心</h1>
            <p className="text-xs" style={{ color: "var(--atlas-text-3)" }}>所有生成的报表文件</p>
          </div>
        </div>

        {reports.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}>
              <FileSpreadsheet size={24} style={{ color: "var(--atlas-text-3)" }} />
            </div>
            <p className="text-sm" style={{ color: "var(--atlas-text-2)" }}>暂无报表，前往工作台生成</p>
          </div>
        ) : (
          <div className="space-y-2">
            {reports.map((r, i) => (
              <motion.div key={r.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="flex items-center gap-4 px-4 py-3.5 rounded-xl"
                style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}>
                <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: "rgba(91,140,255,0.1)" }}>
                  <FileSpreadsheet size={16} style={{ color: "var(--atlas-accent)" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: "var(--atlas-text)" }}>{r.title || r.filename}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Calendar size={10} style={{ color: "var(--atlas-text-3)" }} />
                    <span className="text-xs" style={{ color: "var(--atlas-text-3)", fontFamily: "'JetBrains Mono', monospace" }}>
                      {new Date(r.created_at).toLocaleString("zh-CN")}
                    </span>
                  </div>
                </div>
                <span className="text-xs px-2 py-0.5 rounded"
                  style={{ background: "rgba(52,211,153,0.1)", color: "var(--atlas-success)", fontFamily: "'JetBrains Mono', monospace" }}>
                  {r.status === "completed" ? "已完成" : "失败"}
                </span>
                <button onClick={() => handleDownload(r.id, r.filename)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{ background: "rgba(91,140,255,0.1)", border: "1px solid rgba(91,140,255,0.2)", color: "var(--atlas-accent)" }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "rgba(91,140,255,0.18)"}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "rgba(91,140,255,0.1)"}>
                  <Download size={12} /> 下载
                </button>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
