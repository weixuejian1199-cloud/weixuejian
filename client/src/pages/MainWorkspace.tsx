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
import { AtlasTableRenderer, parseAtlasTableBlocks } from "@/components/AtlasTableRenderer";
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
  const [activeFileMenu, setActiveFileMenu] = useState<string | null>(null);
  // Store suggested actions from last upload (per-session)
  const [pendingActions, setPendingActions] = useState<SuggestedAction[]>([]);
  const [showMorePanel, setShowMorePanel] = useState(false);
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

  // Helper: strip <suggestions> block from text and parse into SuggestedAction[]
  const parseSuggestions = useCallback((text: string): { cleanText: string; suggestions: SuggestedAction[] } => {
    const match = text.match(/<suggestions>\s*([\s\S]*?)\s*<\/suggestions>/);
    if (!match) return { cleanText: text, suggestions: [] };
    const cleanText = text.replace(/<suggestions>[\s\S]*?<\/suggestions>/, "").trimEnd();
    try {
      const arr: string[] = JSON.parse(match[1].trim());
      const icons = ["\u{1F4AC}", "\u{1F4CA}", "\u{1F50D}", "\u{1F4DD}", "\u26A1", "\u{1F4CB}"];
      const suggestions: SuggestedAction[] = arr.slice(0, 3).map((label, i) => ({
        icon: icons[i % icons.length],
        label,
        prompt: label,
      }));
      return { cleanText, suggestions };
    } catch {
      return { cleanText, suggestions: [] };
    }
  }, []);

  // Helper: parse 【①】方向名 format from AI reply into action buttons
  const parseInlineOptions = useCallback((text: string): SuggestedAction[] => {
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
  }, []);

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
            // Strip <suggestions> block from visible text during streaming
            const visibleText = accumulated.replace(/<suggestions>[\s\S]*?<\/suggestions>/, "").replace(/<suggestions>[\s\S]*$/, "");
            updateLastMessage(visibleText);
          },
          onDone: (fullText) => {
            const finalText = fullText || accumulated;
            // First try to extract <suggestions> block
            const { cleanText, suggestions } = parseSuggestions(finalText);
            const parsedActions = suggestions.length > 0 ? suggestions : parseInlineOptions(cleanText);
            updateLastMessage(cleanText, {
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
            // Start polling for task completion (every 10s, max 60 times = 600s / 10 min)
            let attempts = 0;
            const maxAttempts = 60;
            const pollInterval = setInterval(async () => {
              attempts++;
              try {
                const r = await fetch(`/api/atlas/task/${taskId}/status`, { credentials: "include" });
                if (!r.ok) return;
                const data = await r.json() as { status: string; reply?: string; error_msg?: string; output_files?: Array<{ name: string; fileUrl: string }> };
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
                } else if (data.status === "failed" || data.status === "error") {
                  clearInterval(pollInterval);
                  const errDetail = data.error_msg || "处理失败，请重试";
                  updateLastMessage(`❌ ${errDetail}\n\n请重新发送消息，或上传文件后再试。`);
                  toast.error(errDetail);
                  setIsGenerating(false);
                } else if (attempts >= maxAttempts) {
                  clearInterval(pollInterval);
                  updateLastMessage(pendingMsg + "\n\n⏰ 任务超时（10分钟无响应），请重新发送消息重试。");
                  toast.error("任务超时，请重试");
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
  }, [input, isGenerating, hasFiles, readyFiles, messages, addMessage, updateLastMessage, setIsProcessing, addReport, parseSuggestions, parseInlineOptions]);

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
          <div className="flex items-center gap-1.5 flex-wrap" style={{ position: "relative" }}>
            {uploadedFiles.map(f => (
              <span
                key={f.id}
                className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full group/chip"
                style={{
                  position: "relative",
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
                    onClick={e => {
                      e.stopPropagation();
                      e.preventDefault();
                      removeUploadedFile(f.id);
                    }}
                    className="ml-0.5 rounded-full flex items-center justify-center opacity-0 group-hover/chip:opacity-100 transition-opacity hover:bg-black/20"
                    style={{ width: 14, height: 14, flexShrink: 0, fontSize: "11px", lineHeight: 1, color: "currentColor" }}
                    title="删除文件"
                  >
                    <X size={9} />
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

      {/* Quick action pills — always visible below input */}
      {!isGenerating && messages.length === 0 && (
        <div className="flex-shrink-0 pb-3">
          <div className="w-full max-w-4xl mx-auto px-6">
            <div className="flex items-center gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
              {[
                { icon: "📊", label: "生成汇总报表", q: "帮我把上传的数据汇总生成报表" },
                { icon: "🏪", label: "多门店数据合并", q: "我有多家门店的数据，帮我合并汇总到一张表" },
                { icon: "💰", label: "生成工资条", q: "帮我生成工资条" },
                { icon: "📈", label: "销售数据分析", q: "帮我分析销售数据，找出趋势和排名" },
                { icon: "💸", label: "计算分红", q: "帮我计算分红明细" },
                { icon: "📅", label: "考勤汇总", q: "帮我汇总考勤数据" },
              ].map((pill, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setInput(pill.q);
                    setTimeout(() => textareaRef.current?.focus(), 50);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs whitespace-nowrap flex-shrink-0 transition-all"
                  style={{
                    background: "var(--atlas-elevated)",
                    border: "1px solid var(--atlas-border)",
                    color: "var(--atlas-text-2)",
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.borderColor = "rgba(91,140,255,0.4)";
                    (e.currentTarget as HTMLElement).style.color = "var(--atlas-accent)";
                    (e.currentTarget as HTMLElement).style.background = "rgba(91,140,255,0.06)";
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.borderColor = "var(--atlas-border)";
                    (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-2)";
                    (e.currentTarget as HTMLElement).style.background = "var(--atlas-elevated)";
                  }}
                >
                  <span style={{ fontSize: "12px" }}>{pill.icon}</span>
                  <span>{pill.label}</span>
                </button>
              ))}

              {/* 更多 button */}
              <button
                onClick={() => setShowMorePanel(v => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs whitespace-nowrap flex-shrink-0 transition-all"
                style={{
                  background: showMorePanel ? "rgba(91,140,255,0.1)" : "var(--atlas-elevated)",
                  border: `1px solid ${showMorePanel ? "rgba(91,140,255,0.4)" : "var(--atlas-border)"}`,
                  color: showMorePanel ? "var(--atlas-accent)" : "var(--atlas-text-2)",
                }}
              >
                <span>更多</span>
                <span style={{ fontSize: "10px", opacity: 0.7 }}>{showMorePanel ? "▲" : "▼"}</span>
              </button>
            </div>

            {/* More panel */}
            <AnimatePresence>
              {showMorePanel && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.18 }}
                  className="mt-3"
                >
                  <div
                    className="rounded-2xl p-4"
                    style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}
                  >
                    {[
                      {
                        category: "📊 报表生成",
                        items: [
                          { label: "生成销售汇总报表", q: "帮我生成销售汇总报表，包含各维度统计" },
                          { label: "多门店对比表", q: "帮我生成多门店数据对比表" },
                          { label: "月度/季度趋势报表", q: "帮我生成月度趋势报表，展示数据变化" },
                          { label: "自定义格式报表", q: "帮我按自定义格式生成报表" },
                        ],
                      },
                      {
                        category: "💰 HR 薪资",
                        items: [
                          { label: "生成工资条", q: "帮我生成工资条，每人一张" },
                          { label: "计算绩效奖金", q: "帮我根据数据计算绩效奖金" },
                          { label: "计算分红明细", q: "帮我计算分红明细" },
                          { label: "统计出勤与工资", q: "帮我统计出勤天数并计算对应工资" },
                        ],
                      },
                      {
                        category: "📅 考勤管理",
                        items: [
                          { label: "汇总考勤数据", q: "帮我汇总考勤数据" },
                          { label: "统计迟到/早退/缺勤", q: "帮我统计迟到、早退、缺勤情况" },
                          { label: "生成月度考勤报告", q: "帮我生成月度考勤报告" },
                        ],
                      },
                      {
                        category: "🔍 数据分析",
                        items: [
                          { label: "找出排名前10", q: "帮我找出数据中排名前10的记录" },
                          { label: "分析数据异常", q: "帮我找出数据中的异常值、负值或重复记录" },
                          { label: "按时间段对比", q: "帮我对比不同时间段的数据变化" },
                          { label: "计算同比/环比", q: "帮我计算数据的同比和环比增长率" },
                        ],
                      },
                      {
                        category: "📁 文件处理",
                        items: [
                          { label: "合并多个 Excel", q: "帮我把多个 Excel 文件合并成一张表" },
                          { label: "按条件拆分表格", q: "帮我按某个字段把表格拆分成多个分组" },
                          { label: "清洗数据", q: "帮我清洗数据，去除重复行和空值" },
                        ],
                      },
                    ].map((group, gi) => (
                      <div key={gi} className={gi > 0 ? "mt-4" : ""}>
                        <div
                          className="text-xs font-medium mb-2"
                          style={{ color: "var(--atlas-text-2)" }}
                        >
                          {group.category}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {group.items.map((item, ii) => (
                            <button
                              key={ii}
                              onClick={() => {
                                setInput(item.q);
                                setShowMorePanel(false);
                                setTimeout(() => textareaRef.current?.focus(), 50);
                              }}
                              className="px-3 py-1.5 rounded-lg text-xs transition-all"
                              style={{
                                background: "var(--atlas-elevated)",
                                border: "1px solid var(--atlas-border)",
                                color: "var(--atlas-text-2)",
                              }}
                              onMouseEnter={e => {
                                (e.currentTarget as HTMLElement).style.borderColor = "rgba(91,140,255,0.4)";
                                (e.currentTarget as HTMLElement).style.color = "var(--atlas-accent)";
                                (e.currentTarget as HTMLElement).style.background = "rgba(91,140,255,0.06)";
                              }}
                              onMouseLeave={e => {
                                (e.currentTarget as HTMLElement).style.borderColor = "var(--atlas-border)";
                                (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-2)";
                                (e.currentTarget as HTMLElement).style.background = "var(--atlas-elevated)";
                              }}
                            >
                              {item.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}

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

// -- TaskCompleteBar ----------------------------------------------------------
// Shown when a report is generated: ✅ task done + ⭐ star rating

function TaskCompleteBar({ reportId, messagePreview }: { reportId: string; messagePreview: string }) {
  const [starRating, setStarRating] = useState<number | null>(null);
  const [hoverStar, setHoverStar] = useState<number | null>(null);
  const submitFeedback = trpc.messageFeedback.submit.useMutation();

  const handleStar = (star: number) => {
    if (starRating !== null) return;
    setStarRating(star);
    submitFeedback.mutate({
      rating: star >= 3 ? 1 : -1,
      messagePreview: `[Report:${reportId}] ${messagePreview}`,
      comment: `星级评分: ${star}/5`,
      context: "report-complete",
    });
  };

  return (
    <div
      className="flex items-center justify-between px-4 py-2.5 rounded-xl"
      style={{
        background: "rgba(52,211,153,0.06)",
        border: "1px solid rgba(52,211,153,0.18)",
      }}
    >
      {/* Left: task complete */}
      <div className="flex items-center gap-2">
        <div
          className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ background: "rgba(52,211,153,0.15)", border: "1px solid rgba(52,211,153,0.3)" }}
        >
          <Check size={11} style={{ color: "var(--atlas-success)" }} />
        </div>
        <span className="text-sm font-medium" style={{ color: "var(--atlas-success)" }}>任务已完成</span>
      </div>

      {/* Right: star rating */}
      <div className="flex items-center gap-2">
        {starRating === null ? (
          <>
            <span className="text-xs" style={{ color: "var(--atlas-text-3)" }}>这个结果怎么样？</span>
            <div className="flex items-center gap-0.5">
              {[1, 2, 3, 4, 5].map(star => (
                <button
                  key={star}
                  onClick={() => handleStar(star)}
                  onMouseEnter={() => setHoverStar(star)}
                  onMouseLeave={() => setHoverStar(null)}
                  className="transition-transform hover:scale-110"
                  style={{ color: (hoverStar ?? 0) >= star ? "#f59e0b" : "rgba(255,255,255,0.2)", fontSize: "16px" }}
                >
                  ★
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-0.5">
              {[1, 2, 3, 4, 5].map(star => (
                <span key={star} style={{ color: starRating >= star ? "#f59e0b" : "rgba(255,255,255,0.2)", fontSize: "14px" }}>★</span>
              ))}
            </div>
            <span className="text-xs" style={{ color: "var(--atlas-text-3)" }}>已记录</span>
          </div>
        )}
      </div>
    </div>
  );
}

// -- MessageFeedbackButtons ----------------------------------------------------

function MessageFeedbackButtons({ messagePreview }: { messagePreview: string }) {
  const [voted, setVoted] = useState<1 | -1 | null>(null);
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState("");
  const submitFeedback = trpc.messageFeedback.submit.useMutation();

  const handleVote = (rating: 1 | -1) => {
    if (voted !== null) return;
    setVoted(rating);
    submitFeedback.mutate({
      rating,
      messagePreview,
      context: "main-workspace",
    });
    if (rating === -1) setShowComment(true);
  };

  const handleSubmitComment = () => {
    if (!comment.trim()) { setShowComment(false); return; }
    submitFeedback.mutate({
      rating: -1,
      messagePreview,
      comment: comment.trim(),
      context: "main-workspace",
    });
    setShowComment(false);
    setComment("");
  };

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => handleVote(1)}
        disabled={voted !== null}
        className="flex items-center gap-0.5 text-xs transition-colors px-1 py-0.5 rounded"
        style={{
          color: voted === 1 ? "var(--atlas-success)" : "var(--atlas-text-3)",
          opacity: voted !== null && voted !== 1 ? 0.3 : 1,
        }}
        title="有用"
      >
        👍
      </button>
      <button
        onClick={() => handleVote(-1)}
        disabled={voted !== null}
        className="flex items-center gap-0.5 text-xs transition-colors px-1 py-0.5 rounded"
        style={{
          color: voted === -1 ? "#ef4444" : "var(--atlas-text-3)",
          opacity: voted !== null && voted !== -1 ? 0.3 : 1,
        }}
        title="有问题"
      >
        👎
      </button>
      {showComment && (
        <div className="flex items-center gap-1 ml-1">
          <input
            autoFocus
            value={comment}
            onChange={e => setComment(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSubmitComment()}
            placeholder="说说哪里不对？"
            className="text-xs px-2 py-0.5 rounded outline-none"
            style={{
              background: "var(--atlas-elevated)",
              border: "1px solid var(--atlas-border)",
              color: "var(--atlas-text)",
              width: "140px",
            }}
          />
          <button
            onClick={handleSubmitComment}
            className="text-xs px-1.5 py-0.5 rounded"
            style={{ background: "var(--atlas-accent)", color: "#fff" }}
          >
            发
          </button>
          <button
            onClick={() => setShowComment(false)}
            className="text-xs"
            style={{ color: "var(--atlas-text-3)" }}
          >
            取消
          </button>
        </div>
      )}
      {voted !== null && !showComment && (
        <span className="text-xs" style={{ color: "var(--atlas-text-3)" }}>
          {voted === 1 ? "已记录" : "已反馈"}
        </span>
      )}
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
          ) : (() => {
            const { segments } = parseAtlasTableBlocks(message.content || "");
            const hasAtlasTable = segments.some(s => s.type === "table");
            if (!hasAtlasTable) {
              return (
                <div className="atlas-prose" style={{ fontSize: "14px", lineHeight: "1.7" }}>
                  <Streamdown>{message.content}</Streamdown>
                </div>
              );
            }
            return (
              <div>
                {segments.map((seg, idx) =>
                  seg.type === "text" ? (
                    seg.content.trim() ? (
                      <div key={idx} className="atlas-prose" style={{ fontSize: "14px", lineHeight: "1.7" }}>
                        <Streamdown>{seg.content}</Streamdown>
                      </div>
                    ) : null
                  ) : (
                    <AtlasTableRenderer
                      key={idx}
                      rawJson={seg.content}
                      onAdjust={onQuickAction}
                    />
                  )
                )}
              </div>
            );
          })()}
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

        {/* Download button + Task Complete Rating */}
        {message.report_id && message.report_filename && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="mt-2 space-y-2"
          >
            {/* Task complete bar */}
            <TaskCompleteBar
              reportId={message.report_id}
              messagePreview={message.content.slice(0, 500)}
            />
            {/* Download button */}
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

        {/* Copy + Feedback buttons */}
        {message.content && !message.isStreaming && (
          <div className="flex items-center gap-3 mt-1.5">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 text-xs transition-colors"
              style={{ color: copied ? "var(--atlas-success)" : "var(--atlas-text-3)" }}
            >
              {copied ? <Check size={10} /> : <Copy size={10} />}
              {copied ? "已复制" : "复制"}
            </button>
            <MessageFeedbackButtons messagePreview={message.content.slice(0, 500)} />
          </div>
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

      {/* AI Welcome Bubble */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.18, duration: 0.35 }}
        className="w-full flex gap-2.5"
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

        <div
          className="flex-1 px-4 py-3.5 rounded-2xl text-left"
          style={{
            background: "var(--atlas-surface)",
            border: "1px solid var(--atlas-border)",
          }}
        >
          <p style={{ color: "var(--atlas-text)", fontSize: "14px", lineHeight: "1.75" }}>
            我是 ATLAS，专注行政、财务与数据分析的智能助手。
          </p>
          <p style={{ color: "var(--atlas-text-2)", fontSize: "14px", lineHeight: "1.75", marginTop: "6px" }}>
            上传你的 Excel 或 CSV 文件，用一句话告诉我需求——比如「生成工资条」「汇总各店销售」「做考勤统计」。
          </p>
          <p style={{ color: "var(--atlas-text-2)", fontSize: "14px", lineHeight: "1.75", marginTop: "6px" }}>
            我来处理数据、生成报表，你直接下载。
          </p>

          {/* 三步引导 */}
          <div className="flex items-center gap-0 mt-4">
            {[
              { icon: "📁", label: "上传文件" },
              { icon: "💬", label: "说需求" },
              { icon: "📊", label: "下载报表" },
            ].map((step, i) => (
              <div key={i} className="flex items-center">
                <div
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full"
                  style={{
                    background: i === 0 ? "rgba(91,140,255,0.12)" : i === 1 ? "rgba(91,140,255,0.08)" : "rgba(91,140,255,0.06)",
                    border: `1px solid rgba(91,140,255,${i === 0 ? "0.28" : i === 1 ? "0.20" : "0.14"})`,
                  }}
                >
                  <span style={{ fontSize: "13px" }}>{step.icon}</span>
                  <span
                    style={{
                      fontSize: "12px",
                      fontWeight: 500,
                      color: i === 0 ? "var(--atlas-accent)" : i === 1 ? "rgba(91,140,255,0.85)" : "rgba(91,140,255,0.65)",
                      letterSpacing: "0.02em",
                    }}
                  >
                    {step.label}
                  </span>
                </div>
                {i < 2 && (
                  <ChevronRight
                    size={13}
                    style={{ color: "rgba(91,140,255,0.35)", margin: "0 2px", flexShrink: 0 }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
