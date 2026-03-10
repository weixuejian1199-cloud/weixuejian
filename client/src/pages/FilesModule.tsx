/**
 * ATLAS V15.0 — Files Module
 * File management: list, preview, analyze
 * Layout: FileList (50%) | PreviewPanel (50%)
 */
import { useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search, Upload, FileSpreadsheet, File, Trash2, MessageSquare,
  ChevronRight, Clock, BarChart2, X, AlertCircle, CheckCircle2, Loader2
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAtlas } from "@/contexts/AtlasContext";

type FileTab = "all" | "excel" | "analyzed";

interface FileSession {
  id: string;
  originalName: string;
  filename: string;
  fileUrl?: string | null;
  fileSizeKb?: number | null;
  rowCount?: number | null;
  colCount?: number | null;
  status: string;
  isMerged?: number | null;
  createdAt: Date | string;
}

function formatSize(kb?: number | null): string {
  if (!kb) return "—";
  if (kb < 1024) return `${kb} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function formatDate(d: Date | string): string {
  const date = new Date(d);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  if (diff < 60000) return "刚刚";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return `${date.getMonth() + 1}-${String(date.getDate()).padStart(2, "0")}`;
}

function isExcel(name: string) {
  return /\.(xlsx|xls|csv)$/i.test(name);
}

export default function FilesModule() {
  const [activeTab, setActiveTab] = useState<FileTab>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFile, setSelectedFile] = useState<FileSession | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { setActiveModule, setActiveTaskId } = useAtlas();

  const utils = trpc.useUtils();
  const { data: sessions = [], isLoading } = trpc.session.list.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  const deleteSession = trpc.session.delete.useMutation({
    onSuccess: () => {
      utils.session.list.invalidate();
      setSelectedFile(null);
      toast.success("文件已删除");
    },
    onError: () => toast.error("删除失败，请重试"),
  });

  const filtered = sessions.filter((s: FileSession) => {
    const matchTab =
      activeTab === "all" ? true :
      activeTab === "excel" ? isExcel(s.originalName) :
      activeTab === "analyzed" ? s.status === "analyzed" || s.status === "ready" : true;
    const matchSearch = !searchQuery || s.originalName.toLowerCase().includes(searchQuery.toLowerCase());
    return matchTab && matchSearch;
  });

  const handleOpenInChat = (file: FileSession) => {
    setActiveTaskId(file.id);
    setActiveModule("chat");
    toast.success(`已在对话中打开：${file.originalName}`);
  };

  const handleUpload = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!isExcel(file.name) && !file.name.endsWith(".pdf")) {
      toast.error("仅支持 Excel、CSV、PDF 格式");
      return;
    }
    setIsUploading(true);
    try {
      // Upload via the existing upload endpoint
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData, credentials: "include" });
      if (!res.ok) throw new Error("上传失败");
      const data = await res.json();
      utils.session.list.invalidate();
      toast.success(`${file.name} 上传成功`);
    } catch (e: any) {
      toast.error(e?.message || "上传失败，请重试");
    } finally {
      setIsUploading(false);
    }
  }, [utils]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleUpload(e.dataTransfer.files);
  }, [handleUpload]);

  return (
    <div
      className="flex h-full overflow-hidden"
      style={{ background: "#fff" }}
      onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      <AnimatePresence>
        {isDragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3"
            style={{ background: "rgba(37,99,235,0.06)", border: "2px dashed rgba(37,99,235,0.4)", borderRadius: 12, margin: 8 }}
          >
            <Upload size={32} style={{ color: "#2563eb" }} />
            <p className="text-sm font-medium" style={{ color: "#2563eb" }}>松开以上传文件</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Left: File List — 20% */}
      <div
        className="flex flex-col overflow-hidden"
        style={{ width: "20%", minWidth: 200, borderRight: "1px solid var(--atlas-border)" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-3 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--atlas-border)", height: 48 }}
        >
          <div className="flex items-center gap-2">
            <FileSpreadsheet size={14} style={{ color: "#2563eb" }} />
            <span className="text-sm font-semibold" style={{ color: "var(--atlas-text)" }}>文件</span>
            <span
              className="text-xs px-1.5 py-0.5 rounded-full"
              style={{ background: "var(--atlas-surface-2)", color: "var(--atlas-text-3)" }}
            >
              {sessions.length}
            </span>
          </div>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
            style={{ background: "rgba(37,99,235,0.08)", color: "#2563eb", border: "1px solid rgba(37,99,235,0.2)" }}
          >
            {isUploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
            上传文件
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv,.pdf"
            className="hidden"
            onChange={e => handleUpload(e.target.files)}
          />
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
              placeholder="搜索文件..."
              className="flex-1 bg-transparent outline-none text-sm"
              style={{ color: "var(--atlas-text)" }}
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")}>
                <X size={12} style={{ color: "var(--atlas-text-3)" }} />
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 px-4 py-2 flex-shrink-0" style={{ borderBottom: "1px solid var(--atlas-border)" }}>
          {(["all", "excel", "analyzed"] as FileTab[]).map(tab => {
            const labels: Record<FileTab, string> = { all: "全部", excel: "Excel", analyzed: "已分析" };
            const counts: Record<FileTab, number> = {
              all: sessions.length,
              excel: sessions.filter((s: FileSession) => isExcel(s.originalName)).length,
              analyzed: sessions.filter((s: FileSession) => s.status === "analyzed" || s.status === "ready").length,
            };
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs transition-all"
                style={{
                  background: activeTab === tab ? "rgba(37,99,235,0.1)" : "transparent",
                  color: activeTab === tab ? "#2563eb" : "var(--atlas-text-3)",
                  fontWeight: activeTab === tab ? 600 : 400,
                  border: activeTab === tab ? "1px solid rgba(37,99,235,0.2)" : "1px solid transparent",
                }}
              >
                {labels[tab]}
                <span
                  className="ml-1 px-1 rounded-full"
                  style={{
                    background: activeTab === tab ? "rgba(37,99,235,0.15)" : "var(--atlas-surface-2)",
                    color: activeTab === tab ? "#2563eb" : "var(--atlas-text-4)",
                    fontSize: 10,
                  }}
                >
                  {counts[tab]}
                </span>
              </button>
            );
          })}
        </div>

        {/* File list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 gap-2">
              <Loader2 size={16} className="animate-spin" style={{ color: "#2563eb" }} />
              <span className="text-sm" style={{ color: "var(--atlas-text-3)" }}>加载中...</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <FileSpreadsheet size={28} style={{ color: "rgba(37,99,235,0.2)" }} />
              <p className="text-sm" style={{ color: "var(--atlas-text-3)" }}>
                {searchQuery ? "未找到匹配文件" : "暂无文件，拖拽或点击上传"}
              </p>
            </div>
          ) : (
            filtered.map((file: FileSession) => (
              <motion.button
                key={file.id}
                whileHover={{ scale: 1.005 }}
                onClick={() => setSelectedFile(file)}
                onDoubleClick={() => handleOpenInChat(file)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all"
                style={{
                  background: selectedFile?.id === file.id ? "rgba(37,99,235,0.06)" : "var(--atlas-surface)",
                  border: `1px solid ${selectedFile?.id === file.id ? "rgba(37,99,235,0.25)" : "var(--atlas-border)"}`,
                }}
              >
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: isExcel(file.originalName) ? "rgba(16,185,129,0.1)" : "rgba(37,99,235,0.08)" }}
                >
                  {isExcel(file.originalName)
                    ? <FileSpreadsheet size={15} style={{ color: "#10b981" }} />
                    : <File size={15} style={{ color: "#2563eb" }} />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate" style={{ color: "var(--atlas-text)" }}>
                      {file.originalName}
                    </span>
                    {(file.status === "analyzed" || file.status === "ready") && (
                      <span className="text-xs px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: "rgba(16,185,129,0.1)", color: "#10b981" }}>
                        已分析
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs" style={{ color: "var(--atlas-text-4)" }}>
                      {formatSize(file.fileSizeKb)}
                    </span>
                    {file.rowCount && (
                      <span className="text-xs" style={{ color: "var(--atlas-text-4)" }}>
                        · {file.rowCount} 行
                      </span>
                    )}
                    <span className="text-xs" style={{ color: "var(--atlas-text-4)" }}>
                      · {formatDate(file.createdAt)}
                    </span>
                  </div>
                </div>
                <ChevronRight size={13} style={{ color: "var(--atlas-text-4)", flexShrink: 0 }} />
              </motion.button>
            ))
          )}
        </div>

        {/* Drop hint */}
        <div
          className="flex items-center justify-center gap-2 py-2 flex-shrink-0"
          style={{ borderTop: "1px solid var(--atlas-border)" }}
        >
          <Upload size={11} style={{ color: "var(--atlas-text-4)" }} />
          <span className="text-xs" style={{ color: "var(--atlas-text-4)" }}>拖拽文件到此处上传</span>
        </div>
      </div>

      {/* Center: Preview Panel — 60% */}
      <div className="flex flex-col overflow-hidden" style={{ width: "60%", background: "var(--atlas-surface)", borderRight: "1px solid var(--atlas-border)" }}>
        <AnimatePresence mode="wait">
          {selectedFile ? (
            <motion.div
              key={selectedFile.id}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.15 }}
              className="flex flex-col h-full overflow-hidden"
            >
              <FilePreviewPanel
                file={selectedFile}
                onOpenInChat={() => handleOpenInChat(selectedFile)}
                onDelete={() => deleteSession.mutate({ id: selectedFile.id })}
                isDeleting={deleteSession.isPending}
              />
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center h-full gap-4 px-8 text-center"
            >
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center"
                style={{ background: "rgba(37,99,235,0.06)", border: "1px solid rgba(37,99,235,0.12)" }}
              >
                <FileSpreadsheet size={24} style={{ color: "rgba(37,99,235,0.4)" }} />
              </div>
              <div>
                <p className="text-sm font-medium mb-1" style={{ color: "var(--atlas-text-2)" }}>选择文件查看详情</p>
                <p className="text-xs" style={{ color: "var(--atlas-text-4)" }}>点击文件查看预览，双击直接在对话中分析</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Right: Info Panel — 20% */}
      <div
        className="flex flex-col overflow-hidden"
        style={{ width: "20%", background: "var(--atlas-bg)", padding: "20px 16px" }}
      >
        {selectedFile ? (
          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--atlas-text-4)" }}>文件信息</p>
              <div className="space-y-2.5">
                <div className="flex justify-between text-xs">
                  <span style={{ color: "var(--atlas-text-3)" }}>文件大小</span>
                  <span style={{ color: "var(--atlas-text)" }}>{selectedFile.fileSizeKb ? `${selectedFile.fileSizeKb} KB` : "—"}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span style={{ color: "var(--atlas-text-3)" }}>数据行数</span>
                  <span style={{ color: "var(--atlas-text)" }}>{selectedFile.rowCount ?? "—"} 行</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span style={{ color: "var(--atlas-text-3)" }}>数据列数</span>
                  <span style={{ color: "var(--atlas-text)" }}>{selectedFile.colCount ?? "—"} 列</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span style={{ color: "var(--atlas-text-3)" }}>上传时间</span>
                  <span style={{ color: "var(--atlas-text)" }}>{selectedFile.createdAt ? new Date(selectedFile.createdAt).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" }) : "—"}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span style={{ color: "var(--atlas-text-3)" }}>状态</span>
                  <span className="px-1.5 py-0.5 rounded-full text-xs" style={{ background: "rgba(16,185,129,0.1)", color: "#10b981" }}>已就绪</span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
            <p className="text-xs" style={{ color: "var(--atlas-text-4)" }}>选择文件<br/>查看详情</p>
          </div>
        )}
      </div>
    </div>
  );
}

function FilePreviewPanel({
  file,
  onOpenInChat,
  onDelete,
  isDeleting,
}: {
  file: FileSession;
  onOpenInChat: () => void;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-3 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--atlas-border)", height: 48, background: "#fff" }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {isExcel(file.originalName)
            ? <FileSpreadsheet size={14} style={{ color: "#10b981", flexShrink: 0 }} />
            : <File size={14} style={{ color: "#2563eb", flexShrink: 0 }} />
          }
          <span className="text-sm font-semibold truncate" style={{ color: "var(--atlas-text)" }}>
            {file.originalName}
          </span>
        </div>
        <button
          onClick={onDelete}
          disabled={isDeleting}
          className="p-1.5 rounded-lg transition-colors flex-shrink-0"
          style={{ color: "var(--atlas-text-3)" }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "#ef4444"}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)"}
        >
          {isDeleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* File meta */}
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--atlas-border)" }}>
          {[
            { label: "文件大小", value: formatSize(file.fileSizeKb) },
            { label: "数据行数", value: file.rowCount ? `${file.rowCount} 行` : "—" },
            { label: "数据列数", value: file.colCount ? `${file.colCount} 列` : "—" },
            { label: "上传时间", value: formatDate(file.createdAt) },
            { label: "状态", value: file.status === "ready" || file.status === "analyzed" ? "已就绪" : file.status },
          ].map((item, i, arr) => (
            <div
              key={i}
              className="flex items-center justify-between px-4 py-2.5"
              style={{
                borderBottom: i < arr.length - 1 ? "1px solid var(--atlas-border)" : "none",
                background: "#fff",
              }}
            >
              <span className="text-xs" style={{ color: "var(--atlas-text-3)" }}>{item.label}</span>
              <span className="text-xs font-medium" style={{ color: "var(--atlas-text)" }}>{item.value}</span>
            </div>
          ))}
        </div>

        {/* Data preview placeholder */}
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--atlas-text-3)" }}>
            数据预览
          </div>
          <div
            className="rounded-xl overflow-hidden"
            style={{ border: "1px solid var(--atlas-border)", background: "#fff" }}
          >
            {file.rowCount ? (
              <div className="px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <BarChart2 size={13} style={{ color: "#2563eb" }} />
                  <span className="text-xs font-medium" style={{ color: "var(--atlas-text-2)" }}>
                    共 {file.rowCount} 行 × {file.colCount || "?"} 列
                  </span>
                </div>
                <div
                  className="flex items-center gap-2 px-3 py-2 rounded-lg"
                  style={{ background: "rgba(37,99,235,0.04)", border: "1px solid rgba(37,99,235,0.1)" }}
                >
                  <CheckCircle2 size={12} style={{ color: "#10b981" }} />
                  <span className="text-xs" style={{ color: "var(--atlas-text-2)" }}>
                    文件已上传，点击下方按钮开始 AI 分析
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 px-4 py-3">
                <AlertCircle size={13} style={{ color: "var(--atlas-text-4)" }} />
                <span className="text-xs" style={{ color: "var(--atlas-text-3)" }}>暂无预览数据</span>
              </div>
            )}
          </div>
        </div>

        {/* CTA */}
        <button
          onClick={onOpenInChat}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-medium text-sm transition-all"
          style={{ background: "#2563eb", color: "#fff" }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "#1d4ed8"}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "#2563eb"}
        >
          <MessageSquare size={14} />
          用这个文件开始对话
        </button>

        <p className="text-xs text-center" style={{ color: "var(--atlas-text-4)" }}>
          双击文件列表中的文件也可直接打开对话
        </p>
      </div>
    </div>
  );
}
