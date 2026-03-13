/**
 * ATLAS V3.0 — FilePanel (right slide-out 320px)
 *
 * Triggered by 📎 in TopBar.
 * Shows uploaded files for the active task.
 * Supports: view file info, remove file, drag-to-upload.
 */
import { useRef, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  X, FileSpreadsheet, Trash2, Upload, FileText, File,
  AlertCircle, CheckCircle2, Loader2,
} from "lucide-react";
import { useAtlas, type UploadedFile } from "@/contexts/AtlasContext";
import { toast } from "sonner";

/* ── helpers ── */
function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (["xlsx", "xls", "csv"].includes(ext)) return <FileSpreadsheet size={18} style={{ color: "#22c55e" }} />;
  if (["pdf"].includes(ext)) return <FileText size={18} style={{ color: "#ef4444" }} />;
  return <File size={18} style={{ color: "#6b7280" }} />;
}

function statusBadge(status: UploadedFile["status"]) {
  if (status === "uploading") return <Loader2 size={12} className="animate-spin" style={{ color: "#4f6ef7" }} />;
  if (status === "ready") return <CheckCircle2 size={12} style={{ color: "#22c55e" }} />;
  if (status === "error") return <AlertCircle size={12} style={{ color: "#ef4444" }} />;
  return null;
}

export default function FilePanel() {
  const {
    filePanelOpen, setFilePanelOpen,
    uploadedFiles, removeUploadedFile,
    activeTaskId,
  } = useAtlas();

  const dropRef = useRef<HTMLDivElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // File drop is handled by the main workspace's drop handler
    // Just close the panel and let the main handler take over
    toast.info("请将文件拖到对话区域上传");
  }, []);

  const handleRemove = (fileId: string, fileName: string) => {
    removeUploadedFile(fileId);
    toast.success(`已移除 ${fileName}`);
  };

  return (
    <AnimatePresence>
      {filePanelOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0"
            style={{ background: "rgba(0,0,0,0.15)", zIndex: 50 }}
            onClick={() => setFilePanelOpen(false)}
          />

          {/* Panel */}
          <motion.div
            initial={{ x: 320 }}
            animate={{ x: 0 }}
            exit={{ x: 320 }}
            transition={{ type: "spring", damping: 28, stiffness: 300 }}
            className="fixed top-0 right-0 h-full flex flex-col"
            style={{
              width: 320,
              background: "#ffffff",
              borderLeft: "1px solid #e8eaed",
              boxShadow: "-4px 0 16px rgba(0,0,0,0.06)",
              zIndex: 51,
            }}
            ref={dropRef}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-4 flex-shrink-0"
              style={{ height: 56, borderBottom: "1px solid #f3f4f6" }}
            >
              <h2 className="font-semibold" style={{ color: "#1f2937", fontSize: "15px" }}>
                文件
              </h2>
              <button
                className="w-8 h-8 rounded-full flex items-center justify-center transition-all"
                style={{ color: "#6b7280" }}
                onClick={() => setFilePanelOpen(false)}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.04)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                <X size={18} />
              </button>
            </div>

            {/* File list */}
            <div className="flex-1 overflow-y-auto px-3 py-3" style={{ scrollbarWidth: "thin" }}>
              {!activeTaskId ? (
                <EmptyState message="开始新对话后，上传的文件将显示在这里" />
              ) : uploadedFiles.length === 0 ? (
                <EmptyState message="当前对话暂无文件，拖拽或点击对话区域上传" />
              ) : (
                <div className="flex flex-col gap-1.5">
                  {uploadedFiles.map(file => (
                    <FileItem
                      key={file.id}
                      file={file}
                      onRemove={() => handleRemove(file.id, file.name)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Footer: upload hint */}
            <div
              className="flex items-center justify-center gap-2 px-4 flex-shrink-0"
              style={{
                height: 48,
                borderTop: "1px solid #f3f4f6",
                color: "#9ca3af",
                fontSize: "12px",
              }}
            >
              <Upload size={14} />
              <span>拖拽文件到对话区域即可上传</span>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/* ── FileItem ── */
function FileItem({ file, onRemove }: { file: UploadedFile; onRemove: () => void }) {
  const rowCount = file.dfInfo?.row_count;
  const colCount = file.dfInfo?.columns?.length;

  return (
    <div
      className="group flex items-center gap-2.5 px-3 py-2.5 rounded-lg transition-all"
      style={{ background: "transparent" }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#f9fafb"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
    >
      {/* Icon */}
      <div className="flex-shrink-0">{fileIcon(file.name)}</div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p
            className="truncate font-medium"
            style={{ color: "#1f2937", fontSize: "13px", maxWidth: "180px" }}
            title={file.name}
          >
            {file.name}
          </p>
          {statusBadge(file.status)}
        </div>
        <div className="flex items-center gap-2 mt-0.5" style={{ color: "#9ca3af", fontSize: "11px" }}>
          <span>{formatSize(file.size)}</span>
          {rowCount != null && <span>{rowCount.toLocaleString()} 行</span>}
          {colCount != null && <span>{colCount} 列</span>}
        </div>
        {/* Upload progress */}
        {file.status === "uploading" && file.uploadProgress != null && (
          <div className="mt-1.5 h-1 rounded-full overflow-hidden" style={{ background: "#e5e7eb" }}>
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${file.uploadProgress}%`,
                background: "#4f6ef7",
              }}
            />
          </div>
        )}
      </div>

      {/* Remove button (visible on hover) */}
      {file.status !== "uploading" && (
        <button
          className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"
          style={{ color: "#9ca3af" }}
          onClick={e => { e.stopPropagation(); onRemove(); }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#ef4444"; (e.currentTarget as HTMLElement).style.background = "rgba(239,68,68,0.06)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#9ca3af"; (e.currentTarget as HTMLElement).style.background = "transparent"; }}
          title="移除文件"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}

/* ── EmptyState ── */
function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4">
      <div
        className="w-12 h-12 rounded-full flex items-center justify-center mb-3"
        style={{ background: "#f3f4f6" }}
      >
        <FileSpreadsheet size={22} style={{ color: "#9ca3af" }} />
      </div>
      <p className="text-center" style={{ color: "#9ca3af", fontSize: "13px", lineHeight: "1.5" }}>
        {message}
      </p>
    </div>
  );
}
