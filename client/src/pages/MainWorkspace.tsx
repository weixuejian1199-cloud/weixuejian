/**
 * ATLAS V6.0 — Main Workspace (Conversational Delivery)
 * -------------------------------------------------------
 * P0 redesign: from "tool" to "intelligent assistant"
 * - Drag files in → AI greets + gives option buttons
 * - Click option → execute → show table preview + download
 * - Continuous chat, never ends, like WeChat
 * - Multiple files = same task (no new task per file)
 * - Font size: 14px (matches Manus)
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload, X, FileSpreadsheet, Sparkles, Send,
  Download, Loader2, Copy, Check, BarChart2, Paperclip,
  ChevronRight, Square,
} from "lucide-react";
import { Streamdown } from "streamdown";
import { useAtlas, type UploadedFile, type Message } from "@/contexts/AtlasContext";
import { uploadFile, chatStream, generateReport, getDownloadUrl, type SuggestedAction } from "@/lib/api";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { nanoid } from "nanoid";

// -- Suggested actions shown after upload (dynamic from backend, fallback below)
const DEFAULT_ACTIONS: SuggestedAction[] = [
  { icon: "📊", label: "生成汇总表", prompt: "帮我生成数据汇总表，包含关键指标和统计" },
  { icon: "🔍", label: "数据分析", prompt: "帮我分析这份数据，找出关键规律和异常值" },
  { icon: "🏆", label: "排名 Top10", prompt: "帮我找出数据中排名前10和后10的记录" },
  { icon: "✨", label: "自定义需求", prompt: "" },
];

// Post-delivery follow-up actions
const FOLLOWUP_ACTIONS: SuggestedAction[] = [
  { icon: "🔄", label: "再细化一下", prompt: "请对刚才的结果进行细化，增加更多维度的分析" },
  { icon: "📈", label: "换个格式", prompt: "请换一种格式重新生成，更清晰地展示数据" },
  { icon: "📋", label: "生成新报表", prompt: "我想生成另一份报表" },
  { icon: "💬", label: "继续分析", prompt: "请继续深入分析这份数据" },
];

export default function MainWorkspace() {
  const {
    uploadedFiles, addUploadedFile, updateUploadedFile, removeUploadedFile, clearFiles,
    messages, addMessage, updateLastMessage, clearMessages,
    isProcessing, setIsProcessing,
    addReport,
    activeTaskId, createNewTask, updateTask,
    tasks,
  } = useAtlas();

  const [input, setInput] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  // Store suggested actions from last upload (per-session)
  const [pendingActions, setPendingActions] = useState<SuggestedAction[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleStop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsGenerating(false);
    setIsProcessing(false);
  }, [setIsProcessing]);

  const readyFiles = uploadedFiles.filter(f => f.status === "ready");
  const hasFiles = readyFiles.length > 0;
  const hasAnyFiles = uploadedFiles.length > 0;

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + "px";
    }
  }, [input]);

  // -- File processing: multiple files go into the SAME task
  const processFile = useCallback(async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["xlsx", "xls", "csv"].includes(ext || "")) {
      toast.error(`不支持 .${ext} 格式，请上传 Excel 或 CSV`);
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      toast.error(`${file.name} 超过 50MB 限制`);
      return;
    }

    const tempId = nanoid();
    addUploadedFile({ id: tempId, name: file.name, size: file.size, status: "uploading", uploadedAt: new Date() });

    try {
      const result = await uploadFile(file);

      updateUploadedFile(tempId, {
        status: "ready",
        sessionId: result.session_id,
        dfInfo: {
          row_count: result.df_info.row_count,
          col_count: result.df_info.col_count,
          columns: (result.df_info.fields || []).map((f: any) => ({
            name: f.name,
            dtype: f.dtype,
            non_null_count: result.df_info.row_count - (f.null_count || 0),
            sample_values: f.sample || [],
            inferred_type: f.type || "text",
          })),
          preview: result.df_info.preview || [],
          file_size_kb: Math.round(file.size / 1024),
        },
      });

      // Update current task title with filename (use first file's name)
      if (activeTaskId) {
        const currentTask = tasks.find(t => t.id === activeTaskId);
        if (currentTask && currentTask.title === "新建任务") {
          updateTask(activeTaskId, { title: result.filename });
        }
      }

      // Store suggested actions from backend
      if (result.suggested_actions?.length) {
        setPendingActions(result.suggested_actions);
      } else {
        setPendingActions(DEFAULT_ACTIONS);
      }

      // Show AI greeting with suggested actions embedded in message
      addMessage({
        role: "assistant",
        content: result.ai_analysis,
        // @ts-ignore - extended field for suggested actions
        suggestedActions: result.suggested_actions || DEFAULT_ACTIONS,
      });

    } catch (err: any) {
      updateUploadedFile(tempId, { status: "error" });
      toast.error(`${file.name} 上传失败：${err.message}`);
    }
  }, [addUploadedFile, updateUploadedFile, addMessage, activeTaskId, tasks, updateTask]);

  const handleFiles = useCallback((files: FileList | File[]) => {
    // Ensure we have an active task
    if (!activeTaskId) {
      createNewTask();
    }
    Array.from(files).forEach(processFile);
  }, [processFile, activeTaskId, createNewTask]);

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  // -- Send message (supports quick action click)
  const handleSend = useCallback(async (text?: string, isQuickAction = false) => {
    const msg = (text || input).trim();
    if (!msg || isGenerating) return;

    setInput("");
    setIsGenerating(true);
    setPendingActions([]); // Clear pending actions when user sends

    addMessage({ role: "user", content: msg });
    addMessage({ role: "assistant", content: "", isStreaming: true });

    // Auto-generate task title from first user message
    if (activeTaskId) {
      const currentTask = tasks.find(t => t.id === activeTaskId);
      const isFirstMessage = currentTask?.messages.filter(m => m.role === "user").length === 0;
      if (isFirstMessage && (currentTask?.title === "新建任务" || !currentTask?.title)) {
        // Generate a concise title: take first 20 chars of message, strip punctuation at end
        const autoTitle = msg.replace(/[，。！？,.!?]+$/, "").slice(0, 20) + (msg.length > 20 ? "..." : "");
        updateTask(activeTaskId, { title: autoTitle });
      }
    }

    // Use all ready session IDs (multi-file support)
    const sessionIds = readyFiles.map(f => f.sessionId).filter(Boolean) as string[];
    const primarySessionId = sessionIds[0];

    // Detect if user wants a report/table generated
    // IMPORTANT: Analysis words like 「分析」「汇总」「统计」「可视化」 do NOT trigger report generation
    // They go through chat pathway so AI can provide insights first
    // isReport: only trigger report generation when user explicitly asks to CREATE/GENERATE
    // Analysis/tutorial questions like 「怎么算工资条」「工资条需要什么资料」go through chat path
    // isReport: only trigger report generation when user explicitly asks to CREATE/GENERATE
    // Analysis/tutorial questions like 「怎么算工资条」「工资条需要什么资料」go through chat path
    // Queries like 「报表在哪里」「历史报表」 also go through chat path
    const isReport = /生成报表|导出表格|excel表|xlsx表|日报生成|(帮我|(帮我)?生成|(帮我)?制作|(帮我)?做一份|(帮我)?做个|(帮我)?输出|(帮我)?整理成|(帮我)?提取).{0,8}(工资条|工资单|薪资表|薪酬表|分红明细|考勤表|出勤表|财务报表|销售报表|绩效表|奖金表|扣款表|个税表|实发明细|表格)|排名表|对比表/i.test(msg);

    // Helper: parse 【①】方向名 format from AI reply into action buttons
    const parseInlineOptions = (text: string): SuggestedAction[] => {
      const matches = Array.from(text.matchAll(/【([①②③④⑤⑥⑦⑧⑨⑩\d])】\s*([^\n【]+)/g));
      if (matches.length === 0) return FOLLOWUP_ACTIONS;
      const icons = ['📊', '📈', '🔍', '⚡', '🎯', '📋', '💡', '🔢'];
      return [
        ...matches.map((m, i) => ({
          label: m[2].trim(),
          prompt: m[2].trim(),
          icon: icons[i % icons.length],
        })),
        { label: '自定义需求', prompt: '', icon: '✏️' },
      ];
    };

    // Create new AbortController for this request
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      if (isReport && primarySessionId) {
        setIsProcessing(true);
        updateLastMessage("好的，马上为您生成...");

        let result;
        try {
          result = await generateReport(primarySessionId, msg);
        } catch (reportErr: any) {
          const errMsg = reportErr.message || "未知错误";
          updateLastMessage(`生成失败：${errMsg}\n\n请检查数据格式或换个描述方式重试。`);
          toast.error(`生成失败：${errMsg}`);
          setInput(msg);
          return;
        }

        // Show result with table data and download button
        updateLastMessage(result.ai_message, {
          report_id: result.report_id,
          report_filename: result.filename,
          tableData: result.plan?.sheets || [],
          // @ts-ignore
          suggestedActions: FOLLOWUP_ACTIONS,
        });

        addReport({
          id: result.report_id,
          title: msg.slice(0, 30),
          filename: result.filename,
          created_at: new Date().toISOString(),
          session_id: primarySessionId,
          status: "completed",
        });

        toast.success("报表生成成功！");

      } else {
        // Streaming AI chat
        const history = messages
          .filter(m => m.role === "user" || (m.role === "assistant" && m.content && !m.isStreaming))
          .slice(-8)
          .map(m => ({ role: m.role as "user" | "assistant", content: m.content }));

        let accumulated = "";
        await chatStream({
          sessionIds,
          message: msg,
          history,
          signal: abortController.signal,
          onChunk: (chunk) => {
            accumulated += chunk;
            updateLastMessage(accumulated);
          },
          onDone: (fullText) => {
            const finalText = fullText || accumulated;
            const parsedActions = parseInlineOptions(finalText);
            updateLastMessage(finalText, {
              // @ts-ignore
              suggestedActions: parsedActions,
            });
          },
          onError: (err) => {
            const errMsg = err.message || "请求失败";
            updateLastMessage(`对话失败：${errMsg}\n\n请稍后重试。`);
            toast.error("对话失败，请重试");
            setInput(msg);
          },
          onTelegramTask: (taskId, pendingMsg) => {
            // Show pending message immediately
            updateLastMessage(pendingMsg, { isStreaming: false });
            // Start polling for task completion (every 10s, max 20 times = 200s)
            let attempts = 0;
            const maxAttempts = 20;
            const pollInterval = setInterval(async () => {
              attempts++;
              try {
                const r = await fetch(`/api/atlas/task/${taskId}/status`, { credentials: "include" });
                if (!r.ok) return;
                const data = await r.json() as { status: string; reply?: string; output_files?: Array<{ name: string; fileUrl: string }> };
                if (data.status === "completed" && data.reply) {
                  clearInterval(pollInterval);
                  const parsedActions = parseInlineOptions(data.reply);
                  let finalMsg = data.reply;
                  if (data.output_files && data.output_files.length > 0) {
                    finalMsg += "\n\n📄 **输出文件**\n" + data.output_files.map(f => `- [${f.name}](${f.fileUrl})`).join("\n");
                  }
                  updateLastMessage(finalMsg, { suggestedActions: parsedActions } as any);
                  toast.success("任务已完成！");
                  setIsGenerating(false);
                } else if (data.status === "error") {
                  clearInterval(pollInterval);
                  updateLastMessage(`处理失败，请重试。`);
                  setIsGenerating(false);
                } else if (attempts >= maxAttempts) {
                  clearInterval(pollInterval);
                  updateLastMessage(pendingMsg + "\n\n⏰ 处理时间较长，请稍后刷新页面查看结果。");
                  setIsGenerating(false);
                }
              } catch (e) {
                console.warn("[Poll] task status error:", e);
              }
            }, 10_000);
          },
        });
      }
    } catch (err: any) {
      const errMsg = err.message || "请检查网络连接";
      updateLastMessage(`处理失败：${errMsg}`);
      toast.error("请求失败，请重试");
      setInput(msg);
    } finally {
      abortControllerRef.current = null;
      setIsGenerating(false);
      setIsProcessing(false);
    }
  }, [input, isGenerating, hasFiles, readyFiles, messages, addMessage, updateLastMessage, setIsProcessing, addReport]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleDownload = (reportId: string, filename: string) => {
    const a = document.createElement("a");
    a.href = getDownloadUrl(reportId);
    a.download = filename;
    a.click();
    toast.success("开始下载");
  };

  const handleQuickAction = useCallback((prompt: string) => {
    if (!prompt) {
      // "自定义需求" — focus input
      textareaRef.current?.focus();
      return;
    }
    handleSend(prompt, true);
  }, [handleSend]);

  // -- Render
  return (
    <div
      className="flex flex-col h-full overflow-hidden relative"
      style={{ background: "var(--atlas-bg)" }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={e => e.target.files && handleFiles(e.target.files)}
      />

      {/* Header */}
      <div
        className="px-5 py-2.5 flex items-center gap-2.5 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--atlas-border)" }}
      >
        <div
          className="w-6 h-6 rounded-md flex items-center justify-center"
          style={{ background: "rgba(91,140,255,0.12)" }}
        >
          <Sparkles size={13} style={{ color: "var(--atlas-accent)" }} />
        </div>
        <span className="text-sm font-semibold" style={{ color: "var(--atlas-text)" }}>ATLAS AI</span>

        {hasAnyFiles && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {uploadedFiles.map(f => (
              <span
                key={f.id}
                className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full group/chip"
                style={{
                  background: f.status === "ready" ? "rgba(52,211,153,0.1)" : "rgba(91,140,255,0.1)",
                  color: f.status === "ready" ? "var(--atlas-success)" : "var(--atlas-accent)",
                  border: `1px solid ${f.status === "ready" ? "rgba(52,211,153,0.2)" : "rgba(91,140,255,0.2)"}`,
                }}
              >
                {f.status === "uploading"
                  ? <Loader2 size={9} className="animate-spin" />
                  : <FileSpreadsheet size={9} />
                }
                <span className="max-w-[100px] truncate">{f.name}</span>
                {f.status === "ready" && f.dfInfo && (
                  <span style={{ opacity: 0.7 }}>{f.dfInfo.row_count.toLocaleString()}行</span>
                )}
                {f.status !== "uploading" && (
                  <button
                    onClick={e => { e.stopPropagation(); removeUploadedFile(f.id); }}
                    className="ml-0.5 rounded-full flex items-center justify-center opacity-0 group-hover/chip:opacity-100 transition-opacity hover:bg-black/20"
                    style={{ width: 12, height: 12, flexShrink: 0 }}
                    title={`删除 ${f.name}`}
                  >
                    <X size={8} />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}

        <div className="flex-1" />

        {isProcessing && (
          <div className="flex items-center gap-1.5">
            <Loader2 size={12} className="animate-spin" style={{ color: "var(--atlas-accent)" }} />
            <span className="text-xs" style={{ color: "var(--atlas-text-2)" }}>生成中...</span>
          </div>
        )}

        {(hasAnyFiles || messages.length > 0) && (
          <button
            onClick={() => { clearFiles(); clearMessages(); setPendingActions([]); }}
            className="text-xs transition-colors"
            style={{ color: "var(--atlas-text-3)" }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-2)"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)"}
          >
            清空
          </button>
        )}
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto">
        <div className={
          messages.length === 0
            ? "h-full flex items-center justify-center px-6"
            : "w-full max-w-4xl mx-auto px-6 py-5 space-y-4"
        }>
          {messages.length === 0 ? (
            <EmptyState onUpload={() => fileInputRef.current?.click()} onQuickAsk={(q) => handleSend(q)} />
          ) : (
            messages.map((msg, idx) => {
              const isLastAssistant =
                msg.role === "assistant" &&
                idx === messages.length - 1;
              return (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  onDownload={handleDownload}
                  onQuickAction={isLastAssistant && !msg.isStreaming ? handleQuickAction : undefined}
                  isLastAssistant={isLastAssistant}
                />
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Bottom input area */}
      <div className="flex-shrink-0" style={{ borderTop: "1px solid var(--atlas-border)" }}>
        <div className="w-full max-w-4xl mx-auto px-6 pt-3 pb-4">

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
              placeholder={
                hasFiles
                  ? "描述你的需求，例如：帮我提取姓名和工资，生成汇总表..."
                  : "直接提问，或拖入 Excel/CSV 文件开始分析..."
              }
              disabled={isGenerating}
              rows={1}
              className="w-full bg-transparent outline-none resize-none px-4 pt-3 pb-1"
              style={{
                color: "var(--atlas-text)",
                fontSize: "14px",
                lineHeight: "1.6",
                minHeight: 42,
                maxHeight: 160,
                fontFamily: "inherit",
              }}
            />
            <div className="flex items-center justify-between px-3 pb-2.5 pt-1">
              <div className="flex items-center gap-2">
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
                  <Paperclip size={12} />
                  上传文件
                </button>
                <span className="text-xs" style={{ color: "var(--atlas-text-3)" }}>
                  Enter 发送
                </span>
              </div>
              {isGenerating ? (
                <button
                  onClick={handleStop}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all"
                  style={{
                    background: "rgba(239,68,68,0.12)",
                    border: "1px solid rgba(239,68,68,0.25)",
                    color: "#ef4444",
                    transition: "all 0.15s ease",
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.background = "rgba(239,68,68,0.2)";
                    (e.currentTarget as HTMLElement).style.borderColor = "rgba(239,68,68,0.45)";
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.background = "rgba(239,68,68,0.12)";
                    (e.currentTarget as HTMLElement).style.borderColor = "rgba(239,68,68,0.25)";
                  }}
                >
                  <Square size={11} fill="currentColor" />
                  停止
                </button>
              ) : (
                <button
                  onClick={() => handleSend()}
                  disabled={!input.trim()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all"
                  style={{
                    background: input.trim() ? "var(--atlas-accent)" : "var(--atlas-border)",
                    color: input.trim() ? "#fff" : "var(--atlas-text-3)",
                    transition: "all 0.15s ease",
                  }}
                >
                  <Send size={13} />
                  发送
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Drag overlay */}
      <AnimatePresence>
        {isDragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none"
            style={{
              background: "rgba(10,12,16,0.9)",
              border: "2px dashed var(--atlas-accent)",
            }}
          >
            <div className="text-center">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
                style={{ background: "rgba(91,140,255,0.15)", border: "1px solid rgba(91,140,255,0.3)" }}
              >
                <Upload size={28} style={{ color: "var(--atlas-accent)" }} />
              </div>
              <p className="text-lg font-semibold mb-1" style={{ color: "var(--atlas-text)" }}>
                松开，把数据交给 ATLAS
              </p>
              <p className="text-sm" style={{ color: "var(--atlas-text-2)" }}>
                支持 Excel / CSV，可同时拖入多个文件
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// -- MessageBubble ---------------------------------------------------------------

function MessageBubble({
  message,
  onDownload,
  onQuickAction,
  isLastAssistant,
}: {
  message: Message & { suggestedActions?: SuggestedAction[] };
  onDownload: (id: string, filename: string) => void;
  onQuickAction?: (prompt: string) => void;
  isLastAssistant?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [showTable, setShowTable] = useState(true);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // @ts-ignore
  const actions: SuggestedAction[] = message.suggestedActions || [];

  if (message.role === "user") {
    return (
      <motion.div
        initial={{ opacity: 0, x: 12 }}
        animate={{ opacity: 1, x: 0 }}
        className="flex justify-end"
      >
        <div
          className="max-w-[72%] px-4 py-2.5 rounded-2xl"
          style={{
            background: "rgba(91,140,255,0.12)",
            border: "1px solid rgba(91,140,255,0.2)",
          }}
        >
          <p style={{ color: "var(--atlas-text)", fontSize: "14px", lineHeight: "1.6" }}>
            {message.content}
          </p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      className="flex gap-2.5"
    >
      {/* Avatar */}
      <div
        className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{
          background: "rgba(91,140,255,0.12)",
          border: "1px solid rgba(91,140,255,0.2)",
        }}
      >
        <Sparkles size={12} style={{ color: "var(--atlas-accent)" }} />
      </div>

      <div className="flex-1 min-w-0">
        {/* Message bubble */}
        <div
          className="px-4 py-3 rounded-2xl"
          style={{
            background: "var(--atlas-surface)",
            border: "1px solid var(--atlas-border)",
          }}
        >
          {message.isStreaming && !message.content ? (
            <div className="flex items-center gap-1.5 py-0.5">
              {[0, 1, 2].map(i => (
                <div
                  key={i}
                  className="atlas-thinking-dot"
                  style={{ animationDelay: `${i * 0.2}s` }}
                />
              ))}
            </div>
          ) : (
            <div
              className="atlas-prose"
              style={{ fontSize: "14px", lineHeight: "1.7" }}
            >
              <Streamdown>{message.content}</Streamdown>
            </div>
          )}
        </div>

        {/* Table preview (if report has sheets) */}
        {message.tableData && message.tableData.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="mt-2.5"
          >
            <div
              className="rounded-xl overflow-hidden"
              style={{
                border: "1px solid var(--atlas-border)",
                background: "var(--atlas-surface)",
              }}
            >
              {/* Table header */}
              <div
                className="flex items-center justify-between px-4 py-2.5"
                style={{ borderBottom: "1px solid var(--atlas-border)" }}
              >
                <div className="flex items-center gap-2">
                  <BarChart2 size={13} style={{ color: "var(--atlas-accent)" }} />
                  <span className="text-xs font-medium" style={{ color: "var(--atlas-text-2)" }}>
                    {message.tableData[0]?.name || "数据预览"}
                    {message.tableData[0]?.rows?.length > 0 && (
                      <span style={{ color: "var(--atlas-text-3)", marginLeft: 6 }}>
                        {message.tableData[0].rows.length} 行
                      </span>
                    )}
                  </span>
                </div>
                <button
                  onClick={() => setShowTable(v => !v)}
                  className="text-xs transition-colors"
                  style={{ color: "var(--atlas-text-3)" }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-2)"}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)"}
                >
                  {showTable ? "收起" : "展开"}
                </button>
              </div>

              {/* Table content */}
              {showTable && (
                <div className="overflow-x-auto max-h-64">
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ background: "var(--atlas-elevated)" }}>
                        {message.tableData[0]?.headers?.map((h, i) => (
                          <th
                            key={i}
                            className="px-3 py-2 text-left font-medium whitespace-nowrap"
                            style={{
                              color: "var(--atlas-text-2)",
                              borderBottom: "1px solid var(--atlas-border)",
                            }}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {message.tableData[0]?.rows?.slice(0, 20).map((row, ri) => (
                        <tr
                          key={ri}
                          style={{
                            borderBottom: "1px solid var(--atlas-border)",
                            background: ri % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)",
                          }}
                        >
                          {row.map((cell, ci) => (
                            <td
                              key={ci}
                              className="px-3 py-2 whitespace-nowrap"
                              style={{ color: "var(--atlas-text)" }}
                            >
                              {String(cell ?? "")}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {message.tableData[0]?.rows?.length > 20 && (
                    <div
                      className="px-3 py-2 text-xs text-center"
                      style={{ color: "var(--atlas-text-3)", borderTop: "1px solid var(--atlas-border)" }}
                    >
                      仅显示前 20 行，下载 Excel 查看完整数据
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* Download button */}
        {message.report_id && message.report_filename && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="mt-2"
          >
            <button
              onClick={() => onDownload(message.report_id!, message.report_filename!)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl font-medium transition-all text-sm"
              style={{
                background: "rgba(52,211,153,0.1)",
                border: "1px solid rgba(52,211,153,0.25)",
                color: "var(--atlas-success)",
              }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "rgba(52,211,153,0.18)"}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "rgba(52,211,153,0.1)"}
            >
              <Download size={14} />
              下载 {message.report_filename}
            </button>
          </motion.div>
        )}

        {/* Copy button */}
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

        {/* Suggested action buttons */}
        {isLastAssistant && !message.isStreaming && actions.length > 0 && onQuickAction && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className="mt-3 flex flex-wrap gap-1.5"
          >
            {actions.map((action, i) => (
              <button
                key={i}
                onClick={() => onQuickAction(action.prompt)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={{
                  background: "var(--atlas-elevated)",
                  border: "1px solid var(--atlas-border-2)",
                  color: "var(--atlas-text-2)",
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = "rgba(91,140,255,0.5)";
                  (e.currentTarget as HTMLElement).style.color = "var(--atlas-accent)";
                  (e.currentTarget as HTMLElement).style.background = "rgba(91,140,255,0.06)";
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = "var(--atlas-border-2)";
                  (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-2)";
                  (e.currentTarget as HTMLElement).style.background = "var(--atlas-elevated)";
                }}
              >
                <span>{action.icon}</span>
                <span>{action.label}</span>
                {action.prompt === "" && <ChevronRight size={10} />}
              </button>
            ))}
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

// -- EmptyState ------------------------------------------------------------------

function EmptyState({ onUpload, onQuickAsk }: { onUpload: () => void; onQuickAsk: (q: string) => void }) {
  const quickQuestions = [
    { icon: "💰", label: "怎么算工资条？", q: "怎么算工资条？需要提供什么资料？" },
    { icon: "📅", label: "怎么做考勤汇总？", q: "怎么做考勤汇总？需要什么数据？" },
    { icon: "🏪", label: "多店铺数据怎么汇总？", q: "我有多家店铺的数据，怎么汇总在一起？" },
    { icon: "📊", label: "历史报表在哪里？", q: "我之前生成的报表在哪里查看和下载？" },
    { icon: "🔍", label: "能帮我分析什么？", q: "ATLAS 能帮我分析哪些类型的数据？" },
    { icon: "💸", label: "怎么算分红？", q: "怎么计算分红明细？需要提供什么数据？" },
  ];

  return (
    <div className="flex flex-col items-center justify-center gap-8 w-full max-w-2xl mx-auto text-center">
      {/* Brand — primary visual focus */}
      <motion.div
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="flex flex-col items-center gap-4"
      >
        {/* Logo mark */}
        <div
          className="w-20 h-20 rounded-3xl flex items-center justify-center"
          style={{
            background: "linear-gradient(135deg, rgba(91,140,255,0.15) 0%, rgba(91,140,255,0.06) 100%)",
            border: "1px solid rgba(91,140,255,0.22)",
            boxShadow: "0 8px 32px rgba(91,140,255,0.12)",
          }}
        >
          <BarChart2 size={36} style={{ color: "var(--atlas-accent)" }} />
        </div>
        {/* Brand name + tagline */}
        <div className="flex flex-col items-center gap-1.5">
          <h2
            className="font-bold tracking-tight"
            style={{ color: "var(--atlas-text)", fontSize: "26px", letterSpacing: "-0.5px" }}
          >
            ATLAS
          </h2>
          <p
            style={{
              color: "var(--atlas-accent)",
              fontSize: "13px",
              letterSpacing: "0.06em",
              fontWeight: 500,
              opacity: 0.85,
            }}
          >
            行政 · 财务 · 数据分析 三合一智能助手
          </p>
        </div>
      </motion.div>

      {/* Quick questions — smaller, secondary */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="w-full"
      >
        <p className="text-xs mb-2.5" style={{ color: "var(--atlas-text-3)", letterSpacing: "0.02em" }}>直接提问，或上传文件开始分析</p>
        <div className="grid grid-cols-3 gap-1.5">
          {quickQuestions.map((q, i) => (
            <motion.button
              key={i}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 + i * 0.03 }}
              onClick={() => onQuickAsk(q.q)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-left transition-all"
              style={{
                background: "var(--atlas-elevated)",
                border: "1px solid var(--atlas-border)",
                color: "var(--atlas-text-3)",
                fontSize: "11.5px",
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.borderColor = "rgba(91,140,255,0.35)";
                (e.currentTarget as HTMLElement).style.color = "var(--atlas-accent)";
                (e.currentTarget as HTMLElement).style.background = "rgba(91,140,255,0.04)";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.borderColor = "var(--atlas-border)";
                (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)";
                (e.currentTarget as HTMLElement).style.background = "var(--atlas-elevated)";
              }}
            >
              <span style={{ fontSize: "13px", flexShrink: 0 }}>{q.icon}</span>
              <span className="truncate">{q.label}</span>
            </motion.button>
          ))}
        </div>
      </motion.div>

      {/* Drop zone */}
      <motion.button
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        onClick={onUpload}
        className="w-full rounded-xl py-5 flex items-center justify-center gap-3 transition-all"
        style={{
          border: "2px dashed rgba(91,140,255,0.2)",
          background: "rgba(91,140,255,0.02)",
          color: "var(--atlas-text-3)",
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLElement).style.borderColor = "rgba(91,140,255,0.45)";
          (e.currentTarget as HTMLElement).style.background = "rgba(91,140,255,0.05)";
          (e.currentTarget as HTMLElement).style.color = "var(--atlas-accent)";
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLElement).style.borderColor = "rgba(91,140,255,0.2)";
          (e.currentTarget as HTMLElement).style.background = "rgba(91,140,255,0.02)";
          (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)";
        }}
      >
        <Upload size={18} />
        <span className="text-sm">拖入 Excel / CSV 文件，或点击上传（支持多文件）</span>
      </motion.button>
    </div>
  );
}
