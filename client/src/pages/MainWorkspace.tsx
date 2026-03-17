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
Shield, } from "lucide-react";
import { Streamdown } from "streamdown";
import { AtlasTableRenderer, parseAtlasTableBlocks } from "@/components/AtlasTableRenderer";
import { useAtlas, type UploadedFile, type Message } from "@/contexts/AtlasContext";
import { useAuth } from "@/_core/hooks/useAuth";
import { pollUploadStatus, chatStream, generateReport, getDownloadUrl, uploadParsed, smartUpload, exportFromSession, type SuggestedAction, sanitizeExport, type SanitizeExportResponse } from "@/lib/api";
import { parseFile, mergeParsedFiles, type DataQuality } from "@/lib/parseFile"; // v14.2-groupby-fix
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { nanoid } from "nanoid";
import * as XLSX from "xlsx";

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

  // -- File processing: silent upload to chip (no messages, no AI analysis)
  // Analysis is triggered when user clicks Send.
  const processFile = useCallback(async (file: File, explicitTaskId?: string) => {
    const taskId = explicitTaskId ?? activeTaskId;
    if (!taskId) return;
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["xlsx", "xls", "csv"].includes(ext || "")) {
      toast.error(`不支持 .${ext} 格式，请上传 Excel 或 CSV`);
      return;
    }
    if (file.size > 500 * 1024 * 1024) {
      toast.error(`${file.name} 超过 500MB 限制`);
      return;
    }

    const tempId = nanoid();
    addUploadedFile({ id: tempId, name: file.name, size: file.size, status: "uploading", uploadedAt: new Date(), uploadProgress: 0 }, taskId);

    try {
      // Silent upload — update chip progress only, no messages
      let uploadResult;
      try {
        uploadResult = await smartUpload(file, (percent) => {
          updateUploadedFile(tempId, { uploadProgress: Math.round(percent * 0.7) });
        });
      } catch {
        const parsedFallback = await parseFile(file);
        uploadResult = await uploadParsed(parsedFallback, (percent) => {
          updateUploadedFile(tempId, { uploadProgress: Math.round(percent * 0.7) });
        });
      }

      // Poll until server finishes parsing (no AI analysis now)
      const result = await pollUploadStatus(uploadResult.session_id, (pct) => {
        updateUploadedFile(tempId, { uploadProgress: Math.round(70 + pct * 0.3) });
      });

      updateUploadedFile(tempId, {
        status: "ready",
        uploadProgress: 100,
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

      // Background: parse locally for allRows + categoryGroupedTop20 (used by frontend export)
      // Non-blocking — does not affect upload success/failure
      parseFile(file).then(parsed => {
        updateUploadedFile(tempId, {
          allRows: parsed.allRows || undefined,
          categoryGroupedTop20: parsed.categoryGroupedTop20 || undefined,
        });
      }).catch(() => {/* non-critical, ignore */});

      // Update task title with filename
      const currentTask = tasks.find(t => t.id === taskId);
      if (currentTask && currentTask.title === "新建任务") {
        updateTask(taskId, { title: result.filename });
      }
    } catch (err: any) {
      updateUploadedFile(tempId, { status: "error" });
      toast.error(`${file.name} 上传失败：${err.message}`);
    }
  }, [addUploadedFile, updateUploadedFile, activeTaskId, tasks, updateTask]);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const taskId = activeTaskId || createNewTask();
    const fileArray = Array.from(files).filter(f => {
      // Deduplicate: skip files already uploading/ready with same name+size
      const isDup = uploadedFiles.some(u => u.name === f.name && u.size === f.size && u.status !== "error");
      if (isDup) toast.info(`${f.name} 已上传，无需重复添加`);
      return !isDup;
    });
    if (fileArray.length === 0) return;
    fileArray.forEach(file => processFile(file, taskId));
  }, [processFile, activeTaskId, createNewTask, uploadedFiles]);

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
    // If files are uploading, wait — don't send yet
    const uploadingFiles = uploadedFiles.filter(f => f.status === "uploading");
    if (uploadingFiles.length > 0) {
      toast.info("文件上传中，请稍候...");
      return;
    }

    const readyFilesList = uploadedFiles.filter(f => f.status === "ready");
    const isFirstSend = messages.length === 0 && readyFilesList.length > 0;

    // Auto-generate analysis prompt when user sends with files but no text
    let msg = (text || input).trim();
    if (!msg && isFirstSend) {
      // Build file summary for auto-prompt
      const fileNames = readyFilesList.map(f => f.name).join("、");
      msg = `请帮我分析这份数据：${fileNames}`;
    }
    if (!msg || isGenerating) return;

    // If no active task exists, create one first so messages have a task to attach to.
    // createNewTask() returns the new task ID synchronously, so we use it directly
    // to avoid stale closure issues with activeTaskId.
    const taskId = activeTaskId || createNewTask();

    setInput("");
    setIsGenerating(true);
    setPendingActions([]); // Clear pending actions when user sends

    addMessage({ role: "user", content: msg }, taskId);
    // Determine thinking steps based on context
    const steps = hasFiles
      ? ["解析文件数据", "理解你的需求", "生成回复"]
      : ["理解你的需求", "生成回复"];
    addMessage({ role: "assistant", content: "", isStreaming: true, thinkingSteps: steps }, taskId);

    // Auto-generate task title from first user message
    {
      const currentTask = tasks.find(t => t.id === taskId);
      const isFirstMessage = !currentTask || currentTask.messages.filter(m => m.role === "user").length === 0;
      if (isFirstMessage && (!currentTask?.title || currentTask?.title === "新建任务")) {
        // Generate a concise title: take first 20 chars of message, strip punctuation at end
        const autoTitle = msg.replace(/[，。！？,.!?]+$/, "").slice(0, 20) + (msg.length > 20 ? "..." : "");
        updateTask(taskId, { title: autoTitle });
      }
    }

    // Use all ready session IDs (multi-file support)
    const sessionIds = readyFiles.map(f => f.sessionId).filter(Boolean) as string[];
    const primarySessionId = sessionIds[0];

    // Detect if user wants a formatted report (payroll, attendance, etc.)
    // IMPORTANT: Only trigger generate-report for structured payroll/HR/finance document generation.
    // "生成表格", "排名表", "对比表", "统计表" etc. go through CHAT path → atlas-table → AtlasTableRenderer
    // This ensures P0-P5 fixes (fullRows, export gate, rank sort) all apply.
    // generate-report path is kept for legacy payroll/HR doc generation only.
    const isReport = /日报生成|(帮我|(帮我)?生成|(帮我)?制作|(帮我)?做一份|(帮我)?做个|(帮我)?输出|(帮我)?整理成|(帮我)?提取).{0,8}(工资条|工资单|薪资表|薪酬表|分红明细|考勤表|出勤表|绩效表|奖金表|扣款表|个税表|实发明细)/i.test(msg);

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
  }, [input, isGenerating, hasFiles, readyFiles, messages, addMessage, updateLastMessage, setIsProcessing, addReport, parseSuggestions, parseInlineOptions, conversationId, setConversationId, activeTaskId, createNewTask]);

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
        style={{ borderBottom: "none" }}
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
                    className="ml-0.5 rounded-full flex items-center justify-center transition-all hover:bg-black/20"
                    style={{ width: 16, height: 16, flexShrink: 0, fontSize: "11px", lineHeight: 1, color: "currentColor", opacity: 0.65 }}
                    title="删除文件"
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "0.65"; }}
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
            ? "h-full flex flex-col items-center justify-center px-6"
            : "w-full max-w-4xl mx-auto px-6 py-5 space-y-4"
        }>
          {messages.length === 0 ? (
            <>
              <EmptyState
                onUpload={() => fileInputRef.current?.click()}
                onQuickAsk={(q) => handleSend(q)}
                input={input}
                setInput={setInput}
                onSend={() => handleSend()}
                onKeyDown={handleKeyDown}
                isGenerating={isGenerating}
                hasReadyFiles={uploadedFiles.some(f => f.status === "ready")}
                uploadedFiles={uploadedFiles}
                onRemoveFile={(id) => removeUploadedFile(id)}
              />
            </>
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
                       uploadedFiles={uploadedFiles}
                       updateMessageById={updateMessageById}
                       activeTaskId={activeTaskId ?? undefined}
                     />
                  );
                })}
              </>
            );
          })()}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Bottom input area - only shown when there are messages */}
      {messages.length > 0 && <div className="flex-shrink-0" style={{ borderTop: "none" }}>
        <div className="w-full max-w-4xl mx-auto px-6 pt-3 pb-4">

          {/* Input box */}
          <div
            className="rounded-3xl overflow-hidden"
            style={{
              background: "#ffffff",
              border: "1px solid #e5e7eb",
              transition: "border-color 0.15s ease, box-shadow 0.15s ease",
              maxWidth: "680px",
              margin: "0 auto",
            }}
            onFocusCapture={e => {
              (e.currentTarget as HTMLElement).style.borderColor = "#4f6ef7";
              (e.currentTarget as HTMLElement).style.boxShadow = "0 0 0 3px rgba(79,110,247,0.1)";
            }}
            onBlurCapture={e => {
              (e.currentTarget as HTMLElement).style.borderColor = "#e5e7eb";
              (e.currentTarget as HTMLElement).style.boxShadow = "none";
            }}          >
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
                color: "#1f2937",
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
                    background: input.trim() ? "#4f6ef7" : "#e5e7eb",
                    color: input.trim() ? "#fff" : "#9ca3af",
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
      </div>}

      {/* Quick action pills removed per UI spec */}

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
  uploadedFiles,
  updateMessageById,
  activeTaskId,
}: {
  message: Message & { suggestedActions?: SuggestedAction[] };
  onDownload: (id: string, filename: string) => void;
  onQuickAction?: (prompt: string) => void;
  isLastAssistant?: boolean;
  uploadedFiles?: import("@/contexts/AtlasContext").UploadedFile[];
  updateMessageById?: (id: string, content: string, extra: any, taskId?: string) => void;
  activeTaskId?: string;
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
            background: "#e8eaed",
          }}
        >
          <p style={{ color: "#1f1f1f", fontSize: "14px", lineHeight: "1.6" }}>
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
        className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{
          background: "linear-gradient(135deg, #4f6ef7, #7b93fa)",
        }}
      >
        <Sparkles size={13} style={{ color: "#ffffff" }} />
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
        {/* Phase 1: 达人昵称字段治理提示 UI (F1-2/F1-3/F1-4/F1-5) */}
        {(message as any).dataQuality && (() => {
          const dq = (message as any).dataQuality as DataQuality;
          const nullRate = dq.trigger_snapshot.null_rate;
          const top1Ratio = dq.trigger_snapshot.top1_ratio;
          const filteredCount = dq.filtered_invalid_count;
          const suspectedNames = dq.suspected_product_names || [];
          const rulesApplied: string[] = dq.rules_applied || [];
          // F1-4: 空値率警告：> 30% 且 rules_applied 不含 "B1"
          const showNullRateWarning = nullRate > 0.3 && !rulesApplied.includes('B1');
          // F1-3: 数据集中度提示： top1_ratio > 0.6
          const showConcentrationHint = top1Ratio > 0.6;
          // F1-2: 无效値过滤提示： filtered_invalid_count > 0
          const showFilterHint = filteredCount > 0;
          // F1-5: 痑似商品名标记： suspected_product_names.length > 0
          const showProductNameHint = suspectedNames.length > 0;
          if (!showNullRateWarning && !showConcentrationHint && !showFilterHint && !showProductNameHint) return null;
          return (
            <div className="mb-2 flex flex-col gap-1.5">
              {/* F1-4: 空値率警告 */}
              {showNullRateWarning && (
                <div
                  className="flex items-start gap-2 px-3 py-2 rounded-xl"
                  style={{
                    background: 'rgba(239,68,68,0.07)',
                    border: '1px solid rgba(239,68,68,0.22)',
                    fontSize: '12.5px',
                    lineHeight: '1.6',
                    color: 'rgb(185,28,28)',
                  }}
                >
                  <span style={{ flexShrink: 0, marginTop: '1px' }}>⚠️</span>
                  <span className="flex-1">
                    <span style={{ fontWeight: 600 }}>空値率警告：</span>
                    原始文件中 <span style={{ fontWeight: 600 }}>{(nullRate * 100).toFixed(1)}%</span> 的行无达人昵称，可能影响 Top 排名准确性。
                  </span>
                </div>
              )}
              {/* F1-3: 数据集中度提示 */}
              {showConcentrationHint && (
                <div
                  className="flex items-start gap-2 px-3 py-2 rounded-xl"
                  style={{
                    background: 'rgba(245,158,11,0.07)',
                    border: '1px solid rgba(245,158,11,0.22)',
                    fontSize: '12.5px',
                    lineHeight: '1.6',
                    color: 'rgb(146,64,14)',
                  }}
                >
                  <span style={{ flexShrink: 0, marginTop: '1px' }}>ℹ️</span>
                  <span className="flex-1">
                    <span style={{ fontWeight: 600 }}>数据高度集中：</span>
                    当前达人数据中 Top1 占比达 <span style={{ fontWeight: 600 }}>{(top1Ratio * 100).toFixed(1)}%</span>，建议核对数据是否完整。
                  </span>
                </div>
              )}
              {/* F1-2: 无效値过滤提示 */}
              {showFilterHint && (
                <div
                  className="flex items-start gap-2 px-3 py-2 rounded-xl"
                  style={{
                    background: 'rgba(99,102,241,0.07)',
                    border: '1px solid rgba(99,102,241,0.22)',
                    fontSize: '12.5px',
                    lineHeight: '1.6',
                    color: 'rgb(67,56,202)',
                  }}
                >
                  <span style={{ flexShrink: 0, marginTop: '1px' }}>🔵</span>
                  <span className="flex-1">
                    <span style={{ fontWeight: 600 }}>已过滤无效値：</span>
                    Top 排名中共 <span style={{ fontWeight: 600 }}>{filteredCount}</span> 个占位符展示项（如 "-"、"—"、"N/A"、"无"）已自动过滤。
                  </span>
                </div>
              )}
              {/* F1-5: 痑似商品名标记 */}
              {showProductNameHint && (
                <div
                  className="flex items-start gap-2 px-3 py-2 rounded-xl"
                  style={{
                    background: 'rgba(245,158,11,0.07)',
                    border: '1px solid rgba(245,158,11,0.22)',
                    fontSize: '12.5px',
                    lineHeight: '1.6',
                    color: 'rgb(146,64,14)',
                  }}
                >
                  <span style={{ flexShrink: 0, marginTop: '1px' }}>⚠️</span>
                  <span className="flex-1">
                    <span style={{ fontWeight: 600 }}>痑似商品名：</span>
                    达人昵称列中检测到 <span style={{ fontWeight: 600 }}>{suspectedNames.length}</span> 个痑似商品描述（如「{suspectedNames[0]?.slice(0, 15)}{suspectedNames[0]?.length > 15 ? '...' : ''}」），建议核对分组字段是否正确。
                  </span>
                </div>
              )}
            </div>
          );
        })()}
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
        {/* NOTE: 过滤掉旧版全表缺失值警告（Phase 1 起，缺失值提示由 detectDataQuality 专项处理） */}
        {message.qualityIssues && message.qualityIssues.filter(i => !i.startsWith('缺失值警告')).length > 0 && (
          <div className="mb-2 flex flex-col gap-1">
            {message.qualityIssues.filter(i => !i.startsWith('缺失值警告')).map((issue, idx) => {
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
          className="py-1"
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
                  ) : (() => {
                    // P1 重写：三级匹配逐级降级，匹配失败时禁止静默降级
                    // Level-1: category_key 精确绑定
                    // Level-2: 字段名精确包含匹配
                    // Level-3: 受控 alias 兜底（alias 命中多个候选时禁止猜测）
                    let fullRows: (string | number)[][] | undefined = undefined;
                    let isCategoryTable = false;

                    // 受控 alias 组（每组内的关键词互为别名）
                    const FIELD_ALIAS_GROUPS: string[][] = [
                      ['省', '省份', '收货省', '发货省', '地区', '区域', '省市'],
                      ['支付', '付款', '结算', '支付方式', '付款方式', '买家支付'],
                      ['城市', '收货城市', '发货城市', '市', '城市名'],
                      ['状态', '订单状态', '支付状态', '发货状态', '物流状态'],
                      ['渠道', '来源', '平台', '销售渠道', '来源渠道'],
                      ['类型', '订单类型', '商品类型', '业务类型'],
                      ['门店', '店铺', '商家', '门店名称', '店铺名称'],
                    ];

                    type CategoryEntry = { label: string; count: number; sum?: number; avg?: number };

                    /**
                     * 尝试匹配字段名到列名：三级递进
                     * 返回：{ level: 1|2|3, fieldName, entries } 或 null
                     */
                    const tryMatchField = (
                      top20: Record<string, CategoryEntry[]>,
                      colNames: string[],
                      categoryKey?: string
                    ): { level: number; fieldName: string; entries: CategoryEntry[] } | null => {
                      // Level-1: category_key 精确绑定
                      if (categoryKey && top20[categoryKey]) {
                        return { level: 1, fieldName: categoryKey, entries: top20[categoryKey] };
                      }

                      // Level-2: 字段名精确包含匹配
                      const exactMatches: { fieldName: string; entries: CategoryEntry[] }[] = [];
                      for (const [fieldName, entries] of Object.entries(top20)) {
                        const hit = colNames.some(c =>
                          c.includes(fieldName) || fieldName.includes(c)
                        );
                        if (hit) exactMatches.push({ fieldName, entries });
                      }
                      if (exactMatches.length === 1) {
                        return { level: 2, ...exactMatches[0] };
                      }
                      if (exactMatches.length > 1) {
                        // 多个精确匹配：选 entries 最多的（覆盖最广）
                        const best = exactMatches.reduce((a, b) => a.entries.length >= b.entries.length ? a : b);
                        return { level: 2, ...best };
                      }

                      // Level-3: 受控 alias 兜底
                      const aliasMatches: { fieldName: string; entries: CategoryEntry[] }[] = [];
                      for (const [fieldName, entries] of Object.entries(top20)) {
                        const fieldLower = fieldName.toLowerCase();
                        const hit = colNames.some(colName => {
                          const colLower = colName.toLowerCase();
                          return FIELD_ALIAS_GROUPS.some(group => {
                            const fieldInGroup = group.some(kw => fieldLower.includes(kw) || kw.includes(fieldLower));
                            const colInGroup = group.some(kw => colLower.includes(kw) || kw.includes(colLower));
                            return fieldInGroup && colInGroup;
                          });
                        });
                        if (hit) aliasMatches.push({ fieldName, entries });
                      }
                      if (aliasMatches.length === 1) {
                        return { level: 3, ...aliasMatches[0] };
                      }
                      if (aliasMatches.length > 1) {
                        // alias 命中多个候选：禁止猜测，记录日志并返回 null
                        console.warn(
                          '[Atlas/P1] Level-3 alias matched multiple candidates, refusing to guess.',
                          { colNames, candidates: aliasMatches.map(m => m.fieldName) }
                        );
                        return null;
                      }

                      return null;
                    };

                    /**
                     * 根据匹配结果构建 fullRows
                     */
                    const buildFullRows = (
                      colNames: string[],
                      fieldName: string,
                      entries: CategoryEntry[]
                    ): (string | number)[][] => {
                      const labelColIdx = colNames.findIndex(c =>
                        c.includes(fieldName) || fieldName.includes(c) ||
                        FIELD_ALIAS_GROUPS.some(g => {
                          const fl = fieldName.toLowerCase();
                          const cl = c.toLowerCase();
                          return g.some(kw => fl.includes(kw) || kw.includes(fl)) &&
                                 g.some(kw => cl.includes(kw) || kw.includes(cl));
                        })
                      );
                      const countColIdx = colNames.findIndex(c =>
                        c.includes('订单数') || c.includes('数量') || c.toLowerCase().includes('count') || c.includes('笔数') || c.includes('件数')
                      );
                      const sumColIdx = colNames.findIndex(c =>
                        c.includes('金额') || c.includes('销售额') || c.includes('应付') || c.includes('收入') || c.includes('GMV')
                      );
                      const pctColIdx = colNames.findIndex(c => c.includes('占比') || c.includes('%'));
                      const rankColIdx = colNames.findIndex(c => c === '排名' || c.includes('排名') || c === '序号');
                      const totalCount = entries.reduce((s, e) => s + e.count, 0);
                      const totalSum = entries.reduce((s, e) => s + (e.sum ?? 0), 0);
                      return entries.map((entry, rank) => {
                        const row: (string | number)[] = new Array(colNames.length).fill("");
                        if (rankColIdx >= 0) row[rankColIdx] = rank + 1;
                        if (labelColIdx >= 0) row[labelColIdx] = entry.label;
                        if (countColIdx >= 0) row[countColIdx] = entry.count;
                        if (sumColIdx >= 0 && entry.sum !== undefined) row[sumColIdx] = entry.sum.toFixed(2);
                        if (pctColIdx >= 0) {
                          const base = sumColIdx >= 0 && totalSum > 0 ? totalSum : totalCount;
                          const val = sumColIdx >= 0 && entry.sum !== undefined ? entry.sum : entry.count;
                          row[pctColIdx] = base > 0 ? ((val / base) * 100).toFixed(2) + '%' : '0%';
                        }
                        return row;
                      });
                    };

                    try {
                      const tableData = JSON.parse(seg.content);
                      if (tableData?.columns && Array.isArray(tableData.columns)) {
                        const colNames = tableData.columns as string[];
                        const categoryKey: string | undefined = tableData.category_key;

                        // 判断是否为分类统计类表格：
                        // 1. 存在 category_key（AI 明确标注）
                        // 2. 列名包含占比/排名/分布关键词
                        // 3. 列名命中 FIELD_ALIAS_GROUPS 中任何一个分类字段（如「省份」「支付方式」「城市」等）
                        const hasCategoryHint = !!categoryKey ||
                          colNames.some(c => c.includes('占比') || c.includes('排名') || c.includes('分布')) ||
                          colNames.some(colName => {
                            const cl = colName.toLowerCase();
                            return FIELD_ALIAS_GROUPS.some(group =>
                              group.some(kw => cl.includes(kw) || kw.includes(cl))
                            );
                          });
                        if (hasCategoryHint) isCategoryTable = true;

                        for (const uf of (uploadedFiles ?? [])) {
                          if (!uf.categoryGroupedTop20) continue;
                          const result = tryMatchField(uf.categoryGroupedTop20, colNames, categoryKey);
                          if (result) {
                            fullRows = buildFullRows(colNames, result.fieldName, result.entries);
                            console.info(
                              `[Atlas/P1] fullRows matched via Level-${result.level}`,
                              { fieldName: result.fieldName, rows: fullRows.length }
                            );
                            break;
                          }
                        }

                        // 匹配失败时打 warning
                        if (!fullRows && (uploadedFiles ?? []).some(uf => uf.categoryGroupedTop20)) {
                          const availableFields = (uploadedFiles ?? [])
                            .flatMap(uf => Object.keys(uf.categoryGroupedTop20 ?? {}));
                          console.warn(
                            '[Atlas/P1] All 3 levels failed to match fullRows.',
                            { colNames, categoryKey, availableFields }
                          );
                        }
                      }
                    } catch {
                      // 解析失败时不传 fullRows
                    }
                    return (
                      <AtlasTableRenderer
                        key={idx}
                        rawJson={seg.content}
                        onAdjust={onQuickAction}
                        fullRows={fullRows}
                        isCategoryTable={isCategoryTable}
                      />
                    );
                  })()
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
                      className="px-3 py-2 text-xs text-center flex items-center justify-between"
                      style={{ color: "var(--atlas-text-3)", borderTop: "1px solid var(--atlas-border)" }}
                    >
                      <span>仅显示前 20 行</span>
                      <button
                        onClick={async () => {
                          // 优先走服务器导出（S3全量数据），fallback到前端allRows
                          const file = (uploadedFiles ?? []).find((f: import("@/contexts/AtlasContext").UploadedFile) => f.sessionId === message.sessionId);
                          const sessionId = message.sessionId || file?.sessionId;
                          if (sessionId) {
                            try {
                              toast.info("正在准备全量数据导出...");
                              const result = await exportFromSession(sessionId);
                              window.open(result.downloadUrl, "_blank");
                              toast.success(`已导出 ${result.rowCount.toLocaleString()} 行（全量数据）`);
                              return;
                            } catch {
                              // fallback to frontend allRows
                            }
                          }
                          // Fallback: frontend allRows
                          const headers = message.tableData?.[0]?.headers || [];
                          const allRows = file?.allRows || message.tableData?.[0]?.rows || [];
                          if (allRows.length === 0) { toast.error("没有可导出的数据"); return; }
                          const typedRows = allRows as Record<string, unknown>[];
                          const ws = XLSX.utils.aoa_to_sheet([headers, ...typedRows.map(row => headers.map(h => row[h] ?? ""))]);
                          const wb = XLSX.utils.book_new();
                          XLSX.utils.book_append_sheet(wb, ws, message.tableData?.[0]?.name || "数据");
                          XLSX.writeFile(wb, `${message.tableData?.[0]?.name || "数据"}.xlsx`);
                          toast.success(`已导出 ${allRows.length} 行`);
                        }}
                        className="text-xs transition-colors hover:text-green-600"
                        style={{ color: "var(--atlas-text-3)" }}
                      >
                        导出 Excel（{(() => {
                          const f = (uploadedFiles ?? []).find((f: import("@/contexts/AtlasContext").UploadedFile) => f.sessionId === message.sessionId);
                          return (f?.dfInfo?.row_count ?? f?.allRows?.length ?? message.tableData?.[0]?.rows?.length ?? 0).toLocaleString();
                        })()} 行）
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* Download button + Task Complete Rating */}
        {/* Case 1: report_id exists → use proxy download via /api/atlas/download/:reportId */}
        {/* Case 2: download_url exists (merge/payslip/attendance) → direct S3 URL download */}
        {((message.report_id && message.report_filename) || (message.download_url && message.report_filename)) && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="mt-2 space-y-2"
          >
            {/* Task complete bar (only for report_id based reports) */}
            {message.report_id && (
              <TaskCompleteBar
                reportId={message.report_id}
                messagePreview={message.content.slice(0, 500)}
              />
            )}
            {/* Download button */}
            <button
              onClick={async () => {
                // 优先：从 sessionId 导出完整数据（V3.0 ResultSet）
                if (message.sessionId) {
                  try {
                    toast.info("正在导出完整数据...");
                    const result = await exportFromSession(message.sessionId);
                    window.open(result.downloadUrl);
                    toast.success(`已导出 ${result.rowCount.toLocaleString()} 行数据`);
                  } catch (err: any) {
                    toast.error(err.message || "导出失败");
                  }
                  return;
                }
                // 原有逻辑
                if (message.download_url) {
                  // Direct S3 URL download (merge/payslip/attendance)
                  const a = document.createElement("a");
                  a.href = message.download_url;
                  a.download = message.report_filename || "download.xlsx";
                  a.click();
                  toast.success("开始下载");
                } else if (message.report_id) {
                  // Proxy download via /api/atlas/download/:reportId
                  onDownload(message.report_id, message.report_filename!);
                }
              }}
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
              下载 {message.report_filename || "完整数据"}
            </button>
            
            {/* 去敏导出按钮 */}
            {message.sessionId && (
              <button
                onClick={async () => {
                  try {
                    toast.info("正在生成去敏文件（全量数据）...");
                    const result = await sanitizeExport(message.sessionId!);
                    // 直接触发下载
                    window.open(result.downloadUrl, "_blank");
                    toast.success(`去敏导出成功：${result.sourceRowCount.toLocaleString()} 行，已删除 ${result.removedColumns} 个敏感字段`);
                  } catch (err: any) {
                    toast.error(err.message || "去敏导出失败");
                  }
                }}
                className="flex items-center gap-2 px-4 py-2 rounded-xl font-medium transition-all text-sm"
                style={{
                  background: "rgba(79,110,247,0.1)",
                  border: "1px solid rgba(79,110,247,0.25)",
                  color: "var(--atlas-primary)",
                }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "rgba(79,110,247,0.18)"}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "rgba(79,110,247,0.1)"}
              >
                <Shield size={14} />
                去敏导出
              </button>
            )}
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
                  background: "#f0f4f9",
                  border: "1px solid #d3dbe5",
                  color: "#444746",
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = "#4f6ef7";
                  (e.currentTarget as HTMLElement).style.color = "#4f6ef7";
                  (e.currentTarget as HTMLElement).style.background = "rgba(79,110,247,0.06)";
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = "#d3dbe5";
                  (e.currentTarget as HTMLElement).style.color = "#444746";
                  (e.currentTarget as HTMLElement).style.background = "#f0f4f9";
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

const FEATURE_CARDS_V2 = [
  {
    emoji: "🏪",
    title: "出纳报表",
    desc: "收支汇总、现金流水",
    q: "帮我把上传的数据汇总生成出纳报表",
    color: "#ef4444",
    bg: "rgba(239,68,68,0.07)",
    border: "rgba(239,68,68,0.15)",
  },
  {
    emoji: "🧮",
    title: "会计报表",
    desc: "利润表、资产负债表",
    q: "帮我生成利润表和资产负债表",
    color: "#3b82f6",
    bg: "rgba(59,130,246,0.07)",
    border: "rgba(59,130,246,0.15)",
  },
  {
    emoji: "👤",
    title: "HR 中心",
    desc: "工资条、考勤、绩效",
    q: "帮我生成工资条",
    color: "#f59e0b",
    bg: "rgba(245,158,11,0.07)",
    border: "rgba(245,158,11,0.15)",
  },
  {
    emoji: "📊",
    title: "数据分析",
    desc: "趋势分析、排名统计",
    q: "帮我分析这份数据，找出关键规律和趋势",
    color: "#3b82f6",
    bg: "rgba(59,130,246,0.07)",
    border: "rgba(59,130,246,0.15)",
  },
];

type EmptyStateProps = {
  onUpload: () => void;
  onQuickAsk: (q: string) => void;
  input: string;
  setInput: (v: string) => void;
  onSend: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  isGenerating: boolean;
  hasReadyFiles?: boolean;
  uploadedFiles?: Array<{ id: string; name: string; status: string; uploadProgress?: number; dfInfo?: { row_count: number } }>;
  onRemoveFile?: (id: string) => void;
};

function EmptyState({ onUpload, onQuickAsk, input, setInput, onSend, onKeyDown, isGenerating, hasReadyFiles, uploadedFiles = [], onRemoveFile }: EmptyStateProps) {
  const { user } = useAuth();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 120) + "px";
    }
  }, [input]);

  const displayName = user?.name ? user.name.split(" ")[0] : "";

  return (
    <div className="flex flex-col items-center w-full max-w-[720px] mx-auto" style={{ gap: 28 }}>
      {/* Greeting */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="text-left w-full"
        style={{ paddingLeft: 4 }}
      >
        {/* ATLAS diamond icon + Hi line */}
        <div className="flex items-center gap-2 mb-2">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L15.5 8.5L22 12L15.5 15.5L12 22L8.5 15.5L2 12L8.5 8.5L12 2Z" fill="#4f6ef7" />
            <path d="M12 2L15.5 8.5L22 12L15.5 15.5L12 22L8.5 15.5L2 12L8.5 8.5L12 2Z" fill="url(#atlasGrad)" />
            <defs>
              <linearGradient id="atlasGrad" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#4f6ef7" />
                <stop offset="50%" stopColor="#10b981" />
                <stop offset="100%" stopColor="#f59e0b" />
              </linearGradient>
            </defs>
          </svg>
          <span style={{ fontSize: "15px", color: "#6b7280", fontWeight: 500 }}>
            Hi{displayName ? ` ${displayName}` : ""}
          </span>
        </div>
        <h1
          style={{
            fontSize: "clamp(22px, 3.5vw, 30px)",
            fontWeight: 700,
            color: "#1f2937",
            letterSpacing: "-0.5px",
            lineHeight: 1.25,
          }}
        >
          需要我帮你处理什么数据？
        </h1>
      </motion.div>

      {/* Centered input box */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.35 }}
        className="w-full"
      >
        <div
          className="rounded-3xl overflow-hidden w-full"
          style={{
            background: "#ffffff",
            border: "1px solid #e2e5ea",
            boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
            transition: "border-color 0.15s ease, box-shadow 0.15s ease",
          }}
          onFocusCapture={e => {
            (e.currentTarget as HTMLElement).style.borderColor = "#4f6ef7";
            (e.currentTarget as HTMLElement).style.boxShadow = "0 0 0 3px rgba(79,110,247,0.1)";
          }}
          onBlurCapture={e => {
            (e.currentTarget as HTMLElement).style.borderColor = "#e2e5ea";
            (e.currentTarget as HTMLElement).style.boxShadow = "0 2px 12px rgba(0,0,0,0.06)";
          }}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="上传文件或直接提问，开始分析..."
            disabled={isGenerating}
            rows={1}
            className="w-full bg-transparent outline-none resize-none px-5 pt-4 pb-2"
            style={{
              color: "#1f2937",
              fontSize: "15px",
              lineHeight: "1.6",
              minHeight: 48,
              maxHeight: 120,
              fontFamily: "inherit",
            }}
          />
          {/* File chips — shown when files are attached */}
          {uploadedFiles.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-4 pt-1 pb-1">
              {uploadedFiles.map(f => (
                <span
                  key={f.id}
                  className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full"
                  style={{
                    background: f.status === "ready" ? "rgba(52,211,153,0.1)" : f.status === "error" ? "rgba(239,68,68,0.1)" : "rgba(91,140,255,0.1)",
                    color: f.status === "ready" ? "#059669" : f.status === "error" ? "#ef4444" : "#4f6ef7",
                    border: `1px solid ${f.status === "ready" ? "rgba(52,211,153,0.25)" : f.status === "error" ? "rgba(239,68,68,0.25)" : "rgba(91,140,255,0.2)"}`,
                  }}
                >
                  <FileSpreadsheet size={11} />
                  {f.status === "uploading"
                    ? `${f.name} ${f.uploadProgress ?? 0}%`
                    : f.status === "ready"
                    ? `✓ ${f.name}${f.dfInfo ? ` (${f.dfInfo.row_count.toLocaleString()}行)` : ""}`
                    : `✗ ${f.name}`}
                  {onRemoveFile && (
                    <button onClick={() => onRemoveFile(f.id)} style={{ marginLeft: 2, opacity: 0.6 }}>
                      <X size={10} />
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between px-4 pb-3 pt-1">
            {/* Left: + icon + upload */}
            <div className="flex items-center gap-2">
              <button
                onClick={onUpload}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium transition-all"
                style={{
                  background: "#f1f3f9",
                  color: "#5f6368",
                  border: "none",
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.background = "#e8eaf6";
                  (e.currentTarget as HTMLElement).style.color = "#4f6ef7";
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.background = "#f1f3f9";
                  (e.currentTarget as HTMLElement).style.color = "#5f6368";
                }}
                title="上传文件"
              >
                <Paperclip size={13} />
                上传文件
              </button>
              <span className="text-xs" style={{ color: "#9ca3af" }}>Enter 发送</span>
            </div>
            {/* Right: Generate button */}
            <button
              onClick={onSend}
              disabled={(!input.trim() && !hasReadyFiles) || isGenerating}
              className="flex items-center gap-2 px-5 py-2 rounded-2xl text-sm font-semibold transition-all"
              style={{
                background: (input.trim() || hasReadyFiles) && !isGenerating ? "#4f6ef7" : "#e5e7eb",
                color: (input.trim() || hasReadyFiles) && !isGenerating ? "#ffffff" : "#9ca3af",
                transition: "all 0.15s ease",
              }}
            >
              {hasReadyFiles && !input.trim() ? "开始分析" : "Generate"}
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </motion.div>

      {/* 4 feature cards */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.35 }}
        className="grid grid-cols-2 sm:grid-cols-4 gap-3 w-full"
      >
        {FEATURE_CARDS_V2.map((card, i) => (
          <button
            key={i}
            onClick={() => onQuickAsk(card.q)}
            className="flex items-center gap-3 px-4 py-3 rounded-2xl text-left transition-all"
            style={{
              background: card.bg,
              border: `1px solid ${card.border}`,
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.opacity = "0.82";
              (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.opacity = "1";
              (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
            }}
          >
            <span
              className="flex items-center justify-center rounded-xl flex-shrink-0"
              style={{
                width: 36,
                height: 36,
                background: `${card.color}18`,
                fontSize: "18px",
              }}
            >
              {card.emoji}
            </span>
            <div className="flex flex-col min-w-0">
              <span style={{ fontSize: "13px", fontWeight: 600, color: "#1f2937", lineHeight: 1.3 }}>{card.title}</span>
              <span style={{ fontSize: "11px", color: "#6b7280", marginTop: 2, lineHeight: 1.4 }}>{card.desc}</span>
            </div>
          </button>
        ))}
      </motion.div>
    </div>
  );
}
