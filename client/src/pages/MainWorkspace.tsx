/**
 * ATLAS V5.2 — Main Workspace
 * ─────────────────────────────────────────────────────────────────
 * Layout: Single nav sidebar + full-width chat area
 *
 * Structure:
 *   ┌─────────────────────────────────────────┐
 *   │         AI 对话消息区域（全宽）            │
 *   ├─────────────────────────────────────────┤
 *   │  [📊 经营日报] [🏪 门店排行] [📈 平台对比] │  ← 居中，仅空态或少消息时显示
 *   ├─────────────────────────────────────────┤
 *   │  已上传文件列表（紧凑横排，可滚动）          │  ← 有文件时显示
 *   ├─────────────────────────────────────────┤
 *   │  📎  输入你的需求...              [发送]  │
 *   └─────────────────────────────────────────┘
 *
 * V5.2 changes:
 *   - Removed left file panel, full-width chat
 *   - Multi-file upload, no limit on file count
 *   - Uploaded files shown as compact chips above input
 *   - 3 template shortcuts centered above input
 *   - Font sizes scaled up to match wider layout
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload, X, FileSpreadsheet, Sparkles, Send,
  Download, Loader2, Copy, Check, BarChart2, Paperclip,
} from "lucide-react";
import { Streamdown } from "streamdown";
import { useAtlas, type UploadedFile } from "@/contexts/AtlasContext";
import { api, chatStream } from "@/lib/api";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { nanoid } from "nanoid";

// ── Three pinned templates ────────────────────────────────────────────────────

const PINNED_TEMPLATES = [
  { id: "daily-report",     icon: "📋", name: "经营日报",   prompt: "生成今日经营日报，包含总销售额GMV、订单数量、退款金额和退款率、客单价、平台占比，并标注异常数据" },
  { id: "store-sales",      icon: "🏪", name: "门店排行",   prompt: "帮我汇总所有门店的销售数据，按门店分组，显示销售额、订单数量、客单价，并标注排名" },
  { id: "platform-compare", icon: "📊", name: "平台对比",   prompt: "对比各平台的销售数据，生成平台销售对比报表，包含销售额、占比、环比变化" },
];

// ── Main ──────────────────────────────────────────────────────────────────────

export default function MainWorkspace() {
  const {
    uploadedFiles, addUploadedFile, updateUploadedFile, removeUploadedFile, clearFiles,
    messages, addMessage, updateLastMessage, clearMessages,
    isProcessing, setIsProcessing,
    addReport, setHistory, addHistory,
  } = useAtlas();

  const [input, setInput] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const readyFiles = uploadedFiles.filter(f => f.status === "ready");
  const hasFiles = readyFiles.length > 0;
  const hasAnyFiles = uploadedFiles.length > 0;

  // Multi-file merge mutation
  const mergeMutation = trpc.session.merge.useMutation();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + "px";
    }
  }, [input]);

  // ── File processing ──────────────────────────────────────────────────────────

  const processFile = useCallback(async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["xlsx", "xls", "csv"].includes(ext || "")) {
      toast.error(`不支持 .${ext} 格式，请上传 Excel 或 CSV`); return;
    }
    if (file.size > 50 * 1024 * 1024) { toast.error(`${file.name} 超过 50MB 限制`); return; }

    const tempId = nanoid();
    addUploadedFile({ id: tempId, name: file.name, size: file.size, status: "uploading", uploadedAt: new Date() });

    try {
      const result = await api.upload(file);
      updateUploadedFile(tempId, {
        status: "ready",
        sessionId: result.session_id,
        dfInfo: {
          row_count: result.df_info.row_count,
          col_count: result.df_info.col_count,
          columns: (result.df_info.fields || []).map((f: any) => ({
            name: f.name, dtype: f.dtype,
            non_null_count: result.df_info.row_count - (f.null_count || 0),
            sample_values: f.sample || [],
            inferred_type: f.type || "text",
          })),
          preview: result.df_info.preview || [],
          file_size_kb: Math.round(file.size / 1024),
        },
      });
      addHistory({
        id: result.session_id,
        title: result.filename,
        filename: result.filename,
        created_at: new Date().toISOString(),
        status: "uploaded",
        row_count: result.df_info.row_count,
        col_count: result.df_info.col_count,
      });
      // Only show AI analysis message for first file
      if (uploadedFiles.filter(f => f.status === "ready").length === 0) {
        addMessage({ role: "assistant", content: result.ai_analysis });
      } else {
        toast.success(`${file.name} 解析完成 · ${result.df_info.row_count.toLocaleString()} 行`);
      }
    } catch (err: any) {
      updateUploadedFile(tempId, { status: "error" });
      toast.error(`${file.name} 上传失败：${err.message}`);
    }
  }, [addUploadedFile, updateUploadedFile, addMessage, addHistory, uploadedFiles]);

  const handleFiles = useCallback((files: FileList | File[]) => {
    Array.from(files).forEach(processFile);
  }, [processFile]);

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  // ── Send message ─────────────────────────────────────────────────────────────

  const handleSend = useCallback(async (text?: string) => {
    const msg = (text || input).trim();
    if (!msg || isGenerating) return;
    if (!hasFiles) { toast.error("请先上传数据文件"); return; }

    setInput("");
    setIsGenerating(true);
    addMessage({ role: "user", content: msg });
    addMessage({ role: "assistant", content: "", isStreaming: true });

    // If multiple files, merge them first
    let sessionId: string | undefined;
    if (readyFiles.length > 1) {
      const sessionIds = readyFiles.map(f => f.sessionId).filter(Boolean) as string[];
      if (sessionIds.length < 2) { toast.error("文件尚未就绪"); setIsGenerating(false); return; }
      try {
        updateLastMessage("正在合并多个文件数据...");
        const mergeResult = await mergeMutation.mutateAsync({ sessionIds });
        sessionId = mergeResult.id;
        toast.success(`已合并 ${readyFiles.length} 个文件`);
      } catch (mergeErr: any) {
        updateLastMessage(`文件合并失败：${mergeErr.message}`);
        toast.error("多文件合并失败，请重试");
        setIsGenerating(false);
        setIsProcessing(false);
        // Restore user input so they can retry
        setInput(msg);
        return;
      }
    } else {
      sessionId = readyFiles[0]?.sessionId;
    }
    if (!sessionId) { toast.error("文件尚未就绪"); setIsGenerating(false); return; }

    const isReport = /生成|报表|汇总|统计|分析|导出|excel|xlsx|日报|排行|对比/i.test(msg);

    try {
      if (isReport) {
        setIsProcessing(true);
        updateLastMessage("正在分析需求，生成报表中...");
        let result;
        try {
          result = await api.generateReport(sessionId, msg);
        } catch (reportErr: any) {
          const errMsg = reportErr.message || "未知错误";
          updateLastMessage(`报表生成失败：${errMsg}\n\n请检查数据格式或稍后重试。`);
          toast.error(`报表生成失败：${errMsg}`, { action: { label: "重试", onClick: () => handleSend(msg) } });
          // Restore user input for retry
          setInput(msg);
          return;
        }
        updateLastMessage(result.ai_message, {
          report_id: result.report_id,
          report_filename: result.filename,
        });
        addReport({
          id: result.report_id, title: msg.slice(0, 30),
          filename: result.filename, created_at: new Date().toISOString(),
          session_id: sessionId, status: "completed",
        });
        setHistory(prev => prev.map(h =>
          h.id === sessionId
            ? { ...h, status: "completed" as const, report_id: result.report_id, report_filename: result.filename }
            : h
        ));
        toast.success("报表生成成功！");
      } else {
        // Streaming AI chat
        const history = messages
          .filter(m => m.role === "user" || (m.role === "assistant" && m.content && !m.isStreaming))
          .slice(-6)
          .map(m => ({ role: m.role as "user" | "assistant", content: m.content }));
        let accumulated = "";
        let chatFailed = false;
        await chatStream({
          sessionId,
          message: msg,
          history,
          onChunk: (chunk) => {
            accumulated += chunk;
            updateLastMessage(accumulated);
          },
          onDone: (fullText) => {
            updateLastMessage(fullText || accumulated);
          },
          onError: (err) => {
            chatFailed = true;
            const errMsg = err.message || "请求失败";
            updateLastMessage(`对话失败：${errMsg}\n\n请检查网络连接或稍后重试。`);
            toast.error("对话请求失败", { action: { label: "重试", onClick: () => handleSend(msg) } });
            // Restore user input for retry
            setInput(msg);
          },
        });
      }
    } catch (err: any) {
      const errMsg = err.message || "请检查后端服务是否正常运行";
      updateLastMessage(`处理失败：${errMsg}`);
      toast.error("请求失败，请重试", { action: { label: "重试", onClick: () => handleSend(msg) } });
      // Restore user input for retry
      setInput(msg);
    } finally {
      setIsGenerating(false);
      setIsProcessing(false);
    }
  }, [input, isGenerating, hasFiles, readyFiles, addMessage, updateLastMessage, setIsProcessing, addReport, setHistory]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleDownload = (reportId: string, filename: string) => {
    const a = document.createElement("a");
    a.href = api.getDownloadUrl(reportId);
    a.download = filename;
    a.click();
    toast.success("开始下载");
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div
      className="flex flex-col h-full overflow-hidden relative"
      style={{ background: "var(--atlas-bg)" }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef} type="file" multiple accept=".xlsx,.xls,.csv"
        className="hidden" onChange={e => e.target.files && handleFiles(e.target.files)}
      />

      {/* ── Chat header ── */}
      <div
        className="px-6 py-3 flex items-center gap-2.5 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--atlas-border)" }}
      >
        <div className="w-6 h-6 rounded-md flex items-center justify-center"
          style={{ background: "rgba(91,140,255,0.12)" }}>
          <Sparkles size={13} style={{ color: "var(--atlas-accent)" }} />
        </div>
        <span className="text-sm font-semibold" style={{ color: "var(--atlas-text)" }}>ATLAS AI</span>
        {hasAnyFiles && (
          <span className="text-xs px-2 py-0.5 rounded-full"
            style={{ background: "rgba(91,140,255,0.1)", color: "var(--atlas-accent)" }}>
            {uploadedFiles.filter(f => f.status === "ready").length} 个文件就绪
          </span>
        )}
        <div className="flex-1" />
        {isProcessing && (
          <div className="flex items-center gap-1.5">
            <Loader2 size={12} className="animate-spin" style={{ color: "var(--atlas-accent)" }} />
            <span className="text-xs" style={{ color: "var(--atlas-text-2)", fontFamily: "'JetBrains Mono', monospace" }}>
              生成中...
            </span>
          </div>
        )}
        {hasAnyFiles && (
          <button
            onClick={() => { clearFiles(); clearMessages(); }}
            className="text-xs transition-colors"
            style={{ color: "var(--atlas-text-3)" }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-2)"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)"}
          >
            清空会话
          </button>
        )}
      </div>

      {/* ── Messages area ── */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-6 space-y-5">
          {messages.length === 0 ? (
            <EmptyState hasFiles={hasFiles} />
          ) : (
            messages.map(msg => (
              <MessageBubble key={msg.id} message={msg} onDownload={handleDownload} />
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* ── Bottom area ── */}
      <div className="flex-shrink-0" style={{ borderTop: "1px solid var(--atlas-border)" }}>
        <div className="max-w-3xl mx-auto px-6 pt-3 pb-4">

          {/* Template shortcuts — centered, shown when few messages */}
          {messages.length < 4 && (
            <div className="flex items-center justify-center gap-2 mb-3">
              {PINNED_TEMPLATES.map(t => (
                <button
                  key={t.id}
                  onClick={() => handleSend(t.prompt)}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm transition-all"
                  style={{
                    background: "var(--atlas-elevated)",
                    border: "1px solid var(--atlas-border)",
                    color: "var(--atlas-text-2)",
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.borderColor = "rgba(91,140,255,0.35)";
                    (e.currentTarget as HTMLElement).style.color = "var(--atlas-text)";
                    (e.currentTarget as HTMLElement).style.background = "rgba(91,140,255,0.06)";
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.borderColor = "var(--atlas-border)";
                    (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-2)";
                    (e.currentTarget as HTMLElement).style.background = "var(--atlas-elevated)";
                  }}
                >
                  <span>{t.icon}</span>
                  <span className="font-medium">{t.name}</span>
                </button>
              ))}
            </div>
          )}

          {/* Uploaded files chips */}
          <AnimatePresence>
            {hasAnyFiles && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="flex flex-wrap gap-1.5 mb-2"
              >
                {uploadedFiles.map(f => (
                  <FileChip key={f.id} file={f} onRemove={() => removeUploadedFile(f.id)} />
                ))}
                {/* Add more files button */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs transition-all"
                  style={{
                    background: "transparent",
                    border: "1px dashed rgba(91,140,255,0.3)",
                    color: "var(--atlas-text-3)",
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.borderColor = "rgba(91,140,255,0.6)";
                    (e.currentTarget as HTMLElement).style.color = "var(--atlas-accent)";
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.borderColor = "rgba(91,140,255,0.3)";
                    (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)";
                  }}
                >
                  <Upload size={10} />
                  继续添加
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Input box */}
          <div
            className="rounded-xl overflow-hidden"
            style={{
              background: "var(--atlas-elevated)",
              border: "1px solid var(--atlas-border-2)",
              transition: "border-color 0.15s ease",
            }}
            onFocusCapture={e => (e.currentTarget as HTMLElement).style.borderColor = "rgba(91,140,255,0.4)"}
            onBlurCapture={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--atlas-border-2)"}
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={hasFiles
                ? "描述报表需求，例如：帮我汇总14家门店的销售数据..."
                : "上传 Excel 或 CSV 文件后开始对话..."}
              disabled={isGenerating}
              rows={1}
              className="w-full bg-transparent outline-none resize-none px-4 pt-3.5 pb-1"
              style={{
                color: "var(--atlas-text)",
                fontSize: "15px",
                lineHeight: "1.6",
                minHeight: 44,
                maxHeight: 160,
                fontFamily: "inherit",
              }}
            />
            <div className="flex items-center justify-between px-3 pb-3 pt-1">
              <div className="flex items-center gap-2">
                {/* Upload button */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{
                    background: "var(--atlas-surface)",
                    border: "1px solid var(--atlas-border)",
                    color: "var(--atlas-text-2)",
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.borderColor = "rgba(91,140,255,0.4)";
                    (e.currentTarget as HTMLElement).style.color = "var(--atlas-accent)";
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.borderColor = "var(--atlas-border)";
                    (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-2)";
                  }}
                  title="上传文件（支持多选）"
                >
                  <Paperclip size={13} />
                  上传文件
                </button>
                <span className="text-xs" style={{ color: "var(--atlas-text-3)" }}>
                  Enter 发送 · Shift+Enter 换行
                </span>
              </div>
              <button
                onClick={() => handleSend()}
                disabled={!input.trim() || !hasFiles || isGenerating}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all"
                style={{
                  background: input.trim() && hasFiles && !isGenerating
                    ? "var(--atlas-accent)"
                    : "var(--atlas-border)",
                  color: input.trim() && hasFiles && !isGenerating
                    ? "#fff"
                    : "var(--atlas-text-3)",
                  transition: "all 0.15s ease",
                }}
              >
                {isGenerating
                  ? <Loader2 size={14} className="animate-spin" />
                  : <Send size={14} />
                }
                {isGenerating ? "生成中" : "发送"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Global drag overlay ── */}
      <AnimatePresence>
        {isDragging && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none"
            style={{
              background: "rgba(10,12,16,0.88)",
              border: "2px dashed var(--atlas-accent)",
            }}
          >
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
                style={{ background: "rgba(91,140,255,0.15)", border: "1px solid rgba(91,140,255,0.3)" }}>
                <Upload size={28} style={{ color: "var(--atlas-accent)" }} />
              </div>
              <p className="text-lg font-semibold" style={{ color: "var(--atlas-text)" }}>松开以上传文件</p>
              <p className="text-sm mt-1" style={{ color: "var(--atlas-text-2)" }}>
                支持同时上传多个 Excel / CSV 文件
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── FileChip — compact file tag above input ───────────────────────────────────

function FileChip({ file, onRemove }: { file: UploadedFile; onRemove: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs"
      style={{
        background: file.status === "ready"
          ? "rgba(52,211,153,0.08)"
          : file.status === "error"
          ? "rgba(248,113,113,0.08)"
          : "rgba(91,140,255,0.08)",
        border: `1px solid ${
          file.status === "ready"
            ? "rgba(52,211,153,0.2)"
            : file.status === "error"
            ? "rgba(248,113,113,0.2)"
            : "rgba(91,140,255,0.2)"
        }`,
      }}
    >
      {file.status === "uploading" ? (
        <Loader2 size={10} className="animate-spin flex-shrink-0" style={{ color: "var(--atlas-accent)" }} />
      ) : file.status === "error" ? (
        <X size={10} className="flex-shrink-0" style={{ color: "var(--atlas-danger)" }} />
      ) : (
        <FileSpreadsheet size={10} className="flex-shrink-0" style={{ color: "var(--atlas-success)" }} />
      )}
      <span
        className="max-w-[140px] truncate font-medium"
        style={{
          color: file.status === "ready"
            ? "var(--atlas-success)"
            : file.status === "error"
            ? "var(--atlas-danger)"
            : "var(--atlas-accent)",
        }}
      >
        {file.name}
      </span>
      {file.status === "ready" && file.dfInfo && (
        <span style={{ color: "var(--atlas-text-3)" }}>
          {file.dfInfo.row_count.toLocaleString()}行
        </span>
      )}
      <button
        onClick={onRemove}
        className="flex-shrink-0 transition-colors ml-0.5"
        style={{ color: "var(--atlas-text-3)" }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-danger)"}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)"}
      >
        <X size={10} />
      </button>
    </motion.div>
  );
}

// ── MessageBubble ─────────────────────────────────────────────────────────────

function MessageBubble({
  message,
  onDownload,
}: {
  message: { id: string; role: string; content: string; isStreaming?: boolean; report_id?: string; report_filename?: string };
  onDownload: (id: string, filename: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (message.role === "user") {
    return (
      <motion.div initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} className="flex justify-end">
        <div
          className="max-w-[70%] px-5 py-3 rounded-2xl"
          style={{ background: "rgba(91,140,255,0.12)", border: "1px solid rgba(91,140,255,0.2)" }}
        >
          <p style={{ color: "var(--atlas-text)", fontSize: "15px", lineHeight: "1.65" }}>
            {message.content}
          </p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} className="flex gap-3">
      <div
        className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{ background: "rgba(91,140,255,0.12)", border: "1px solid rgba(91,140,255,0.2)" }}
      >
        <Sparkles size={13} style={{ color: "var(--atlas-accent)" }} />
      </div>
      <div className="flex-1 min-w-0">
        <div
          className="px-5 py-4 rounded-2xl"
          style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}
        >
          {message.isStreaming && !message.content ? (
            <div className="flex items-center gap-1.5 py-0.5">
              {[0, 1, 2].map(i => (
                <div key={i} className="atlas-thinking-dot" style={{ animationDelay: `${i * 0.2}s` }} />
              ))}
            </div>
          ) : (
            <div className="atlas-prose" style={{ fontSize: "15px", lineHeight: "1.7" }}>
              <Streamdown>{message.content}</Streamdown>
            </div>
          )}
        </div>

        {message.report_id && message.report_filename && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-2.5">
            <button
              onClick={() => onDownload(message.report_id!, message.report_filename!)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium transition-all"
              style={{
                background: "rgba(91,140,255,0.1)",
                border: "1px solid rgba(91,140,255,0.25)",
                color: "var(--atlas-accent)",
                fontSize: "14px",
              }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "rgba(91,140,255,0.18)"}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "rgba(91,140,255,0.1)"}
            >
              <Download size={14} />
              下载 {message.report_filename}
            </button>
          </motion.div>
        )}

        {message.content && !message.isStreaming && (
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 mt-2 text-xs transition-colors"
            style={{ color: copied ? "var(--atlas-success)" : "var(--atlas-text-3)" }}
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? "已复制" : "复制"}
          </button>
        )}
      </div>
    </motion.div>
  );
}

// ── EmptyState ────────────────────────────────────────────────────────────────

function EmptyState({ hasFiles }: { hasFiles: boolean }) {
  if (hasFiles) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3 }}>
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
            style={{ background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.2)" }}>
            <Check size={24} style={{ color: "#34D399" }} />
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="text-center">
          <h3 className="font-semibold mb-1.5" style={{ color: "var(--atlas-text)", fontSize: "17px" }}>文件已就绪，开始对话</h3>
          <p style={{ color: "var(--atlas-text-2)", fontSize: "14px" }}>AI 已分析数据结构，点击上方模板或直接描述需求</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-12 gap-6">
      {/* Logo + title */}
      <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3 }} className="text-center">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
          style={{ background: "rgba(91,140,255,0.08)", border: "1px solid rgba(91,140,255,0.15)" }}>
          <BarChart2 size={24} style={{ color: "var(--atlas-accent)" }} />
        </div>
        <h3 className="font-semibold mb-1.5" style={{ color: "var(--atlas-text)", fontSize: "18px" }}>把数据拖进来，剩下的交给 ATLAS</h3>
        <p style={{ color: "var(--atlas-text-2)", fontSize: "14px" }}>支持 Excel / CSV，可同时上传多个文件</p>
      </motion.div>

      {/* 3-step guide */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
        className="flex items-center gap-3">
        {[
          { step: "1", label: "上传文件", desc: "Excel / CSV", color: "#5B8CFF" },
          { step: "→", label: "", desc: "", color: "var(--atlas-text-3)" },
          { step: "2", label: "描述需求", desc: "或选模板", color: "#A78BFA" },
          { step: "→", label: "", desc: "", color: "var(--atlas-text-3)" },
          { step: "3", label: "下载报表", desc: "Excel 格式", color: "#34D399" },
        ].map((item, i) => item.step === "→" ? (
          <span key={i} className="text-sm" style={{ color: item.color }}>→</span>
        ) : (
          <div key={i} className="flex flex-col items-center gap-1">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
              style={{ background: `${item.color}18`, color: item.color, border: `1px solid ${item.color}30` }}>
              {item.step}
            </div>
            <span className="text-xs font-medium" style={{ color: "var(--atlas-text-2)" }}>{item.label}</span>
            <span className="text-xs" style={{ color: "var(--atlas-text-3)" }}>{item.desc}</span>
          </div>
        ))}
      </motion.div>

      {/* Capability tags */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
        className="flex flex-wrap justify-center gap-2">
        {[
          { label: "📊 销售报表", color: "#5B8CFF" },
          { label: "💰 财务分析", color: "#FBBF24" },
          { label: "👥 工资条", color: "#34D399" },
          { label: "📅 考勤汇总", color: "#5B8CFF" },
          { label: "📦 库存盘点", color: "#A78BFA" },
          { label: "📱 多平台对比", color: "#FF6B35" },
        ].map(tag => (
          <span key={tag.label} className="text-xs px-2.5 py-1 rounded-full"
            style={{ background: `${tag.color}12`, color: tag.color, border: `1px solid ${tag.color}25` }}>
            {tag.label}
          </span>
        ))}
      </motion.div>
    </div>
  );
}
