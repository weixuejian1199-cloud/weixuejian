/**
 * ATLAS Core API Routes  (V7.1 — Persistent Sessions)
 * ─────────────────────────────────────────────────────────────────
 * Endpoints:
 *   POST /api/atlas/upload      — Upload Excel/CSV → S3 → parse → AI analysis
 *   POST /api/atlas/chat        — Streaming AI chat about uploaded data
 *   POST /api/atlas/generate-report — Generate Excel report → S3 → download URL
 *   GET  /api/atlas/download/:reportId — Redirect to S3 download URL
 *
 * Persistence strategy:
 *   - Parsed data rows → stored as JSON in S3 (atlas-data/<sessionId>-data.json)
 *   - dfInfo + fileKey → stored in sessions table (dfInfo JSON column)
 *   - Reports → stored in reports table (fileKey + fileUrl columns)
 *   - No in-memory stores → survives server restarts
 */

import type { Express, Request, Response, NextFunction } from "express";
import multer from "multer";
import { nanoid } from "nanoid";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import { streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { ENV } from "./_core/env";
import { createPatchedFetch } from "./_core/patchedFetch";
import { storagePut, storageGet } from "./storage";
import { getSession, createSession, updateSession, createReport, updateReport, getReport, getSimilarExamples } from "./db";
import { sdk } from "./_core/sdk";

// Optional auth middleware: injects req.userId if session cookie is valid
async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const user = await sdk.authenticateRequest(req);
    (req as any).userId = user.id;
    (req as any).atlasUser = user;
  } catch {
    // Not authenticated — proceed as anonymous (userId = 0)
  }
  next();
}

// ── LLM Provider ──────────────────────────────────────────────────────────────

function createLLM() {
  const baseURL = ENV.forgeApiUrl.endsWith("/v1")
    ? ENV.forgeApiUrl
    : `${ENV.forgeApiUrl}/v1`;
  return createOpenAI({
    baseURL,
    apiKey: ENV.forgeApiKey,
    fetch: createPatchedFetch(fetch),
  });
}

// ── Multer (memory storage — no disk writes) ──────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "text/csv",
      "application/csv",
    ];
    const ext = file.originalname.split(".").pop()?.toLowerCase();
    if (allowed.includes(file.mimetype) || ["xlsx", "xls", "csv"].includes(ext || "")) {
      cb(null, true);
    } else {
      cb(new Error(`不支持的文件格式: ${ext}`));
    }
  },
});

// ── Data parsing helpers ──────────────────────────────────────────────────────

interface FieldInfo {
  name: string;
  type: "numeric" | "text" | "datetime";
  dtype: string;
  null_count: number;
  unique_count: number;
  sample: (string | number)[];
}

interface DataFrameInfo {
  row_count: number;
  col_count: number;
  fields: FieldInfo[];
  preview: Record<string, unknown>[];
}

function inferType(values: unknown[]): "numeric" | "text" | "datetime" {
  const nonNull = values.filter(v => v !== null && v !== undefined && v !== "");
  if (nonNull.length === 0) return "text";
  const numericCount = nonNull.filter(v => !isNaN(Number(v))).length;
  if (numericCount / nonNull.length > 0.8) return "numeric";
  const datePatterns = [/^\d{4}[-/]\d{2}[-/]\d{2}/, /^\d{2}[-/]\d{2}[-/]\d{4}/];
  const dateCount = nonNull.filter(v => datePatterns.some(p => p.test(String(v)))).length;
  if (dateCount / nonNull.length > 0.5) return "datetime";
  return "text";
}

function parseExcelBuffer(buffer: Buffer, filename: string): { data: Record<string, unknown>[]; sheetNames: string[] } {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetNames = workbook.SheetNames;
  const sheet = workbook.Sheets[sheetNames[0]];
  const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: false,
  });
  return { data, sheetNames };
}

function parseCsvBuffer(buffer: Buffer): Record<string, unknown>[] {
  const text = buffer.toString("utf-8");
  const result = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: true,
  });
  return result.data;
}

function buildDataFrameInfo(data: Record<string, unknown>[], sheetNames?: string[]): DataFrameInfo {
  if (data.length === 0) {
    return { row_count: 0, col_count: 0, fields: [], preview: [] };
  }
  const columns = Object.keys(data[0]);
  const fields: FieldInfo[] = columns.map(col => {
    const values = data.map(row => row[col]);
    const nonNull = values.filter(v => v !== null && v !== undefined && v !== "");
    const unique = new Set(nonNull.map(String)).size;
    const type = inferType(values);
    const sample = nonNull.slice(0, 5).map(v => (type === "numeric" ? Number(v) : String(v)));
    return {
      name: col,
      type,
      dtype: type === "numeric" ? "float64" : "object",
      null_count: values.length - nonNull.length,
      unique_count: unique,
      sample,
    };
  });
  return {
    row_count: data.length,
    col_count: columns.length,
    fields,
    preview: data.slice(0, 5),
  };
}

// ── Persistent session helpers ────────────────────────────────────────────────
// Parsed data rows are stored in S3 as JSON; dfInfo is stored in sessions.dfInfo column.
// This survives server restarts.

const DATA_KEY = (sessionId: string) => `atlas-data/${sessionId}-data.json`;

async function storeSessionData(sessionId: string, data: Record<string, unknown>[]): Promise<void> {
  await storagePut(DATA_KEY(sessionId), JSON.stringify(data), "application/json");
}

async function loadSessionData(sessionId: string): Promise<Record<string, unknown>[] | null> {
  try {
    const { url } = await storageGet(DATA_KEY(sessionId));
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json() as Record<string, unknown>[];
  } catch {
    return null;
  }
}

// ── Register routes ───────────────────────────────────────────────────────────

export function registerAtlasRoutes(app: Express) {

  // ── POST /api/atlas/upload ────────────────────────────────────────────────

  app.post("/api/atlas/upload", optionalAuth, upload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No file uploaded" });
        return;
      }

      const { originalname, buffer, mimetype } = req.file;
      const ext = originalname.split(".").pop()?.toLowerCase() || "xlsx";
      const sessionId = nanoid();
      const fileKey = `atlas-uploads/${sessionId}-${Date.now()}.${ext}`;

      // 1. Upload original file to S3
      const { url: fileUrl } = await storagePut(fileKey, buffer, mimetype);

      // 2. Parse data
      let data: Record<string, unknown>[];
      let sheetNames: string[] | undefined;
      if (ext === "csv") {
        data = parseCsvBuffer(buffer);
      } else {
        const parsed = parseExcelBuffer(buffer, originalname);
        data = parsed.data;
        sheetNames = parsed.sheetNames;
      }

      const dfInfo = buildDataFrameInfo(data, sheetNames);

      // 3. Persist parsed data to S3 (for AI chat — survives restarts)
      await storeSessionData(sessionId, data);

      // 4. Create session record in DB (dfInfo stored in JSON column)
      await createSession({
        id: sessionId,
        userId: (req as any).userId || 0, // userId injected by auth middleware if available
        filename: fileKey,
        originalName: originalname,
        fileKey,
        fileUrl,
        fileSizeKb: Math.ceil(buffer.length / 1024),
        rowCount: dfInfo.row_count,
        colCount: dfInfo.col_count,
        dfInfo: dfInfo as any,
        isMerged: 0,
        status: "ready",
      });

      // 5. AI analysis (non-streaming, fast summary)
      const openai = createLLM();
      const fieldSummary = dfInfo.fields.slice(0, 15).map(f =>
        `${f.name}(${f.type}, ${f.unique_count}个唯一值, 示例:${f.sample.slice(0, 3).join("/")})`
      ).join(", ");

      let aiAnalysis = "";
      try {
        const result = await streamText({
          model: openai.chat("gemini-2.5-flash"),
          system: `你是 ATLAS，一个友好、自然的数据助手，像朋友一样和用户交流。
用户刚刚拖入了一份数据文件，你需要：
1. 简短友好地打招呼（1句话，不要说"你好我是ATLAS"这种机械语气，要自然）
2. 用1-2句话说明你看到了什么数据（文件名、行数、关键字段）
3. 直接问用户想要什么，给出2-3个具体的可操作建议（例如：提取某些字段、生成汇总表、分析排名等）
语气：轻松、自然、专业，像一个懂数据的朋友。不超过120字。`,
          messages: [{
            role: "user",
            content: `文件名：${originalname}，共 ${dfInfo.row_count} 行 ${dfInfo.col_count} 列。字段：${fieldSummary}。`,
          }],
        });
        aiAnalysis = await result.text;
      } catch (e) {
        console.warn("[Atlas] AI analysis failed:", e);
        aiAnalysis = `收到了！**${originalname}** 共 ${dfInfo.row_count.toLocaleString()} 行数据，包含字段：${dfInfo.fields.slice(0, 6).map(f => f.name).join("、")}${dfInfo.fields.length > 6 ? "等" : ""}。

你想怎么处理这份数据？可以提取指定字段、生成汇总表、排名分析，或者直接告诉我你想要什么。`;
      }

      // Generate smart suggested actions based on field names
      const fieldNames = dfInfo.fields.map(f => f.name.toLowerCase());
      const suggestedActions: Array<{ label: string; prompt: string; icon: string }> = [];

      // Detect data type and suggest relevant actions
      const hasSales = fieldNames.some(f => /销售|金额|订单|gmv|amount|sales|revenue/.test(f));
      const hasPayroll = fieldNames.some(f => /工资|薪资|工资|工资|工资|工资|salary|pay|wage/.test(f));
      const hasAttendance = fieldNames.some(f => /出勤|考勤|迟到|早退|attendance|clock/.test(f));
      const hasDividend = fieldNames.some(f => /分红|分配|奖金|dividend|bonus/.test(f));
      const hasStore = fieldNames.some(f => /门店|店铺|店名|store|shop/.test(f));
      const hasDate = fieldNames.some(f => /日期|时间|月份|date|time|month/.test(f));
      const hasName = fieldNames.some(f => /姓名|名字|员工|人员|name|staff|employee/.test(f));

      if (hasPayroll || (hasName && dfInfo.fields.some(f => /numeric/.test(f.type)))) {
        suggestedActions.push({ icon: "📝", label: "生成工资条", prompt: "帮我根据这份数据生成工资条，包含姓名、工资明细和实发金额" });
      }
      if (hasDividend) {
        suggestedActions.push({ icon: "💰", label: "分红明细表", prompt: "帮我生成分红明细表，按分红金额从高到低排序" });
        suggestedActions.push({ icon: "🏆", label: "Top10 排名", prompt: "帮我找出分红最高的前10名和最低的后10名" });
      }
      if (hasSales) {
        suggestedActions.push({ icon: "📊", label: "销售汇总表", prompt: "帮我汇总销售数据，显示总销售额、订单数和关键指标" });
      }
      if (hasStore) {
        suggestedActions.push({ icon: "🏦", label: "门店对比", prompt: "帮我按门店分组汇总，对比各门店表现" });
      }
      if (hasAttendance) {
        suggestedActions.push({ icon: "📅", label: "考勤汇总", prompt: "帮我汇总考勤数据，统计出勤天数、迟到次数和早退记录" });
      }
      if (hasDate) {
        suggestedActions.push({ icon: "📈", label: "趋势分析", prompt: "帮我按时间分析数据趋势，看看有什么规律" });
      }

      // Always add generic options
      if (suggestedActions.length < 2) {
        suggestedActions.push({ icon: "📊", label: "生成汇总表", prompt: "帮我生成数据汇总表，包含关键指标和统计" });
        suggestedActions.push({ icon: "🔍", label: "数据分析", prompt: "帮我分析这份数据，找出关键规律和异常值" });
      }
      suggestedActions.push({ icon: "✨", label: "自定义需求", prompt: "" }); // empty prompt = open input

      res.json({
        session_id: sessionId,
        filename: originalname,
        file_url: fileUrl,
        df_info: {
          row_count: dfInfo.row_count,
          col_count: dfInfo.col_count,
          fields: dfInfo.fields,
          preview: dfInfo.preview,
        },
        ai_analysis: aiAnalysis,
        suggested_actions: suggestedActions,
      });
    } catch (err: any) {
      console.error("[Atlas] Upload error:", err);
      res.status(500).json({ error: err.message || "Upload failed" });
    }
  });

  // ── POST /api/atlas/chat ──────────────────────────────────────────────────
  // Streaming text response about the uploaded data

    app.post("/api/atlas/chat", optionalAuth, async (req: Request, res: Response) => {
    try {
      const { session_id, session_ids, message, history } = req.body as {
        session_id?: string;
        session_ids?: string[];
        message: string;
        history?: Array<{ role: "user" | "assistant"; content: string }>;
      };
      // Support both single session_id and multiple session_ids
      const allSessionIds = session_ids?.length ? session_ids : session_id ? [session_id] : [];
      if (!allSessionIds.length || !message) {
        res.status(400).json({ error: "session_id(s) and message are required" });
        return;
      }
      // Load all sessions
      const sessionRecords = await Promise.all(allSessionIds.map(id => getSession(id)));
      const validSessions = sessionRecords.filter(Boolean);
      if (!validSessions.length) {
        res.status(404).json({ error: "Session not found. Please re-upload the file." });
        return;
      }
      // Use first session as primary, merge context from others
      const sessionRecord = validSessions[0]!;
      const dfInfo = sessionRecord.dfInfo as DataFrameInfo | null;
      const filename = validSessions.length > 1
        ? validSessions.map(s => s!.originalName).join("、")
        : sessionRecord.originalName;

      if (!dfInfo) {
        res.status(404).json({ error: "Session data not found. Please re-upload the file." });
        return;
      }

      // Load parsed data from S3 (use first valid session)
      const data = await loadSessionData(allSessionIds[0]);
      if (!data) {
        res.status(404).json({ error: "Session data expired. Please re-upload the file." });
        return;
      }

      // Build data context for AI
      const fieldSummary = dfInfo.fields.slice(0, 20).map((f: FieldInfo) =>
        `- ${f.name}: ${f.type}类型, ${dfInfo.row_count}行, ${f.null_count}个空值, 示例值: ${f.sample.slice(0, 3).join(", ")}`
      ).join("\n");

      // Sample a few rows for context
      const sampleRows = data.slice(0, 10).map(row =>
        Object.entries(row).slice(0, 8).map(([k, v]) => `${k}=${v}`).join(", ")
      ).join("\n");

        const systemPrompt = `你是 ATLAS，一个懂数据的朋友，不是冷冰冰的工具。和用户自然对话，像朋友一样交流。

当前数据：${filename}（${dfInfo.row_count} 行 × ${dfInfo.col_count} 列）
字段：
${fieldSummary}
数据样例：
${sampleRows}

对话原则：
1. 语气自然、轻松，可以用「好的」「没问题」「稍等」等口语
2. 用户说「谢谢」「不错」等，正常回应，像朋友一样
3. 如果用户要生成表格/报表/汇总/分析，直接告诉他「好的，马上为你生成」，不要让他去找按钮
4. 如果用户说「再细化」「换个格式」「加上XXX」，理解为对上一次结果的修改需求
5. 回答简洁，不要废话，最多3-4句话
6. 遇到数据问题可以直接给出数字分析结果
使用中文，语气友好专业。`;

      const openai = createLLM();

      // Build message history
      const messages: Array<{ role: "user" | "assistant"; content: string }> = [
        ...(history || []).slice(-6), // Keep last 6 messages for context
        { role: "user", content: message },
      ];

      const result = streamText({
        model: openai.chat("gemini-2.5-flash"),
        system: systemPrompt,
        messages,
      });

      result.pipeTextStreamToResponse(res);
    } catch (err: any) {
      console.error("[Atlas] Chat error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || "Chat failed" });
      }
    }
  });

  // ── POST /api/atlas/generate-report ──────────────────────────────────────
  // Generate Excel report based on user requirement

  app.post("/api/atlas/generate-report", optionalAuth, async (req: Request, res: Response) => {
    try {
      const { session_id, requirement, report_title } = req.body as {
        session_id: string;
        requirement: string;
        report_title?: string;
      };

      if (!session_id || !requirement) {
        res.status(400).json({ error: "session_id and requirement are required" });
        return;
      }

      // Load session from DB
      const sessionRecord = await getSession(session_id);
      if (!sessionRecord) {
        res.status(404).json({ error: "Session not found. Please re-upload the file." });
        return;
      }

      const dfInfo = sessionRecord.dfInfo as DataFrameInfo | null;
      const filename = sessionRecord.originalName;

      if (!dfInfo) {
        res.status(404).json({ error: "Session data not found. Please re-upload the file." });
        return;
      }

      // Load parsed data from S3
      const data = await loadSessionData(session_id);
      if (!data) {
        res.status(404).json({ error: "Session data expired. Please re-upload the file." });
        return;
      }
      // 1. Ask AI to generate the report data as JSONN
      const openai = createLLM();
      const fieldNames = dfInfo.fields.map((f: FieldInfo) => f.name).join(", ");
      const sampleRows = JSON.stringify(data.slice(0, 20), null, 2);

      // RAG: retrieve similar high-rated examples for self-learning
      const columnSignature = dfInfo.fields.map((f: FieldInfo) => f.name).join(",");
      const ragExamples = await getSimilarExamples(columnSignature, 2);
      const ragSection = ragExamples.length > 0
        ? `\n\n参考示例（这是用户评分较高的历史报表，请学习其分析风格和结构）：\n${ragExamples.map((ex, i) => `示例${i + 1}：需求「${ex.prompt}」，用户评分：${ex.rating}星`).join("\n")}`
        : "";

      const aiPrompt = `你是数据分析专家。根据以下数据和需求，生成一份报表数据。${ragSection}

数据文件：${filename}（${dfInfo.row_count}行 x ${dfInfo.col_count}列）
字段：${fieldNames}

数据样例（前20行）：
${sampleRows}

用户需求：${requirement}

请返回一个 JSON 对象，格式如下：
{
  "title": "报表标题",
  "sheets": [
    {
      "name": "Sheet名称",
      "headers": ["入1", "入2", "入3"],
      "rows": [
        ["倃1", "倃2", "倃3"]
      ],
      "summary": "本sheet的说明"
    }
  ],
  "insights": "关键发现和建议（2-3条）"
}

要求：
- 最多3个Sheet
- 每个Sheet最多50行数据
- 数据要准确，基于实际数据计算
- 如果需要汇总，请按需求进行分组汇总
- 只返回JSON，不要其他文字`;

      let reportData: {
        title: string;
        sheets: Array<{
          name: string;
          headers: string[];
          rows: (string | number)[][];
          summary?: string;
        }>;
        insights: string;
      };

      try {
        const aiResult = await streamText({
          model: openai.chat("gemini-2.5-flash"),
          messages: [{ role: "user", content: aiPrompt }],
        });
        const rawText = await aiResult.text;
        // Extract JSON from response
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("AI did not return valid JSON");
        reportData = JSON.parse(jsonMatch[0]);
      } catch (e) {
        console.warn("[Atlas] AI report generation failed, using fallback:", e);
        // Fallback: create a simple summary sheet
        const headers = dfInfo.fields.map((f: FieldInfo) => f.name);
        const rows = data.slice(0, 30).map(row => headers.map((h: string) => row[h] ?? ""));
        reportData = {
          title: report_title || requirement.slice(0, 30),
          sheets: [{
            name: "数据汇总",
            headers,
            rows: rows as (string | number)[][],
            summary: "原始数据（前30行）",
          }],
          insights: `已导出 ${Math.min(data.length, 30)} 行数据。`,
        };
      }

      // 2. Generate Excel file
      const workbook = XLSX.utils.book_new();
      for (const sheet of reportData.sheets) {
        const wsData = [sheet.headers, ...sheet.rows];
        const ws = XLSX.utils.aoa_to_sheet(wsData);

        // Style header row (bold)
        const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
        for (let c = range.s.c; c <= range.e.c; c++) {
          const cellAddr = XLSX.utils.encode_cell({ r: 0, c });
          if (ws[cellAddr]) {
            ws[cellAddr].s = { font: { bold: true }, fill: { fgColor: { rgb: "1E3A5F" } } };
          }
        }

        // Auto column widths
        ws["!cols"] = sheet.headers.map(h => ({ wch: Math.max(h.length * 2, 12) }));
        XLSX.utils.book_append_sheet(workbook, ws, sheet.name.slice(0, 31));
      }

      const excelBuffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

      // 3. Upload to S3
      const reportId = nanoid();
      const safeTitle = (reportData.title || "report").replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, "_").slice(0, 40);
      const reportKey = `atlas-reports/${reportId}-${safeTitle}.xlsx`;
      const { url: reportUrl } = await storagePut(reportKey, excelBuffer, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

      // 4. Persist report to DB (replaces in-memory reportStore)
      const userId = (req as any).userId || 0;
      await createReport({
        id: reportId,
        sessionId: session_id,
        userId,
        title: reportData.title || safeTitle,
        filename: `${safeTitle}.xlsx`,
        fileKey: reportKey,
        fileUrl: reportUrl,
        fileSizeKb: Math.ceil(excelBuffer.length / 1024),
        prompt: requirement,
        status: "completed",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });

      const aiMessage = `✅ **${reportData.title}** 已生成完毕！\n\n${reportData.insights}\n\n报表包含 ${reportData.sheets.length} 个工作表：${reportData.sheets.map(s => s.name).join("、")}。`;

      res.json({
        report_id: reportId,
        filename: `${safeTitle}.xlsx`,
        download_url: reportUrl,
        ai_message: aiMessage,
        plan: {
          title: reportData.title,
          sheets: reportData.sheets.map(s => ({
            name: s.name,
            headers: s.headers,
            rows: s.rows.slice(0, 50),
            summary: s.summary || "",
          })),
          insights: reportData.insights,
        },
      });
    } catch (err: any) {
      console.error("[Atlas] Generate report error:", err);
      res.status(500).json({ error: err.message || "Report generation failed" });
    }
  });

  // ── GET /api/atlas/download/:reportId ─────────────────────────────────────

  app.get("/api/atlas/download/:reportId", async (req: Request, res: Response) => {
    try {
      const { reportId } = req.params;
      // Load from DB instead of in-memory store
      const report = await getReport(reportId);
      if (!report || !report.fileKey) {
        res.status(404).json({ error: "Report not found or expired" });
        return;
      }
      // Get fresh presigned URL from S3
      const { url } = await storageGet(report.fileKey);
      res.redirect(url);
    } catch (err: any) {
      console.error("[Atlas] Download error:", err);
      res.status(500).json({ error: err.message });
    }
  });
}
