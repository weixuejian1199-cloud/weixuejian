/**
 * ATLAS V5.0 — Main Workspace
 * ─────────────────────────────────────────────────────────────────
 * Design Philosophy:
 *   "把数据拖进来，剩下的交给 ATLAS"
 *   — Slogan is the visual anchor of the empty state.
 *   — When no files: full-bleed hero with animated drop zone.
 *   — When files present: compact sidebar + AI chat takes over.
 *
 * Layout:
 *   Empty state → centered hero (slogan + giant drop zone)
 *   Active state → left panel (320px) + right chat panel
 *
 * Key changes V5.0:
 *   - Slogan rendered as large display type in empty state
 *   - Drop zone becomes a full-screen invitation when empty
 *   - Animated grid background on drag
 *   - Particle-style floating data icons in hero
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload, X, FileSpreadsheet, Sparkles, Send,
  Download, Loader2, Copy, Check, BarChart2,
  RefreshCw, ChevronRight, Paperclip, ArrowRight,
  Table2, TrendingUp, PieChart, FileText,
} from "lucide-react";
import { Streamdown } from "streamdown";
import { useAtlas, SYSTEM_TEMPLATES, type UploadedFile } from "@/contexts/AtlasContext";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { nanoid } from "nanoid";

// ── Floating data icons for hero decoration ───────────────────────────────────

const FLOAT_ICONS = [
  { Icon: Table2,       x: "12%",  y: "22%", delay: 0,    size: 18, opacity: 0.18 },
  { Icon: TrendingUp,   x: "82%",  y: "18%", delay: 0.4,  size: 16, opacity: 0.14 },
  { Icon: PieChart,     x: "88%",  y: "68%", delay: 0.8,  size: 20, opacity: 0.16 },
  { Icon: FileText,     x: "8%",   y: "72%", delay: 1.2,  size: 15, opacity: 0.12 },
  { Icon: BarChart2,    x: "48%",  y: "8%",  delay: 0.6,  size: 17, opacity: 0.13 },
  { Icon: FileSpreadsheet, x: "52%", y: "88%", delay: 1.0, size: 16, opacity: 0.11 },
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
  const isEmpty = uploadedFiles.length === 0;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 140) + "px";
    }
  }, [input]);

  const processFile = useCallback(async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["xlsx", "xls", "csv"].includes(ext || "")) {
      toast.error(`不支持 .${ext} 格式`); return;
    }
    if (file.size > 50 * 1024 * 1024) { toast.error("文件超过 50MB"); return; }

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
      addMessage({ role: "assistant", content: result.ai_analysis });
      addHistory({
        id: result.session_id,
        title: result.filename,
        filename: result.filename,
        created_at: new Date().toISOString(),
        status: "uploaded",
        row_count: result.df_info.row_count,
        col_count: result.df_info.col_count,
      });
      toast.success(`${file.name} 解析成功，共 ${result.df_info.row_count.toLocaleString()} 行`);
    } catch (err: any) {
      updateUploadedFile(tempId, { status: "error" });
      toast.error(`上传失败：${err.message}`);
    }
  }, [addUploadedFile, updateUploadedFile, addMessage, addHistory]);

  const handleFiles = useCallback((files: FileList | File[]) => {
    Array.from(files).forEach(processFile);
  }, [processFile]);

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  const handleSend = useCallback(async (text?: string) => {
    const msg = (text || input).trim();
    if (!msg || isGenerating) return;
    if (!hasFiles) { toast.error("请先上传数据文件"); return; }

    setInput("");
    setIsGenerating(true);
    addMessage({ role: "user", content: msg });
    addMessage({ role: "assistant", content: "", isStreaming: true });

    const sessionId = readyFiles[0]?.sessionId;
    if (!sessionId) { toast.error("文件尚未就绪"); setIsGenerating(false); return; }

    const isReport = /生成|报表|汇总|统计|分析|导出|excel|xlsx|日报|排行|对比/i.test(msg);

    try {
      if (isReport) {
        setIsProcessing(true);
        updateLastMessage("正在分析需求，生成报表中...");
        const result = await api.generateReport(sessionId, msg);
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
        const result = await api.chat(sessionId, msg);
        updateLastMessage(result.response);
      }
    } catch (err: any) {
      updateLastMessage(`处理失败：${err.message || "请检查后端服务是否正常运行"}`);
      toast.error("请求失败");
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

  return (
    <div
      className="flex h-full overflow-hidden relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef} type="file" multiple accept=".xlsx,.xls,.csv"
        className="hidden" onChange={e => e.target.files && handleFiles(e.target.files)}
      />

      {/* ── Empty State: Full-bleed Hero ── */}
      <AnimatePresence mode="wait">
        {isEmpty ? (
          <motion.div
            key="hero"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.3 }}
            className="absolute inset-0 flex flex-col items-center justify-center"
            style={{ background: "var(--atlas-bg)" }}
          >
            {/* Floating decoration icons */}
            {FLOAT_ICONS.map(({ Icon, x, y, delay, size, opacity }, i) => (
              <motion.div
                key={i}
                className="absolute pointer-events-none"
                style={{ left: x, top: y }}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity, y: [0, -8, 0] }}
                transition={{
                  opacity: { delay, duration: 0.6 },
                  y: { delay, duration: 4 + i * 0.5, repeat: Infinity, ease: "easeInOut" },
                }}
              >
                <Icon size={size} style={{ color: "var(--atlas-accent)" }} />
              </motion.div>
            ))}

            {/* Subtle grid background */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                backgroundImage: `
                  linear-gradient(rgba(91,140,255,0.04) 1px, transparent 1px),
                  linear-gradient(90deg, rgba(91,140,255,0.04) 1px, transparent 1px)
                `,
                backgroundSize: "48px 48px",
              }}
            />

            {/* Hero content */}
            <div className="relative z-10 flex flex-col items-center text-center px-8 max-w-2xl">
              {/* Logo mark */}
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                className="w-16 h-16 rounded-2xl flex items-center justify-center mb-8"
                style={{
                  background: "linear-gradient(135deg, rgba(91,140,255,0.2) 0%, rgba(123,95,255,0.2) 100%)",
                  border: "1px solid rgba(91,140,255,0.25)",
                  boxShadow: "0 0 40px rgba(91,140,255,0.12)",
                }}
              >
                <BarChart2 size={28} style={{ color: "var(--atlas-accent)" }} />
              </motion.div>

              {/* Slogan — the visual anchor */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              >
                <h1
                  className="font-bold leading-tight mb-3"
                  style={{
                    fontSize: "clamp(28px, 4vw, 42px)",
                    color: "var(--atlas-text)",
                    letterSpacing: "-0.02em",
                    fontFamily: "'Inter', 'Noto Sans SC', sans-serif",
                  }}
                >
                  把数据拖进来，
                  <br />
                  <span
                    style={{
                      background: "linear-gradient(135deg, #5B8CFF 0%, #A78BFA 100%)",
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                    }}
                  >
                    剩下的交给 ATLAS
                  </span>
                </h1>
                <p
                  className="text-base mb-10"
                  style={{ color: "var(--atlas-text-3)", maxWidth: "420px", margin: "0 auto 40px" }}
                >
                  上传 Excel 或 CSV，AI 自动解析数据结构，
                  <br />
                  一句话生成专业报表
                </p>
              </motion.div>

              {/* Drop Zone */}
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                className="w-full max-w-md"
              >
                <div
                  className="rounded-2xl p-10 text-center cursor-pointer transition-all relative overflow-hidden"
                  style={{
                    background: isDragging
                      ? "rgba(91,140,255,0.08)"
                      : "var(--atlas-surface)",
                    border: isDragging
                      ? "2px dashed rgba(91,140,255,0.6)"
                      : "2px dashed rgba(91,140,255,0.2)",
                    boxShadow: isDragging
                      ? "0 0 0 4px rgba(91,140,255,0.08), 0 20px 60px rgba(91,140,255,0.12)"
                      : "0 4px 24px rgba(0,0,0,0.12)",
                    transform: isDragging ? "scale(1.01)" : "scale(1)",
                    transition: "all 0.2s ease",
                  }}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {/* Animated ring on drag */}
                  {isDragging && (
                    <motion.div
                      className="absolute inset-0 rounded-2xl pointer-events-none"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: [0.3, 0.6, 0.3] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                      style={{ border: "2px solid rgba(91,140,255,0.4)" }}
                    />
                  )}

                  <div
                    className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 transition-all"
                    style={{
                      background: isDragging
                        ? "rgba(91,140,255,0.2)"
                        : "rgba(91,140,255,0.1)",
                      border: "1px solid rgba(91,140,255,0.2)",
                    }}
                  >
                    <motion.div
                      animate={isDragging ? { y: [-2, 2, -2] } : { y: 0 }}
                      transition={{ duration: 0.8, repeat: isDragging ? Infinity : 0 }}
                    >
                      <Upload size={24} style={{ color: "var(--atlas-accent)" }} />
                    </motion.div>
                  </div>

                  <p
                    className="text-base font-semibold mb-1.5"
                    style={{ color: isDragging ? "var(--atlas-accent)" : "var(--atlas-text)" }}
                  >
                    {isDragging ? "松开以上传文件" : "拖拽文件到这里"}
                  </p>
                  <p className="text-sm mb-5" style={{ color: "var(--atlas-text-3)" }}>
                    支持 Excel (.xlsx / .xls) 和 CSV 格式，最大 50MB
                  </p>

                  <button
                    className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all"
                    style={{
                      background: "var(--atlas-accent)",
                      color: "#fff",
                      boxShadow: "0 4px 16px rgba(91,140,255,0.3)",
                    }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = "0.88"}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = "1"}
                  >
                    <Upload size={14} />
                    选择文件上传
                  </button>
                </div>
              </motion.div>

              {/* Feature hints */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="flex items-center gap-6 mt-8"
              >
                {[
                  { icon: "📊", label: "自动解析数据结构" },
                  { icon: "🤖", label: "AI 理解业务需求" },
                  { icon: "📋", label: "一键导出 Excel 报表" },
                ].map((f, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-sm">{f.icon}</span>
                    <span className="text-xs" style={{ color: "var(--atlas-text-3)" }}>{f.label}</span>
                  </div>
                ))}
              </motion.div>
            </div>
          </motion.div>
        ) : (
          /* ── Active State: Sidebar + Chat ── */
          <motion.div
            key="workspace"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.25 }}
            className="flex w-full h-full overflow-hidden"
          >
            {/* ── LEFT PANEL ── */}
            <div
              className="flex flex-col overflow-hidden flex-shrink-0"
              style={{
                width: 320,
                background: "var(--atlas-surface)",
                borderRight: "1px solid var(--atlas-border)",
              }}
            >
              {/* Panel header */}
              <div
                className="px-4 py-2.5 flex items-center justify-between flex-shrink-0"
                style={{ borderBottom: "1px solid var(--atlas-border)" }}
              >
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--atlas-text-2)", letterSpacing: "0.08em" }}>
                  数据文件
                </span>
                <button
                  onClick={() => { clearFiles(); clearMessages(); }}
                  className="flex items-center gap-1 text-xs transition-colors"
                  style={{ color: "var(--atlas-text-3)" }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-2)"}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)"}
                >
                  <RefreshCw size={10} /> 清空
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {/* Compact upload zone */}
                <div
                  className="rounded-xl p-4 text-center cursor-pointer transition-all"
                  style={{
                    background: "var(--atlas-elevated)",
                    border: "1.5px dashed rgba(91,140,255,0.25)",
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.borderColor = "rgba(91,140,255,0.5)";
                    (e.currentTarget as HTMLElement).style.background = "rgba(91,140,255,0.04)";
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.borderColor = "rgba(91,140,255,0.25)";
                    (e.currentTarget as HTMLElement).style.background = "var(--atlas-elevated)";
                  }}
                >
                  <div className="flex items-center justify-center gap-2 mb-1">
                    <Upload size={13} style={{ color: "var(--atlas-accent)" }} />
                    <span className="text-xs font-semibold" style={{ color: "var(--atlas-text)" }}>
                      继续上传文件
                    </span>
                  </div>
                  <p className="text-xs" style={{ color: "var(--atlas-text-3)" }}>
                    Excel / CSV · 最大 50MB
                  </p>
                </div>

                {/* Uploaded files */}
                <AnimatePresence>
                  {uploadedFiles.length > 0 && (
                    <div className="space-y-1.5">
                      {uploadedFiles.map(f => (
                        <FileCard key={f.id} file={f} onRemove={() => removeUploadedFile(f.id)} />
                      ))}
                    </div>
                  )}
                </AnimatePresence>

                {/* Step guide (no ready files) */}
                {!hasFiles && (
                  <div className="space-y-1.5">
                    {[
                      { icon: Upload, label: "拖数据", sub: "Drag Data", color: "var(--atlas-accent)" },
                      { icon: Sparkles, label: "对话需求", sub: "Interpret Intent", color: "#A78BFA" },
                      { icon: FileSpreadsheet, label: "出结果", sub: "Produce Results", color: "var(--atlas-success)" },
                    ].map((s, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
                        style={{ background: "var(--atlas-elevated)", border: "1px solid var(--atlas-border)" }}
                      >
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${s.color}18` }}>
                          <s.icon size={13} style={{ color: s.color }} />
                        </div>
                        <div>
                          <p className="text-xs font-medium" style={{ color: "var(--atlas-text)" }}>{s.label}</p>
                          <p className="text-xs" style={{ color: "var(--atlas-text-3)" }}>{s.sub}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Templates */}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider mb-2"
                    style={{ color: "var(--atlas-text-3)", fontSize: "10px", letterSpacing: "0.08em" }}>
                    推荐模板
                  </p>
                  <div className="space-y-1">
                    {SYSTEM_TEMPLATES.map(t => (
                      <button
                        key={t.id}
                        onClick={() => setInput(t.prompt)}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all group"
                        style={{ background: "transparent", border: "1px solid transparent" }}
                        onMouseEnter={e => {
                          (e.currentTarget as HTMLElement).style.background = "var(--atlas-elevated)";
                          (e.currentTarget as HTMLElement).style.borderColor = "var(--atlas-border)";
                        }}
                        onMouseLeave={e => {
                          (e.currentTarget as HTMLElement).style.background = "transparent";
                          (e.currentTarget as HTMLElement).style.borderColor = "transparent";
                        }}
                      >
                        <span className="text-sm flex-shrink-0">{t.icon}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate" style={{ color: "var(--atlas-text-2)" }}>{t.name}</p>
                          <p className="text-xs truncate" style={{ color: "var(--atlas-text-3)" }}>{t.description}</p>
                        </div>
                        <ChevronRight size={11} className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: "var(--atlas-accent)" }} />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* ── RIGHT PANEL — AI Chat ── */}
            <div className="flex-1 flex flex-col overflow-hidden" style={{ background: "var(--atlas-bg)" }}>
              {/* Chat header */}
              <div className="px-5 py-2.5 flex items-center gap-2 flex-shrink-0" style={{ borderBottom: "1px solid var(--atlas-border)" }}>
                <div className="w-5 h-5 rounded-md flex items-center justify-center" style={{ background: "rgba(91,140,255,0.12)" }}>
                  <Sparkles size={11} style={{ color: "var(--atlas-accent)" }} />
                </div>
                <span className="text-sm font-medium" style={{ color: "var(--atlas-text)" }}>ATLAS AI</span>
                <div className="flex-1" />
                {isProcessing && (
                  <div className="flex items-center gap-1.5">
                    <Loader2 size={11} className="animate-spin" style={{ color: "var(--atlas-accent)" }} />
                    <span className="text-xs" style={{ color: "var(--atlas-text-2)", fontFamily: "'JetBrains Mono', monospace" }}>生成中...</span>
                  </div>
                )}
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
                {messages.length === 0 ? (
                  <EmptyChat hasFiles={hasFiles} onTemplate={t => setInput(t)} />
                ) : (
                  messages.map(msg => (
                    <MessageBubble key={msg.id} message={msg} onDownload={handleDownload} />
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input area */}
              <div className="px-4 pb-4 pt-3 flex-shrink-0" style={{ borderTop: "1px solid var(--atlas-border)" }}>
                {hasFiles && messages.length > 0 && messages.length < 6 && (
                  <div className="flex gap-2 mb-3 flex-wrap">
                    {["生成经营日报", "门店销售汇总", "平台对比分析", "商品排行榜"].map(p => (
                      <button key={p} onClick={() => handleSend(p)} className="atlas-chip">{p}</button>
                    ))}
                  </div>
                )}
                <div
                  className="rounded-xl overflow-hidden"
                  style={{ background: "var(--atlas-elevated)", border: "1px solid var(--atlas-border-2)", transition: "border-color 0.15s ease" }}
                  onFocusCapture={e => (e.currentTarget as HTMLElement).style.borderColor = "rgba(91,140,255,0.35)"}
                  onBlurCapture={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--atlas-border-2)"}
                >
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={hasFiles ? "描述报表需求，例如：帮我汇总14家门店销售..." : "上传文件后开始对话..."}
                    disabled={isGenerating}
                    rows={1}
                    className="w-full bg-transparent outline-none resize-none text-sm px-4 pt-3 pb-1"
                    style={{ color: "var(--atlas-text)", minHeight: 36, maxHeight: 140, fontFamily: "inherit" }}
                  />
                  <div className="flex items-center justify-between px-3 pb-2.5 pt-1">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="w-7 h-7 rounded-md flex items-center justify-center transition-colors"
                        style={{ color: "var(--atlas-text-3)" }}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-accent)"}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)"}
                        title="上传文件"
                      >
                        <Paperclip size={13} />
                      </button>
                      <span className="text-xs" style={{ color: "var(--atlas-text-3)" }}>Enter 发送 · Shift+Enter 换行</span>
                    </div>
                    <button
                      onClick={() => handleSend()}
                      disabled={!input.trim() || !hasFiles || isGenerating}
                      className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
                      style={{
                        background: input.trim() && hasFiles && !isGenerating ? "var(--atlas-accent)" : "var(--atlas-border)",
                        color: input.trim() && hasFiles && !isGenerating ? "#fff" : "var(--atlas-text-3)",
                      }}
                    >
                      {isGenerating ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Global drag overlay (when files already exist) ── */}
      <AnimatePresence>
        {isDragging && !isEmpty && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none"
            style={{ background: "rgba(10,12,16,0.88)", border: "2px dashed var(--atlas-accent)", borderRadius: "var(--atlas-radius)" }}
          >
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
                style={{ background: "rgba(91,140,255,0.15)", border: "1px solid rgba(91,140,255,0.3)" }}>
                <Upload size={28} style={{ color: "var(--atlas-accent)" }} />
              </div>
              <p className="text-base font-semibold" style={{ color: "var(--atlas-text)" }}>松开以上传文件</p>
              <p className="text-sm mt-1" style={{ color: "var(--atlas-text-2)" }}>支持 Excel / CSV</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FileCard({ file, onRemove }: { file: UploadedFile; onRemove: () => void }) {
  const sizeStr = file.size > 1024 * 1024
    ? `${(file.size / 1024 / 1024).toFixed(1)} MB`
    : `${Math.round(file.size / 1024)} KB`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg"
      style={{ background: "var(--atlas-elevated)", border: "1px solid var(--atlas-border)" }}
    >
      <div className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0" style={{ background: "rgba(91,140,255,0.1)" }}>
        {file.status === "uploading" ? (
          <Loader2 size={13} className="animate-spin" style={{ color: "var(--atlas-accent)" }} />
        ) : file.status === "error" ? (
          <X size={13} style={{ color: "var(--atlas-danger)" }} />
        ) : (
          <FileSpreadsheet size={13} style={{ color: "var(--atlas-accent)" }} />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate" style={{ color: "var(--atlas-text)" }}>{file.name}</p>
        <p className="text-xs" style={{ color: "var(--atlas-text-3)", fontFamily: "'JetBrains Mono', monospace" }}>
          {file.status === "uploading" ? "上传中..."
            : file.status === "error" ? "上传失败"
            : `${file.dfInfo?.row_count?.toLocaleString() || "—"} 行 · ${sizeStr}`}
        </p>
      </div>
      {file.status === "ready" && (
        <span className="text-xs px-1.5 py-0.5 rounded flex-shrink-0"
          style={{ background: "rgba(52,211,153,0.1)", color: "var(--atlas-success)", fontFamily: "'JetBrains Mono', monospace", fontSize: "10px" }}>
          ✓ 就绪
        </span>
      )}
      <button
        onClick={onRemove}
        className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 transition-colors"
        style={{ color: "var(--atlas-text-3)" }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-danger)"}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)"}
      >
        <X size={11} />
      </button>
    </motion.div>
  );
}

function MessageBubble({
  message,
  onDownload,
}: {
  message: { id: string; role: string; content: string; isStreaming?: boolean; report_id?: string; report_filename?: string; };
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
        <div className="max-w-[80%] px-4 py-2.5 rounded-xl"
          style={{ background: "rgba(91,140,255,0.12)", border: "1px solid rgba(91,140,255,0.2)" }}>
          <p className="text-sm leading-relaxed" style={{ color: "var(--atlas-text)" }}>{message.content}</p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} className="flex gap-2.5">
      <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{ background: "rgba(91,140,255,0.12)", border: "1px solid rgba(91,140,255,0.2)" }}>
        <Sparkles size={11} style={{ color: "var(--atlas-accent)" }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="px-4 py-3 rounded-xl" style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}>
          {message.isStreaming && !message.content ? (
            <div className="flex items-center gap-1.5 py-0.5">
              {[0, 1, 2].map(i => <div key={i} className="atlas-thinking-dot" style={{ animationDelay: `${i * 0.2}s` }} />)}
            </div>
          ) : (
            <div className="atlas-prose"><Streamdown>{message.content}</Streamdown></div>
          )}
        </div>
        {message.report_id && message.report_filename && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-2">
            <button
              onClick={() => onDownload(message.report_id!, message.report_filename!)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
              style={{ background: "rgba(91,140,255,0.1)", border: "1px solid rgba(91,140,255,0.25)", color: "var(--atlas-accent)" }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "rgba(91,140,255,0.18)"}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "rgba(91,140,255,0.1)"}
            >
              <Download size={13} />
              下载 {message.report_filename}
            </button>
          </motion.div>
        )}
        {message.content && !message.isStreaming && (
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 mt-1.5 text-xs transition-colors"
            style={{ color: copied ? "var(--atlas-success)" : "var(--atlas-text-3)" }}
          >
            {copied ? <Check size={10} /> : <Copy size={10} />}
            {copied ? "已复制" : "复制"}
          </button>
        )}
      </div>
    </motion.div>
  );
}

function EmptyChat({ hasFiles, onTemplate }: { hasFiles: boolean; onTemplate: (t: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full py-16 gap-5">
      <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.35 }}>
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
          style={{ background: "rgba(91,140,255,0.08)", border: "1px solid rgba(91,140,255,0.15)" }}>
          <BarChart2 size={22} style={{ color: "var(--atlas-accent)" }} />
        </div>
      </motion.div>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="text-center">
        <h3 className="text-base font-semibold mb-1.5" style={{ color: "var(--atlas-text)" }}>
          {hasFiles ? "文件已就绪，开始对话" : "上传数据，开始生成报表"}
        </h3>
        <p className="text-sm max-w-xs" style={{ color: "var(--atlas-text-2)" }}>
          {hasFiles
            ? "AI 已分析数据结构，告诉我你需要什么报表"
            : "把 Excel 或 CSV 文件拖到左侧，或点击上传按钮"}
        </p>
      </motion.div>
      {hasFiles && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="grid grid-cols-2 gap-2 w-full max-w-sm">
          {SYSTEM_TEMPLATES.slice(0, 4).map((t, i) => (
            <motion.button
              key={t.id}
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 + i * 0.05 }}
              onClick={() => onTemplate(t.prompt)}
              className="flex items-center gap-2 p-3 rounded-xl text-left transition-all"
              style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.borderColor = "rgba(91,140,255,0.3)";
                (e.currentTarget as HTMLElement).style.background = "rgba(91,140,255,0.04)";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.borderColor = "var(--atlas-border)";
                (e.currentTarget as HTMLElement).style.background = "var(--atlas-surface)";
              }}
            >
              <span className="text-lg">{t.icon}</span>
              <span className="text-xs font-medium" style={{ color: "var(--atlas-text-2)" }}>{t.name}</span>
            </motion.button>
          ))}
        </motion.div>
      )}
    </div>
  );
}
