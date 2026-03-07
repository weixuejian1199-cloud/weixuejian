/**
 * ATLAS Core API Routes
 * ─────────────────────────────────────────────────────────────────
 * Endpoints:
 *   POST /api/atlas/upload      — Upload Excel/CSV → S3 → parse → AI analysis
 *   POST /api/atlas/chat        — Streaming AI chat about uploaded data
 *   POST /api/atlas/generate-report — Generate Excel report → S3 → download URL
 *   GET  /api/atlas/download/:reportId — Redirect to S3 download URL
 */

import type { Express, Request, Response } from "express";
import multer from "multer";
import { nanoid } from "nanoid";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import { streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { ENV } from "./_core/env";
import { createPatchedFetch } from "./_core/patchedFetch";
import { storagePut, storageGet } from "./storage";

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

// ── In-memory session store (cleared on server restart) ───────────────────────
// For production, store data in Redis or DB. Here we keep parsed data in memory
// so AI can reference it during the session.

const sessionDataStore = new Map<string, {
  data: Record<string, unknown>[];
  dfInfo: DataFrameInfo;
  filename: string;
  fileKey: string;
  fileUrl: string;
}>();

// ── Register routes ───────────────────────────────────────────────────────────

export function registerAtlasRoutes(app: Express) {

  // ── POST /api/atlas/upload ────────────────────────────────────────────────

  app.post("/api/atlas/upload", upload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No file uploaded" });
        return;
      }

      const { originalname, buffer, mimetype } = req.file;
      const ext = originalname.split(".").pop()?.toLowerCase() || "xlsx";
      const sessionId = nanoid();
      const fileKey = `atlas-uploads/${sessionId}-${Date.now()}.${ext}`;

      // 1. Upload to S3
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

      // 3. Store in memory for AI chat
      sessionDataStore.set(sessionId, { data, dfInfo, filename: originalname, fileKey, fileUrl });

      // 4. AI analysis (non-streaming, fast summary)
      const openai = createLLM();
      const fieldSummary = dfInfo.fields.slice(0, 15).map(f =>
        `${f.name}(${f.type}, ${f.unique_count}个唯一值, 示例:${f.sample.slice(0, 3).join("/")})`
      ).join(", ");

      let aiAnalysis = "";
      try {
        const result = await streamText({
          model: openai.chat("gemini-2.5-flash"),
          system: "你是 ATLAS 数据分析助手。用简洁的中文分析数据，不超过150字。",
          messages: [{
            role: "user",
            content: `文件：${originalname}，共 ${dfInfo.row_count} 行 ${dfInfo.col_count} 列。字段：${fieldSummary}。请简要描述这份数据的内容和可以做哪些分析。`,
          }],
        });
        aiAnalysis = await result.text;
      } catch (e) {
        console.warn("[Atlas] AI analysis failed:", e);
        aiAnalysis = `已解析 **${originalname}**，共 ${dfInfo.row_count.toLocaleString()} 行、${dfInfo.col_count} 列数据。\n\n包含字段：${dfInfo.fields.map(f => f.name).join("、")}。\n\n请描述您需要什么样的报表分析。`;
      }

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
      });
    } catch (err: any) {
      console.error("[Atlas] Upload error:", err);
      res.status(500).json({ error: err.message || "Upload failed" });
    }
  });

  // ── POST /api/atlas/chat ──────────────────────────────────────────────────
  // Streaming text response about the uploaded data

  app.post("/api/atlas/chat", async (req: Request, res: Response) => {
    try {
      const { session_id, message, history } = req.body as {
        session_id: string;
        message: string;
        history?: Array<{ role: "user" | "assistant"; content: string }>;
      };

      if (!session_id || !message) {
        res.status(400).json({ error: "session_id and message are required" });
        return;
      }

      const session = sessionDataStore.get(session_id);
      if (!session) {
        res.status(404).json({ error: "Session not found or expired. Please re-upload the file." });
        return;
      }

      const { dfInfo, filename, data } = session;

      // Build data context for AI
      const fieldSummary = dfInfo.fields.slice(0, 20).map(f =>
        `- ${f.name}: ${f.type}类型, ${dfInfo.row_count}行, ${f.null_count}个空值, 示例值: ${f.sample.slice(0, 3).join(", ")}`
      ).join("\n");

      // Sample a few rows for context
      const sampleRows = data.slice(0, 10).map(row =>
        Object.entries(row).slice(0, 8).map(([k, v]) => `${k}=${v}`).join(", ")
      ).join("\n");

      const systemPrompt = `你是 ATLAS 数据分析助手，专门帮助用户分析电商/零售数据。

当前数据文件：${filename}
数据规模：${dfInfo.row_count} 行 × ${dfInfo.col_count} 列

字段信息：
${fieldSummary}

数据样例（前10行）：
${sampleRows}

请根据数据内容回答用户问题。如果用户要求生成报表，请告知他们可以使用"生成报表"功能。
回答要简洁、专业，使用中文。`;

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

  app.post("/api/atlas/generate-report", async (req: Request, res: Response) => {
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

      const session = sessionDataStore.get(session_id);
      if (!session) {
        res.status(404).json({ error: "Session not found or expired. Please re-upload the file." });
        return;
      }

      const { dfInfo, filename, data } = session;

      // 1. Ask AI to generate the report data as JSON
      const openai = createLLM();
      const fieldNames = dfInfo.fields.map(f => f.name).join(", ");
      const sampleRows = JSON.stringify(data.slice(0, 20), null, 2);

      const aiPrompt = `你是数据分析专家。根据以下数据和需求，生成一份报表数据。

数据文件：${filename}（${dfInfo.row_count}行 × ${dfInfo.col_count}列）
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
      "headers": ["列1", "列2", "列3"],
      "rows": [
        ["值1", "值2", "值3"],
        ...
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
        const headers = dfInfo.fields.map(f => f.name);
        const rows = data.slice(0, 30).map(row => headers.map(h => row[h] ?? ""));
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

      // 4. Store report metadata in memory (for download redirect)
      reportStore.set(reportId, { key: reportKey, url: reportUrl, filename: `${safeTitle}.xlsx` });

      const aiMessage = `✅ **${reportData.title}** 已生成完毕！\n\n${reportData.insights}\n\n报表包含 ${reportData.sheets.length} 个工作表：${reportData.sheets.map(s => s.name).join("、")}。`;

      res.json({
        report_id: reportId,
        filename: `${safeTitle}.xlsx`,
        download_url: reportUrl,
        ai_message: aiMessage,
        plan: {
          title: reportData.title,
          sheets: reportData.sheets.map(s => ({ name: s.name, summary: s.summary || "" })),
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
      const report = reportStore.get(reportId);
      if (!report) {
        res.status(404).json({ error: "Report not found or expired" });
        return;
      }
      // Get fresh presigned URL from S3
      const { url } = await storageGet(report.key);
      res.redirect(url);
    } catch (err: any) {
      console.error("[Atlas] Download error:", err);
      res.status(500).json({ error: err.message });
    }
  });
}

// ── In-memory report store ────────────────────────────────────────────────────
const reportStore = new Map<string, { key: string; url: string; filename: string }>();
