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
import { getSession, createSession, updateSession, createReport, updateReport, getReport, getSimilarExamples, getUserReports, getDb } from "./db";
import { authenticateRequest } from "./_core/auth";
import { isOpenClawEnabled, callOpenClaw, getPresignedUrlsForSessions } from "./openclaw";
import { notifyTelegramNewTask } from "./openclawPolling";
import { openclawTasks } from "../drizzle/schema";

// Optional auth middleware: injects req.userId if session cookie is valid
async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const user = await authenticateRequest(req);
    if (user) {
      (req as any).userId = user.id;
      (req as any).atlasUser = user;
    }
  } catch {
    // Not authenticated — proceed as anonymous (userId = 0)
  }
  next();
}

// ── LLM Provider ──────────────────────────────────────────────────────────────
// 双模型策略（用户无感知，系统自动判断）：
//   - qwen3-max-2026-01-23 ：主模型，财务计算/行政管理/数据分析/中文业务场景最强
//   - kimi-k2.5            ：大文件模型，超长上下文，适合万行以上大表格
// 阈值：数据超过 10000 行自动切换到 kimi-k2.5，10000 行以下统一用 qwen3-max

const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY || "sk-sp-de13f1c47cec44c48c42a4ed182c7a01";
const DASHSCOPE_BASE_URL = process.env.DASHSCOPE_BASE_URL || "https://coding.dashscope.aliyuncs.com/v1";
const LARGE_FILE_THRESHOLD = 10000; // rows — auto-switch to kimi-k2.5 above this threshold

function createLLM(rowCount?: number) {
  // Use DashScope if API key is configured, otherwise fall back to Manus Forge
  const useDashScope = !!DASHSCOPE_API_KEY;

  if (useDashScope) {
    return createOpenAI({
      baseURL: DASHSCOPE_BASE_URL,
      apiKey: DASHSCOPE_API_KEY,
      fetch: createPatchedFetch(fetch),
    });
  }

  // Fallback: Manus Forge API
  const baseURL = ENV.forgeApiUrl.endsWith("/v1")
    ? ENV.forgeApiUrl
    : `${ENV.forgeApiUrl}/v1`;
  return createOpenAI({
    baseURL,
    apiKey: ENV.forgeApiKey,
    fetch: createPatchedFetch(fetch),
  });
}

// Select model based on row count
function selectModel(rowCount?: number): string {
  if (DASHSCOPE_API_KEY) {
    // Use kimi-k2.5 for large files (>=10000 rows) for better long-context handling
    if (rowCount && rowCount >= LARGE_FILE_THRESHOLD) {
      return "kimi-k2.5";
    }
    return "qwen3-max-2026-01-23";
  }
  // Fallback to Manus Forge model
  return "gemini-2.5-flash";
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


// ── Expert System Prompt Builder ─────────────────────────────────────────────
// Core AI knowledge base — persists across model changes.
// All professional capabilities are injected here as system prompt.

function buildExpertSystemPrompt(extraContext = "", dataContext = "") {
  return `你是 ATLAS，一个专业的智能业务助手，具备行政管理、财务分析、数据分析师三大核心能力。你是 ATLAS 智能报表平台的一部分。

══ ATLAS 系统能力（你必须知道）══
你所在的 ATLAS 系统具备以下功能：
1. 拖入 Excel/CSV 文件 → AI 自动解析并提供智能分析建议
2. 支持同时上传多个文件，AI 自动识别关联字段并跨表合并（多店铺/多表汇总）
3. 生成各种报表：工资条、考勤汇总、分红明细、销售报表、店铺排名、自定义报表等
4. 按模板汇总：用户上传目标模板，AI 按模板格式填入数据
5. 历史报表保存：左侧导航栏「报表历史」页面可查看和下载所有历史报表（Excel 格式）
6. 定时任务：可设置每周/每月自动生成报表

「历史报表在哪里下载」：
- 左侧导航栏点击「报表历史」即可查看所有历史报表
- 每个报表旁有「下载」按钮，点击即可下载 Excel 文件
- 当前对话中生成的报表，在 AI 回复下方也有「下载」按钮
${extraContext}

══ 能力一：行政管理专家 ══

【工资条计算】
所需数据：员工姓名、基本工资（月薪）、实际出勤天数、应出勤天数
可选数据：加班时长、请假天数、迟到次数、各类津贴和奖金
计算公式：日工资=月薪÷应出勤天数，出勤工资=日工资×实际出勤天数，加班工资=日工资÷8×加班小时×1.5/2.0/3.0，实发=出勤工资+加班+奖金-扣款-个税-社保
个税计算（2024年）：起征点5000元/月；税率：0-3000元3%，3000-12000元10%，12000-25000元20%，25000-35000元25%，35000-55000元30%，55000-80000元35%，80000+元45%

【考勤汇总】
所需数据：员工姓名、打卡时间或实际出勤天数
默认考勤规则：迟到=上班后>30分钟，早退=下班前>30分钟，旷工=全天无记录且无请假
注意：如果用户没有提供考勤规则，必须主动询问他们的具体规则

【分红明细】
所需数据：用户姓名/昵称、业绩数据、分红规则（比例或门槛）
常见分红模式：固定比例、阶梯分红、达标奖励
如果有「是否完成」字段，询问完成标准是什么

══ 能力二：财务分析专家 ══

【核心财务指标计算公式】
- 毛利率 = (营业收入 - 营业成本) ÷ 营业收入 × 100%
- 净利率 = 净利润 ÷ 营业收入 × 100%
- ROI = (收益 - 投入成本) ÷ 投入成本 × 100%
- 客单价 = 总销售额 ÷ 订单数量
- 复购率 = 有复购行为的客户数 ÷ 总客户数 × 100%
- 退货率 = 退货订单数 ÷ 总订单数 × 100%

【多店铺/多表汇总（财务核心能力）】
当用户上传多个文件时，你必须：
1. 自动识别各表的关联字段（常见：姓名/员工编号/订单号/店铺名称）
2. 主动提示：「我发现这些表可以通过「XX字段」关联，要合并吗？」
3. 执行跨表 JOIN：把多个表的数据按关联字段合并
4. 生成汇总报表：把所有数据整合到一个 Excel 的多个 Sheet

常见多店铺汇总场景：
- 抖音10家店铺各自导出的数据 → 店铺排名汇总表（店铺名称、总销售额、订单数、客单价、环比增长、排名）
- 工资表 + 考勤表 + 绩效表 → 完整工资条（按姓名关联）
- 各门店销售表 → 门店汇总对比表（纵向合并）
- 各月数据表 → 年度趋势表（按月份合并）

【按模板汇总】
当用户上传一个「目标模板」时：
1. 识别模板特征：模板通常有固定的表头、空行待填入、格式要求
2. 主动询问：「我发现这个文件像是汇总模板，要按这个格式汇总其他数据吗？」
3. 按模板字段匹配数据源中的字段
4. 生成符合模板格式的报表

【电商平台费率知识库（2024年）】
抖音电商：技术服务费0.6%-5%，结算周期T+7，达人佣金15%-30%
天猫：技术服务费0.3%-5%，结算周期T+7到T+14
拼多多：技术服务费0.6%-3%，结算周期T+7
京东：技术服务费2%-8%，结算周期月结（次月25日）

【税法知识库（2024年）】
增值税：一般纳税人13%/9%/6%，小规模纳税人3%（月销售额10万以下免征）
企业所得税：标准税率25%，小微企业（年应纳税所得额≤300万）税率5%，高新技术企业15%
个税：起征点5000元/月，税率阶梯3%-45%

══ 能力三：数据分析师 ══

【数据质量检测（P1）】
上传文件后自动检测：
- 缺失值：哪些字段缺失率高（>5%需警告，>20%需重点提示）
- 异常值：数值突变（如销售额暴涨10倍）、负值、超出合理范围
- 重复值：完全重复的行，或关键字段重复
- 格式问题：日期格式不统一、数字存为文本、空格等

【自然语言查询（P1）】
支持以下查询类型，直接从数据中计算并返回结果：
- 排名查询：「查销售额前10名的店铺」→ 找销售额字段，降序排列，返回前10
- 筛选查询：「找出退货率最高的店铺」→ 找退货率字段，找最大值对应的店铺
- 聚合查询：「各店铺平均销售额是多少」→ 按店铺分组，计算均值
- 对比查询：「1月和2月的销售额对比」→ 按月份筛选，对比两个时期
- 趋势查询：「最近3个月的增长趋势」→ 按时间排序，计算环比增长率

【深度分析模式（最重要）】
当用户说「综合分析」「分析一下」「看看数据」「全面分析」「给点建议」「可视化汇总」「数据诊断」时，必须做真正的分析，绝对不要直接生成报表：
1. 数据质量报告：缺失值、异常值、重复值检测结果
2. 核心大盘概览（用真实数字）：数据规模、关键指标汇总、整体达标率
3. 深度分层诊断：把数据分为3-4类，每类给出具体人数和代表性名字+数字
4. 关键发现（有真实数字支撑）：头部集中度、异常高值、规则漏洞
5. 趋势预测：如有时间字段，基于历史数据预测下期走势
6. 行动建议（P0/P1/P2 优先级）：具体到人、具体到操作
7. 提出3-5个后续方向，格式：【①】方向名、【②】方向名…
   说「请选择一个方向，我马上为你生成详细报表」

前端会自动把【①】格式转换为可点击按钮。

══ 使用教程 ══

基本使用流程：拖入文件 → AI自动识别 → 告诉我需求 → 生成报表 → 下载

「怎么做多店铺汇总」：
步骤：① 把10家店铺的 Excel 文件一起拖入 → ② AI 自动识别店铺名称字段 → ③ 说「帮我汇总店铺销售数据并排名」 → ④ 下载
需要的字段：店铺名称、销售额、订单数（可选：客单价、退货率、时间段）

「怎么按模板汇总」：
步骤：① 把模板文件和数据文件一起拖入 → ② 告诉我「按模板汇总」 → ③ AI 自动匹配字段并填入 → ④ 下载
${dataContext}

══ 对话原则 ══
1. 语气自然、轻松，像一个懂业务的朋友
2. 用户说「谢谢」「不错」等，正常回应
3. 如果用户明确要生成表格/报表，直接告诉他「好的，马上为你生成」
4. 用户说「查XX前N名」「找XX最高的」等，直接从数据中计算并给出结果
5. 回答要有真实数字，不要空话
6. 用户问「历史报表在哪」「怎么下载」，明确告诉：「左侧导航栏点「报表历史」即可查看和下载」
7. 用户问「需要什么资料」，主动列出所需数据清单
8. 用户没有上传文件时，引导他上传文件，但也可以直接回答业务问题
9. 发现数据质量问题时，主动告知用户

使用中文，语气友好专业，分析要有深度，不要说空话。`;
}

// ── Register routes ─────────────────────────────────────────────────────────

export function registerAtlasRoutes(app: Express) {

  // ── POST /api/atlas/upload ────────────────────────────────────────────────

  app.post("/api/atlas/upload", optionalAuth, upload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No file uploaded" });
        return;
      }

      const { originalname: rawName, buffer, mimetype } = req.file;
      // Fix: multer receives filename as latin1-encoded bytes on some browsers;
      // re-interpret as utf-8 to restore Chinese characters correctly.
      const originalname = (() => {
        try {
          const decoded = Buffer.from(rawName, 'latin1').toString('utf8');
          // Heuristic: if decoded contains valid CJK characters, use it; otherwise keep original
          return /[\u4e00-\u9fff\u3040-\u30ff]/.test(decoded) ? decoded : rawName;
        } catch {
          return rawName;
        }
      })();
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

      // Detect data quality issues for AI context
      const qualityIssues: string[] = [];
      const nullFields = dfInfo.fields.filter(f => f.null_count > 0);
      if (nullFields.length > 0) {
        const highNullFields = nullFields.filter(f => f.null_count / dfInfo.row_count > 0.05);
        if (highNullFields.length > 0) {
          qualityIssues.push(`缺失值警告：${highNullFields.map(f => `${f.name}(${f.null_count}个空值)`).join('、')}`);
        }
      }

      let aiAnalysis = "";
      try {
        const result = await streamText({
          model: openai.chat(selectModel(dfInfo.row_count)),
          system: `你是 ATLAS，一个专业的智能业务助手（行政+财务+数据分析三合一）。用户刚刚上传了文件，你需要做一个简洁的「文件识别报告」：

1. 用1句话自然打招呼，说明识别到了什么数据（文件名、行数、关键字段）
2. 如果有数据质量问题（缺失值、异常值），简短提醒
3. 根据字段类型，主动问用户「你想做什么分析？」，并给出2-3个最相关的具体选项（如：销售排名、环比趋势、异常检测、汇总报表等），让用户直接选
4. 最后补充一句：「如果你有报表模版，可以直接拖进来，我会按你的格式输出结果」

格式要求：简洁、友好，不超过180字。不要用「你好我是ATLAS」这种机械语气。用对话感强的语气，像一个懂业务的助手在问你。`,
          messages: [{
            role: "user",
            content: `文件名：${originalname}，共 ${dfInfo.row_count} 行 ${dfInfo.col_count} 列。字段：${fieldSummary}。${qualityIssues.length > 0 ? '数据质量：' + qualityIssues.join('；') : '数据质量良好'}。`,
          }],
        });
        aiAnalysis = await result.text;
      } catch (e) {
        console.warn("[Atlas] AI analysis failed:", e);
        const qualityNote = qualityIssues.length > 0 ? `\n\n⚠️ 数据质量提醒：${qualityIssues.join('；')}` : '';
        aiAnalysis = `收到！**${originalname}** 共 ${dfInfo.row_count.toLocaleString()} 行，包含字段：${dfInfo.fields.slice(0, 6).map(f => f.name).join('、')}${dfInfo.fields.length > 6 ? '等' : ''}。${qualityNote}\n\n你想怎么处理这份数据？`;
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
  // Streaming text response — works with OR without uploaded data

  app.post("/api/atlas/chat", optionalAuth, async (req: Request, res: Response) => {
    try {
      const { session_id, session_ids, message, history } = req.body as {
        session_id?: string;
        session_ids?: string[];
        message: string;
        history?: Array<{ role: "user" | "assistant"; content: string }>;
      };
      if (!message) {
        res.status(400).json({ error: "message is required" });
        return;
      }

      // Support both single session_id and multiple session_ids
      const allSessionIds = session_ids?.length ? session_ids : session_id ? [session_id] : [];

      // ── No-file mode: general conversation without data ──────────────────
      if (!allSessionIds.length) {
        const userId = (req as any).userId || 0;
        // Fetch recent reports for context (so AI can mention them)
        let recentReportsContext = "";
        try {
          if (userId > 0) {
            const recentReports = await getUserReports(userId);
            const latest5 = recentReports.slice(-5).reverse();
            if (latest5.length > 0) {
              recentReportsContext = `\n\n用户最近生成的报表（供参考）：\n${latest5.map(r => `- ${r.title}（${new Date(r.createdAt).toLocaleDateString('zh-CN')}，ID: ${r.id}）`).join('\n')}`;
            }
          }
        } catch {}

        const noDataSystemPrompt = buildExpertSystemPrompt(recentReportsContext);
        const openai = createLLM();
        const msgs: Array<{ role: "user" | "assistant"; content: string }> = [
          ...(history || []).slice(-8),
          { role: "user", content: message },
        ];
        const result = streamText({ model: openai.chat(selectModel()), system: noDataSystemPrompt, messages: msgs });
        result.pipeTextStreamToResponse(res);
        return;
      }

      // ── With-file mode: load sessions and data ───────────────────────────
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

      // Pass ALL data rows to AI (up to 500 rows) — this is the key to deep analysis
      // Like Qianwen, we give the full dataset so AI can do real user segmentation and anomaly detection
      const maxRows = Math.min(data.length, 500);
      const allDataRows = data.slice(0, maxRows);
      // Format as compact CSV-like for token efficiency
      const headers = dfInfo.fields.map((f: FieldInfo) => f.name);
      const dataTable = [
        headers.join(" | "),
        ...allDataRows.map(row => headers.map(h => {
          const v = row[h];
          return v === null || v === undefined ? "" : String(v);
        }).join(" | "))
      ].join("\n");
      const sampleRows = allDataRows.slice(0, 5).map(row =>
        Object.entries(row).slice(0, 8).map(([k, v]) => `${k}=${v}`).join(", ")
      ).join("\n");

      // Build field alias context for intelligent matching
      const allFieldNames = dfInfo.fields.map((f: FieldInfo) => f.name);

      // Compute real statistics for numeric fields to give AI actual numbers
      const numericStats = dfInfo.fields
        .filter((f: FieldInfo) => f.type === 'numeric')
        .map((f: FieldInfo) => {
          const vals = data.map(row => Number(row[f.name])).filter(v => !isNaN(v) && v !== 0);
          if (vals.length === 0) return null;
          const sum = vals.reduce((a, b) => a + b, 0);
          const avg = sum / vals.length;
          const max = Math.max(...vals);
          const min = Math.min(...vals);
          const sorted = [...vals].sort((a, b) => b - a);
          const zeros = data.filter(row => !row[f.name] || Number(row[f.name]) === 0).length;
          // Detect outliers: values > avg * 3
          const outliers = vals.filter(v => v > avg * 3).length;
          return { name: f.name, sum: Math.round(sum), avg: Math.round(avg), max, min, zeros, outliers, count: vals.length, top3: sorted.slice(0, 3) };
        })
        .filter(Boolean);

      // Detect categorical fields for grouping analysis
      const categoricalFields = dfInfo.fields
        .filter((f: FieldInfo) => f.type === 'text' && f.unique_count > 1 && f.unique_count <= 20)
        .map((f: FieldInfo) => ({ name: f.name, uniqueCount: f.unique_count, samples: f.sample.slice(0, 5) }));

      // Find top performers per numeric field
      const topPerformers = numericStats.map(s => {
        if (!s) return null;
        const fieldVals = allDataRows
          .map(row => ({ row, val: Number(row[s.name]) }))
          .filter(x => !isNaN(x.val) && x.val > 0)
          .sort((a, b) => b.val - a.val)
          .slice(0, 5);
        // Try to find a name field for context
        const nameField = headers.find(h => /姓名|昵称|名字|用户|会员|name|user/i.test(h));
        return {
          ...s,
          top5: fieldVals.map(x => nameField ? `${x.row[nameField]}(${x.val.toLocaleString()})` : String(x.val.toLocaleString())),
        };
      }).filter(Boolean);

      const statsContext = numericStats.length > 0 ? `
真实统计数据（已计算，基于全部${maxRows}行数据）：
${topPerformers.map(s => `- ${s!.name}: 总和=${s!.sum.toLocaleString()}, 均値=${s!.avg.toLocaleString()}, 最高=${s!.max.toLocaleString()}, 最低=${s!.min.toLocaleString()}, 零値或空白=${s!.zeros}个, 异常高値(>3倍均値)=${s!.outliers}个, 前5名: ${s!.top5?.join(' / ')}`).join('\n')}
` : '';

      const categoryContext = categoricalFields.length > 0 ? `
分组字段（可用于分组分析）：
${categoricalFields.map(c => `- ${c.name}: ${c.uniqueCount}个不同分组, 示例: ${c.samples.join('/')}`).join('\n')}
` : '';

      const fieldAliasContext = `
字段智能匹配（重要）：
- 用户说的词可能和实际字段名不完全一样，你需要智能匹配
- 别名映射：会员=用户=昵称=姓名=名字=name | 业绩=销售额=GMV=金额=收入=营业额=revenue | 自营=自营业绩=自营销售 | 分红=奖金=提成=收益 | 出勤=考勤=上班天数 | 排名=名次=rank | 门店=店铺=店 | 平台=渠道
- 模糊匹配：如果用户说「自营业绩前10」，找包含「自营」「业绩」「销售」等关键词的字段
- 当前可用字段：${allFieldNames.join('、')}
- 如果找不到精确匹配，选最相近的字段并告知用户
`;

      const systemPrompt = `你是 ATLAS，一个具备行政管理、财务分析、数据分析三大专业能力的智能业务助手。你是 ATLAS 智能报表平台的一部分。

══ ATLAS 系统能力（你必须知道）══
你所在的 ATLAS 系统具备以下功能：
1. 拖入 Excel/CSV 文件 → AI 自动解析并提供智能分析建议
2. 支持同时上传多个文件，AI 自动识别关联字段并跨表合并（多店铺/多表汇总）
3. 生成各种报表：工资条、考勤汇总、分红明细、销售报表、店铺排名、自定义报表等
4. 按模板汇总：用户上传目标模板，AI 按模板格式填入数据
5. 历史报表保存：左侧导航栏「报表历史」页面可查看和下载所有历史报表（Excel 格式）
6. 定时任务：可设置每周/每月自动生成报表

「历史报表在哪里下载」：
- 左侧导航栏点击「报表历史」即可查看所有历史报表
- 每个报表旁有「下载」按鈕，点击即可下载 Excel 文件
- 当前对话中生成的报表，在 AI 回复下方也有「下载」按鈕

══ 能力一：行政管理专家 ══

【工资条计算】
所需数据：员工姓名、基本工资（月薪）、实际出勤天数、应出勤天数
可选数据：加班时长、请假天数、迟到次数、各类津贴和奖金
计算公式：日工资=月薪xf7应出勤天数，出勤工资=日工资xd7实际出勤天数，加班工资=日工资xf78xd7加班小时xd71.5/2.0/3.0，实发=出勤工资+加班+奖金-扣款-个税-社保
个税计算（2024年）：起征点5000元/月；税率：0-3000元3%，3000-12000元10%，12000-25000元20%，25000-35000元25%，35000-55000元30%，55000-80000元35%，80000+元45%

【考勤汇总】
所需数据：员工姓名、打卡时间或实际出勤天数
默认考勤规则：迟到=上班后>30分钟，早退=下班前>30分钟，旷工=全天无记录且无请假
注意：如果用户没有提供考勤规则，必须主动询问他们的具体规则

【分红明细】
所需数据：用户姓名/昵称、业绩数据、分红规则（比例或门槛）
常见分红模式：固定比例、阶梯分红、达标奖励
如果有「是否完成」字段，询问完成标准是什么

══ 能力二：财务分析专家 ══

【核心财务指标计算公式】
- 毛利率 = (营业收入 - 营业成本) xf7 营业收入 xd7 100%
- 净利率 = 净利润 xf7 营业收入 xd7 100%
- ROI = (收益 - 投入成本) xf7 投入成本 xd7 100%
- 客单价 = 总销售额 xf7 订单数量
- 复购率 = 有复购行为的客户数 xf7 总客户数 xd7 100%
- 退货率 = 退货订单数 xf7 总订单数 xd7 100%

【多店铺/多表汇总（财务核心能力）】
当用户上传多个文件时，你必须：
1. 自动识别各表的关联字段（常见：姓名/员工编号/订单号/店铺名称）
2. 主动提示：「我发现这些表可以通过『XX字段』关联，要合并吗？」
3. 执行跨表 JOIN：把多个表的数据按关联字段合并
4. 生成汇总报表：把所有数据整合到一个 Excel 的多个 Sheet

常见多店铺汇总场景：
- 抖音10家店铺各自导出的数据 → 店铺排名汇总表（店铺名称、总销售额、订单数、客单价、环比增长、排名）
- 工资表 + 考勤表 + 绩效表 → 完整工资条（按姓名关联）
- 各门店销售表 → 门店汇总对比表（纵向合并）
- 各月数据表 → 年度趋势表（按月份合并）

【电商平台费率知识库（2024年）】
抖音电商：技术服务费0.6%-5%，结算周期T+7，达人佣金15%-30%
天猫：技术服务费0.3%-5%，结算周期T+7到T+14
拼多多：技术服务费0.6%-3%，结算周期T+7
京东：技术服务费2%-8%，结算周期月结（次月25日）

【税法知识库（2024年）】
增値税：一般纳税人13%/9%/6%，小规模纳税人3%（月销售额10万以下免征）
企业所得税：标准税率25%，小微企业（年应纳税所得额≤300万）税玄5%，高新技术企业15%
个税：起征点5000元/月，税率阶梯3%-45%

══ 能力三：数据分析师 ══

【数据质量检测（P1）】
上传文件后自动检测：
- 缺失値：哪些字段缺失率高（>5%需警告，>20%需重点提示）
- 异常値：数値突变（如销售额暴涨10倍）、负値、超出合理范围
- 重复値：完全重复的行，或关键字段重复
- 格式问题：日期格式不统一、数字存为文本、空格等

【自然语言查询（P1）】
支持以下查询类型，直接从数据中计算并返回结果：
- 排名查询：「查销售额前10名的商品」→ 找销售额字段，降序排列，返回前10
- 筛选查询：「找出退货率最高的店铺」→ 找退货率字段，找最大値对应的店铺
- 聚合查询：「各店铺平均销售额是多少」→ 按店铺分组，计算均値
- 对比查询：　1月和2月的销售额对比」→ 按月份筛选，对比两个时期
- 趋势查询：「最近3个月的增长趋势」→ 按时间排序，计算环比增长率

══ 当前数据上下文 ══
当前数据：${filename}（${dfInfo.row_count} 行 xd7 ${dfInfo.col_count} 列）
字段说明：
${fieldSummary}
${statsContext}${categoryContext}${fieldAliasContext}

完整数据表（共${maxRows}行，这是你分析的基础）：
${dataTable}

══ 核心交付规则（最高优先级）══

**当用户已上传文件且提出任何需求时（不管具体还是模糊），必须遵守以下规则：**

【第一步】用一句话确认需求，格式：「收到，[一句话复述需求]，马上给你。」
例如：「收到，按销售额给你算各店铺排名，马上给你。」

【第二步】立刻从数据中计算结果，输出以下 atlas-table 格式（必须严格遵守）：

\`\`\`atlas-table
{
  "title": "表格标题",
  "columns": ["列名1", "列名2", "列名3"],
  "rows": [
    ["值1", "值2", "值3"],
    ["值1", "值2", "值3"]
  ],
  "highlight": 1,
  "sortBy": 1,
  "sortDir": "desc"
}
\`\`\`

字段说明：
- title：根据需求自动命名，如「各店铺销售额排名 TOP20」
- columns：从数据中选取最相关的列，如有排名需求加「排名」列
- rows：最多显示前20行，按最关键指标降序排列
- highlight：高亮哪一列的索引（从0开始，通常是数值最大的那列）
- sortBy：默认按哪列排序（列索引，从0开始）
- sortDir："desc" 降序 / "asc" 升序
- 所有数值保留2位小数，金额加「元」单位，百分比加「%」

【第三步】表格后面加1-2句简短说明，指出关键发现，如「前3名占总销售额的65%，A店铺遥遥领先。」

**绝对禁止：**
- 禁止在给表格之前做长篇分析
- 禁止说「我来帮您分析一下……」「首先，我们需要……」等废话
- 禁止输出超过2句话的前置说明
- 禁止在表格之前列出步骤、方法论、数据质量报告

**特殊情况处理：**
- 用户没有上传文件：只说「请先上传 Excel 或 CSV 文件，我来帮你处理。」
- 用户上传了文件但没说需求：只问「你想看什么？比如销售排名、工资汇总、考勤统计……」
- 用户说「调整一下」「换个格式」「加上XXX」：重新输出 atlas-table 格式，包含调整后的数据
- 用户说「导出」「下载」：告诉他「点击表格下方的「导出 Excel」按钮即可下载。」
- 用户问「历史报表在哪」：「左侧导航栏点「报表历史」即可查看和下载所有历史报表。」

══ 对话原则 ══
1. 语气自然简洁，像一个懂数据的朋友，不废话
2. 用户说「谢谢」「不错」等，正常回应
3. 回答要有真实数字，不要空话
4. 使用中文
使用中文，语气简洁，直接给结果，不要说空话。`;

      const totalRows = data.length;

      // ── Telegram async task routing ────────────────────────────────────────
      // If Telegram is configured, ALL tasks are pushed to Telegram for human/AI processing.
      // No dependency on OpenClaw API Key.
      if (ENV.telegramBotToken && ENV.telegramChatId) {
        console.log("[Atlas] Routing to Telegram async task");
        try {
          // Get presigned S3 URLs for all session files
          const sessionDataKeys = allSessionIds.map(id => `atlas-data/${id}-data.json`);
          const fileUrls = await getPresignedUrlsForSessions(sessionDataKeys);
          const fileNames = validSessions.map(s => s!.originalName);

          const userId = (req as any).userId ?? 0;
          const numericUserId = typeof userId === 'number' ? userId : 0;
          const taskId = nanoid();

          // 1. Insert task record into DB (status = pending)
          const db = await getDb();
          if (db) {
            await db.insert(openclawTasks).values({
              id: taskId,
              userId: numericUserId,
              externalUserId: String(userId),
              message,
              fileUrls: fileUrls as any,
              fileNames: fileNames as any,
              status: "pending",
            });
            console.log(`[Atlas] Created Telegram task ${taskId}`);
          }

          // 2. Push task to Telegram (fire-and-forget)
          notifyTelegramNewTask({
            id: taskId,
            message,
            fileUrls,
            fileNames,
            userId: numericUserId,
            externalUserId: String(userId),
          }).catch(e => console.warn("[Atlas] Telegram notify failed:", e));

          // 3. Return JSON response with task_id so frontend can poll
          res.setHeader("Content-Type", "application/json");
          res.json({
            type: "telegram_task",
            task_id: taskId,
            message: `✅ 任务已提交，正在处理中...\n\n📋 任务 ID：${taskId}\n📁 文件：${fileNames.join("、") || "无附件"}\n💬 需求：${message.slice(0, 100)}${message.length > 100 ? "..." : ""}\n\n⏳ 处理完成后结果将自动显示，通常需要 1-5 分钟，请稍候。`,
          });
          return;
        } catch (telegramErr: any) {
          console.error("[Atlas] Telegram task creation failed, falling back to Qwen:", telegramErr.message);
          // Fall through to Qwen on error
        }
      }

      // ── Qwen3-Max / Kimi-K2.5 streaming (default channel) ───────────────
      const openai = createLLM(totalRows);

      // Build message history
      const messages: Array<{ role: "user" | "assistant"; content: string }> = [
        ...(history || []).slice(-6), // Keep last 6 messages for context
        { role: "user", content: message },
      ];

      const result = streamText({
        model: openai.chat(selectModel(totalRows)),
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
      // 1. Ask AI to generate the report data as JSON
      const openai = createLLM();
      const fieldNames = dfInfo.fields.map((f: FieldInfo) => f.name).join(", ");
      // Pass ALL data (up to 500 rows) so AI can generate accurate reports based on real data
      const maxReportRows = Math.min(data.length, 500);
      const allReportData = data.slice(0, maxReportRows);
      const sampleRows = JSON.stringify(allReportData, null, 2);

      // RAG: retrieve similar high-rated examples for self-learning
      const columnSignature = dfInfo.fields.map((f: FieldInfo) => f.name).join(",");
      const ragExamples = await getSimilarExamples(columnSignature, 2);
      const ragSection = ragExamples.length > 0
        ? `\n\n参考示例（这是用户评分较高的历史报表，请学习其分析风格和结构）：\n${ragExamples.map((ex, i) => `示例${i + 1}：需求「${ex.prompt}」，用户评分：${ex.rating}星`).join("\n")}`
        : "";

      const aiPrompt = `你是数据分析专家。根据以下完整数据和需求，生成一份准确的报表。${ragSection}

数据文件：${filename}（${dfInfo.row_count}行 x ${dfInfo.col_count}列）
字段：${fieldNames}

完整数据（共${maxReportRows}行，这是所有数据）：
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
          model: openai.chat(selectModel(data?.length)),
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
