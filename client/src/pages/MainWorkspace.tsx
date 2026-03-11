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
  ChevronRight, Square, ChevronDown,
} from "lucide-react";
import { Streamdown } from "streamdown";
import { AtlasTableRenderer, parseAtlasTableBlocks } from "@/components/AtlasTableRenderer";
import { useAtlas, type UploadedFile, type Message } from "@/contexts/AtlasContext";
import { smartUpload, pollUploadStatus, chatStream, generateReport, getDownloadUrl, type SuggestedAction } from "@/lib/api";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { nanoid } from "nanoid";

// Helper: strip <suggestions> block from text and parse into SuggestedAction[]
function parseSuggestionsHelper(text: string): { cleanText: string; suggestions: SuggestedAction[] } {
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
}

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
    messages, addMessage, updateLastMessage, updateMessageById, clearMessages,
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
  // V13.10: track conversation_id for persistence and 小虾米 reply polling
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const openClawPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPollTimestampRef = useRef<number>(Date.now());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  // Pagination: show last N messages, load more on demand
  const PAGE_SIZE = 20;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  // Reset visible count when task changes
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [activeTaskId]);

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
  // explicitTaskId: passed from handleFiles when activeTaskId was null at call time
  const processFile = useCallback(async (file: File, explicitTaskId?: string) => {
    // Use explicitly passed taskId (handles the case where activeTaskId was null when handleFiles was called)
    const taskId = explicitTaskId ?? activeTaskId;
    if (!taskId) return; // No task to attach to (should not happen)
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
    addUploadedFile({ id: tempId, name: file.name, size: file.size, status: "uploading", uploadedAt: new Date(), uploadProgress: 0 }, taskId);

    // ★ 文件选择后立即插入进度条消息（覆盖上传+分析全过程）
    addMessage({ role: "user", content: `[自动分析] ${file.name}`, isHidden: true } as any, taskId);
    // Capture the assistant message ID to enable per-message updates (fixes concurrent upload race condition)
    const assistantMsgId = addMessage({
      role: "assistant",
      content: "",
      isAnalyzing: true,
      analyzeProgress: 5,
      isStreaming: false,
    } as any, taskId);

    // Helper: update THIS file's assistant message by ID (not the last message)
    const updateMyMsg = (content: string, extra?: Partial<Message>) =>
      updateMessageById(assistantMsgId, content, extra, taskId);

    // 进度定时器引用（用于清理）
    const progressTimers: ReturnType<typeof setTimeout>[] = [];
    let currentProgress = 5;

    // 上传阶段：5% → 30%（随文件上传真实进度推进）
    const uploadPhaseTimer = setInterval(() => {
      if (currentProgress < 28) {
        currentProgress = Math.min(currentProgress + 3, 28);
        updateMyMsg("", { isAnalyzing: true, analyzeProgress: currentProgress });
      }
    }, 400);
    progressTimers.push(uploadPhaseTimer as any);

    try {
      // Phase 1: upload file (0% → 30%)
      const uploadResult = await smartUpload(file, (percent) => {
        updateUploadedFile(tempId, { uploadProgress: percent });
        // 上传进度映射到 5%-30% 区间
        const mappedProgress = Math.round(5 + (percent / 100) * 25);
        if (mappedProgress > currentProgress) {
          currentProgress = mappedProgress;
          updateMyMsg("", { isAnalyzing: true, analyzeProgress: currentProgress });
        }
      });

      // 上传完成，清除上传阶段定时器
      clearInterval(uploadPhaseTimer);

      // Phase 2: poll for async processing result (30% → 100%)
      currentProgress = 30;
      updateMyMsg("", { isAnalyzing: true, analyzeProgress: 30 });
      let resultShown = false;

      // If upload already returned full result (sync mode), use it directly
      // Otherwise poll the status endpoint until ready
      let result;
      if (uploadResult.ai_analysis) {
        // Sync result (small file processed inline)
        result = uploadResult;
      } else {
        // Async result: poll status endpoint
        result = await pollUploadStatus(
          uploadResult.session_id,
          (pct) => {
            if (!resultShown) {
              currentProgress = pct;
              updateMyMsg("", { isAnalyzing: true, analyzeProgress: pct });
            }
          }
        );
      }

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

      // 分析结果出来后，清除所有定时器，替换为真实内容
      const showResult = () => {
        resultShown = true; // Set flag before clearing timers to prevent race condition
        progressTimers.forEach(t => { clearTimeout(t); clearInterval(t as any); });
        const analysisText = result.ai_analysis ||
          `这是一份数据文件，共 ${result.df_info.row_count} 行、${result.df_info.col_count} 列。`;
        const { cleanText, suggestions } = parseSuggestionsHelper(analysisText);
        const finalSuggestions = suggestions.length > 0
          ? suggestions
          : (result.suggested_actions || DEFAULT_ACTIONS);
        // Use updateMessageById to update THIS file's message precisely
        updateMyMsg(cleanText, {
          isAnalyzing: false,
          analyzeProgress: 100,
          isStreaming: false,
          suggestedActions: finalSuggestions,
          qualityIssues: result.quality_issues?.length ? result.quality_issues : undefined,
          outlierDetails: result.outlier_details?.length ? result.outlier_details : undefined,
          fieldMappingHint: result.field_mapping_hint?.length ? result.field_mapping_hint : undefined, // P0-C
        });
      };
      // 最短展示 1.5s 动画后显示结果
      setTimeout(showResult, 1500);

    } catch (err: any) {
      // 清除所有定时器
      progressTimers.forEach(t => { clearTimeout(t); clearInterval(t as any); });
      clearInterval(uploadPhaseTimer);
      // 移除进度条消息（替换为错误提示）
      updateMyMsg(`上传失败：${(err as any).message || "请重试"}`, {
        isAnalyzing: false,
        analyzeProgress: 0,
      });
      updateUploadedFile(tempId, { status: "error" });
      toast.error(`${file.name} 上传失败：${err.message}`);
    }
  }, [addUploadedFile, updateUploadedFile, addMessage, updateMessageById, setIsGenerating, activeTaskId, tasks, updateTask]);

  const handleFiles = useCallback((files: FileList | File[]) => {
    // Ensure we have an active task
    // Note: createNewTask() returns the new task ID synchronously (before React re-renders)
    // We pass it explicitly to processFile to avoid the stale activeTaskId closure issue
    const taskId = activeTaskId || createNewTask();
    Array.from(files).forEach(file => processFile(file, taskId));
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
    // Determine thinking steps based on context
    const steps = hasFiles
      ? ["解析文件数据", "理解你的需求", "生成回复"]
      : ["理解你的需求", "生成回复"];
    addMessage({ role: "assistant", content: "", isStreaming: true, thinkingSteps: steps });

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
        let openClawTimedOut = false; // Flag: OpenClaw 30s timeout triggered auto-retry
        await chatStream({
          sessionIds,
          message: msg,
          history,
          signal: abortController.signal,
          conversationId,  // V13.10: pass current conversation ID
          onChunk: (chunk) => {
            accumulated += chunk;
            // Detect OpenClaw 30s timeout signal → trigger auto-retry with Qwen
            if (accumulated.includes("__OPENCLAW_TIMEOUT_RETRY__")) {
              openClawTimedOut = true;
              updateLastMessage("⚡ 正在切换备用引擎，自动重试中...", { isStreaming: true });
              return;
            }
            // Strip <suggestions> block from visible text during streaming
            const visibleText = accumulated.replace(/<suggestions>[\s\S]*?<\/suggestions>/, "").replace(/<suggestions>[\s\S]*$/, "");
            updateLastMessage(visibleText, { isStreaming: true });
          },
          onDone: async (fullText, returnedConvId) => {
            // Auto-retry with Qwen when OpenClaw timed out
            if (openClawTimedOut) {
              accumulated = "";
              openClawTimedOut = false;
              const retryAbort = new AbortController();
              abortControllerRef.current = retryAbort;
              await chatStream({
                sessionIds,
                message: msg,
                history,
                signal: retryAbort.signal,
                conversationId,
                onChunk: (chunk) => {
                  accumulated += chunk;
                  const visibleText = accumulated.replace(/<suggestions>[\s\S]*?<\/suggestions>/, "").replace(/<suggestions>[\s\S]*$/, "");
                  updateLastMessage(visibleText, { isStreaming: true });
                },
                onDone: (retryFullText, retryConvId) => {
                  const finalRetryText = retryFullText || accumulated;
                  if (retryConvId) setConversationId(retryConvId);
                  const { cleanText, suggestions } = parseSuggestions(finalRetryText);
                  const parsedActions = suggestions.length > 0 ? suggestions : parseInlineOptions(cleanText);
                  updateLastMessage(cleanText, { suggestedActions: parsedActions } as any);
                },
                onError: (retryErr) => {
                  updateLastMessage(`对话失败：${retryErr.message || "请求失败"}\n\n请稍后重试。`);
                  toast.error("对话失败，请重试");
                  setInput(msg);
                },
              });
              return;
            }
            const finalText = fullText || accumulated;
            // V13.10: save conversation_id from server response
            if (returnedConvId) {
              setConversationId(returnedConvId);
              // Start polling for 小虾米 replies (every 5s, stop after 5 min)
              if (openClawPollRef.current) clearInterval(openClawPollRef.current);
              lastPollTimestampRef.current = Date.now();
              let pollCount = 0;
              const maxPolls = 60; // 5 min
              openClawPollRef.current = setInterval(async () => {
                pollCount++;
                if (pollCount > maxPolls) {
                  clearInterval(openClawPollRef.current!);
                  openClawPollRef.current = null;
                  return;
                }
                try {
                  const r = await fetch(
                    `/api/atlas/chat-replies?conversationId=${returnedConvId}&after=${lastPollTimestampRef.current}`,
                    { credentials: "include" }
                  );
                  if (!r.ok) return;
                  const data = await r.json() as { messages: Array<{ id: string; content: string; createdAt: string }> };
                  if (data.messages && data.messages.length > 0) {
                    // Show 小虾米 reply as a new assistant message
                    const latestMsg = data.messages[data.messages.length - 1];
                    addMessage({ role: "assistant", content: `🦐 **小虾米回复**\n\n${latestMsg.content}` });
                    lastPollTimestampRef.current = new Date(latestMsg.createdAt).getTime();
                    clearInterval(openClawPollRef.current!);
                    openClawPollRef.current = null;
                  }
                } catch (e) {
                  console.warn("[Poll] chat-replies error:", e);
                }
              }, 5_000);
            }
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
  }, [input, isGenerating, hasFiles, readyFiles, messages, addMessage, updateLastMessage, setIsProcessing, addReport, parseSuggestions, parseInlineOptions, conversationId, setConversationId]);

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

  // P1-C: Merge dialog state
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [mergeNames, setMergeNames] = useState<Record<string, string>>({});
  const [isMerging, setIsMerging] = useState(false);

  // P1-C: Inline multi-file merge
  const handleInlineMerge = useCallback(async () => {
    const files = readyFiles.filter(f => f.sessionId);
    if (files.length < 2) return;
    setShowMergeDialog(false);
    setIsMerging(true);
    addMessage({ role: "user", content: "合并多门店数据" });
    addMessage({ role: "assistant", content: "", isStreaming: true, thinkingSteps: ["读取文件数据", "添加来源平台列", "生成合并Excel"] });
    setIsGenerating(true);
    try {
      const session_ids = files.map(f => f.sessionId!);
      const platform_names: Record<string, string> = {};
      files.forEach(f => {
        if (mergeNames[f.id]) platform_names[f.sessionId!] = mergeNames[f.id];
      });
      const res = await fetch("/api/atlas/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ session_ids, platform_names }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "合并失败");
      }
      const data = await res.json();
      const summaryLines = [
        `✅ 数据合并完成，共 **${data.totalRows}** 行`,
        ``,
        `| 文件 | 来源平台 | 行数 |`,
        `|------|---------|------|`,
        ...(data.files || []).map((f: { name: string; platform: string; rowCount: number }) =>
          `| ${f.name} | ${f.platform} | ${f.rowCount} |`
        ),
      ].join("\n");
      updateLastMessage(summaryLines, {
        isStreaming: false,
        thinkingSteps: undefined,
        download_url: data.downloadUrl,
        report_filename: `合并数据_${new Date().toISOString().slice(0, 10)}.xlsx`,
        suggestedActions: [
          { icon: "📊", label: "生成汇总报表", prompt: "帮我把合并后的数据生成汇总报表" },
          { icon: "🔍", label: "各平台对比", prompt: "帮我对比各平台的销售数据" },
          { icon: "✨", label: "自定义需求", prompt: "" },
        ],
      });
      toast.success(`合并完成，共 ${data.totalRows} 行`);
    } catch (err: any) {
      updateLastMessage(`❌ 合并失败：${err.message}`, { isStreaming: false, thinkingSteps: undefined });
      toast.error(err.message || "合并失败");
    } finally {
      setIsGenerating(false);
      setIsMerging(false);
    }
  }, [readyFiles, mergeNames, addMessage, updateLastMessage, setIsGenerating]);

  // P1-B: Inline payslip generation from quick-action button (no page jump)
  const handleInlinePayslip = useCallback(async (sessionId: string) => {
    const period = new Date().toISOString().slice(0, 7);
    addMessage({ role: "user", content: "生成工资条" });
    addMessage({ role: "assistant", content: "", isStreaming: true, thinkingSteps: ["识别字段映射", "计算个税", "生成工资条"] });
    setIsGenerating(true);
    try {
      const res = await fetch("/api/hr/payslip/from-atlas-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ sessionId, period }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "生成失败");
      }
      const data = await res.json();
      const fmt = (n: number) => n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const summaryText = [
        `✅ 工资条已生成，共 **${data.employeeCount}** 人`,
        ``,
        `| 指标 | 金额 |`,
        `|------|------|`,
        `| 应发工资总额 | ¥${fmt(data.summary.totalPayroll)} |`,
        `| 实发工资总额 | ¥${fmt(data.summary.totalNetPay)} |`,
        `| 个税总额 | ¥${fmt(data.summary.totalTax)} |`,
        `| 人均实发 | ¥${fmt(data.summary.avgSalary)} |`,
        ``,
        `工资期间：${data.period}`,
      ].join("\n");
      updateLastMessage(summaryText, {
        isStreaming: false,
        download_url: data.downloadUrl,
        report_filename: `工资条-${data.period}.xlsx`,
        suggestedActions: [
          { icon: "📅", label: "查看考勤汇总", prompt: "帮我汇总考勤数据" },
          { icon: "📊", label: "继续分析", prompt: "对工资数据进行进一步分析" },
          { icon: "✨", label: "自定义需求", prompt: "" },
        ],
      });
      toast.success(`工资条已生成，共 ${data.employeeCount} 人`);
    } catch (err: any) {
      updateLastMessage(`生成失败：${err.message || "未知错误"}

请检查文件格式或重新上传。`, { isStreaming: false });
      toast.error(err.message || "生成失败");
    } finally {
      setIsGenerating(false);
    }
  }, [addMessage, updateLastMessage, setIsProcessing]);

  // P1-B: Inline attendance summary from quick-action button (no page jump)
  const handleInlineAttendance = useCallback(async (sessionId: string) => {
    addMessage({ role: "user", content: "考勤汇总" });
    addMessage({ role: "assistant", content: "", isStreaming: true, thinkingSteps: ["识别打卡记录", "分析迟到早退", "生成汇总表"] });
    setIsGenerating(true);
    try {
      const res = await fetch("/api/hr/attendance/from-atlas-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ sessionId }),
      });
      if (!res.ok) {
        // Fallback: send as chat message
        updateLastMessage("", { isStreaming: false });
        setIsGenerating(false);
        handleSend("帮我汇总考勤数据，统计出勤天数、迟到次数和早退记录", true);
        return;
      }
      const data = await res.json();
      const summaryText = [
        `✅ 考勤汇总已生成，共 **${data.employeeCount}** 人`,
        ``,
        `| 指标 | 数据 |`,
        `|------|------|`,
        `| 出勤率 | ${(data.summary.attendanceRate * 100).toFixed(1)}% |`,
        `| 迟到次数 | ${data.summary.lateCount} 次 |`,
        `| 旷工次数 | ${data.summary.absentCount} 次 |`,
        `| 早退次数 | ${data.summary.earlyLeaveCount} 次 |`,
      ].join("\n");
      updateLastMessage(summaryText, {
        isStreaming: false,
        download_url: data.downloadUrl,
        report_filename: `考勤汇总.xlsx`,
        suggestedActions: FOLLOWUP_ACTIONS,
      });
      toast.success(`考勤汇总已生成`);
    } catch (err: any) {
      updateLastMessage(`生成失败：${err.message || "未知错误"}

请检查文件格式或重新上传。`, { isStreaming: false });
      toast.error(err.message || "生成失败");
    } finally {
      setIsGenerating(false);
    }
  }, [addMessage, updateLastMessage, setIsProcessing, handleSend]);

  const handleQuickAction = useCallback((prompt: string) => {
    if (!prompt) {
      // "自定义需求" — focus input
      textareaRef.current?.focus();
      return;
    }
    // P1-B: Detect inline HR flow prefixes
    if (prompt.startsWith("__PAYSLIP_INLINE__")) {
      handleInlinePayslip(prompt.replace("__PAYSLIP_INLINE__", ""));
      return;
    }
    if (prompt.startsWith("__ATTENDANCE_INLINE__")) {
      handleInlineAttendance(prompt.replace("__ATTENDANCE_INLINE__", ""));
      return;
    }
    // P1-C: Multi-file merge
    if (prompt === "__MERGE_INLINE__") {
      const files = readyFiles.filter(f => f.sessionId);
      if (files.length < 2) {
        const count = files.length;
        if (count === 0) {
          toast.info("请先上传至少 2 个文件，再使用多门店合并功能");
        } else {
          toast.info(`当前只有 1 个文件，请再上传至少 1 个其他门店的文件`);
        }
        return;
      }
      const platformKeywords = ["淘宝", "天猫", "京东", "拼多多", "抖音", "快手", "1688", "闲鱼", "苏宁", "唯品会", "小红书"];
      const initial: Record<string, string> = {};
      files.forEach(f => {
        const base = f.name.replace(/\.[^.]+$/, "");
        const found = platformKeywords.find(k => base.includes(k));
        initial[f.id] = found || base;
      });
      setMergeNames(initial);
      setShowMergeDialog(true);
      return;
    }
    handleSend(prompt, true);
  }, [handleSend, handleInlinePayslip, handleInlineAttendance, readyFiles]);

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
                  overflow: "hidden",
                  background: f.status === "error"
                    ? "rgba(239,68,68,0.1)"
                    : f.status === "ready"
                    ? "rgba(52,211,153,0.1)"
                    : "rgba(91,140,255,0.1)",
                  color: f.status === "error"
                    ? "#ef4444"
                    : f.status === "ready"
                    ? "var(--atlas-success)"
                    : "var(--atlas-accent)",
                  border: `1px solid ${
                    f.status === "error"
                      ? "rgba(239,68,68,0.3)"
                      : f.status === "ready"
                      ? "rgba(52,211,153,0.2)"
                      : "rgba(91,140,255,0.2)"
                  }`,
                }}
              >
                {/* Progress bar background for uploading state */}
                {f.status === "uploading" && typeof f.uploadProgress === "number" && (
                  <span
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: `${f.uploadProgress}%`,
                      background: "rgba(91,140,255,0.15)",
                      transition: "width 0.3s ease",
                      pointerEvents: "none",
                    }}
                  />
                )}
                {f.status === "uploading"
                  ? <Loader2 size={9} className="animate-spin" style={{ flexShrink: 0 }} />
                  : f.status === "error"
                  ? <X size={9} style={{ flexShrink: 0 }} />
                  : <FileSpreadsheet size={9} style={{ flexShrink: 0 }} />
                }
                <span className="max-w-[100px] truncate" style={{ position: "relative" }}>{f.name}</span>
                {f.status === "uploading" && typeof f.uploadProgress === "number" && (
                  <span style={{ opacity: 0.85, flexShrink: 0, position: "relative" }}>{f.uploadProgress}%</span>
                )}
                {f.status === "ready" && f.dfInfo && (
                  <span style={{ opacity: 0.7, flexShrink: 0 }}>{f.dfInfo.row_count.toLocaleString()}行</span>
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
          ) : (() => {
            const startIdx = Math.max(0, messages.length - visibleCount);
            const visibleMessages = messages.slice(startIdx).filter(m => !m.isHidden);
            const hasMore = startIdx > 0;
            return (
              <>
                {hasMore && (
                  <div className="flex justify-center py-2">
                    <button
                      onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
                      className="text-xs px-3 py-1.5 rounded-lg transition-all"
                      style={{
                        background: "var(--atlas-surface)",
                        border: "1px solid var(--atlas-border)",
                        color: "var(--atlas-text-2)",
                      }}
                    >
                      ↑ 加载更早的 {startIdx} 条消息
                    </button>
                  </div>
                )}
                {visibleMessages.map((msg, relIdx) => {
                  const idx = startIdx + relIdx;
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
                })}
              </>
            );
          })()}
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

      {/* Quick action pills — visible when no messages OR when files are ready */}
      {!isGenerating && (messages.length === 0 || hasFiles) && (
        <div className="flex-shrink-0 pb-3">
          <div className="w-full max-w-4xl mx-auto px-6">
            <div className="flex items-center gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
              {[
                { icon: "📊", label: "生成汇总报表", q: "帮我把上传的数据汇总生成报表" },
                { icon: "🏪", label: "多门店数据合并", q: "__MERGE_INLINE__" },
                { icon: "💰", label: "生成工资条", q: "帮我生成工资条" },
                { icon: "📈", label: "销售数据分析", q: "帮我分析销售数据，找出趋势和排名" },
                { icon: "💸", label: "计算分红", q: "帮我计算分红明细" },
                { icon: "📅", label: "考勤汇总", q: "帮我汇总考勤数据" },
              ].map((pill, i) => (
                <button
                  key={i}
                  onClick={() => {
                    if (pill.q === "__MERGE_INLINE__") {
                      handleQuickAction("__MERGE_INLINE__");
                    } else {
                      setInput(pill.q);
                      setTimeout(() => textareaRef.current?.focus(), 50);
                    }
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

      {/* P1-C: Merge Confirmation Dialog */}
      <AnimatePresence>
        {showMergeDialog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.6)" }}
            onClick={e => { if (e.target === e.currentTarget) setShowMergeDialog(false); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 8 }}
              transition={{ duration: 0.18 }}
              className="rounded-2xl p-6 w-full max-w-md mx-4"
              style={{
                background: "var(--atlas-surface)",
                border: "1px solid var(--atlas-border-2)",
                boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
              }}
            >
              <div className="flex items-center gap-2 mb-4">
                <span style={{ fontSize: 20 }}>🏪</span>
                <h3 className="font-semibold text-base" style={{ color: "var(--atlas-text)" }}>多门店数据合并</h3>
              </div>
              <p className="text-sm mb-4" style={{ color: "var(--atlas-text-2)" }}>
                将为每个文件添加「来源平台」列，可修改平台名称：
              </p>
              <div className="space-y-2 mb-5">
                {readyFiles.filter(f => f.sessionId).map(f => (
                  <div key={f.id} className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs truncate mb-1" style={{ color: "var(--atlas-text-3)" }}>{f.name}</div>
                      <input
                        type="text"
                        value={mergeNames[f.id] || ""}
                        onChange={e => setMergeNames(prev => ({ ...prev, [f.id]: e.target.value }))}
                        placeholder="平台名称"
                        className="w-full rounded-lg px-3 py-1.5 text-sm outline-none"
                        style={{
                          background: "var(--atlas-elevated)",
                          border: "1px solid var(--atlas-border)",
                          color: "var(--atlas-text)",
                        }}
                        onFocus={e => (e.currentTarget.style.borderColor = "rgba(91,140,255,0.5)")}
                        onBlur={e => (e.currentTarget.style.borderColor = "var(--atlas-border)")}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setShowMergeDialog(false)}
                  className="px-4 py-2 rounded-lg text-sm transition-all"
                  style={{
                    background: "var(--atlas-elevated)",
                    border: "1px solid var(--atlas-border)",
                    color: "var(--atlas-text-2)",
                  }}
                >
                  取消
                </button>
                <button
                  onClick={handleInlineMerge}
                  disabled={isMerging}
                  className="px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5"
                  style={{
                    background: "var(--atlas-accent)",
                    color: "#fff",
                    opacity: isMerging ? 0.7 : 1,
                  }}
                >
                  {isMerging && <Loader2 size={12} className="animate-spin" />}
                  开始合并
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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

// -- AnalysisProgressBar -------------------------------------------------------
function AnalysisProgressBar({ progress }: { progress: number }) {
  const stages = [
    { min: 0,  max: 25,  label: "正在读取数据…" },
    { min: 25, max: 50,  label: "识别业务场景…" },
    { min: 50, max: 75,  label: "提炼关键指标…" },
    { min: 75, max: 95,  label: "生成分析报告…" },
    { min: 95, max: 100, label: "即将完成…" },
  ];
  const stage = stages.find(s => progress >= s.min && progress < s.max) || stages[stages.length - 1];

  return (
    <div className="py-2">
      <div className="flex items-center justify-between mb-2">
        <span style={{ fontSize: "13px", color: "var(--atlas-text-2)", fontWeight: 500 }}>
          {stage.label}
        </span>
        <span style={{ fontSize: "13px", color: "var(--atlas-accent)", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
          {progress}%
        </span>
      </div>
      <div
        className="relative overflow-hidden rounded-full"
        style={{ height: "6px", background: "var(--atlas-border)" }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            height: "100%",
            width: `${progress}%`,
            background: "linear-gradient(90deg, #5b8cff 0%, #a78bfa 100%)",
            borderRadius: "9999px",
            transition: "width 0.8s cubic-bezier(0.4, 0, 0.2, 1)",
            boxShadow: "0 0 8px rgba(91,140,255,0.5)",
          }}
        />
        {/* Shimmer sweep effect */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: "-60%",
            width: "60%",
            height: "100%",
            background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.4) 50%, transparent 100%)",
            animation: "shimmer-sweep 1.8s ease-in-out infinite",
          }}
        />
      </div>
      <p style={{ fontSize: "11px", color: "var(--atlas-text-3)", marginTop: "8px" }}>
        ATLAS 正在智能分析中，请稍候…
      </p>
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
  const [showThinking, setShowThinking] = useState(false);
  // P0-B UI: track which outlier field's detail panel is expanded (null = collapsed)
  const [expandedOutlierField, setExpandedOutlierField] = useState<string | null>(null);
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
        {/* 思考过程面板：有内容且有 thinkingSteps 时显示 */}
        {message.thinkingSteps && message.thinkingSteps.length > 0 && message.content && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-2"
          >
            <button
              onClick={() => setShowThinking(v => !v)}
              className="flex items-center gap-1.5 text-xs transition-colors"
              style={{ color: "var(--atlas-text-3)" }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-2)"}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)"}
            >
              <span style={{ fontWeight: 500 }}>思考过程</span>
              <ChevronDown
                size={12}
                style={{
                  transform: showThinking ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.2s ease",
                }}
              />
            </button>
            <AnimatePresence>
              {showThinking && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="mt-2 space-y-1.5">
                    {message.thinkingSteps.map((step, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <div
                          className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0"
                          style={{ background: "var(--atlas-accent)", opacity: 0.5 }}
                        />
                        <span style={{ fontSize: "12px", color: "var(--atlas-text-3)", lineHeight: "1.6" }}>
                          {step}
                        </span>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
        {/* P0-C: Field mapping hint block — blue info bar */}
        {message.fieldMappingHint && message.fieldMappingHint.length > 0 && (
          <div className="mb-2 flex flex-col gap-1">
            <div
              className="flex items-start gap-2 px-3 py-2 rounded-xl"
              style={{
                background: 'rgba(59,130,246,0.08)',
                border: '1px solid rgba(59,130,246,0.22)',
                fontSize: '12.5px',
                lineHeight: '1.6',
                color: 'rgb(37,99,235)',
              }}
            >
              <span style={{ flexShrink: 0, marginTop: '1px' }}>ℹ️</span>
              <span className="flex-1">
                <span style={{ fontWeight: 600 }}>已自动识别字段：</span>
                {message.fieldMappingHint.map((m, i) => (
                  <span key={i}>
                    {i > 0 && <span style={{ color: 'rgba(37,99,235,0.5)', margin: '0 4px' }}>·</span>}
                    <span style={{ background: 'rgba(59,130,246,0.12)', borderRadius: '4px', padding: '0 4px' }}>「{m.original}」</span>
                    <span style={{ margin: '0 3px', opacity: 0.6 }}>→</span>
                    <span style={{ background: 'rgba(59,130,246,0.12)', borderRadius: '4px', padding: '0 4px' }}>「{m.canonical}」</span>
                  </span>
                ))}
              </span>
            </div>
          </div>
        )}
        {/* P0-B: Quality issues hint block */}
        {message.qualityIssues && message.qualityIssues.length > 0 && (
          <div className="mb-2 flex flex-col gap-1">
            {message.qualityIssues.map((issue, idx) => {
              const isWarning = issue.startsWith('⚠️');
              const isSuccess = issue.startsWith('✅');
              // P0-B UI: detect outlier warning and find matching detail
              const isOutlierWarning = isWarning && issue.includes('异常高值预警');
              const outlierDetails = (message as any).outlierDetails as Array<{
                fieldName: string; median: number; threshold: number;
                outlierRows: Array<{ rowIndex: number; value: number }>;
              }> | undefined;
              return (
                <div key={idx} className="flex flex-col rounded-xl overflow-hidden"
                  style={{
                    background: isWarning ? 'rgba(245,158,11,0.08)' : isSuccess ? 'rgba(34,197,94,0.08)' : 'rgba(99,102,241,0.08)',
                    border: `1px solid ${isWarning ? 'rgba(245,158,11,0.25)' : isSuccess ? 'rgba(34,197,94,0.25)' : 'rgba(99,102,241,0.25)'}`,
                  }}
                >
                  {/* Main row */}
                  <div className="flex items-start gap-2 px-3 py-2"
                    style={{ fontSize: '12.5px', lineHeight: '1.6', color: isWarning ? 'rgb(180,120,20)' : isSuccess ? 'rgb(22,163,74)' : 'var(--atlas-text-2)' }}
                  >
                    <span style={{ flexShrink: 0, marginTop: '1px' }}>
                      {isWarning ? '⚠️' : isSuccess ? '✅' : 'ℹ️'}
                    </span>
                    <span className="flex-1">{issue.replace(/^[⚠️✅ℹ️]+\s*/, '')}</span>
                    {/* P0-B UI: clickable expand button for outlier warnings with details */}
                    {isOutlierWarning && outlierDetails && outlierDetails.length > 0 && (
                      <button
                        onClick={() => setExpandedOutlierField(prev => prev === `issue-${idx}` ? null : `issue-${idx}`)}
                        className="flex items-center gap-1 ml-1 px-2 py-0.5 rounded-lg text-xs font-medium transition-all"
                        style={{
                          background: 'rgba(245,158,11,0.15)',
                          color: 'rgb(180,120,20)',
                          border: '1px solid rgba(245,158,11,0.3)',
                          cursor: 'pointer',
                          flexShrink: 0,
                        }}
                      >
                        <span>查看详情</span>
                        <ChevronDown
                          size={12}
                          style={{ transform: expandedOutlierField === `issue-${idx}` ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
                        />
                      </button>
                    )}
                  </div>
                  {/* P0-B UI: expandable outlier detail panel */}
                  {isOutlierWarning && expandedOutlierField === `issue-${idx}` && outlierDetails && outlierDetails.length > 0 && (
                    <div className="px-3 pb-3 flex flex-col gap-2"
                      style={{ borderTop: '1px solid rgba(245,158,11,0.15)' }}
                    >
                      {outlierDetails.map((detail) => {
                        const fmtV = (n: number) => n >= 10000 ? `${(n / 10000).toFixed(1)}万` : n.toLocaleString();
                        return (
                          <div key={detail.fieldName} className="mt-2">
                            <div className="flex items-center gap-2 mb-1.5"
                              style={{ fontSize: '12px', color: 'rgb(180,120,20)', fontWeight: 600 }}
                            >
                              <span>📊 {detail.fieldName}</span>
                              <span style={{ fontWeight: 400, color: 'rgb(160,100,10)' }}>
                                中位数 {fmtV(detail.median)} · 阈值 {fmtV(detail.threshold)}
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {detail.outlierRows.map((row) => (
                                <span key={row.rowIndex}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg"
                                  style={{
                                    fontSize: '11.5px',
                                    background: 'rgba(245,158,11,0.12)',
                                    border: '1px solid rgba(245,158,11,0.25)',
                                    color: 'rgb(160,80,0)',
                                  }}
                                >
                                  <span style={{ color: 'rgb(140,100,20)' }}>R{row.rowIndex}</span>
                                  <span style={{ fontWeight: 600 }}>{fmtV(row.value)}</span>
                                </span>
                              ))}
                            </div>
                            {detail.outlierRows.length >= 20 && (
                              <p style={{ fontSize: '11px', color: 'rgb(160,120,40)', marginTop: '4px' }}>
                                仅显示前 20 条异常记录
                              </p>
                            )}
                          </div>
                        );
                      })}
                      <button
                        onClick={() => onQuickAction?.(`展示 ${outlierDetails.map(d => d.fieldName).join('、')} 字段中的异常高值记录，帮我核查这些数据是否准确`)}
                        className="mt-1 self-start px-3 py-1 rounded-lg text-xs font-medium transition-all hover:opacity-80"
                        style={{
                          background: 'rgba(245,158,11,0.18)',
                          color: 'rgb(160,80,0)',
                          border: '1px solid rgba(245,158,11,0.35)',
                          cursor: 'pointer',
                        }}
                      >
                        🔍 让 AI 帮我核查这些异常数据
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {/* Message bubble */}
        <div
          className="px-4 py-3 rounded-2xl"
          style={{
            background: "var(--atlas-surface)",
            border: "1px solid var(--atlas-border)",
          }}
        >
          {/* @ts-ignore */}
          {message.isAnalyzing ? (
            /* 分析进度动画 */
            <AnalysisProgressBar progress={(message as any).analyzeProgress ?? 15} />
          ) : message.isStreaming && !message.content ? (
            /* 正在思考动画 */
            <div className="flex items-center gap-2 py-0.5">
              <div className="flex items-center gap-1">
                {[0, 1, 2].map(i => (
                  <div
                    key={i}
                    className="atlas-thinking-dot"
                    style={{ animationDelay: `${i * 0.2}s` }}
                  />
                ))}
              </div>
              <span style={{ fontSize: "13px", color: "var(--atlas-text-3)" }}>ATLAS 正在思考…</span>
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
