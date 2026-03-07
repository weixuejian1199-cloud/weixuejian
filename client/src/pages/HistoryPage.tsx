/**
 * ATLAS V3.0 — History Page
 */
import { motion } from "framer-motion";
import { Clock, FileSpreadsheet, Download, CheckCircle, XCircle, Upload } from "lucide-react";
import { useAtlas } from "@/contexts/AtlasContext";
import { api } from "@/lib/api";
import { toast } from "sonner";

export default function HistoryPage() {
  const { history } = useAtlas();

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
            style={{ background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.2)" }}>
            <Clock size={18} style={{ color: "var(--atlas-success)" }} />
          </div>
          <div>
            <h1 className="text-lg font-semibold" style={{ color: "var(--atlas-text)" }}>历史记录</h1>
            <p className="text-xs" style={{ color: "var(--atlas-text-3)" }}>所有处理过的文件记录</p>
          </div>
        </div>

        {history.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}>
              <Clock size={24} style={{ color: "var(--atlas-text-3)" }} />
            </div>
            <p className="text-sm" style={{ color: "var(--atlas-text-2)" }}>暂无历史记录</p>
          </div>
        ) : (
          <div className="space-y-2">
            {history.map((h, i) => (
              <motion.div key={h.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                className="flex items-center gap-4 px-4 py-3.5 rounded-xl"
                style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}>
                <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: "var(--atlas-elevated)" }}>
                  <FileSpreadsheet size={16} style={{ color: "var(--atlas-text-2)" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: "var(--atlas-text)" }}>{h.filename}</p>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-xs" style={{ color: "var(--atlas-text-3)", fontFamily: "'JetBrains Mono', monospace" }}>
                      {new Date(h.created_at).toLocaleString("zh-CN")}
                    </span>
                    {h.row_count && (
                      <span className="text-xs" style={{ color: "var(--atlas-text-3)" }}>
                        {h.row_count.toLocaleString()} 行 · {h.col_count} 列
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {h.status === "completed"
                    ? <CheckCircle size={14} style={{ color: "var(--atlas-success)" }} />
                    : h.status === "uploaded"
                      ? <Upload size={14} style={{ color: "var(--atlas-accent)" }} />
                      : <XCircle size={14} style={{ color: "var(--atlas-danger)" }} />}
                  <span className="text-xs" style={{
                    color: h.status === "completed" ? "var(--atlas-success)" :
                           h.status === "uploaded" ? "var(--atlas-accent)" : "var(--atlas-danger)",
                    fontFamily: "'JetBrains Mono', monospace",
                  }}>
                    {h.status === "completed" ? "已完成" : h.status === "uploaded" ? "已上传" : "失败"}
                  </span>
                </div>
                {h.report_id && h.report_filename && (
                  <button onClick={() => handleDownload(h.report_id!, h.report_filename!)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                    style={{ background: "rgba(91,140,255,0.1)", border: "1px solid rgba(91,140,255,0.2)", color: "var(--atlas-accent)" }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "rgba(91,140,255,0.18)"}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "rgba(91,140,255,0.1)"}>
                    <Download size={12} /> 下载报表
                  </button>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
