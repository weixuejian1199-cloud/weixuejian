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
import { Worker } from "worker_threads";
import path from "path";
import { fileURLToPath } from "url";
import Papa from "papaparse";
import { streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import Decimal from "decimal.js";
import { ENV } from "./_core/env";
import { createPatchedFetch } from "./_core/patchedFetch";
import { storagePut, storageGet } from "./storage";
import { getSession, createSession, updateSession, createReport, updateReport, getReport, getSimilarExamples, getUserReports, getDb } from "./db";
import { authenticateRequest } from "./_core/auth";
import { isOpenClawEnabled, callOpenClaw, callOpenClawStream, getPresignedUrlsForSessions } from "./openclaw";
import { runPipelineInBackground, getResultSetForSession, runParsedPipelineInBackground } from "./pipeline/bridge";
import { exportFromResultSet } from "./pipeline/delivery";
import { buildExpressionPrompt, buildDataSummary } from "./pipeline/expression";
import { pushAtlasMsgToOpenClaw, pushQwenReplyToOpenClaw } from "./im/wsServer";
import { openclawTasks, chatConversations, chatMessages, personalTemplates, sessions, resultSets } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import type { FieldMetadata, GroupedMetric, ExportPayload, FieldAggType, MetricAggType } from "../shared/types";

// ── Phase 4：辅助函数（V4.0）────────────────────────────────────────────────────

/**
 * 推断分组字段的结构化标识（groupByKey）
 * 注意：这里是后端版本，应该和前端的 inferGroupByKey 保持一致
 */
function inferGroupByKey(fieldName: string): string {
  if (fieldName.includes("达人昵称") || fieldName.includes("主播昵称")) {
    return "talent_nickname";
  }
  if (fieldName.includes("达人") && !fieldName.includes("金额")) {
    return "talent";
  }
  if (fieldName.includes("选购商品") || fieldName.includes("商品名称") || fieldName.includes("商品名")) {
    return "product_name";
  }
  if (fieldName.includes("省份") || fieldName.includes("收货省份")) {
    return "province";
  }
  if (fieldName.includes("城市") || fieldName.includes("收货城市")) {
    return "city";
  }
  // 未能识别 → 使用字段名作为 key（但会警告）
  return `dim_${fieldName}`;
}

// ── Phase 4：多文件汇总精确校验（V4.0）────────────────────────────────────────────────────

/**
 * 检查 sourceDomain 兼容性
 * 规则：
 * - unknown 参与 → 不允许合并
 * - 相同 sourceDomain → 允许
 * - order + payment → 允许
 * - order + product、payment + product → 不允许
 */
function checkSourceDomainCompatibility(
  domain1: string,
  domain2: string
): boolean {
  // unknown 参与 → 不允许合并
  if (domain1 === "unknown" || domain2 === "unknown") {
    return false;
  }
  
  // 相同 sourceDomain → 允许
  if (domain1 === domain2) {
    return true;
  }
  
  // order + payment → 允许
  if (
    (domain1 === "order" && domain2 === "payment") ||
    (domain1 === "payment" && domain2 === "order")
  ) {
    return true;
  }
  
  // 其他组合 → 不允许
  return false;
}

/**
 * 校验多文件汇总匹配（真正的三元组 + sourceDomain）
 * 必须同时满足以下条件才允许合并：
 * - metricKey 一致
 * - aggType 一致
 * - groupByKey 一致
 * - sourceDomain 兼容
 */
function validateMetricMatch(
  target: {
    metricKey: string;
    aggType: string;
    groupByKey: string;
    sourceDomain: string;
  },
  candidate: {
    metricKey: string;
    aggType: string;
    groupByKey: string;
    sourceDomain: string;
  }
): { valid: boolean; reason?: string } {
  // 校验 metricKey
  if (target.metricKey !== candidate.metricKey) {
    return {
      valid: false,
      reason: `metricKey 不一致: ${target.metricKey} vs ${candidate.metricKey}`
    };
  }
  
  // 校验 aggType
  if (target.aggType !== candidate.aggType) {
    return {
      valid: false,
      reason: `aggType 不一致: ${target.aggType} vs ${candidate.aggType}`
    };
  }
  
  // 校验 groupByKey（关键：不能用中文字段名）
  if (target.groupByKey !== candidate.groupByKey) {
    return {
      valid: false,
      reason: `groupByKey 不一致: ${target.groupByKey} vs ${candidate.groupByKey}`
    };
  }
  
  // 校验 sourceDomain 兼容性
  const compatible = checkSourceDomainCompatibility(
    target.sourceDomain,
    candidate.sourceDomain
  );
  if (!compatible) {
    return {
      valid: false,
      reason: `sourceDomain 不兼容: ${target.sourceDomain} vs ${candidate.sourceDomain}`
    };
  }
  
  return { valid: true };
}

// ── In-memory Rate Limiter ───────────────────────────────────────────────────
// Limits /api/atlas/chat to 20 requests per user per minute
// Key: userId (authenticated) or IP (anonymous)
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute

interface RateEntry { count: number; resetAt: number; }
const rateLimitMap = new Map<string, RateEntry>();

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  Array.from(rateLimitMap.entries()).forEach(([key, entry]) => {
    if (entry.resetAt < now) rateLimitMap.delete(key);
  });
}, 5 * 60_000);

function checkRateLimit(key: string): { allowed: boolean; remaining: number; resetIn: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || entry.resetAt < now) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1, resetIn: RATE_LIMIT_WINDOW_MS };
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    return { allowed: false, remaining: 0, resetIn: entry.resetAt - now };
  }
  entry.count++;
  return { allowed: true, remaining: RATE_LIMIT_MAX - entry.count, resetIn: entry.resetAt - now };
}

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
// NOTE: kimi-k2.5 is NOT used for initial upload analysis — it has 60-120s TTFT which causes
// frontend polling timeouts. qwen3-max handles up to 50k rows fine for the 800-token analysis prompt.
function selectModel(rowCount?: number): string {
  if (DASHSCOPE_API_KEY) {
    // Always use qwen3-max for upload analysis (fast TTFT, sufficient context for 800-token output)
    // kimi-k2.5 is reserved for future deep-analysis chat where long context is truly needed
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

// ── Multer for chunk uploads (no fileFilter — chunks are raw binary) ──────────
const uploadChunk = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB per chunk
});

// ── Data parsing helpers ──────────────────────────────────────────────────────

interface FieldInfo {
  name: string;
  type: "numeric" | "text" | "datetime";
  dtype: string;
  null_count: number;
  unique_count: number;
  sample: (string | number)[];
  // Full-dataset statistics (populated by /upload-parsed from frontend scan)
  sum?: number;
  avg?: number;
  max?: number;
  min?: number;
  // Full-dataset top5 (value-descending), each entry: { value, rowIndex }
  top5?: Array<{ value: number; rowIndex: number }>;
  // Grouped top5: GROUP BY dimension field, SUM numeric field, TOP5 by sum — from full dataset
  // ── Phase 4：增加结构化标识（V4.0）────────────────────────────────────────────
  groupedTop5?: Array<{ 
    label: string; 
    sum: number; 
    source?: string;
    metricKey?: string;
    aggType?: "sum" | "count" | "avg";
    groupByKey?: string;
    groupByRole?: "dimension" | "metric" | "identifier" | "datetime";
  }>;
  // Which dimension field was used for groupedTop5
  groupByField?: string;
  // T7: sum of ALL valid (non-placeholder) groups — used to compute null-nickname amount
  // null_nickname_amount = field.sum - validGroupSum
  validGroupSum?: number;
  // Product-dimension groupedTop5 (GROUP BY 选购商品) for product Top queries
  productGroupedTop5?: Array<{ 
    label: string; 
    sum: number; 
    source?: string;
    metricKey?: string;
    aggType?: "sum" | "count" | "avg";
    groupByKey?: string;
  }>;
  productGroupByField?: string;
  // Category-dimension stats: for ALL categorical fields (省份/支付方式/城市/状态 etc.)
  // Key = field name, Value = top20 entries with count/sum/avg
  categoryGroupedTop20?: Record<string, Array<{ label: string; count: number; sum?: number; avg?: number }>>;
  // ── Phase 4：字段身份元信息（V4.0）────────────────────────────────────────────
  metadata?: FieldMetadata;
}

interface DataFrameInfo {
  row_count: number;
  col_count: number;
  fields: FieldInfo[];
  preview: Record<string, unknown>[];
  // Primary dimension field used for groupedTop5 (e.g. "达人昵称")
  groupByField?: string;
  // All detected dimension fields with priority tiers (tier 1=达人, tier 2=昵称, tier 3=姓名, tier 4=店铺, tier 5=商品)
  allGroupByFields?: Array<{ field: string; tier: number }>;
  // Phase 1: 达人昵称字段治理元数据（仅当 groupByField 存在时由前端生成并透传）
  dataQuality?: Record<string, unknown>;
  // Category stats: full-dataset GROUP BY stats for ALL categorical fields
  categoryGroupedTop20?: Record<string, Array<{ label: string; count: number; sum?: number; avg?: number }>>;
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

  // First pass: try default parsing (header row = row 1)
  let data = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: false,
  });

  // Detect __EMPTY columns — means the real header is not on row 1
  // Try rows 2-6 as header until we find one with meaningful column names
  const hasEmptyHeaders = data.length > 0 &&
    Object.keys(data[0]).some(k => k.startsWith("__EMPTY"));

  if (hasEmptyHeaders) {
    // Try header rows 2 through 6 (0-indexed: 1 through 5)
    for (let headerRow = 1; headerRow <= 5; headerRow++) {
      const candidate = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: null,
        raw: false,
        range: headerRow, // use this row as header
      });
      if (
        candidate.length > 0 &&
        !Object.keys(candidate[0]).some(k => k.startsWith("__EMPTY")) &&
        Object.keys(candidate[0]).some(k => k.trim() !== "")
      ) {
        data = candidate;
        break;
      }
    }
  }

  // Clean up: remove rows where ALL values are null/empty (blank separator rows)
  data = data.filter(row =>
    Object.values(row).some(v => v !== null && v !== undefined && v !== "")
  );

  return { data, sheetNames };
}

// Async wrapper: runs XLSX.read in a worker thread so the main event loop is never blocked.
// Memory-optimized: returns only first 200 rows + full-scan column statistics.
// Worker script is pre-compiled to xlsxWorker.mjs (works in both dev and prod).
type XlsxWorkerResult = {
  data: Record<string, unknown>[];  // first 200 rows
  sheetNames: string[];
  totalRowCount: number;            // accurate full count
  columnStats: Record<string, {
    sum: number; min: number; max: number;
    count: number; nullCount: number; uniqueCount: number;
    isNumeric: boolean; sample: (string | number)[];
  }>;
  parseTimeMs: number;
};

function parseExcelBufferAsync(
  buffer: Buffer,
  filename: string
): Promise<XlsxWorkerResult> {
  return new Promise((resolve, reject) => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const workerScript = path.resolve(__dirname, "xlsxWorker.mjs");

    const worker = new Worker(workerScript, {
      workerData: {
        buffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
        filename,
      },
    });

    worker.on("message", (result: XlsxWorkerResult & { error?: string }) => {
      if (result.error) {
        reject(new Error(result.error));
      } else {
        resolve(result);
      }
    });

    worker.on("error", (err) => reject(err));
    worker.on("exit", (code) => {
      if (code !== 0) reject(new Error(`XLSX worker exited with code ${code}`));
    });
  });
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

function buildDataFrameInfo(
  data: Record<string, unknown>[],
  sheetNames?: string[],
  totalRowCount?: number,
  columnStats?: XlsxWorkerResult["columnStats"]
): DataFrameInfo {
  if (data.length === 0) {
    return { row_count: 0, col_count: 0, fields: [], preview: [] };
  }
  const columns = Object.keys(data[0]);
  const effectiveRowCount = totalRowCount ?? data.length;
  const fields: FieldInfo[] = columns.map(col => {
    // Prefer full-scan stats from worker; fall back to computing from preview rows
    if (columnStats && columnStats[col]) {
      const st = columnStats[col];
      const type = st.isNumeric ? "numeric" : "text";
      return {
        name: col,
        type,
        dtype: type === "numeric" ? "float64" : "object",
        null_count: st.nullCount,
        unique_count: st.uniqueCount,
        sample: st.isNumeric ? st.sample.map(Number) : st.sample.map(String),
      };
    }
    // Fallback: compute from preview rows
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
    row_count: effectiveRowCount,
    col_count: columns.length,
    fields,
    preview: data.slice(0, 5),
  };
}

// ── Field normalization (P1-A: synonym mapping + missing-field tolerance) ──────
/**
 * Normalize field names across rows using a synonym map.
 * Also injects missing standard fields as 0 so downstream aggregation never fails.
 */
const FIELD_SYNONYM_MAP: Record<string, string[]> = {
  // ── 销售/电商 ──
  "总销售额":  ["销售额", "销售金额", "订单金额", "收入", "实收", "流水", "GMV", "gmv", "revenue", "sales", "amount", "营业额"],
  "手续费":    ["平台手续费", "服务费", "技术服务费", "平台费", "佣金", "commission", "fee"],
  "退款金额":  ["退款", "退货金额", "退单金额", "退货", "refund", "return_amount"],
  "订单数":    ["订单量", "笔数", "件数", "orders", "order_count", "count"],
  "客单价":    ["人均消费", "平均单价", "AOV", "aov", "avg_order"],
  "门店名称":  ["店铺名称", "店名", "渠道", "平台", "store", "shop", "channel"],
  // ── 工资/HR ──
  "基本工资":  ["底薪", "固定工资", "月薪", "标准工资", "base_salary", "base", "基础工资"],
  "绩效工资":  ["绩效", "绩效奖金", "KPI奖金", "季度奖", "performance", "bonus_perf"],
  "奖金":      ["奖励", "提成", "bonus", "incentive"],
  "扣款":      ["扣除", "罚款", "缺勤扣款", "违规扣款", "deduction", "deduct"],
  "社保公积金":["五险一金", "社保", "公积金", "insurance", "social_insurance"],
  "应发工资":  ["应发", "税前工资", "gross_salary", "gross"],
  "实发工资":  ["实发", "税后工资", "net_salary", "net", "到手工资"],
  "员工姓名":  ["姓名", "名字", "员工", "人员", "name", "staff", "employee"],
  "部门":      ["dept", "department", "所属部门"],
  // ── 考勤 ──
  "出勤天数":  ["实际出勤", "出勤", "上班天数", "工作天数", "attendance_days"],
  "迟到次数":  ["迟到", "late_count", "late"],
  // 电商订单字段
  "订单号":   ["order_id"],
  "下单时间": ["order_time"],
  "支付时间": ["pay_time"],
  "实付金额": ["pay_amount"],
  "订单应付金额": ["total_amount"],
  "收货省份": ["province"],
  "收货城市": ["city"],
  "商品ID":   ["product_id"],
  "商品名称": ["product_name"],
  "商品数量": ["quantity"],
  "商品金额": ["amount"],
  "SKU":      ["sku"],
  "平台":     ["platform"],
  "渠道":     ["channel"],
  "店铺":     ["shop"],
  "物流单号": ["tracking_number"],
  "物流公司": ["logistics_company"],
  "物流方式": ["logistics_method"],
  "订单状态": ["order_status"],
  "退款状态": ["refund_status"],
  "发货状态": ["delivery_status"],
  "预计到货日期": ["estimated_arrival_date"],
  "实际到货日期": ["actual_arrival_date"],
  "买家昵称": ["buyer_name"],
  "买家手机号": ["buyer_phone"],
  "买家ID":   ["buyer_id"],
  "会员等级": ["member_level"],
  "优惠券":   ["coupon"],
  "优惠金额": ["discount_amount"],
  "运费":     ["shipping_fee"],
  "运费险":   ["shipping_insurance"],
  "签收人":   ["signer"],
  "签收时间": ["sign_time"],

  "早退次数":  ["早退", "early_leave"],
  "旷工天数":  ["旷工", "缺勤", "absent", "absence"],
  // ── 财务 ──
  "借方金额":  ["借方", "debit", "借"],
  "贷方金额":  ["贷方", "credit", "贷"],
  "科目名称":  ["科目", "会计科目", "account", "subject"],
};

// Reverse map: synonym → canonical (built once at module load)
const SYNONYM_TO_CANONICAL: Record<string, string> = {};
for (const [canonical, synonyms] of Object.entries(FIELD_SYNONYM_MAP)) {
  for (const syn of synonyms) {
    SYNONYM_TO_CANONICAL[syn] = canonical;
    SYNONYM_TO_CANONICAL[syn.toLowerCase()] = canonical;
  }
}

// ── P2-A: Finance debit-credit balance check (Decimal.js precision) ────────────────
// Returns balance discrepancy; isBalanced=true if diff <= 0.01 (rounding tolerance).
function checkDebitCreditBalance(
  data: Record<string, unknown>[],
  debitField: string,
  creditField: string
): { isBalanced: boolean; discrepancy: string; debitTotal: string; creditTotal: string } {
  let debitTotal = new Decimal(0);
  let creditTotal = new Decimal(0);
  for (const row of data) {
    const d = row[debitField];
    const c = row[creditField];
    if (d !== undefined && d !== null && d !== "") {
      try { debitTotal = debitTotal.plus(new Decimal(String(d))); } catch { /* skip non-numeric */ }
    }
    if (c !== undefined && c !== null && c !== "") {
      try { creditTotal = creditTotal.plus(new Decimal(String(c))); } catch { /* skip non-numeric */ }
    }
  }
  const discrepancy = debitTotal.minus(creditTotal).abs();
  const isBalanced = discrepancy.lessThanOrEqualTo(new Decimal("0.01"));
  return {
    isBalanced,
    discrepancy: discrepancy.toFixed(2),
    debitTotal: debitTotal.toFixed(2),
    creditTotal: creditTotal.toFixed(2),
  };
}

function normalizeFieldNames(
  data: Record<string, unknown>[],
  requiredFields?: string[]
): {
  normalizedData: Record<string, unknown>[];
  injectedFields: string[];
  fieldMapping: Record<string, string>; // original → canonical
} {
  if (data.length === 0) return { normalizedData: data, injectedFields: [], fieldMapping: {} };

  const originalKeys = Object.keys(data[0]);
  const fieldMapping: Record<string, string> = {};

  // Build mapping: original field name → canonical name
  for (const key of originalKeys) {
    const canonical = SYNONYM_TO_CANONICAL[key] || SYNONYM_TO_CANONICAL[key.toLowerCase()];
    if (canonical && canonical !== key) {
      fieldMapping[key] = canonical;
    }
  }

  // Remap rows: add canonical alias alongside original (non-destructive)
  const normalizedData = data.map(row => {
    const newRow: Record<string, unknown> = { ...row };
    for (const [orig, canon] of Object.entries(fieldMapping)) {
      if (!(canon in newRow)) {
        newRow[canon] = row[orig];
      }
    }
    return newRow;
  });

  // Inject missing required fields as 0 (tolerance for incomplete multi-file merges)
  const injectedFields: string[] = [];
  if (requiredFields && requiredFields.length > 0) {
    const existingKeys = new Set([
      ...originalKeys,
      ...Object.values(fieldMapping),
    ]);
    for (const req of requiredFields) {
      if (!existingKeys.has(req)) {
        normalizedData.forEach(row => { row[req] = 0; });
        injectedFields.push(req);
      }
    }
  }

  return { normalizedData, injectedFields, fieldMapping };
}

// ── Business scenario detection ─────────────────────────────────────────────

interface ScenarioResult {
  name: string;       // 场景名称（中文）
  type: string;       // 场景类型 key
  confidence: number; // 0-1
  primaryFields: string[]; // 主要数值字段
  groupFields: string[];   // 分组字段（姓名/门店等）
  dateFields: string[];    // 时间字段
}

function detectScenario(fields: FieldInfo[]): ScenarioResult {
  const names = fields.map(f => f.name.toLowerCase());
  const numericFields = fields.filter(f => f.type === "numeric").map(f => f.name);
  const textFields = fields.filter(f => f.type === "text").map(f => f.name);
  const dateFields = fields.filter(f => f.type === "datetime").map(f => f.name);

  // Helper: find matching field names
  const match = (patterns: RegExp[]) =>
    fields.filter(f => patterns.some(p => p.test(f.name.toLowerCase())));

  // Scenario detection rules (ordered by specificity)
  const payrollFields = match([/工资|薪资|底薪|绩效工资|实发|应发|扣款|社保|公积金|个税|salary|pay|wage/]);
  const attendanceFields = match([/出勤|考勤|迟到|早退|旷工|打卡|上班|下班|attendance|clock/]);
  const dividendFields = match([/分红|分配|奖金|提成|佣金|dividend|bonus|commission/]);
  const salesFields = match([/销售|金额|订单|gmv|营业额|收入|revenue|amount|sales/]);
  const inventoryFields = match([/库存|入库|出库|库量|数量|stock|inventory/]);
  const storeFields = match([/门店|店铺|店名|渠道|平台|store|shop|channel/]);
  const nameFields = match([/姓名|名字|员工|人员|会员|用户|name|staff|member/]);

  // Score each scenario
  const scores: Record<string, number> = {
    payroll: payrollFields.length * 3 + (attendanceFields.length > 0 ? 1 : 0),
    attendance: attendanceFields.length * 3,
    dividend: dividendFields.length * 3,
    sales: salesFields.length * 2 + (storeFields.length > 0 ? 2 : 0),
    inventory: inventoryFields.length * 3,
  };

  const maxScore = Math.max(...Object.values(scores));
  const topType = maxScore > 0
    ? Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0]
    : "general";

  const scenarioNames: Record<string, string> = {
    payroll: "工资/薪酬数据",
    attendance: "考勤数据",
    dividend: "分红/奖金数据",
    sales: storeFields.length > 0 ? "多门店销售数据" : "销售/电商数据",
    inventory: "库存数据",
    general: "业务数据",
  };

  // Determine primary numeric fields for this scenario
  const primaryFieldMap: Record<string, RegExp[]> = {
    payroll: [/工资|薪资|底薪|绩效|实发|应发/],
    attendance: [/出勤|天数|次数/],
    dividend: [/分红|奖金|提成|佣金/],
    sales: [/销售|金额|gmv|营业额|收入/],
    inventory: [/库存|数量|入库|出库/],
    general: [],
  };
  const primaryPatterns = primaryFieldMap[topType] || [];
  const primaryFields = primaryPatterns.length > 0
    ? match(primaryPatterns).map(f => f.name)
    : numericFields.slice(0, 3);

  const groupFields = [
    ...nameFields.map(f => f.name),
    ...storeFields.map(f => f.name),
  ].slice(0, 2);

  return {
    name: scenarioNames[topType] || "业务数据",
    type: topType,
    confidence: maxScore > 0 ? Math.min(maxScore / 9, 1) : 0.3,
    primaryFields: primaryFields.length > 0 ? primaryFields : numericFields.slice(0, 3),
    groupFields,
    dateFields: dateFields.slice(0, 2),
  };
}

// ── Server-side dimension field detection (mirrors parseFile.ts V14.2 logic) ──────────────────
// Used by /upload-parsed to re-detect groupByField when frontend sends null/undefined
// (e.g., when browser is running cached old version of parseFile.ts)
const SERVER_AMOUNT_FIELD_PATTERNS = [
  "金额", "优惠", "费用", "佣金", "补贴", "承担", "支付", "单价",
  "price", "amount", "money", "fee", "cost",
];
const SERVER_DIMENSION_TIERS: Array<{ tier: number; keywords: string[] }> = [
  { tier: 1, keywords: ["达人昵称", "主播昵称", "达人名称", "主播名称", "达人ID", "主播ID", "达人", "主播"] },
  { tier: 2, keywords: ["昵称"] },
  { tier: 3, keywords: ["姓名", "员工姓名", "用户名", "名字"] },
  { tier: 4, keywords: ["店铺名称", "店铺", "商家名称", "商家"] },
  { tier: 5, keywords: ["商品名称", "商品", "SKU", "品牌"] },
];
function serverIsAmountField(fieldName: string): boolean {
  const lower = fieldName.toLowerCase();
  return SERVER_AMOUNT_FIELD_PATTERNS.some((p) => fieldName.includes(p) || lower.includes(p.toLowerCase()));
}
function serverDetectGroupByField(
  fields: Array<{ name: string; type: string }>
): string | null {
  const result: Array<{ field: string; tier: number }> = [];
  const seen = new Set<string>();
  for (const { tier, keywords } of SERVER_DIMENSION_TIERS) {
    for (const kw of keywords) {
      const exactMatches = fields.filter((f) => !seen.has(f.name) && f.name === kw);
      const containsMatches = fields.filter((f) => !seen.has(f.name) && f.name !== kw && f.name.includes(kw));
      for (const f of [...exactMatches, ...containsMatches]) {
        if (seen.has(f.name)) continue;
        // Must be text type
        if (f.type === "numeric") continue;
        // Must not be an amount/fee field
        if (serverIsAmountField(f.name)) continue;
        result.push({ field: f.name, tier });
        seen.add(f.name);
      }
    }
  }
  return result.length > 0 ? result[0].field : null;
}
function serverComputeGroupedTopN(
  rows: Record<string, unknown>[],
  numericField: string,
  groupField: string,
  sourceFilename: string,
  topN = 20
): Array<{ label: string; sum: number; source?: string }> {
  const groupSums = new Map<string, number>();
  for (const row of rows) {
    const groupVal = row[groupField];
    const numVal = Number(row[numericField]);
    if (groupVal === null || groupVal === undefined || groupVal === "") continue;
    if (isNaN(numVal)) continue;
    const key = String(groupVal).trim();
    // Filter out placeholder values from groupBy ranking
    if (key === "" || key === "-" || key === "—" || key === "--" || key === "——" ||
        key === "N/A" || key === "n/a" || key === "NA" || key === "na" ||
        key === "无" || key === "null" || key === "NULL" || key === "None" || key === "none") continue;
    groupSums.set(key, (groupSums.get(key) ?? 0) + numVal);
  }
  return Array.from(groupSums.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([label, sum]) => ({ label, sum, source: sourceFilename }));
}

// ── Key metrics computation (pure code, no AI, 100% stable) ──────────────────

interface KeyMetric {
  name: string;
  value: string | number;
  field: string;
  type: "sum" | "avg" | "max" | "min" | "count" | "top" | "pct";
}

interface PrecomputedFieldStat {
  name: string;
  sum?: number;
  avg?: number;
  max?: number;
  min?: number;
}

function computeKeyMetrics(
  data: Record<string, unknown>[],
  scenario: ScenarioResult,
  dfInfo: DataFrameInfo,
  precomputedStats?: PrecomputedFieldStat[]
): KeyMetric[] {
  const metrics: KeyMetric[] = [];
  const numericFields = dfInfo.fields.filter(f => f.type === "numeric");

  // Always add row count — use dfInfo.row_count (full count) when available, else data.length
  const totalRowCount = dfInfo.row_count > 0 ? dfInfo.row_count : data.length;
  metrics.push({ name: "数据总行数", value: totalRowCount, field: "_count", type: "count" });

  // For each primary numeric field, compute sum / avg / max / min
  const targetFields = scenario.primaryFields.length > 0
    ? scenario.primaryFields.slice(0, 4)
    : numericFields.slice(0, 3).map(f => f.name);

  // V1.1: Format numbers per ATLAS display rules
  // Amount fields (sum/avg/max/min for amount-like fields): dual-unit "202.50 万 (2,024,968 元)"
  // Count fields: integer with thousands separator
  // Average fields: up to 2 decimal places
  const isAmountField = (fieldName: string) =>
    /金额|价格|成本|利润|销售|GMV|收入|费用|支出|工资|薪资|奖金|提成|分红|补贴|amount|price|cost|revenue|salary|bonus/i.test(fieldName);

  const fmtAmount = (n: number): string => {
    const wan = n / 10000;
    const wanStr = `${wan.toFixed(2)} 万`;
    const yuanStr = `(${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} 元)`;
    return `${wanStr} ${yuanStr}`;
  };

  const fmtNum = (n: number, fieldName?: string) => {
    if (fieldName && isAmountField(fieldName) && Math.abs(n) >= 10000) {
      return fmtAmount(n);
    }
    if (Math.abs(n) >= 10000) return `${(n / 10000).toFixed(2)}万`;
    return n % 1 === 0 ? n.toString() : n.toFixed(2);
  };

  // Build a quick lookup map for precomputed stats (from frontend full-dataset scan)
  const statsMap = new Map<string, PrecomputedFieldStat>();
  if (precomputedStats) {
    for (const s of precomputedStats) statsMap.set(s.name, s);
  }

  for (const fieldName of targetFields) {
    const precomp = statsMap.get(fieldName);
    let sum: number, avg: number, max: number, min: number;

    if (precomp && precomp.sum !== undefined && precomp.avg !== undefined &&
        precomp.max !== undefined && precomp.min !== undefined) {
      // Use frontend-computed full-dataset stats (accurate for all rows)
      sum = precomp.sum;
      avg = precomp.avg;
      max = precomp.max;
      min = precomp.min;
    } else {
      // Fallback: compute from available data rows (preview subset)
      const rawValues = data
        .map(row => row[fieldName])
        .filter(v => v !== null && v !== undefined && v !== "");
      const decimalValues: Decimal[] = [];
      for (const v of rawValues) {
        try { decimalValues.push(new Decimal(String(v))); } catch { /* skip non-numeric */ }
      }
      if (decimalValues.length === 0) continue;
      const decSum = decimalValues.reduce((acc, d) => acc.plus(d), new Decimal(0));
      sum = decSum.toNumber();
      avg = decSum.dividedBy(decimalValues.length).toNumber();
      const numVals = decimalValues.map(d => d.toNumber());
      max = Math.max(...numVals);
      min = Math.min(...numVals);
    }

    metrics.push({ name: `${fieldName}合计`, value: fmtNum(sum, fieldName), field: fieldName, type: "sum" });
    metrics.push({ name: `${fieldName}均値`, value: fmtNum(avg, fieldName), field: fieldName, type: "avg" });
    metrics.push({ name: `${fieldName}最高`, value: fmtNum(max, fieldName), field: fieldName, type: "max" });
    metrics.push({ name: `${fieldName}最低`, value: fmtNum(min, fieldName), field: fieldName, type: "min" });

    if (metrics.length >= 9) break;
  }

  // Add group-level top3 if we have a group field (also using Decimal.js)
  if (scenario.groupFields.length > 0 && scenario.primaryFields.length > 0) {
    const groupField = scenario.groupFields[0];
    const valueField = scenario.primaryFields[0];
    const groupMap = new Map<string, Decimal>();
    for (const row of data) {
      const key = String(row[groupField] ?? "");
      if (!key) continue;
      const rawVal = row[valueField];
      if (rawVal === null || rawVal === undefined || rawVal === "") continue;
      try {
        const d = new Decimal(String(rawVal));
        groupMap.set(key, (groupMap.get(key) ?? new Decimal(0)).plus(d));
      } catch { /* skip non-numeric */ }
    }
    if (groupMap.size > 0) {
      const sorted = Array.from(groupMap.entries()).sort((a, b) => b[1].comparedTo(a[1]));
      const top3 = sorted.slice(0, 3).map(([k, d]) => {
        const v = d.toNumber();
        return `${k}(${v >= 10000 ? (v / 10000).toFixed(1) + '万' : v.toFixed(0)})`;
      }).join("、");
      metrics.push({ name: `${valueField}Top3`, value: top3, field: groupField, type: "top" });
    }
  }

  return metrics.slice(0, 8);
}

// ── Persistent session helpers ────────────────────────────────────────────────
// Parsed data rows are stored in S3 as JSON; dfInfo is stored in sessions.dfInfo column.
// This survives server restarts.

const DATA_KEY = (sessionId: string) => `atlas-data/${sessionId}-data.json`;
const RESULT_KEY = (sessionId: string) => `atlas-data/${sessionId}-result.json`;

// Store the final upload result (ai_analysis + suggested_actions etc.) to S3
async function storeUploadResult(sessionId: string, result: Record<string, unknown>): Promise<void> {
  try {
    await storagePut(RESULT_KEY(sessionId), JSON.stringify(result), "application/json");
  } catch (e) {
    console.error("[Atlas] storeUploadResult failed:", e);
  }
}

// Load the final upload result from S3
async function loadUploadResult(sessionId: string): Promise<Record<string, unknown> | null> {
  try {
    const { url } = await storageGet(RESULT_KEY(sessionId));
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}

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
- 对比查询：、1月和2月的销售额对比」→ 按月份筛选，对比两个时期
- 趋势查询：「最近3个月的增长趋势」→ 按时间排序，计算环比增长率

《字段别名映射表》（模糊匹配，用户说的词可能与字段名不完全一致）：
- 业绩 = 销售额 = GMV = 流水 = 订单金额 = revenue = sales
- 会员 = 用户 = 客户 = 消费者 = 昵称 = member
- 门店 = 店铺 = 店名 = 渠道 = store = shop
- 员工 = 姓名 = 人员 = 工人 = staff = employee
- 工资 = 薪资 = 底薪 = 实发 = salary = pay
- 日期 = 时间 = 月份 = 周期 = date = time = month
- 订单数 = 笔数 = 数量 = 件数 = orders = count
- 退款 = 退货 = 退单 = refund
- 客单价 = 人均 = 平均单价 = AOV

当用户查询的字段名与数据中的字段名不完全一致时，必须优先使用语义理解匹配对应字段，不要说「找不到字段」。

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

══ 财务/统计/行政 专项训练 ══

【财务场景常见需求】
当用户说「成本」「利润」「费用」「收入」「应收」「应付」「账期」「常规」「核对」「对账」「账单」「发票」时，必须按财务逻辑处理：
- 「利润分析」：自动计算毛利率、净利率、每品利润贡献度，标注异常负利品项
- 「费用汇总」：按部门/项目/月份分组，计算占收入比例，标识超预算项目
- 「应收账款」：按客户分组，计算账龄天数，标识超期未收款项
- 「资金回款」：计算平均回款天数，按客户排序，标识高风险客户
- 「成本分摆」：按固定/变动成本分类，计算单位变动成本，对比行业基准
- 「现金流分析」：按月分组汇总收支，计算净现金流，标识资金紧张月份

【统计场景常见需求】
当用户说「汇总」「汇表」「统计」「汇总表」「对比」「排名」「占比」「环比」「同比」「趋势」时，必须按统计逻辑处理：
- 「多维汇总」：按时间xd7部门xd7品类多维展开，自动计算小计/合计行
- 「环比分析」：自动识别时间字段，计算环比增长率，标识超过20%波动的异常项
- 「占比分析」：自动计算各组占总体比例，加总计行，按占比降序
- 「排名汇总」：自动加「排名」列，标识同比变动（↑↓），标注名次变化
- 「交叉分析」：如「按门店分月份展示」，自动识别行/列维度并生成交叉表
- 「数据核对」：对比两个表的关键字段，标识差异项和缺失项

【行政场景常见需求】
当用户说「工资」「考勤」「员工」「入离职」「张贴」「合同」「证书」「年假」「绩效」「平均工资」时，必须按行政逻辑处理：
- 「工资条生成」：每人一行，包含应发、扣款明细、实发，展示全部员工（不得截断）
- 「考勤汇总」：每人一行，包含实际出勤、迟到次数、早退次数、缺勤天数，展示全部员工
- 「入离职分析」：按月分组，计算入职人数、离职人数、净增人数、离职率
- 「平均工资」：按部门分组，计算平均应发/实发，标识超出平均工资–50%的异常项
- 「绩效排名」：按绩效分数降序，标识优秀/合格/待改进三个层次，展示全部员工

【数量词歧义消除规则（必须遵守）】
「数据」「数据项」「指标」「字段」「列」 = 指列（字段），不是行（用户）
「用户」「人员」「员工」「记录」「条」 = 指行（人员）
「所有用户」「全部」「全量」「所有人」 = 必须展示全量数据，不得截断；如超过50行，在表格标题后注明「共[N]条，展示前50条，完整数据请导出 Excel」（[N]替换为实际总行数）
「N个数据」「N个指标」「N个字段」 = 选取N列，不是取N行
「核心数据」「核心字段」 = 指最重要的N个列（如姓名、部门、应发工资、实发工资等），展示所有行
「前10名」「Top10」「前10个」 = 按某指标降序取前10行，不是取前10列

示例辨析：
- 「按用户列表到处，提取核心的10个数据」→ 展示所有用户（全量行），每人展示10个核心列
- 「帮我找销售额前10名」→ 销售额降序，取前10行
- 「提取核心的10个数据」→ 选择10个核心列，展示所有行

══ 对话原则 ══
1. 语气自然、轻松，像一个懂业务的朋友
2. 用户说「谢谢」「不错」等，正常回应
3. 如果用户明确要生成表格/报表，直接告诉他「好的，马上为你生成」
4. 用户说「查XX前N名」「找XX最高的」等，直接从数据中计算并给出结果
5. 回答要有真实数字，不要空话
6. 用户问「历史报表在哪」「怎么下载」，明确告诉：「左侧导航栏点『报表历史』即可查看和下载」
7. 用户问「需要什么资料」，主动列出所需数据清单
8. 用户没有上传文件时，引导他上传文件，但也可以直接回答业务问题
9. 发现数据质量问题时，主动告知用户

使用中文，语气友好专业，分析要有深度，不要说空话。

══ 推荐追问（可选，回复末尾附加）══
正文回复完成后，如果有合适的后续操作，可以在最后附加如下格式的推荐追问块：

<suggestions>
["追问1", "追问2"]
</suggestions>

规则：
- 只在有实质性后续操作时才附加，不要强行凑数
- 每条不超过 15 字，直接是用户会说的话
- <suggestions> 标签内只放 JSON 数组，不要有其他文字
- 这个块不会显示给用户，前端会自动解析成按钮
- **正文质量优先，不要为了生成追问而拖长正文**`;
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
      // Security: sanitize filename to prevent path traversal
      const safeFilename = originalname.replace(/[/\\<>:"'|?*\x00-\x1f]/g, "_").slice(0, 200);
      const sessionId = nanoid();
      const fileKey = `atlas-uploads/${sessionId}-${Date.now()}.${ext}`;
      const userId = (req as any).userId || 0;
      const fileSizeKb = Math.ceil(buffer.length / 1024);

      // 1. Create session record immediately (status=uploading) — no blocking S3/parse
      await createSession({
        id: sessionId,
        userId,
        filename: fileKey,
        originalName: originalname,
        fileKey,
        fileUrl: "", // will be updated after S3 upload in background
        fileSizeKb,
        rowCount: 0,
        colCount: 0,
        dfInfo: {} as any,
        isMerged: 0,
         status: "uploading",
      });
      // V3.0: 写入 pipelineStatus=running（含 pipelineStartedAt，pipelineFinishedAt=null，pipelineError=null）
      await updateSession(sessionId, {
        pipelineStatus: "running",
        pipelineError: null,
        pipelineStartedAt: new Date(),
        pipelineFinishedAt: null,
      }).catch(err => console.warn(`[Pipeline] Failed to write running status for ${sessionId}:`, err?.message));
      console.log(`[Pipeline] Status set to running for session ${sessionId}`);
      // 2. Return immediately — client starts polling /api/atlas/status/:sessionId
      res.json({
        session_id: sessionId,
        filename: originalname,
        file_url: "",
        status: "processing",
        df_info: { row_count: 0, col_count: 0, fields: [], preview: [] },
      });
      // 3. All heavy work (S3 upload + parse + AI) runs in background (non-blocking)
      setImmediate(async () => {
        try {
          // 3a. Upload original file to S33
          const { url: fileUrl } = await storagePut(fileKey, buffer, mimetype);
          await updateSession(sessionId, { fileUrl }).catch(() => {});

          // 3b. Parse data
          // Use worker thread for XLSX so the main event loop is never blocked (prevents 503 on large files)
          let data: Record<string, unknown>[];
          let sheetNames: string[] | undefined;
          if (ext === "csv") {
            data = parseCsvBuffer(buffer);
          } else {
            const parsed = await parseExcelBufferAsync(buffer, originalname);
            data = parsed.data;
            sheetNames = parsed.sheetNames;
            // Pass full-scan stats so row_count and field stats are accurate
            (data as any).__xlsxMeta = { totalRowCount: parsed.totalRowCount, columnStats: parsed.columnStats };
          }
          const xlsxMeta = (data as any).__xlsxMeta;
          const dfInfo = buildDataFrameInfo(data, sheetNames, xlsxMeta?.totalRowCount, xlsxMeta?.columnStats);

          // 3c. Normalize field names (P1-A: synonym mapping, non-destructive)
          const scenarioHint = detectScenario(dfInfo.fields);
          const requiredByScenario: Record<string, string[]> = {
            payroll:    ["基本工资", "员工姓名"],
            attendance: ["员工姓名", "出勤天数"],
            sales:      ["总销售额"],
            dividend:   ["员工姓名"],
          };
          const requiredFields = requiredByScenario[scenarioHint.type] || [];
          const { normalizedData, injectedFields, fieldMapping } = normalizeFieldNames(data, requiredFields);
          const workingData = normalizedData;

          // 3d. Update session with parsed info
          await updateSession(sessionId, {
            rowCount: dfInfo.row_count,
            colCount: dfInfo.col_count,
            dfInfo: dfInfo as any,
          }).catch(() => {});

          // 3e. Persist parsed data to S3 (for AI chat — survives restarts)
          await storeSessionData(sessionId, workingData);

          // 5b. Detect scenario + compute key metrics (pure code, no AI dependency)
          const scenario = detectScenario(dfInfo.fields);
          const keyMetrics = computeKeyMetrics(workingData, scenario, dfInfo);

          // Build field summary for AI context
          const fieldSummary = dfInfo.fields.slice(0, 15).map(f =>
            `${f.name}(${f.type}, ${f.unique_count}个唯一值, 示例:${f.sample.slice(0, 3).join("/")})`
          ).join(", ");

          // Detect data quality issues for AI context
          // NOTE: 全表缺失値警告已移除（Phase 1 治理提示仅针对 groupByField 列，由前端 detectDataQuality 生成）
          const qualityIssues: string[] = [];
          if (injectedFields.length > 0) {
            qualityIssues.push(`字段容错提示：${injectedFields.join('、')}字段在数据中缺失，已自动按 0 处理，计算结果不受影响`);
          }
          const mappingEntries = Object.entries(fieldMapping);
          if (mappingEntries.length > 0) {
            const mappingDesc = mappingEntries.map(([o, c]) => `「${o}」→「${c}」`).join('、');
            qualityIssues.push(`字段识别提示：已自动将 ${mappingDesc} 对齐为标准字段名，计算结果不受影响`);
          }
          const numericFieldsForOutlier = dfInfo.fields.filter(f => f.type === "numeric");
          const outlierWarnings: string[] = [];
          const outlierDetails: Array<{
            fieldName: string;
            median: number;
            threshold: number;
            outlierRows: Array<{ rowIndex: number; value: number }>;
          }> = [];
          for (const field of numericFieldsForOutlier.slice(0, 6)) {
            const valsWithIndex = workingData
              .map((row, i) => ({ val: Number(row[field.name]), rowIndex: i + 2 }))
              .filter(x => !isNaN(x.val) && x.val > 0);
            if (valsWithIndex.length < 3) continue;
            const sortedVals = [...valsWithIndex.map(x => x.val)].sort((a, b) => a - b);
            const median = sortedVals[Math.floor(sortedVals.length / 2)];
            const threshold = median * 5;
            const outlierItems = valsWithIndex.filter(x => x.val > threshold);
            if (outlierItems.length > 0 && median > 0) {
              const maxVal = Math.max(...outlierItems.map(x => x.val));
              const fmtV = (n: number) => n >= 10000 ? `${(n/10000).toFixed(1)}万` : n.toFixed(0);
              outlierWarnings.push(`${field.name}(最高值${fmtV(maxVal)}，约为中位数${fmtV(median)}的${Math.round(maxVal/median)}倍)`);
              outlierDetails.push({
                fieldName: field.name,
                median,
                threshold,
                outlierRows: outlierItems.slice(0, 20).map(x => ({ rowIndex: x.rowIndex, value: x.val })),
              });
            }
          }
          if (outlierWarnings.length > 0) {
            qualityIssues.push(`⚠️ 异常高值预警：${outlierWarnings.join('；')}，建议核实数据准确性`);
          }
          const hasDebit = workingData.length > 0 && ("借方金额" in workingData[0] || "debit" in workingData[0]);
          const hasCredit = workingData.length > 0 && ("贷方金额" in workingData[0] || "credit" in workingData[0]);
          if (hasDebit && hasCredit) {
            const debitField = "借方金额" in workingData[0] ? "借方金额" : "debit";
            const creditField = "贷方金额" in workingData[0] ? "贷方金额" : "credit";
            const balanceCheck = checkDebitCreditBalance(workingData, debitField, creditField);
            if (!balanceCheck.isBalanced) {
              qualityIssues.push(`⚠️ 借贷不平警告：借方合计 ${balanceCheck.debitTotal}，贷方合计 ${balanceCheck.creditTotal}，差异 ${balanceCheck.discrepancy}，请检查数据完整性`);
            } else {
              qualityIssues.push(`✅ 借贷平衡校验通过：借方 ${balanceCheck.debitTotal}，贷方 ${balanceCheck.creditTotal}`);
            }
          }

          const numericFields = dfInfo.fields.filter(f => f.type === "numeric").map(f => f.name);
          const metricsSummary = keyMetrics.map(m => `${m.name}: ${m.value}`).join("、");

          const hasSales2 = scenario.type === "sales";
          const hasPayroll2 = scenario.type === "payroll";
          const hasAttendance2 = scenario.type === "attendance";
          const hasDividend2 = scenario.type === "dividend";
          const hasStore2 = scenario.groupFields.some(f => /门店|店铺|store|shop/.test(f.toLowerCase()));
          const hasDate2 = scenario.dateFields.length > 0;
          const hasName2 = scenario.groupFields.some(f => /姓名|名字|员工|name|staff/.test(f.toLowerCase()));

          const fallbackTable = {
            title: `${originalname} 关键指标`,
            columns: ["指标名称", "指标值"],
            rows: keyMetrics.map(m => [m.name, String(m.value)]),
            highlight: 1,
            sortBy: -1,
            sortDir: "desc",
          };
          const fallbackTableStr = "```atlas-table\n" + JSON.stringify(fallbackTable, null, 2) + "\n```";

          const fieldListStr = dfInfo.fields.slice(0, 4).map(f => f.name).join('、') + (dfInfo.fields.length > 4 ? '等' : '');
          const qualityHint = qualityIssues.length > 0 ? '（并加一句质量提醒）' : '';
          const uploadSystemPrompt = [
            '你是 ATLAS，一个专业的智能数据分析助手。用户刚刚上传了文件，你必须立刻输出以下内容：',
            '',
            '**第一部分：一句话识别**（不超过30字）',
            `格式：「这是一份[${scenario.name}]，共${dfInfo.row_count}行、${dfInfo.col_count}列。」${qualityHint}`,
            '',
            '**第二部分：关键指标表**',
            '必须输出以下 atlas-table 格式（严格遵守）：',
            '',
            '\`\`\`atlas-table',
            '{',
            `  "title": "[${originalname}] 关键指标",`,
            '  "columns": ["指标名称", "指标值", "说明"],',
            '  "rows": [',
            `    ["数据总行数", "${dfInfo.row_count}", "有效数据行"],`,
            `    ["字段数", "${dfInfo.col_count}", "包括: ${fieldListStr}"],`,
            `    // 在此基础上，根据实际数据补充 5-6 个最重要的业务指标（已计算值：${metricsSummary}）`,
            '  ],',
            '  "highlight": 1,',
            '  "sortBy": -1,',
            '  "sortDir": "desc"',
            '}',
            '\`\`\`',
            '',
            '**第三部分：3个分析方向**（带字段名）',
            '格式：【①】具体操作（如「按门店汇总销售额排名」）',
            '',
            `数据场景：${scenario.name}，置信度：${(scenario.confidence * 100).toFixed(0)}%`,
            `主要数值字段：${scenario.primaryFields.join('、') || '无'}`,
            `分组字段：${scenario.groupFields.join('、') || '无'}`,
            `已计算指标：${metricsSummary}`,
            '',
            '注意：',
            '- rows 中的注释行必须删除，只保留真实数据行',
            '- 指标值直接用已计算的真实数值，不要编造',
            '- 输出不超过150字，不要有任何前置序言',
          ].join('\n');

          let aiAnalysis = "";
          try {
            const openai = createLLM();
            // 45s timeout: qwen3-max typically responds in 5-15s; abort if exceeded to avoid frontend timeout
            const aiAbortController = new AbortController();
            const aiTimeoutId = setTimeout(() => aiAbortController.abort(), 45_000);
            const result = await streamText({
              model: openai.chat(selectModel(dfInfo.row_count)),
              system: uploadSystemPrompt,
              messages: [{
                role: "user",
                content: `文件名：${originalname}，共 ${dfInfo.row_count} 行 ${dfInfo.col_count} 列。字段：${fieldSummary}。${qualityIssues.length > 0 ? '数据质量：' + qualityIssues.join('；') : '数据质量良好'}。已计算指标：${metricsSummary}`,
              }],
              maxOutputTokens: 800,
              abortSignal: aiAbortController.signal,
            });
            aiAnalysis = await result.text;
            clearTimeout(aiTimeoutId);
            if (!aiAnalysis.includes("atlas-table")) {
              console.warn("[Atlas] AI analysis missing atlas-table, using fallback");
              const intro = aiAnalysis.split("\n")[0] || `这是一份${scenario.name}，共${dfInfo.row_count}行、${dfInfo.col_count}列。`;
              aiAnalysis = `${intro}\n\n${fallbackTableStr}`;
            }
          } catch (e) {
            console.warn("[Atlas] AI analysis failed, using pure-code fallback:", e);
            const qualityNote = qualityIssues.length > 0 ? `\n\n⚠️ 数据质量提醒：${qualityIssues.join('；')}` : '';
            aiAnalysis = `这是一份**${scenario.name}**，共 ${dfInfo.row_count.toLocaleString()} 行、${dfInfo.col_count} 列。${qualityNote}\n\n${fallbackTableStr}`;
          }

          const suggestedActions: Array<{ label: string; prompt: string; icon: string }> = [];
          const hasSales = hasSales2;
          const hasPayroll = hasPayroll2;
          const hasAttendance = hasAttendance2;
          const hasDividend = hasDividend2;
          const hasStore = hasStore2;
          const hasDate = hasDate2;
          const hasName = hasName2;

          if (hasPayroll || (hasName && numericFields.length > 0)) {
            suggestedActions.push({ icon: "📝", label: "生成工资条", prompt: `__PAYSLIP_INLINE__${sessionId}` });
          }
          if (hasDividend) {
            const divField = numericFields.find(f => /分红|奖金|奖/.test(f)) || numericFields[0] || "奖金";
            suggestedActions.push({ icon: "💰", label: "分红明细表", prompt: `帮我按${divField}从高到低生成分红明细表` });
            suggestedActions.push({ icon: "🏆", label: "Top10 排名", prompt: `帮我找出${divField}最高的前10名和最低的后10名` });
          }
          if (hasSales) {
            const salesField = numericFields.find(f => /销售|金额|gmv|revenue/.test(f.toLowerCase())) || numericFields[0] || "销售额";
            suggestedActions.push({ icon: "📊", label: "销售汇总表", prompt: `帮我汇总销售数据，显示${salesField}、订单数和关键指标` });
            if (hasStore) {
              suggestedActions.push({ icon: "🏦", label: "门店排名", prompt: `帮我按门店分组汇总${salesField}，对比各门店表现并排名` });
            }
          }
          if (hasAttendance) {
            suggestedActions.push({ icon: "📅", label: "考勤汇总", prompt: `__ATTENDANCE_INLINE__${sessionId}` });
          }
          if (hasDate && !hasSales) {
            suggestedActions.push({ icon: "📈", label: "趋势分析", prompt: "帮我按时间分析数据趋势，看看有什么规律" });
          }
          if (suggestedActions.length < 2) {
            if (numericFields.length > 0) {
              suggestedActions.push({ icon: "📊", label: "生成汇总表", prompt: `帮我汇总${numericFields.slice(0, 3).join('、')}等关键指标` });
            } else {
              suggestedActions.push({ icon: "📊", label: "生成汇总表", prompt: "帮我生成数据汇总表，包含关键指标和统计" });
            }
            suggestedActions.push({ icon: "🔍", label: "全面分析", prompt: "帮我全面分析这份数据，找出关键规律、异常值和可优化方向" });
          }
          suggestedActions.push({ icon: "✨", label: "自定义需求", prompt: "" });

          // 5c. Store final result to S3 for polling
          const finalResult = {
            session_id: sessionId,
            filename: originalname,
            file_url: fileUrl,
            status: "ready",
            df_info: {
              row_count: dfInfo.row_count,
              col_count: dfInfo.col_count,
              fields: dfInfo.fields,
              preview: dfInfo.preview,
            },
            ai_analysis: aiAnalysis,
            suggested_actions: suggestedActions,
            quality_issues: qualityIssues,
            outlier_details: outlierDetails.length > 0 ? outlierDetails : undefined,
            field_mapping_hint: mappingEntries.length > 0
              ? mappingEntries.map(([original, canonical]) => ({ original, canonical }))
              : undefined,
          };
          await storeUploadResult(sessionId, finalResult);

          // 5d. Update session status to ready
          await updateSession(sessionId, { status: "ready" });
           console.log(`[Atlas] Background processing complete for session ${sessionId}`);
          // V3.0 双轨：在后台并行运行新 Pipeline，生成 ResultSet
          // running 已在上方写入，runPipelineInBackground 负责写全部终态 success/failed
          runPipelineInBackground(sessionId, userId, buffer, originalname, mimetype);
        } catch (bgErr: any) {
          console.error(`[Atlas] Background processing failed for session ${sessionId}:`, bgErr);
          await updateSession(sessionId, { status: "error" }).catch(() => {});
        }
      });

    } catch (err: any) {
      console.error("[Atlas] Upload error:", err);
      const safeMsg = process.env.NODE_ENV === "production" ? "文件处理失败，请重试" : (err.message || "Upload failed");
      res.status(500).json({ error: safeMsg });
    }
  });

  // ── POST /api/atlas/chat ──────────────────────────────────────────────────
  // Streaming text response — works with OR without uploaded data

  app.post("/api/atlas/chat", optionalAuth, async (req: Request, res: Response) => {
    try {
      const { session_id, session_ids, message, history, conversation_id } = req.body as {
        session_id?: string;
        session_ids?: string[];
        message: string;
        history?: Array<{ role: "user" | "assistant"; content: string }>;
        conversation_id?: string;
      };
      if (!message || typeof message !== "string") {
        res.status(400).json({ error: "message is required" });
        return;
      }
      // Security: limit message length to prevent token abuse
      const MAX_MSG_LEN = 8000;
      if (message.length > MAX_MSG_LEN) {
        res.status(400).json({ error: `消息过长，最多 ${MAX_MSG_LEN} 字符` });
        return;
      }

      // Support both single session_id and multiple session_ids
      const allSessionIds = session_ids?.length ? session_ids : session_id ? [session_id] : [];

      // ── Rate Limiting: 20 requests per user/IP per minute ─────────────────
      const rateLimitKey = (req as any).userId
        ? `user:${(req as any).userId}`
        : `ip:${req.ip ?? req.socket.remoteAddress ?? "unknown"}`;
      const rl = checkRateLimit(rateLimitKey);
      if (!rl.allowed) {
        const resetSec = Math.ceil(rl.resetIn / 1000);
        res.status(429).json({
          error: `请求过于频繁，请 ${resetSec} 秒后再试（每分钟最多 ${RATE_LIMIT_MAX} 次）`,
          retryAfter: resetSec,
        });
        return;
      }

      // ── V13.9: Persist conversation and user message ─────────────────
      const userId = (req as any).userId || 0;
      const convId = conversation_id || nanoid();
      const db = await getDb();
      if (db) {
        try {
          const { eq, sql: drizzleSql } = await import("drizzle-orm");
          // Upsert conversation record
          const existingConvs = await db.select().from(chatConversations)
            .where(eq(chatConversations.id, convId));
          if (existingConvs.length === 0) {
            await db.insert(chatConversations).values({
              id: convId,
              userId,
              sessionIds: allSessionIds.length ? allSessionIds : null,
              title: message.slice(0, 100),
              messageCount: 0,
            });
          }
          // Save user message
          await db.insert(chatMessages).values({
            id: nanoid(),
            conversationId: convId,
            role: "user",
            content: message,
            fileNames: allSessionIds.length ? allSessionIds : null,
          });
          // Increment message count
          await db.update(chatConversations)
            .set({ messageCount: drizzleSql`${chatConversations.messageCount} + 1` })
            .where(eq(chatConversations.id, convId));
        } catch (persistErr) {
          console.warn("[Atlas] Conversation persist error (non-fatal):", persistErr);
        }
      }

      // ── V13.10: Push user message to OpenClaw (小虾米) via WebSocket ────────
      // Only push messages from the designated owner account (weixuejian) to avoid flooding
      const atlasUser = (req as any).atlasUser;
      const senderUsername = atlasUser?.username || "";
      const OPENCLAW_OWNER_USERNAME = "weixuejian";
      if (senderUsername === OPENCLAW_OWNER_USERNAME) {
        const pushed = pushAtlasMsgToOpenClaw({
          conversationId: convId,
          sessionId: allSessionIds[0] || "",
          userId,
          userName: atlasUser?.name || atlasUser?.username || `用户${userId}`,
          content: message,
          fileNames: allSessionIds.length > 0 ? allSessionIds : undefined,
        });
        if (pushed) {
          console.log(`[Atlas] Pushed user message to OpenClaw, convId=${convId}`);
        }
      }

      // Disable Cloudflare/proxy buffering so streaming text reaches the browser in real-time
      res.setHeader("X-Accel-Buffering", "no");
      res.setHeader("Cache-Control", "no-cache, no-store");
      res.setHeader("Connection", "keep-alive");
      // Return conversation_id in header so frontend can track it
      res.setHeader("X-Conversation-Id", convId);

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
        // V14.0: Persist + Push Qwen reply to OpenClaw (Level 1 监控)
        Promise.resolve(result.text).then(async (fullText) => {
          if (db) {
            try {
              const { eq, sql: drizzleSql } = await import("drizzle-orm");
              await db.insert(chatMessages).values({
                id: nanoid(), conversationId: convId, role: "assistant", content: fullText,
              });
              await db.update(chatConversations)
                .set({ messageCount: drizzleSql`${chatConversations.messageCount} + 1` })
                .where(eq(chatConversations.id, convId));
            } catch (e) { console.warn("[Atlas] AI reply persist error:", e); }
          }
          // Push to OpenClaw for Level 1 monitoring
          pushQwenReplyToOpenClaw({
            conversationId: convId,
            userId,
            userName: atlasUser?.name || atlasUser?.username || `用户${userId}`,
            userMessage: message,
            qwenReply: fullText,
            model: selectModel(),
            timestamp: Date.now(),
          });
        }).catch(() => {});
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

      // ── Task A: Log every file's key fields for diagnostics ─────────────────
      console.log(`[Atlas/chat] Received ${validSessions.length} session(s) for message: "${message.slice(0, 60)}"`);
      for (const s of validSessions) {
        const di = s!.dfInfo as DataFrameInfo | null;
        const hasProductAmt = di?.fields.some((f: FieldInfo) => f.name.includes('商品金额')) ?? false;
        const hasOrderAmt   = di?.fields.some((f: FieldInfo) => f.name.includes('应付金额') || f.name.includes('订单金额')) ?? false;
        const groupedKeys   = di?.fields.filter((f: FieldInfo) => f.groupedTop5 && f.groupedTop5.length > 0).map((f: FieldInfo) => f.name) ?? [];
        const sampleLen     = di?.preview?.length ?? 0;
        console.log(`  [File] id=${s!.id} | name=${s!.originalName} | db.rowCount=${s!.rowCount} | dfInfo.row_count=${di?.row_count ?? 'N/A'} | 商品金额字段=${hasProductAmt} | 应付金额字段=${hasOrderAmt} | groupedTop5字段=${groupedKeys.join(',')||'无'} | preview.length=${sampleLen}`);
      }

      // ── Task B: Hard guard — refuse to fake multi-file stats with single file ─
      const isMultiFile = allSessionIds.length > 1;
      if (isMultiFile && validSessions.length < 2) {
        console.error(`[Atlas/chat] HARD GUARD: requested ${allSessionIds.length} files but only ${validSessions.length} valid sessions found`);
        res.status(400).json({ error: `当前仅收到 ${validSessions.length} 个文件，禁止执行多文件统计。请确认所有文件已正确上传。` });
        return;
      }

      // ── Task C: Build per-file independent context (never reuse file[0] for all) ─
      interface PerFileProfile {
        fileId: string;
        fileName: string;
        rowCount: number;
        colCount: number;
        dfInfo: DataFrameInfo;
        data: Record<string, unknown>[];
        numericStats: Array<{ name: string; sum: number; avg: number; max: number; min: number; zeros: number; outliers: number; count: number }>;
        groupedTop5Map: Map<string, Array<{ label: string; sum: number }>>;
        groupByFieldMap: Map<string, string>;
        // Product-dimension groupedTop5 (GROUP BY 选购商品) for product Top queries
        productGroupedTop5Map: Map<string, Array<{ label: string; sum: number }>>;
        productGroupByFieldMap: Map<string, string>;
      }

      const perFileProfiles: PerFileProfile[] = [];
      for (const s of validSessions) {
        const di = s!.dfInfo as DataFrameInfo | null;
        if (!di) {
          console.warn(`[Atlas/chat] Skipping session ${s!.id} (${s!.originalName}): dfInfo is null`);
          continue;
        }
        const fileData = await loadSessionData(s!.id);
        if (!fileData) {
          console.warn(`[Atlas/chat] Skipping session ${s!.id} (${s!.originalName}): S3 data not found`);
          continue;
        }
        // Build numericStats from dfInfo full-dataset stats (NOT from 500-row preview)
        const ns = di.fields
          .filter((f: FieldInfo) => f.type === 'numeric')
          .map((f: FieldInfo) => {
            if (f.sum === undefined || f.avg === undefined || f.max === undefined || f.min === undefined) return null;
            const previewVals = fileData.map(row => Number(row[f.name])).filter(v => !isNaN(v) && v !== 0);
            const zeros = fileData.filter(row => !row[f.name] || Number(row[f.name]) === 0).length;
            const outliers = previewVals.filter(v => v > f.avg! * 3).length;
            return { name: f.name, sum: f.sum, avg: f.avg, max: f.max, min: f.min, zeros, outliers, count: di.row_count };
          })
          .filter(Boolean) as PerFileProfile['numericStats'];

        // Build groupedTop5 map (talent-dimension: GROUP BY 达人昵称)
        const g5Map = new Map<string, Array<{ label: string; sum: number }>>();
        const gbMap = new Map<string, string>();
        // Build productGroupedTop5 map (product-dimension: GROUP BY 选购商品)
        const pg5Map = new Map<string, Array<{ label: string; sum: number }>>();
        const pgbMap = new Map<string, string>();
        for (const f of di.fields) {
          if (f.groupedTop5 && f.groupedTop5.length > 0) {
            g5Map.set(f.name, f.groupedTop5);
            if (f.groupByField) gbMap.set(f.name, f.groupByField);
          }
          // Extract product-dimension groupedTop5
          if ((f as any).productGroupedTop5 && (f as any).productGroupedTop5.length > 0) {
            pg5Map.set(f.name, (f as any).productGroupedTop5);
            if ((f as any).productGroupByField) pgbMap.set(f.name, (f as any).productGroupByField);
          }
        }

        perFileProfiles.push({
          fileId: s!.id,
          fileName: s!.originalName,
          rowCount: di.row_count,
          colCount: di.col_count,
          dfInfo: di,
          data: fileData,
          numericStats: ns,
          groupedTop5Map: g5Map,
          groupByFieldMap: gbMap,
          productGroupedTop5Map: pg5Map,
          productGroupByFieldMap: pgbMap,
        });
        // Detailed groupedTop5 debug log
        const g5Summary = Array.from(g5Map.entries()).map(([field, entries]) =>
          `${field}(top${entries.length}:[${entries.slice(0,3).map(e => `${e.label}=${e.sum}`).join(',')}])`
        ).join(' | ');
        console.log(`[Atlas/chat] Built perFileProfile: id=${s!.id} | name=${s!.originalName} | rowCount=${di.row_count} | numericStats=${ns.length}个字段 | groupedTop5Map: ${g5Summary || '无'}`);
        // P1 diagnostic: check if this file has high null rate for groupByField
        if (di.dataQuality) {
          const dq = di.dataQuality as Record<string, unknown>;
          console.log(`[Atlas/chat]   dataQuality: nullRate=${dq.nullRate} | groupByField=${di.groupByField || 'N/A'}`);
        }
      }

      if (perFileProfiles.length === 0) {
        res.status(404).json({ error: "所有文件数据均已过期，请重新上传。" });
        return;
      }

      // ── Task D: Assert uniqueness before building prompt ─────────────────────
      if (isMultiFile) {
        const fileIds = perFileProfiles.map(p => p.fileId);
        const uniqueIds = new Set(fileIds);
        if (uniqueIds.size !== fileIds.length) {
          console.error(`[Atlas/chat] ASSERTION FAILED: duplicate fileIds in perFileProfiles: ${fileIds.join(',')}`);
          res.status(500).json({ error: "内部错误：文件ID重复，无法执行多文件统计。" });
          return;
        }
        const rowCounts = perFileProfiles.map(p => p.rowCount);
        console.log(`[Atlas/chat] Multi-file assertion passed: ${perFileProfiles.map(p => `${p.fileName}(${p.rowCount}行)`).join(' | ')}`);
        console.log(`[Atlas/chat] Expected total rows: ${rowCounts.reduce((a, b) => a + b, 0)}`);
      }

      // ── Backward-compat aliases (used by single-file path below) ─────────────
      const primaryProfile = perFileProfiles[0];
      const sessionRecord = validSessions[0]!;
      const dfInfo = primaryProfile.dfInfo;
      const filename = isMultiFile
        ? perFileProfiles.map(p => p.fileName).join('\u3001')
        : primaryProfile.fileName;
      const data = primaryProfile.data;

      // Build data context for AI
      const fieldSummary = dfInfo.fields.slice(0, 20).map((f: FieldInfo) =>
        `- ${f.name}: ${f.type}类型, ${dfInfo.row_count}行, ${f.null_count}个空值, 示例值: ${f.sample.slice(0, 3).join(", ")}`
      ).join("\n");

      // Pass data rows to AI (up to 50 rows for speed; stats cover the full dataset)
      // Real statistics (sum/avg/max/min/top5) are computed from ALL rows below, so 50 rows is enough for structure
      const maxRows = Math.min(data.length, 50);
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
          const zeros = data.filter(row => !row[f.name] || Number(row[f.name]) === 0).length;
          // Prefer full-dataset stats from dfInfo (stored by /upload-parsed from frontend scan)
          // Fall back to computing from preview rows if not available
          let sum: number, avg: number, max: number, min: number, outliers: number;
          if (f.sum !== undefined && f.avg !== undefined && f.max !== undefined && f.min !== undefined) {
            sum = f.sum;
            avg = f.avg;
            max = f.max;
            min = f.min;
            outliers = vals.filter(v => v > avg * 3).length;
          } else {
            if (vals.length === 0) return null;
            sum = vals.reduce((a, b) => a + b, 0);
            avg = sum / vals.length;
            max = Math.max(...vals);
            min = Math.min(...vals);
            outliers = vals.filter(v => v > avg * 3).length;
          }
          if (vals.length === 0 && f.sum === undefined) return null;
          const sorted = [...vals].sort((a, b) => b - a);
          return { name: f.name, sum, avg, max, min, zeros, outliers, count: dfInfo.row_count || vals.length, top3: sorted.slice(0, 3) };
        })
        .filter(Boolean);

      // Detect categorical fields for grouping analysis
      const categoricalFields = dfInfo.fields
        .filter((f: FieldInfo) => f.type === 'text' && f.unique_count > 1 && f.unique_count <= 20)
        .map((f: FieldInfo) => ({ name: f.name, uniqueCount: f.unique_count, samples: f.sample.slice(0, 5) }));

      // ── Phase 4：多文件汇总精确校验（V4.0）────────────────────────────────────────────
      // 使用结构化字段身份进行精确匹配，而不是关键词模糊匹配
      
      // 获取主文件的字段身份元信息（用于作为目标匹配）
      const primaryFieldMetadata = (() => {
        for (const s of validSessions) {
          const di = s!.dfInfo as DataFrameInfo | null;
          if (!di) continue;
          // 获取第一个数值字段的元信息（如果存在）
          const firstNumericField = di.fields.find((f: FieldInfo) => f.type === 'numeric' && (f as any).metadata);
          if (firstNumericField && (firstNumericField as any).metadata) {
            return (firstNumericField as any).metadata as FieldMetadata;
          }
        }
        return undefined;
      })();

      // Helper: 使用结构化字段身份匹配 groupedTop5（Phase 4 改进）
      const findMatchingGroupedTop5 = (
        pfp: PerFileProfile,
        fieldName: string
      ): { entries: Array<GroupedMetric>; matchedField: string; valid: boolean; reason?: string } | null => {
        const targetField = pfp.dfInfo.fields.find((f: FieldInfo) => f.name === fieldName);
        if (!targetField) {
          return { entries: [], matchedField: fieldName, valid: false, reason: `字段 ${fieldName} 不存在` };
        }

        const targetMetadata = (targetField as any).metadata as FieldMetadata;
        const targetGroupedBy = (targetField as any).groupByField;
        const targetGroupByKey = targetGroupedBy ? inferGroupByKey(targetGroupedBy) : undefined;

        // ── Phase 4：unknown 字段拦截（三阶段）────────────────────────────────────────
        if (targetMetadata?.metricKey?.startsWith("unknown_")) {
          console.warn(`[Atlas/chat] 字段身份未确认，跳过汇总: ${targetMetadata.canonicalName} (metricKey=${targetMetadata.metricKey})`);
          return { entries: [], matchedField: fieldName, valid: false, reason: `字段身份未确认: ${targetMetadata.canonicalName}` };
        }

        // ── Phase 4：aggType 分层拦截（V4.0）────────────────────────────────────────────
        // 字段身份层允许 "none"，但聚合层不允许，必须在进入聚合链路前拦截
        if (targetMetadata?.aggType === "none") {
          console.warn(`[Atlas/chat] 字段不可聚合（aggType=none），跳过汇总: ${targetMetadata.canonicalName} (fieldRole=${targetMetadata.fieldRole})`);
          return { entries: [], matchedField: fieldName, valid: false, reason: `字段不可聚合: ${targetMetadata.canonicalName}` };
        }

        if (!targetMetadata || !targetMetadata.metricKey || !targetMetadata.aggType || !targetGroupByKey) {
          return { entries: [], matchedField: fieldName, valid: false, reason: `字段身份元信息不完整` };
        }

        // 遍历 pfp 中所有字段，寻找匹配的 groupedTop5
        const matchedEntries: GroupedMetric[] = [];
        for (const f of pfp.dfInfo.fields) {
          if (!f.groupedTop5 || f.groupedTop5.length === 0) continue;

          const metadata = (f as any).metadata as FieldMetadata;
          const groupByField = (f as any).groupByField;
          const groupByKey = groupByField ? inferGroupByKey(groupByField) : undefined;

          if (!metadata || !groupByKey) continue;

          // ── Phase 4：aggType 分层拦截（V4.0）────────────────────────────────────────────
          if (metadata.aggType === "none") {
            console.warn(`[Atlas/chat] 字段不可聚合（aggType=none），跳过: ${metadata.canonicalName}`);
            continue;
          }

          // ── Phase 4：精确校验（metricKey + aggType + groupByKey + sourceDomain）────────────
          const validation = validateMetricMatch(
            {
              metricKey: targetMetadata.metricKey,
              aggType: targetMetadata.aggType,
              groupByKey: targetGroupByKey,
              sourceDomain: targetMetadata.sourceDomain,
            },
            {
              metricKey: metadata.metricKey,
              aggType: metadata.aggType,
              groupByKey: groupByKey,
              sourceDomain: metadata.sourceDomain,
            }
          );

          if (!validation.valid) {
            console.warn(`[Atlas/chat] 字段匹配失败: ${validation.reason}`);
            continue;
          }

          // 转换为 GroupedMetric 格式（聚合层，aggType 不会是 "none"）
          const groupedMetrics: GroupedMetric[] = f.groupedTop5.map((entry: any) => ({
            label: entry.label,
            sum: entry.sum,
            source: pfp.fileName,
            metricKey: metadata.metricKey,
            aggType: metadata.aggType as MetricAggType,  // 已过滤 "none"
            groupByField: groupByField,
            groupByKey: groupByKey,
            groupByRole: metadata.fieldRole,
            sourceSessionId: pfp.fileId,
            sourceFileName: pfp.fileName,
          }));

          matchedEntries.push(...groupedMetrics);
        }

        if (matchedEntries.length === 0) {
          return { entries: [], matchedField: fieldName, valid: false, reason: `未找到匹配的字段` };
        }

        return { entries: matchedEntries, matchedField: fieldName, valid: true };
      };

      const topPerformers = numericStats.map(s => {
        if (!s) return null;

        // ── Phase 4：使用结构化字段身份收集 groupedTop5（V4.0）────────────────────
        const allGroupedMetrics: GroupedMetric[] = [];
        const sourceSessionIds: string[] = [];
        const sourceFileNames: string[] = [];

        for (const pfp of perFileProfiles) {
          const match = findMatchingGroupedTop5(pfp, s.name);
          
          if (!match) continue;
          
          // 如果字段匹配失败，跳过该文件
          if (!match.valid) {
            console.warn(`[Atlas/chat] 跳过文件 ${pfp.fileName}: ${match.reason}`);
            continue;
          }

          // P1: Skip files where the groupBy field has extremely high null rate
          // (these files have no reliable talent data and their file name should not enter the ranking)
          const fileNameBase = pfp.fileName.replace(/[-_].*$/, '').replace(/\.(xlsx|csv|xls)$/i, '').trim();
          const validEntries = match.entries.filter(e => {
            const lbl = e.label.trim();
            // Skip if label matches the file base name (store name masquerading as talent)
            if (lbl === fileNameBase || lbl === pfp.fileName.replace(/\.(xlsx|csv|xls)$/i, '').trim()) return false;
            return true;
          });

          if (validEntries.length > 0) {
            allGroupedMetrics.push(...validEntries);
            sourceSessionIds.push(pfp.fileId);
            sourceFileNames.push(pfp.fileName);
          }
        }

        // 如果没有匹配的字段，跳过
        if (allGroupedMetrics.length === 0) {
          console.warn(`[Atlas/chat] 字段 ${s.name} 未找到匹配的 groupedTop5，跳过`);
          return null;
        }

        // Re-aggregate: sum by label across files
        const PLACEHOLDER_LABELS = new Set(["-", "—", "--", "——", "N/A", "n/a", "NA", "na", "无", "null", "NULL", "None", "none"]);
        const unionMap = new Map<string, number>();
        for (const entry of allGroupedMetrics) {
          const lbl = entry.label.trim();
          if (!lbl || PLACEHOLDER_LABELS.has(lbl)) continue;
          unionMap.set(lbl, (unionMap.get(lbl) ?? 0) + entry.sum);
        }

        const sorted = Array.from(unionMap.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5);

        const top5Labels = sorted.map(([label, sum]) => `${label}(${sum.toLocaleString()})`);
        
        // 获取 groupByField 和 groupByKey
        const firstEntry = allGroupedMetrics[0];
        const groupByFieldName = firstEntry.groupByField;
        const groupByKey = firstEntry.groupByKey;
        const metricKey = firstEntry.metricKey;
        const aggType = firstEntry.aggType;

        return {
          ...s,
          top5: top5Labels,
          top5IsFullData: true,
          groupByField: groupByFieldName,
          // ── Phase 4：记录结构化信息用于后续生成 ExportPayload（V4.0）────────────
          _phase4: {
            metricKey,
            aggType,
            groupByKey,
            sourceSessionIds,
            sourceFileNames,
            groupedMetrics: allGroupedMetrics,
          },
        };
      }).filter(Boolean);

      // Build null-value context for groupByField (T7 fix: distinguish field-missing vs field-exists-with-nulls)
      const groupByFieldNullContext = (() => {
        const dq = dfInfo.dataQuality as Record<string, unknown> | undefined;
        const gbField = dfInfo.groupByField;
        if (!gbField) return '';
        // affected_rows = null_or_empty + placeholder (from dataQuality)
        const affectedRows = dq ? (Number((dq.affected_rows as number) ?? 0)) : 0;
        const nullOrEmpty = dq ? Number(((dq.invalid_value_breakdown as any)?.null_or_empty ?? 0)) : 0;
        const placeholder = dq ? Number(((dq.invalid_value_breakdown as any)?.placeholder ?? 0)) : 0;
        if (affectedRows === 0) return '';
        // T7: compute null-nickname amount for single-file using validGroupSum
        const keyNumericFields = ['商品金额', '订单应付金额', '订单金额', '销售额', '金额'];
        const nullAmountLines: string[] = [];
        for (const f of dfInfo.fields) {
          if (!keyNumericFields.some(kw => f.name.includes(kw))) continue;
          if (f.sum === undefined) continue;
          if (f.validGroupSum !== undefined && f.validGroupSum > 0) {
            const nullAmt = Math.max(0, f.sum - f.validGroupSum);
            nullAmountLines.push(`- 「${f.name}」中无有效${gbField}的订单金额: ${nullAmt.toFixed(2)}（= 总计${f.sum.toFixed(2)} - 有效${gbField}金额${f.validGroupSum.toFixed(2)}）`);
          }
        }
        return `\n【${gbField}字段空值说明（重要）】\n- 字段「${gbField}」存在于数据中（字段存在，不是缺失）\n- 共有 ${affectedRows} 行的「${gbField}」値为空値或占位符（null/空字符串: ${nullOrEmpty}行，占位符如"-"/"—"/"N/A": ${placeholder}行）\n- 这些行在达人排名中被过滤，但其对应金额仍计入文件总金额\n${nullAmountLines.length > 0 ? nullAmountLines.join('\n') + '\n' : ''}- ⚠️ 禁止说「文件不包含${gbField}字段」——字段存在，只是部分行値为空\n`;
      })();

      // Build single-file product Top context (GROUP BY 选购商品)
      const singleFileProductTopContext = (() => {
        const lines: string[] = [];
        for (const f of dfInfo.fields) {
          const pg5 = (f as any).productGroupedTop5 as Array<{ label: string; sum: number }> | undefined;
          const pgbField = (f as any).productGroupByField as string | undefined;
          if (!pg5 || pg5.length === 0 || !pgbField) continue;
          if (f.type !== 'numeric' || f.sum === undefined) continue;
          // Only include key numeric fields
          const keyNumericFields = ['商品金额', '订单应付金额', '订单金额', '销售额', '金额', '商品数量', '数量'];
          if (!keyNumericFields.some(kw => f.name.includes(kw))) continue;
          const top10 = pg5.slice(0, 10);
          const topLabels = top10.map(e => `${e.label}(${e.sum.toLocaleString()})`);
          lines.push(`${f.name}按${pgbField}前${top10.length}名（全量数据）: ${topLabels.join(' / ')}`);
          lines.push(`⚠️ 商品排名规则：必须将以上全部 ${top10.length} 名展示在表格中，不得因金额差异大而只展示 Top1`);
        }
        if (lines.length === 0) return '';
        return `
══ 商品排名（全量数据，禁止用样本行覆盖）══
⚠️ 以下商品排名基于全量数据按商品名称聚合，是唯一可信的商品排名来源。
❌ 严格禁止：对 sample_rows 做 GROUP BY / SUM / COUNT 来得出商品排名。
✅ 当用户询问商品 Top / 商品排名 / 销售金额 Top / 销售数量 Top 时，必须且只能引用以下数据：
${lines.join('\n')}
══ 商品排名结束 ══
`;
      })();

      // E方案修复：单文件达人排名也只保留优先级最高的一个金额字段
      const SINGLE_FILE_AMOUNT_PRIORITY = ['订单应付金额', '成交金额', '实付金额', '订单金额', '商品金额'];
      const validSingleTopPerformers = topPerformers.filter(s => s && s.top5IsFullData && s.top5 && s.top5.length > 0);
      let primarySingleTopPerformer = validSingleTopPerformers[0];
      for (const kw of SINGLE_FILE_AMOUNT_PRIORITY) {
        const match = validSingleTopPerformers.find(s => s!.name.includes(kw));
        if (match) { primarySingleTopPerformer = match; break; }
      }

      const statsContext = numericStats.length > 0 ? `
══ 全量统计摘要（基于 ${dfInfo.row_count.toLocaleString()} 行全量数据，非样本）══
重要约束：当用户询问总量/合计/均値/最大/最小等聚合指标时，必须直接引用以下全量统计値，禁止对样本行重新计算。
${topPerformers.map(s => [
  `${s!.name}总计: ${s!.sum.toFixed(2)}`,
  `${s!.name}均値: ${s!.avg.toFixed(2)}`,
  `${s!.name}最大: ${s!.max.toFixed(2)}`,
  `${s!.name}最小: ${s!.min.toFixed(2)}`,
  `${s!.name}零値或空白: ${s!.zeros}个`,
  `${s!.name}异常高値(>均到13倍): ${s!.outliers}个`,
  // 达人排名：只在优先级最高的一个金额字段上注入，避免双列
  (s === primarySingleTopPerformer && s!.top5IsFullData && s!.top5!.length > 0)
    ? `${s!.name}前${s!.top5!.length}名（按${(s as any).groupByField || '分组维度'}聚合，全量数据）: ${s!.top5!.join(' / ')}\n⚠️ 排名规则：必须将以上全部 ${s!.top5!.length} 名展示在表格中，不得因金额差异大而只展示 Top1\n⚠️ 金额字段规则：达人排名只使用「${s!.name}」一列，禁止同时展示多个金额字段`
    : null,
].filter(Boolean).join('\n')).join('\n')}
${groupByFieldNullContext}${singleFileProductTopContext}══ 全量统计摘要结束 ══
` : '';

      const categoryContext = categoricalFields.length > 0 ? `
分组字段（可用于分组分析）：
${categoricalFields.map(c => `- ${c.name}: ${c.uniqueCount}个不同分组, 示例: ${c.samples.join('/')}`).join('\n')}
` : '';

      // 分类字段全量预计算统计（单文件）
      const singleFileCategoryStats = dfInfo.categoryGroupedTop20;
      const categoryStatsContext = (singleFileCategoryStats && Object.keys(singleFileCategoryStats).length > 0) ? (() => {
        const lines: string[] = [];
        for (const [fieldName, entries] of Object.entries(singleFileCategoryStats)) {
          if (!entries || entries.length === 0) continue;
          // 全量注入：最多50条（不再截断为10条，避免 AI 对缺失部分自行补数）
          const fullEntries = entries.slice(0, 50);
          const totalCount = entries.reduce((s, e) => s + e.count, 0);
          const hasSum = fullEntries.some(e => e.sum !== undefined);
          // P4a：达人/商品维度的 count=0 表示没有行数统计，只展示金额排名
          const isRankingDimension = fullEntries.every(e => e.count === 0);
          if (isRankingDimension) {
            // 达人/商品维度：只展示金额排名，不展示 count
            const entryLines = fullEntries.map((e, i) =>
              `  ${i + 1}. ${e.label}: 金额${e.sum !== undefined ? e.sum.toFixed(2) : '0.00'}`
            );
            lines.push(`${fieldName}排名（共${fullEntries.length}名，全量数据，按金额降序）：`);
            lines.push(...entryLines);
            lines.push(`  ⚠️ 以上${fullEntries.length}条为该字段全量排名。禁止在表格中添加任何不在以上列表中的名称，禁止修改任何金额数字。`);
          } else if (hasSum) {
            // 分类维度有金额统计：展示 count + sum + avg
            const entryLines = fullEntries.map(e =>
              `  ${e.label}: 订单数${e.count}单${e.sum !== undefined ? `，金额${e.sum.toFixed(2)}，均单价${e.avg?.toFixed(2)}` : ''}`
            );
            lines.push(`${fieldName}分布（共${fullEntries.length}个分类，全量数据 ${dfInfo.row_count.toLocaleString()} 行，以下为全部分类，按订单数降序）：`);
            lines.push(...entryLines);
            lines.push(`  ⚠️ 以上${fullEntries.length}条为该字段全部分类，count之和=${totalCount}（应等于总行数${dfInfo.row_count}）。禁止在表格中添加任何不在以上列表中的分类，禁止修改任何count数字。`);
          } else {
            // 只有 count
            const entryLines = fullEntries.map(e => `  ${e.label}: ${e.count}单`);
            lines.push(`${fieldName}分布（共${fullEntries.length}个分类，全量数据 ${dfInfo.row_count.toLocaleString()} 行，以下为全部分类，按订单数降序）：`);
            lines.push(...entryLines);
            lines.push(`  ⚠️ 以上${fullEntries.length}条为该字段全部分类，count之和=${totalCount}（应等于总行数${dfInfo.row_count}）。禁止在表格中添加任何不在以上列表中的分类，禁止修改任何count数字。`);
          }
        }
        if (lines.length === 0) return '';
        return `
══ 分类字段全量统计（基于 ${dfInfo.row_count.toLocaleString()} 行全量数据，非样本）══
⚠️ 以下统计来自全量数据预计算，是唯一可信的分类统计来源。
❌ 严格禁止：对 sample_rows 做 GROUP BY / COUNT / SUM 来得出分类统计。
❌ 严格禁止：在表格 rows 中添加任何不在以下列表中的分类，或修改任何 count 数字。
${lines.join('\n')}
══ 分类统计结束 ══
⚠️ 输出表格时，分类字段的列名必须与以上字段名完全一致（如"收货省份"不得缩写为"省份"），否则前端无法匹配全量数据，导出将降级为样本数据。
`;
      })() : '';

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

${isMultiFile ? (() => {
  // ── Task E: Multi-file — each file gets its own dataset_profile section ──
  const sections = perFileProfiles.map((pfp, idx) => {
    const keyNumericFields = ['商品金额', '订单应付金额', '订单金额', '销售额', '金额'];
    const relevantStats = pfp.numericStats.filter(ns =>
      keyNumericFields.some(kw => ns.name.includes(kw))
    );
    const allStats = relevantStats.length > 0 ? relevantStats : pfp.numericStats.slice(0, 5);
    const statsLines = allStats.map(ns =>
      `${ns.name}合计: ${ns.sum.toFixed(2)}\n${ns.name}均値: ${ns.avg.toFixed(2)}\n${ns.name}最大: ${ns.max.toFixed(2)}\n${ns.name}最小: ${ns.min.toFixed(2)}`
    ).join('\n');
    const sampleData = pfp.data.slice(0, 3);
    // 修复多文件字段列表注入：使用全量字段（原来只有前8个）
    const sampleHeaders = pfp.dfInfo.fields.map((f: FieldInfo) => f.name);
    const sampleTable = [
      sampleHeaders.join(' | '),
      ...sampleData.map(row => sampleHeaders.map(h => { const v = row[h]; return v === null || v === undefined ? '' : String(v); }).join(' | '))
    ].join('\n');
    // T7 fix: inject groupByField null-value stats per file
    const pfpDq = pfp.dfInfo.dataQuality as Record<string, unknown> | undefined;
    const pfpGbField = pfp.dfInfo.groupByField;
    const pfpAffectedRows = pfpDq ? Number((pfpDq.affected_rows as number) ?? 0) : 0;
    const pfpNullOrEmpty = pfpDq ? Number(((pfpDq.invalid_value_breakdown as any)?.null_or_empty ?? 0)) : 0;
    const pfpPlaceholder = pfpDq ? Number(((pfpDq.invalid_value_breakdown as any)?.placeholder ?? 0)) : 0;
    const pfpNullContext = (pfpGbField && pfpAffectedRows > 0)
      ? `\n【${pfpGbField}字段空値说明】字段「${pfpGbField}」存在，共 ${pfpAffectedRows} 行値为空/占位符（null/空: ${pfpNullOrEmpty}行，占位符"-"等: ${pfpPlaceholder}行），这些行在达人排名中被过滤但金额计入总额。禁止说「文件不含${pfpGbField}字段」。`
      : (pfpGbField ? `\n【${pfpGbField}字段说明】字段「${pfpGbField}」存在，所有行均有有效値。` : '');
    // 分类字段全量预计算统计（多文件，每个文件单独注入）
    const pfpCategoryStats = pfp.dfInfo.categoryGroupedTop20;
    const pfpCategoryStatsContext = (pfpCategoryStats && Object.keys(pfpCategoryStats).length > 0) ? (() => {
      const catLines: string[] = [];
      for (const [fieldName, entries] of Object.entries(pfpCategoryStats)) {
        if (!entries || entries.length === 0) continue;
        // 全量注入：最多50条，避免 AI 对缺失部分自行补数
        const fullEntries = entries.slice(0, 50);
        const totalCount = entries.reduce((s, e) => s + e.count, 0);
        const hasSum = fullEntries.some(e => e.sum !== undefined);
        // P4a：达人/商品维度的 count=0 表示没有行数统计，只展示金额排名
        const isRankingDim = fullEntries.every(e => e.count === 0);
        if (isRankingDim) {
          catLines.push(`${fieldName}排名（共${fullEntries.length}名，全量数据，按金额降序）：`);
          fullEntries.forEach((e, i) => catLines.push(`  ${i + 1}. ${e.label}: 金额${e.sum !== undefined ? e.sum.toFixed(2) : '0.00'}`));
          catLines.push(`  ⚠️ 以上${fullEntries.length}条为该字段全量排名。禁止添加不在列表中的名称，禁止修改任何金额数字。`);
        } else if (hasSum) {
          catLines.push(`${fieldName}分布（共${fullEntries.length}个分类，全量 ${pfp.rowCount.toLocaleString()} 行，以下为全部分类）：`);
          fullEntries.forEach(e => catLines.push(`  ${e.label}: ${e.count}单${e.sum !== undefined ? `，金额${e.sum.toFixed(2)}` : ''}`));
          catLines.push(`  ⚠️ 以上${fullEntries.length}条为全部分类，count之和=${totalCount}。禁止添加不在列表中的分类或修改count数字。`);
        } else {
          catLines.push(`${fieldName}分布（共${fullEntries.length}个分类，全量 ${pfp.rowCount.toLocaleString()} 行，以下为全部分类）：`);
          fullEntries.forEach(e => catLines.push(`  ${e.label}: ${e.count}单`));
          catLines.push(`  ⚠️ 以上${fullEntries.length}条为全部分类，count之和=${totalCount}。禁止添加不在列表中的分类或修改count数字。`);
        }
      }
      if (catLines.length === 0) return '';
      return `\n══ 分类字段全量统计（全量数据，非样本）══\n⚠️ 以下统计来自全量数据预计算，是唯一可信的分类统计来源。\n❌ 严格禁止：对 sample_rows 做 GROUP BY / COUNT 得出分类统计。\n❌ 严格禁止：在表格 rows 中添加不在以下列表中的分类，或修改任何 count 数字。\n${catLines.join('\n')}\n══ 分类统计结束 ══
⚠️ 输出表格时，分类字段的列名必须与以上字段名完全一致（如"收货省份"不得缩写为"省份"），否则前端无法匹配全量数据，导出将降级为样本数据。`;
    })() : '';
    return `══ dataset_profile[${idx + 1}] ══
source_file_id: ${pfp.fileId}
source_file_name: ${pfp.fileName}
source_row_count: ${pfp.rowCount}
列数: ${pfp.colCount}

全量统计摘要（基于 ${pfp.rowCount.toLocaleString()} 行全量数据，非样本）：
⚠️ 以下统计値来自全量数据，回答时必须直接引用，禁止对 sample_rows 重新计算。
${statsLines}${pfpNullContext}${pfpCategoryStatsContext}

══ sample_rows[${idx + 1}] ══（仅用于理解字段含义，禁止对此求和）
${sampleTable}`;
  });
  // Compute cross-file totals for key fields
  const allFieldNames2 = Array.from(new Set(perFileProfiles.flatMap(p => p.numericStats.map(ns => ns.name))));
  const totals: string[] = [];
  for (const fieldName of allFieldNames2) {
    const keyNumericFields = ['商品金额', '订单应付金额', '订单金额', '销售额', '金额'];
    if (!keyNumericFields.some(kw => fieldName.includes(kw))) continue;
    const total = perFileProfiles.reduce((acc, pfp) => {
      const ns = pfp.numericStats.find(s => s.name === fieldName);
      return acc + (ns?.sum ?? 0);
    }, 0);
    const totalRows = perFileProfiles.reduce((acc, pfp) => acc + pfp.rowCount, 0);
    totals.push(`${fieldName}合计(全部文件): ${total.toFixed(2)}`);
    if (totals.length === 1) totals.push(`总行数(全部文件): ${totalRows.toLocaleString()}`);
  }
  // ── Task F: Inject cross-file topPerformers (merged Top10) into multi-file prompt ──
  // This was missing in af21a74 refactor — restoring parity with single-file statsContext
  // E方案修复：只保留优先级最高的一个金额字段，避免双列达人排名
  // 优先级：订单应付金额 > 成交金额 > 实付金额 > 订单金额 > 商品金额 > 其他
  const AMOUNT_PRIORITY = ['订单应付金额', '成交金额', '实付金额', '订单金额', '商品金额'];
  const validTopPerformers = topPerformers.filter(s => s && s.top5IsFullData && s.top5 && s.top5.length > 0);
  // 找到优先级最高的金额字段
  let primaryTopPerformer = validTopPerformers[0]; // 默认取第一个
  for (const kw of AMOUNT_PRIORITY) {
    const match = validTopPerformers.find(s => s!.name.includes(kw));
    if (match) { primaryTopPerformer = match; break; }
  }
  // 只注入一个字段的达人排名
  const topPerformersLines = primaryTopPerformer ? (() => {
    const s = primaryTopPerformer!;
    const n = s.top5!.length;
    return `${s.name}跨文件合并前${n}名（按${(s as any).groupByField || '分组维度'}聚合，全量数据，已过滤占位符）: ${s.top5!.join(' / ')}\n⚠️ 排名规则：必须将以上全部 ${n} 名展示在表格中，不得因金额差异大而只展示 Top1\n⚠️ 金额字段规则：达人排名只使用「${s.name}」一列，禁止同时展示多个金额字段`;
  })() : '';

  // T7 fix: compute cross-file null-nickname amount totals using validGroupSum for precision
  const nullNicknameLines: string[] = [];
  const gbFieldsInFiles = perFileProfiles.map(pfp => pfp.dfInfo.groupByField).filter(Boolean);
  if (gbFieldsInFiles.length > 0) {
    const gbFieldName = gbFieldsInFiles[0] as string; // e.g. "达人昵称"
    const perFileNullAmounts: Array<{ fileName: string; nullAmount: number; affectedRows: number; hasValidGroupSum: boolean }> = [];
    for (const pfp of perFileProfiles) {
      const pfpDq = pfp.dfInfo.dataQuality as Record<string, unknown> | undefined;
      const pfpAffectedRows = pfpDq ? Number((pfpDq.affected_rows as number) ?? 0) : 0;
      if (pfpAffectedRows === 0) continue;
      // Find the primary amount field for this file
      const keyNumericFields = ['商品金额', '订单应付金额', '订单金额', '销售额', '金额'];
      const primaryAmountField = pfp.numericStats.find(ns =>
        keyNumericFields.some(kw => ns.name.includes(kw))
      );
      if (!primaryAmountField) continue;
      const fileTotal = primaryAmountField.sum;
      // T7 fix: use validGroupSum (sum of ALL valid non-placeholder groups) for precise null amount
      // validGroupSum is stored in dfInfo.fields[primaryAmountField.name].validGroupSum
      const fieldDef = pfp.dfInfo.fields.find((f: FieldInfo) => f.name === primaryAmountField.name);
      const validGroupSum = fieldDef?.validGroupSum;
      if (validGroupSum !== undefined && validGroupSum > 0) {
        // Precise: null_amount = file_total - sum_of_all_valid_groups
        const nullAmount = Math.max(0, fileTotal - validGroupSum);
        perFileNullAmounts.push({ fileName: pfp.fileName, nullAmount, affectedRows: pfpAffectedRows, hasValidGroupSum: true });
      } else {
        // No validGroupSum: cannot compute null amount accurately (row-count ratio is unreliable)
        // Just record the affected rows count for context
        perFileNullAmounts.push({ fileName: pfp.fileName, nullAmount: -1, affectedRows: pfpAffectedRows, hasValidGroupSum: false });
      }
    }
    if (perFileNullAmounts.length > 0) {
      const preciseFiles = perFileNullAmounts.filter(x => x.hasValidGroupSum);
      const impreciseFiles = perFileNullAmounts.filter(x => !x.hasValidGroupSum);
      if (preciseFiles.length > 0) {
        const totalNullAmount = preciseFiles.reduce((acc, x) => acc + x.nullAmount, 0);
        const allPrecise = impreciseFiles.length === 0;
        nullNicknameLines.push(`「${gbFieldName}」为空/占位符的订单金额合计${allPrecise ? '(全部文件)' : '(部分文件精确値)'}: ${totalNullAmount.toFixed(2)}`);
        for (const x of preciseFiles) {
          nullNicknameLines.push(`  - ${x.fileName}: ${x.nullAmount.toFixed(2)}（${x.affectedRows}行空/占位符）`);
        }
      }
      if (impreciseFiles.length > 0) {
        nullNicknameLines.push(`以下文件有空値行但无法精确计算无昵称金额（需重新上传文件）：`);
        for (const x of impreciseFiles) {
          nullNicknameLines.push(`  - ${x.fileName}: 共 ${x.affectedRows} 行空/占位符，无法精确计算对应金额`);
        }
      }
    }
  }

  // Build cross-file product Top ranking (GROUP BY 选购商品, SUM 商品金额/商品数量)
  const productTopLines = (() => {
    const lines: string[] = [];
    // Collect all numeric fields that have productGroupedTop5 data
    const allProductFields = new Set<string>();
    for (const pfp of perFileProfiles) {
      for (const [fieldName] of Array.from(pfp.productGroupedTop5Map.entries())) {
        allProductFields.add(fieldName);
      }
    }
    // For each numeric field, UNION all productGroupedTop5 entries across files
    for (const fieldName of Array.from(allProductFields)) {
      const unionMap = new Map<string, number>();
      let productGroupByFieldName = '';
      for (const pfp of perFileProfiles) {
        // Try exact match first, then semantic match
        let entries = pfp.productGroupedTop5Map.get(fieldName);
        if (!entries || entries.length === 0) {
          // Semantic match: find field with same keyword
          const AMOUNT_KEYWORDS = ['商品金额', '订单金额', '应付金额', '实付金额', '销售金额'];
          const QTY_KEYWORDS = ['商品数量', '订单数量', '数量'];
          const allKws = [...AMOUNT_KEYWORDS, ...QTY_KEYWORDS];
          for (const kw of allKws) {
            if (!fieldName.includes(kw)) continue;
            for (const [pfpField, pfpEntries] of Array.from(pfp.productGroupedTop5Map.entries())) {
              if (pfpField.includes(kw) && pfpEntries.length > 0) {
                entries = pfpEntries;
                break;
              }
            }
            if (entries && entries.length > 0) break;
          }
        }
        if (!entries || entries.length === 0) continue;
        if (!productGroupByFieldName) {
          productGroupByFieldName = pfp.productGroupByFieldMap.get(fieldName) || '选购商品';
        }
        for (const entry of entries) {
          const lbl = entry.label.trim();
          if (!lbl) continue;
          unionMap.set(lbl, (unionMap.get(lbl) ?? 0) + entry.sum);
        }
      }
      if (unionMap.size === 0) continue;
      const sorted = Array.from(unionMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
      const topLabels = sorted.map(([label, sum]) => `${label}(${sum.toLocaleString()})`);
      lines.push(`${fieldName}跨文件商品前${topLabels.length}名（按${productGroupByFieldName}聚合，全量数据）: ${topLabels.join(' / ')}`);
      lines.push(`⚠️ 商品排名规则：必须将以上全部 ${topLabels.length} 名展示在表格中，不得因金额差异大而只展示 Top1`);
    }
    return lines.join('\n');
  })();

  const topPerformersSection = topPerformersLines ? `

══ 跨文件达人排名（全量合并，禁止用样本行覆盖此结果）══
⚠️ 以下排名基于所有文件全量数据 UNION 后重新聚合，是唯一可信的排名来源。
❌ 严格禁止：对 sample_rows 做 GROUP BY / SUM / COUNT / 去重推断来得出排名。
❌ 严格禁止：用样本行的计数或求和结果替代此处的全量排名。
✅ 当用户询问 Top10 / Top5 / 排名 / 达人汇总时，必须且只能引用以下数据：
${topPerformersLines}
══ 跨文件达人排名结束 ══` : `

⚠️ 当前文件中未检测到可靠的达人分组字段，无法生成跨文件达人排名。如需达人 Top10，请确认文件中包含“达人昵称”等分组字段。`;

  const productTopSection = productTopLines ? `

══ 跨文件商品排名（全量合并，禁止用样本行覆盖此结果）══
⚠️ 以下商品排名基于所有文件全量数据 UNION 后按商品名称重新聚合，是唯一可信的商品排名来源。
❌ 严格禁止：对 sample_rows 做 GROUP BY / SUM / COUNT 来得出商品排名。
✅ 当用户询问商品 Top / 商品排名 / 销售金额 Top / 销售数量 Top 时，必须且只能引用以下数据：
${productTopLines}
══ 跨文件商品排名结束 ══` : '';

  const nullNicknameSection = nullNicknameLines.length > 0 ? `\n\n══ 无达人昵称订单金额统计（T7）══\n说明：以下金额来自达人昵称字段为空或占位符的订单（字段存在但值为空），必须按全文件口径回答，不得只统计单个文件。\n${nullNicknameLines.join('\n')}\n══ 无达人昵称金额统计结束 ══` : '';


  // 跨文件分类字段合并统计（UNION 所有文件的 categoryGroupedTop20）
  const crossFileCategorySection = (() => {
    // 收集所有文件的分类字段名
    const allCategoryFields = new Set<string>();
    for (const pfp of perFileProfiles) {
      const cats = pfp.dfInfo.categoryGroupedTop20;
      if (cats) {
        for (const fieldName of Object.keys(cats)) {
          allCategoryFields.add(fieldName);
        }
      }
    }
    if (allCategoryFields.size === 0) return '';

    const crossLines: string[] = [];
    for (const fieldName of Array.from(allCategoryFields)) {
      // UNION 所有文件的该字段统计
      const unionCountMap = new Map<string, number>();
      const unionSumMap = new Map<string, number>();
      let hasSum = false;
      for (const pfp of perFileProfiles) {
        const cats = pfp.dfInfo.categoryGroupedTop20;
        if (!cats || !cats[fieldName]) continue;
        for (const entry of cats[fieldName]) {
          unionCountMap.set(entry.label, (unionCountMap.get(entry.label) ?? 0) + entry.count);
          if (entry.sum !== undefined) {
            hasSum = true;
            unionSumMap.set(entry.label, (unionSumMap.get(entry.label) ?? 0) + entry.sum);
          }
        }
      }
      if (unionCountMap.size === 0) continue;
      const totalRows = perFileProfiles.reduce((acc, pfp) => acc + pfp.rowCount, 0);
      // 全量注入：最多50条，避免 AI 对缺失部分自行补数
      const sorted = Array.from(unionCountMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 50);
      const totalCount = Array.from(unionCountMap.values()).reduce((s, c) => s + c, 0);
      crossLines.push(`${fieldName}分布（跨文件合并，共${sorted.length}个分类，全量 ${totalRows.toLocaleString()} 行，以下为全部分类）：`);
      for (const [label, count] of sorted) {
        const sum = unionSumMap.get(label);
        crossLines.push(`  ${label}: ${count}单${hasSum && sum !== undefined ? `，金额${sum.toFixed(2)}` : ''}`);
      }
      crossLines.push(`  ⚠️ 以上${sorted.length}条为全部分类，count之和=${totalCount}。禁止添加不在列表中的分类或修改count数字。`);
    }
    if (crossLines.length === 0) return '';
    return `\n\n══ 跨文件分类字段合并统计（全量数据，非样本）══\n⚠️ 以下统计基于所有文件全量数据 UNION 后重新聚合，是唯一可信的分类统计来源。\n❌ 严格禁止：对 sample_rows 做 GROUP BY / COUNT 得出分类统计。\n❌ 严格禁止：在表格 rows 中添加不在以下列表中的分类，或修改任何 count 数字。\n${crossLines.join('\n')}\n══ 跨文件分类统计结束 ══
⚠️ 输出表格时，分类字段的列名必须与以上字段名完全一致（如"收货省份"不得缩写为"省份"），否则前端无法匹配全量数据，导出将降级为样本数据。`;
  })();

  return sections.join('\n\n') + (totals.length > 0 ? `\n\n══ 跨文件汇总 ══\n${totals.join('\n')}` : '') + nullNicknameSection + topPerformersSection + productTopSection + crossFileCategorySection;
})() : `══ dataset_profile ══
文件：${filename}（全量 ${dfInfo.row_count.toLocaleString()} 行 × ${dfInfo.col_count} 列）
字段说明：
${fieldSummary}
${statsContext}${categoryStatsContext}${categoryContext}${fieldAliasContext}

══ sample_rows ══
以下 ${maxRows} 行仅用于理解字段含义和数据结构，不代表全量数据。
❗❗ 禁止对以下样本行求和得出总量。总量/合计/均値/最大/最小必须使用 dataset_profile 中的全量统计値。
${dataTable}`}

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
- rows：分类统计类问题（省份/城市/支付方式/状态等分布）必须输出全部分类（最多50行），不得截断；其他类型问题最多显示前20行，按最关键指标降序排列
- highlight：高亮哪一列的索引（从0开始，通常是数值最大的那列）
- sortBy：默认按哪列排序（列索引，从0开始）
- sortDir："desc" 降序 / "asc" 升序
- category_key：分类统计类表格必填，填入数据中对应的原始字段名（如 "收货省份"、"支付方式"），必须与字段名完全一致，不得缩写或改写；非分类统计类表格可不填
- 所有数值保留2位小数，金额加「元」单位，百分比加「%」
- 排名列（如有）必须从 1 开始连续编号，严格按 rows 数组顺序填写，禁止出现跳号（如 7、8、9）或重复序号
- 排名列中禁止出现 "-"、"—"、"N/A"、"无" 等无效占位符

【第三步】表格后面加1-2句简短说明，指出关键发现，如「前3名占总销售额的65%，A店铺遥遥领先。」
说明文案必须基于表格中实际展示的数据生成，禁止描述已被过滤的无效值（如"-"、"N/A"等占位符不应出现在文案中）

**绝对禁止：**
- 禁止在给表格之前做长篇分析
- 禁止说「我来帮您分析一下……」「首先，我们需要……」等废话
- 禁止输出超过2句话的前置说明
- 禁止在表格之前列出步骤、方法论、数据质量报告

**特殊情况处理：**
- 用户没有上传文件：只说「请先上传 Excel 或 CSV 文件，我来帮你处理。」
- 用户上传了文件但没说需求：只问「你想看什么？比如销售排名、工资汇总、考勤统计……」
- 用户说「调整一下」「换个格式」「加上XXX」：重新输出 atlas-table 格式，包含调整后的数据
- 用户说「导出」「下载」：告诉他「点击表格下方的『导出 Excel』按鈕即可下载。」
- 用户问「历史报表在哪」：「左侧导航栏点『报表历史』即可查看和下载所有历史报表。」

**数量词歧义消除规则（必须遵守）：**
「数据」「数据项」「指标」「字段」「列」 = 指列（字段），不是行（用户）
「用户」「人员」「员工」「记录」「条」 = 指行（人员）
「所有用户」「全部」「全量」「所有人」 = 必须展示全量数据，不得截断；如超过50行，在表格标题后注明「共[N]条，展示前50条，完整数据请导出 Excel」（[N]替换为实际总行数）
「N个数据」「N个指标」「N个字段」 = 选取N列，不是取N行
「核心数据」「核心字段」 = 指最重要的N个列（如姓名、部门、应发工资、实发工资等），展示所有行
「前10名」「Top10」「前10个」 = 按某指标降序取前10行，不是取前10列

示例辨析：
- 「按用户列表到处，提取核心的10个数据」→ 展示所有用户（全量行），每人展示10个核心列
- 「帮我找销售额前10名」→ 销售额降序，取前10行
- 「提取核心的10个数据」→ 选择10个核心列，展示所有行

══ 对话原则 ══
1. 语气自然简洁，像一个懂数据的朋友，不废话
2. 用户说「谢谢」「不错」等，正常回应
3. 回答要有真实数字，不要空话
4. 使用中文
使用中文，语气简洁，直接给结果，不要说空话。

══ 推荐追问（可选，回复末尾附加）══
正文回复完成后，如果有合适的后续操作，可以在最后附加如下格式的推荐追问块：

<suggestions>
["追问1", "追问2"]
</suggestions>

规则：
- 只在有实质性后续操作时才附加，不要强行凑数
- 每条不超过 15 字，直接是用户会说的话
- 如果刚生成了报表，可推荐「按部门拆分」「找出异常数据」等
- 如果是分析类回复，可推荐「找出前10名」「对比上月数据」等
- <suggestions> 标签内只放 JSON 数组，不要有其他文字
- 这个块不会显示给用户，前端会自动解析成按钮
-- **正文质量优先，不要为了生成追问而拖长正文**`;
      const totalRows = data.length;
          // ── OpenClaw SSE streaming (if configured) ──────────────────────
      if (isOpenClawEnabled()) {
        console.log("[Atlas] Routing to OpenClaw SSE channel");
        try {
          // Get presigned S3 URLs for all session files
          const sessionDataKeys = allSessionIds.map(id => `atlas-data/${id}-data.json`);
          const fileUrls = await getPresignedUrlsForSessions(sessionDataKeys);
          const fileNames = validSessions.map(s => s!.originalName);
          const ocUserId = String((req as any).userId ?? "anonymous");

          await callOpenClawStream(
            {
              message,
              file_urls: fileUrls,
              file_names: fileNames,
              user_id: ocUserId,
              source: "atlas",
            },
            res,
            ocUserId
          );
          return;
        } catch (openClawErr: any) {
          console.error("[Atlas] OpenClaw SSE failed, falling back to Qwen:", openClawErr.message);
          // If headers not yet sent (connection failed before writing), fall through silently
          // If headers already sent (30s no-data timeout mid-stream), we can't send Qwen response
          // on the same connection — just end the response with a fallback notice
          if (res.headersSent) {
            if (!res.writableEnded) {
              res.write(`0:${JSON.stringify("\n\n__OPENCLAW_TIMEOUT_RETRY__\n")}\n`);
              res.end();
            }
            return;
          }
          // Headers not sent → fall through to Qwen below
        }
      }

      // ── Qwen3-Max / Kimi-K2.5 streaming (default / fallback channel) ────
      const openai = createLLM(totalRows);

      // ═══ V3.0: 尝试注入 ResultSet 精确指标到 systemPrompt ═══
      let finalSystemPrompt = systemPrompt;
      try {
        // 对于单文件场景，尝试从 Pipeline ResultSet 获取精确计算结果
        if (!isMultiFile && allSessionIds.length === 1) {
          const resultSet = await getResultSetForSession(allSessionIds[0]);
          if (resultSet && resultSet.metrics.length > 0) {
            const expressionOutput = buildExpressionPrompt(resultSet);
            // 将 ResultSet 精确指标追加到 systemPrompt 中
            const resultSetSection = `\n\n══ V3.0 Pipeline 精确计算结果（唯一数字来源）══\n` +
              `⚠️ 以下指标由 Pipeline 确定性计算引擎 v${resultSet.computationVersion} 产出，使用 Decimal.js 精确计算。\n` +
              `⚠️ 你的回答中的所有数字必须来自以下数据，禁止自行计算或推断。\n` +
              `⚠️ 如果用户问的数据不在以下列表中，你必须明确回答"当前数据中没有这个信息"，而不是猜测。\n\n` +
              expressionOutput.resultSetSummary +
              (expressionOutput.cleaningLogSummary ? `\n\n数据清洗说明：\n${expressionOutput.cleaningLogSummary}` : '') +
              `\n══ V3.0 精确计算结果结束 ══`;
            // 注入到 finalSystemPrompt 末尾
            finalSystemPrompt += resultSetSection;
            console.log(`[Atlas] V3.0 ResultSet injected into chat prompt, ${resultSet.metrics.length} metrics`);
          }
        }
      } catch (rsErr: any) {
        console.warn(`[Atlas] V3.0 ResultSet injection failed (non-fatal): ${rsErr?.message}`);
      }

      // Build message history
      const messages: Array<{ role: "user" | "assistant"; content: string }> = [
        ...(history || []).slice(-4), // Keep last 4 messages for context (speed)
        { role: "user", content: message },
      ];

      const result = streamText({
        model: openai.chat(selectModel(totalRows)),
        system: finalSystemPrompt,
        messages,
      });

      // V13.9: Persist AI reply after streaming completes
      // V14.0: Push Qwen reply to OpenClaw (Level 1 监控)
      const modelUsed = selectModel(totalRows);
      Promise.resolve(result.text).then(async (fullText) => {
        // 1. Persist to DB
        if (db) {
          try {
            const { eq, sql: drizzleSql } = await import("drizzle-orm");
            await db.insert(chatMessages).values({
              id: nanoid(), conversationId: convId, role: "assistant", content: fullText,
            });
            await db.update(chatConversations)
              .set({ messageCount: drizzleSql`${chatConversations.messageCount} + 1` })
              .where(eq(chatConversations.id, convId));
          } catch (e) { console.warn("[Atlas] AI reply persist error (with-file):", e); }
        }
        // 2. Push Qwen reply to OpenClaw for Level 1 monitoring
        const pushed = pushQwenReplyToOpenClaw({
          conversationId: convId,
          userId,
          userName: atlasUser?.name || atlasUser?.username || `用户${userId}`,
          userMessage: message,
          qwenReply: fullText,
          model: modelUsed,
          timestamp: Date.now(),
        });
        if (pushed) {
          console.log(`[Atlas] Pushed Qwen reply to OpenClaw (Level 1), convId=${convId}, len=${fullText.length}`);
        }
      }).catch(() => {});

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

      // ═══ V3.0 新路径：优先从 ResultSet 导出全量数据 ═══
      // ⭐ 原则：只要 getResultSetForSession(session_id) 成功拿到可导出的 ResultSet，就优先走 V3 导出；
      //        pipelineStatus 仅用于等待策略和 fallback 原因，不作为否决已有 ResultSet 的条件。

      // 1. 先查询 session 的 pipelineStatus
      const grDb = await getDb();
      let grSessionRecord: any = null;
      if (grDb) {
        const grResults = await grDb.select().from(sessions)
          .where(eq(sessions.id, session_id))
          .limit(1);
        grSessionRecord = grResults[0] || null;
      }
      const initialPipelineStatus = grSessionRecord?.pipelineStatus || 'not_started';
      console.log(`[Atlas] Session ${session_id} pipelineStatus: ${initialPipelineStatus}`);

      // 2. 如果 Pipeline 正在 running，等待最多 10 秒
      let currentPipelineStatus = initialPipelineStatus;
      if (currentPipelineStatus === 'running') {
        console.log(`[Atlas] Pipeline is running, waiting for completion...`);
        const maxWait = 10000;
        const pollInterval = 1000;
        let waited = 0;
        while (waited < maxWait) {
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          waited += pollInterval;
          if (grDb) {
            const refreshedResults = await grDb.select().from(sessions)
              .where(eq(sessions.id, session_id))
              .limit(1);
            const refreshedSession = refreshedResults[0] || null;
            currentPipelineStatus = refreshedSession?.pipelineStatus || 'not_started';
            console.log(`[Atlas] Checked session ${session_id} pipelineStatus: ${currentPipelineStatus} (${waited}ms)`);
            if (currentPipelineStatus === 'success') {
              console.log(`[Atlas] Pipeline completed successfully after ${waited}ms`);
              break;
            } else if (currentPipelineStatus === 'failed') {
              console.log(`[Atlas] Pipeline failed after ${waited}ms`);
              break;
            }
          }
        }
        // 等待结束后，最终状态即为 currentPipelineStatus
      }

      // 3. 根据 pipelineStatus 决定导出路径
      // 确定 fallback 原因（在 V3 路径尝试前先记录）
      let fallbackReason = "resultset_missing";
      if (currentPipelineStatus === 'failed') {
        fallbackReason = "pipeline_failed";
        console.log(`[Atlas] Pipeline failed for session ${session_id}, using legacy AI`);
      } else if (currentPipelineStatus === 'running') {
        fallbackReason = "pipeline_running_timeout";
        console.log(`[Atlas] Pipeline still running after timeout for session ${session_id}, using legacy AI`);
      }

      // 确定性异常场景处理：若 pipelineStatus=success，则 V3 路径上的任何异常都不允许 fallback
      if (currentPipelineStatus === 'success') {
        let resultSet: any = null;
        let rsError: string | null = null;
        try {
          resultSet = await getResultSetForSession(session_id);
        } catch (rsErr: any) {
          rsError = rsErr?.message || 'Unknown error';
          console.error(`[Atlas] ❌ CRITICAL: pipelineStatus=success but getResultSetForSession threw for session ${session_id}: ${rsError}`);
          res.status(500).json({
            error: `Data consistency error: pipeline completed but ResultSet query failed: ${rsError}`,
            session_id,
            pipelineStatus: currentPipelineStatus,
            export_path: "error",
            export_reason: "resultset_missing_after_success",
          });
          return;
        }
        if (!resultSet || resultSet.standardizedRows.length === 0) {
          console.error(`[Atlas] ❌ CRITICAL: pipelineStatus=success but ResultSet is null for session ${session_id}`);
          console.error(`[Atlas] This is a data consistency issue - pipeline reported success but no ResultSet was saved`);
          res.status(500).json({
            error: "Data consistency error: pipeline completed but no ResultSet available",
            session_id,
            pipelineStatus: currentPipelineStatus,
            export_path: "error",
            export_reason: "resultset_missing_after_success",
          });
          return;
        }
        // 有 ResultSet，导出（如果导出失败也必须返回 500，不能 fallback）
        try {
          console.log(`[Atlas] ✅ V3.0 ResultSet found for session ${session_id}, rows: ${resultSet.rowCount}, exporting full data`);
          const safeTitle = (report_title || requirement.slice(0, 30)).replace(/[^a-zA-Z0-9一-龥_-]/g, "_").slice(0, 40);
          const exportResult = await exportFromResultSet(resultSet, {
            format: "xlsx",
            fileName: safeTitle,
            includeSummary: true,
            includeCleaningLog: true,
          });
          const dataSummary = buildDataSummary(resultSet);
          const metricsInfo = resultSet.metrics
            .filter((m: any) => "value" in m && m.value !== undefined)
            .map((m: any) => `${m.displayName}: ${m.value} ${m.unit}`)
            .join("\n");
          const reportId = nanoid();
          const resultSetId = (resultSet as any).resultSetId || resultSet.jobId;  // ── Phase 4：绑定 resultSetId（V4.0）
          const userId = (req as any).userId || 0;
          await createReport({
            id: reportId,
            sessionId: session_id,
            userId,
            title: safeTitle,
            filename: exportResult.fileName,
            fileKey: exportResult.s3Key,
            fileUrl: exportResult.url,
            fileSizeKb: Math.ceil(exportResult.fileSize / 1024),
            prompt: requirement,
            resultSetId,  // ── Phase 4：绑定 resultSetId（V4.0）
            status: "completed",
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          });
          const aiMessage = `✅ **${safeTitle}** 已生成完成！（V3.0 全量导出）\n\n` +
            `📊 数据概况：\n${dataSummary}\n\n` +
            (metricsInfo ? `📈 核心指标：\n${metricsInfo}\n\n` : "") +
            `报表包含 ${resultSet.rowCount} 行全量数据（含数据明细、汇总统计、清洗日志 3 个工作表）。\n` +
            `⚠️ 数据来源：Pipeline 确定性性计算引擎 v${resultSet.computationVersion}，非 AI 生成。`;
          const previewHeaders = resultSet.fields.slice(0, 15);
          const previewRows = resultSet.standardizedRows.slice(0, 50).map((row: Record<string, unknown>) =>
            previewHeaders.map((h: string) => row[h] ?? "")
          );
          res.json({
            report_id: reportId,
            filename: exportResult.fileName,
            download_url: exportResult.url,
            export_path: "v3_resultset",
            export_reason: "resultset_found",
            ai_message: aiMessage,
            plan: {
              title: safeTitle,
              sheets: [{
                name: "数据明细",
                headers: previewHeaders,
                rows: previewRows as (string | number)[][],
                summary: `全量 ${resultSet.rowCount} 行数据（预览前 50 行）`,
              }],
              insights: metricsInfo || "全量数据已导出",
            },
          });
          return;
        } catch (exportErr: any) {
          // 确定性异常：pipelineStatus=success 下导出失败，不允许 fallback
          console.error(`[Atlas] ❌ CRITICAL: pipelineStatus=success but exportFromResultSet failed for session ${session_id}: ${exportErr?.message}`);
          res.status(500).json({
            error: `Data consistency error: pipeline completed but export failed: ${exportErr?.message}`,
            session_id,
            pipelineStatus: currentPipelineStatus,
            export_path: "error",
            export_reason: "resultset_missing_after_success",
          });
          return;
        }
      }

      // 非 success 状态：尝试 V3 路径（如果有 ResultSet 就用 V3，否则 fallback）
      try {
        const resultSet = await getResultSetForSession(session_id);
        if (resultSet && resultSet.standardizedRows.length > 0) {
          console.log(`[Atlas] ✅ V3.0 ResultSet found for session ${session_id}, rows: ${resultSet.rowCount}, exporting full data`);
          const safeTitle = (report_title || requirement.slice(0, 30)).replace(/[^a-zA-Z0-9一-龥_-]/g, "_").slice(0, 40);
          const exportResult = await exportFromResultSet(resultSet, {
            format: "xlsx",
            fileName: safeTitle,
            includeSummary: true,
            includeCleaningLog: true,
          });
          const dataSummary = buildDataSummary(resultSet);
          const metricsInfo = resultSet.metrics
            .filter((m: any) => "value" in m && m.value !== undefined)
            .map((m: any) => `${m.displayName}: ${m.value} ${m.unit}`)
            .join("\n");
          const reportId = nanoid();
          const resultSetId = (resultSet as any).resultSetId || resultSet.jobId;  // ── Phase 4：绑定 resultSetId（V4.0）
          const userId = (req as any).userId || 0;
          await createReport({
            id: reportId,
            sessionId: session_id,
            userId,
            title: safeTitle,
            filename: exportResult.fileName,
            fileKey: exportResult.s3Key,
            fileUrl: exportResult.url,
            fileSizeKb: Math.ceil(exportResult.fileSize / 1024),
            prompt: requirement,
            resultSetId,  // ── Phase 4：绑定 resultSetId（V4.0）
            status: "completed",
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          });
          const aiMessage = `✅ **${safeTitle}** 已生成完成！（V3.0 全量导出）\n\n` +
            `📊 数据概况：\n${dataSummary}\n\n` +
            (metricsInfo ? `📈 核心指标：\n${metricsInfo}\n\n` : "") +
            `报表包含 ${resultSet.rowCount} 行全量数据（含数据明细、汇总统计、清洗日志 3 个工作表）。\n` +
            `⚠️ 数据来源：Pipeline 确定性计算引擎 v${resultSet.computationVersion}，非 AI 生成。`;
          const previewHeaders = resultSet.fields.slice(0, 15);
          const previewRows = resultSet.standardizedRows.slice(0, 50).map((row: Record<string, unknown>) =>
            previewHeaders.map((h: string) => row[h] ?? "")
          );
          res.json({
            report_id: reportId,
            filename: exportResult.fileName,
            download_url: exportResult.url,
            export_path: "v3_resultset",
            export_reason: "resultset_found",
            ai_message: aiMessage,
            plan: {
              title: safeTitle,
              sheets: [{
                name: "数据明细",
                headers: previewHeaders,
                rows: previewRows as (string | number)[][],
                summary: `全量 ${resultSet.rowCount} 行数据（预览前 50 行）`,
              }],
              insights: metricsInfo || "全量数据已导出",
            },
          });
          return;
        }
      } catch (rsErr: any) {
        console.warn(`[Atlas] V3.0 ResultSet export failed, falling back to legacy: ${rsErr?.message}`);
      }

      // ═══ 旧路径 Fallback：AI 生成 JSON → Excel ═══
      console.log(`[Atlas] ⚠️ No ResultSet for session ${session_id}, using legacy AI generation`);
      // ═══ 旧路径 Fallback：AI 生成 JSON → Excel ═══
      console.log(`[Atlas] No ResultSet for session ${session_id}, using legacy AI generation`);

      // Load parsed data from S3
      const data = await loadSessionData(session_id);
      if (!data) {
        res.status(404).json({ error: "Session data expired. Please re-upload the file." });
        return;
      }
      // 1. Ask AI to generate the report data as JSON
      const openai = createLLM();
      const fieldNames = dfInfo.fields.map((f: FieldInfo) => f.name).join(", ");
      // Build full-dataset statistics summary to inject into AI prompt
      // This ensures AI uses accurate stats even when only 500 sample rows are provided
      const numericFields = dfInfo.fields.filter((f: FieldInfo) => f.type === 'numeric');
      const fullStatsLines: string[] = [];
      for (const f of numericFields) {
        if (f.sum !== undefined && f.avg !== undefined) {
          fullStatsLines.push(
            `${f.name}: 总计=${f.sum.toFixed(2)}, 均值=${f.avg.toFixed(2)}, 最大=${(f.max ?? 0).toFixed(2)}, 最小=${(f.min ?? 0).toFixed(2)}`
          );
        }
      }
      const fullStatsSection = fullStatsLines.length > 0
        ? `\n══ 全量统计摘要（基于 ${dfInfo.row_count.toLocaleString()} 行全量数据，非样本）══\n重要约束：当需要汇总/合计/均值等指标时，必须直接引用以下全量统计值，禁止对样本行重新计算。\n${fullStatsLines.join('\n')}\n══ 全量统计摘要结束 ══\n`
        : '';

      // Pass sample data (up to 500 rows) for field understanding
      const maxReportRows = Math.min(data.length, 500);
      const allReportData = data.slice(0, maxReportRows);
      const sampleRows = JSON.stringify(allReportData, null, 2);

      // RAG: retrieve similar high-rated examples for self-learning
      const columnSignature = dfInfo.fields.map((f: FieldInfo) => f.name).join(",");
      const ragExamples = await getSimilarExamples(columnSignature, 2);
      const ragSection = ragExamples.length > 0
        ? `\n\n参考示例（这是用户评分较高的历史报表，请学习其分析风格和结构）：\n${ragExamples.map((ex, i) => `示例${i + 1}：需求「${ex.prompt}」，用户评分：${ex.rating}星`).join("\n")}`
        : "";

      const aiPrompt = `你是数据分析专家。根据以下数据和需求，生成一份准确的报表。${ragSection}

数据文件：${filename}（全量 ${dfInfo.row_count}行 x ${dfInfo.col_count}列）
字段：${fieldNames}
${fullStatsSection}
样本数据（共${maxReportRows}行，仅用于理解字段含义，不代表全量数据）：
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
        ["值1", "值2", "值3"]
      ],
      "summary": "本sheet的说明"
    }
  ],
  "insights": "关键发现和建议（2-3条）"
}

要求：
- 最多3个Sheet
- 每个Sheet最多100行数据
- 数据要准确，汇总统计必须使用上方全量统计摘要中的数据
- 如果需要分组汇总，请基于样本数据中的分组字段进行 GROUP BY
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
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      });

      const aiMessage = `✅ **${reportData.title}** 已生成完毕！\n\n${reportData.insights}\n\n报表包含 ${reportData.sheets.length} 个工作表：${reportData.sheets.map(s => s.name).join("、")}。`;
      res.json({
        report_id: reportId,
        filename: `${safeTitle}.xlsx`,
        download_url: reportUrl,
        export_path: "legacy_ai",
        export_reason: fallbackReason,
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
      });;
    } catch (err: any) {
      console.error("[Atlas] Generate report error:", err);
      res.status(500).json({ error: err.message || "Report generation failed" });
    }
  });

  // ── Personal Templates API (V13.7) ─────────────────────────────────────────
  // GET /api/atlas/templates — list user's personal templates
  app.get("/api/atlas/templates", optionalAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId;
      if (!userId) { res.status(401).json({ error: "Login required" }); return; }
      const db = await getDb();
      if (!db) { res.status(500).json({ error: "DB unavailable" }); return; }
      const { eq, desc } = await import("drizzle-orm");
      const rows = await db.select().from(personalTemplates)
        .where(eq(personalTemplates.userId, userId))
        .orderBy(desc(personalTemplates.updatedAt));
      res.json({ templates: rows });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/atlas/templates — save a new personal template
  app.post("/api/atlas/templates", optionalAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId;
      if (!userId) { res.status(401).json({ error: "Login required" }); return; }
      const { name, description, category, systemPrompt, inputFields, exampleOutput } = req.body;
      if (!name || !systemPrompt) { res.status(400).json({ error: "name and systemPrompt are required" }); return; }
      const db = await getDb();
      if (!db) { res.status(500).json({ error: "DB unavailable" }); return; }
      const id = nanoid();
      await db.insert(personalTemplates).values({
        id, userId, name, description, category: category || "custom",
        systemPrompt, inputFields: inputFields || null, exampleOutput: exampleOutput || null,
      });
      res.json({ id, success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/atlas/templates/:id — delete a personal template
  app.delete("/api/atlas/templates/:id", optionalAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId;
      if (!userId) { res.status(401).json({ error: "Login required" }); return; }
      const db = await getDb();
      if (!db) { res.status(500).json({ error: "DB unavailable" }); return; }
      const { eq, and } = await import("drizzle-orm");
      await db.delete(personalTemplates)
        .where(and(eq(personalTemplates.id, req.params.id), eq(personalTemplates.userId, userId)));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/atlas/templates/:id/use — use a template (stream calculation)
  app.post("/api/atlas/templates/:id/use", optionalAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId;
      if (!userId) { res.status(401).json({ error: "Login required" }); return; }
      const db = await getDb();
      if (!db) { res.status(500).json({ error: "DB unavailable" }); return; }
      const { eq } = await import("drizzle-orm");
      const rows = await db.select().from(personalTemplates)
        .where(eq(personalTemplates.id, req.params.id));
      if (!rows.length) { res.status(404).json({ error: "Template not found" }); return; }
      const tmpl = rows[0];
      const { inputs } = req.body as { inputs?: Record<string, string> };
      // Build user message from input fields
      let userMsg = "请根据以下参数进行计算：\n";
      if (inputs && Object.keys(inputs).length > 0) {
        const fields = (tmpl.inputFields as Array<{ key: string; label: string; unit?: string }>) || [];
        for (const f of fields) {
          if (inputs[f.key] !== undefined) {
            userMsg += `${f.label}：${inputs[f.key]}${f.unit ? ' ' + f.unit : ''}\n`;
          }
        }
      }
      // Update use count
      const { sql: drizzleSql } = await import("drizzle-orm");
      await db.update(personalTemplates)
        .set({ useCount: drizzleSql`${personalTemplates.useCount} + 1`, lastUsedAt: new Date() })
        .where(eq(personalTemplates.id, req.params.id));
      // Stream response
      res.setHeader("X-Accel-Buffering", "no");
      res.setHeader("Cache-Control", "no-cache, no-store");
      res.setHeader("Connection", "keep-alive");
      const openai = createLLM();
      const result = streamText({
        model: openai.chat(selectModel()),
        system: tmpl.systemPrompt,
        messages: [{ role: "user", content: userMsg }],
      });
      result.pipeTextStreamToResponse(res);
    } catch (err: any) {
      console.error("[Atlas] Template use error:", err);
        if (!res.headersSent) res.status(500).json({ error: process.env.NODE_ENV === "production" ? "对话处理失败，请重试" : err.message });
    }
  });

  // ── GET /api/atlas/chat-replies ─────────────────────────────────────────────────────
  // 前端轮询：获取小虾米对指定对话的回复消息
  // Query params: ?conversationId=xxx&after=<timestamp_ms>
  app.get("/api/atlas/chat-replies", optionalAuth, async (req: Request, res: Response) => {
    try {
      const { conversationId, after } = req.query as { conversationId?: string; after?: string };
      if (!conversationId) {
        res.status(400).json({ error: "conversationId is required" });
        return;
      }
      const db = await getDb();
      if (!db) {
        res.status(503).json({ error: "Database unavailable" });
        return;
      }
      const { eq, and, gt } = await import("drizzle-orm");
      // 只返回 assistant 角色的消息（小虾米回复）
      const conditions = [eq(chatMessages.conversationId, conversationId), eq(chatMessages.role, "assistant")];
      if (after) {
        const afterDate = new Date(parseInt(after));
        conditions.push(gt(chatMessages.createdAt, afterDate));
      }
      const messages = await db.select().from(chatMessages)
        .where(and(...conditions))
        .orderBy(chatMessages.createdAt)
        .limit(20);
      res.json({ messages });
    } catch (err: any) {
      console.error("[Atlas] chat-replies error:", err);
      res.status(500).json({ error: err.message });
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
      // Proxy download: fetch from S3 with server-side token, stream to browser
      // This avoids redirecting to a private S3 URL that requires auth
      const { url } = await storageGet(report.fileKey);
      const s3Response = await fetch(url);
      if (!s3Response.ok) {
        res.status(502).json({ error: "Failed to fetch file from storage" });
        return;
      }
      // Determine filename for Content-Disposition
      const filename = report.title
        ? `${report.title.replace(/[/\\?%*:|"<>]/g, '-')}.xlsx`
        : `report-${reportId}.xlsx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
      // Stream the file body to the client
      const { Readable } = await import("stream");
      if (s3Response.body) {
        Readable.fromWeb(s3Response.body as any).pipe(res);
      } else {
        const buffer = await s3Response.arrayBuffer();
        res.send(Buffer.from(buffer));
      }
    } catch (err: any) {
      console.error("[Atlas] Download error:", err);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  });
  // POST /api/atlas/merge (P1-C) - merge multiple sessions into one Excel
  app.post("/api/atlas/merge", optionalAuth, async (req: Request, res: Response) => {
    try {
      const { session_ids, platform_names } = req.body as {
        session_ids: string[];
        platform_names?: Record<string, string>;
      };
      if (!session_ids?.length || session_ids.length < 2) {
        res.status(400).json({ error: "至少需要 2 个文件才能合并" });
        return;
      }
      const sessionRecords = await Promise.all(session_ids.map((id: string) => getSession(id)));
      const valid = sessionRecords.map((s, i) => ({ session: s, id: session_ids[i] })).filter(x => x.session);
      if (valid.length < 2) {
        res.status(404).json({ error: "部分文件已过期，请重新上传" });
        return;
      }
      const allRows: Record<string, unknown>[] = [];
      const fileStats: Array<{ name: string; platform: string; rowCount: number }> = [];
      const platformKeywords = ["淘宝","天猫","京东","拼多多","抖音","快手","1688","闲鱼","苏宁","唯品会","小红书"];
      for (const { session, id } of valid) {
        const data = await loadSessionData(id);
        if (!data) continue;
        const filename = (session as { originalName?: string } | undefined)?.originalName ?? id;
        const baseName = filename.replace(/\.[^.]+$/, "");
        let platform = platform_names?.[id] || "";
        if (!platform) {
          const found = platformKeywords.find(k => baseName.includes(k));
          platform = found || baseName;
        }
        const rowsWithSource = data.map(row => ({ ...row, "来源平台": platform }));
        allRows.push(...rowsWithSource);
        fileStats.push({ name: filename, platform, rowCount: data.length });
      }
      if (allRows.length === 0) {
        res.status(400).json({ error: "所有文件数据均为空" });
        return;
      }
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(allRows);
      XLSX.utils.book_append_sheet(wb, ws, "合并数据");
      const summaryData: unknown[][] = [
        ["文件名", "来源平台", "数据行数"],
        ...fileStats.map(f => [f.name, f.platform, f.rowCount]),
        ["合计", "", allRows.length],
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryData), "合并概览");
      const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
      const reportId = nanoid();
      const { url: reportUrl } = await storagePut(
        "atlas-merged-reports/" + reportId + ".xlsx",
        buffer,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
       res.json({
        downloadUrl: reportUrl,
        reportId,
        totalRows: allRows.length,
        files: fileStats,
        message: "已合并 " + valid.length + " 个文件，共 " + allRows.length + " 行数据",
      });
    } catch (err: any) {
      console.error("[Atlas] Merge error:", err);
      res.status(500).json({ error: err.message || "合并失败" });
    }
  });

  // ── POST /api/atlas/upload-chunk ─────────────────────────────────────────────
  // Chunked upload: receives 1MB slices, assembles in memory, triggers background
  // processing on last chunk. Bypasses Cloudflare 30s timeout.
  const chunkStore = new Map<string, {
    chunks: (Buffer | undefined)[];
    totalChunks: number;
    filename: string;
    mimetype: string;
    sessionId: string;
    userId: number;
  }>();

  // Clean up stale chunk stores every 10 minutes
  setInterval(() => {
    chunkStore.clear();
  }, 10 * 60_000);

  app.post("/api/atlas/upload-chunk", optionalAuth, uploadChunk.single("chunk"), async (req: Request, res: Response) => {
    try {
      const { uploadId, chunkIndex, totalChunks, filename } = req.body as {
        uploadId: string;
        chunkIndex: string;
        totalChunks: string;
        filename: string;
      };
      const chunkIdx = parseInt(chunkIndex, 10);
      const total = parseInt(totalChunks, 10);

      if (!uploadId || isNaN(chunkIdx) || isNaN(total) || !req.file) {
        res.status(400).json({ error: "Missing required chunk fields" });
        return;
      }

      // Initialize store for this uploadId on first chunk
      if (!chunkStore.has(uploadId)) {
        const sessionId = nanoid();
        const userId = (req as any).userId || 0;
        const ext = (filename || "file").split(".").pop()?.toLowerCase() || "xlsx";
        const fileKey = `atlas-uploads/${sessionId}-${Date.now()}.${ext}`;
        const safeFilename = (filename || "file").replace(/[\/\\<>:"'|?*\x00-\x1f]/g, "_").slice(0, 200);
        // Create session record immediately so polling can start
        await createSession({
          id: sessionId,
          userId,
          filename: fileKey,
          originalName: safeFilename,
          fileKey,
          fileUrl: "",
          fileSizeKb: 0,
          rowCount: 0,
          colCount: 0,
          dfInfo: {} as any,
          isMerged: 0,
          status: "uploading",
        });
        chunkStore.set(uploadId, {
          chunks: new Array(total).fill(undefined),
          totalChunks: total,
          filename: safeFilename,
          mimetype: req.file.mimetype || "application/octet-stream",
          sessionId,
          userId,
        });
      }

      const entry = chunkStore.get(uploadId)!;
      entry.chunks[chunkIdx] = req.file.buffer;

      const receivedCount = entry.chunks.filter(Boolean).length;
      const isComplete = receivedCount === total;

      if (!isComplete) {
        // Acknowledge chunk, client sends next one
        res.json({ received: chunkIdx, total, session_id: entry.sessionId, status: "uploading" });
        return;
      }

      // All chunks received — merge buffers
      const buffer = Buffer.concat(entry.chunks as Buffer[]);
      const { sessionId, filename: originalname, mimetype: mimeType, userId } = entry;
      chunkStore.delete(uploadId); // free memory immediately

      const ext = originalname.split(".").pop()?.toLowerCase() || "xlsx";
      const fileKey = `atlas-uploads/${sessionId}-${Date.now()}.${ext}`;
      const fileSizeKb = Math.ceil(buffer.length / 1024);
      await updateSession(sessionId, { filename: fileKey, fileKey, fileSizeKb }).catch(() => {});

      // Return immediately — client starts polling
      res.json({
        session_id: sessionId,
        filename: originalname,
        file_url: "",
        status: "processing",
        df_info: { row_count: 0, col_count: 0, fields: [], preview: [] },
      });

      // Background processing (identical logic to /upload)
      setImmediate(async () => {
        try {
          const { url: fileUrl } = await storagePut(fileKey, buffer, mimeType);
          await updateSession(sessionId, { fileUrl }).catch(() => {});

          // Use worker thread for XLSX so the main event loop is never blocked (prevents 503 on large files)
          let data: Record<string, unknown>[];
          let sheetNames: string[] | undefined;
          if (ext === "csv") {
            data = parseCsvBuffer(buffer);
          } else {
            const parsed = await parseExcelBufferAsync(buffer, originalname);
            data = parsed.data;
            sheetNames = parsed.sheetNames;
            (data as any).__xlsxMeta = { totalRowCount: parsed.totalRowCount, columnStats: parsed.columnStats };
          }
          const xlsxMeta = (data as any).__xlsxMeta;
          const dfInfo = buildDataFrameInfo(data, sheetNames, xlsxMeta?.totalRowCount, xlsxMeta?.columnStats);
          const scenarioHint = detectScenario(dfInfo.fields);
          const requiredByScenario: Record<string, string[]> = {
            payroll:    ["基本工资", "员工姓名"],
            attendance: ["员工姓名", "出勤天数"],
            sales:      ["总销售额"],
            dividend:   ["员工姓名"],
          };
          const requiredFields = requiredByScenario[scenarioHint.type] || [];
          const { normalizedData, injectedFields, fieldMapping } = normalizeFieldNames(data, requiredFields);
          const workingData = normalizedData;

          await updateSession(sessionId, { rowCount: dfInfo.row_count, colCount: dfInfo.col_count, dfInfo: dfInfo as any }).catch(() => {});
          await storeSessionData(sessionId, workingData);

          const scenario = detectScenario(dfInfo.fields);
          const keyMetrics = computeKeyMetrics(workingData, scenario, dfInfo);
          const fieldSummary = dfInfo.fields.slice(0, 15).map(f =>
            `${f.name}(${f.type}, ${f.unique_count}个唯一值, 示例:${f.sample.slice(0, 3).join("/")})`
          ).join(", ");
          const metricsSummary = keyMetrics.map(m => `${m.name}: ${m.value}`).join("、");

          // Quality checks
          // NOTE: 全表缺失値警告已移除（Phase 1 治理提示仅针对 groupByField 列，由前端 detectDataQuality 生成）
          const qualityIssues: string[] = [];
          if (injectedFields.length > 0) qualityIssues.push(`字段容错提示：${injectedFields.join('、')}字段在数据中缺失，已自动按 0 处理`);
          const mappingEntries = Object.entries(fieldMapping);
          if (mappingEntries.length > 0) qualityIssues.push(`字段识别提示：已自动将 ${mappingEntries.map(([o, c]) => `「${o}」→「${c}」`).join('、')} 对齐为标准字段名`);

          // Outlier detection
          const outlierDetails: Array<{ fieldName: string; median: number; threshold: number; outlierRows: Array<{ rowIndex: number; value: number }> }> = [];
          const outlierWarnings: string[] = [];
          for (const field of dfInfo.fields.filter(f => f.type === "numeric").slice(0, 6)) {
            const valsWithIndex = workingData.map((row, i) => ({ val: Number(row[field.name]), rowIndex: i + 2 })).filter(x => !isNaN(x.val) && x.val > 0);
            if (valsWithIndex.length < 3) continue;
            const sortedVals = [...valsWithIndex.map(x => x.val)].sort((a, b) => a - b);
            const median = sortedVals[Math.floor(sortedVals.length / 2)];
            const threshold = median * 5;
            const outlierItems = valsWithIndex.filter(x => x.val > threshold);
            if (outlierItems.length > 0 && median > 0) {
              const maxVal = Math.max(...outlierItems.map(x => x.val));
              const fmtV = (n: number) => n >= 10000 ? `${(n/10000).toFixed(1)}万` : n.toFixed(0);
              outlierWarnings.push(`${field.name}(最高值${fmtV(maxVal)}，约为中位数${fmtV(median)}的${Math.round(maxVal/median)}倍)`);
              outlierDetails.push({ fieldName: field.name, median, threshold, outlierRows: outlierItems.slice(0, 20).map(x => ({ rowIndex: x.rowIndex, value: x.val })) });
            }
          }
          if (outlierWarnings.length > 0) qualityIssues.push(`⚠️ 异常高值预警：${outlierWarnings.join('；')}，建议核实数据准确性`);

          const numericFields = dfInfo.fields.filter(f => f.type === "numeric").map(f => f.name);
          const fieldListStr = dfInfo.fields.slice(0, 4).map(f => f.name).join('、') + (dfInfo.fields.length > 4 ? '等' : '');
          const qualityHint = qualityIssues.length > 0 ? '（并加一句质量提醒）' : '';
          const hasSales = scenario.type === "sales";
          const hasPayroll = scenario.type === "payroll";
          const hasAttendance = scenario.type === "attendance";
          const hasDividend = scenario.type === "dividend";
          const hasStore = scenario.groupFields.some(f => /门店|店铺|store|shop/.test(f.toLowerCase()));
          const hasDate = scenario.dateFields.length > 0;
          const hasName = scenario.groupFields.some(f => /姓名|名字|员工|name|staff/.test(f.toLowerCase()));

          const fallbackTable = { title: `${originalname} 关键指标`, columns: ["指标名称", "指标値"], rows: keyMetrics.map(m => [m.name, String(m.value)]), highlight: 1, sortBy: -1, sortDir: "desc", source: `基于 ${dfInfo.row_count.toLocaleString()} 行全量数据统计` };
          const fallbackTableStr = "```atlas-table\n" + JSON.stringify(fallbackTable, null, 2) + "\n```";
          const uploadSystemPrompt = [
            '你是 ATLAS，一个专业的智能数据分析助手。用户刚刚上传了文件，你必须立刻输出以下内容：',
            '', '**第一部分：一句话识别**（不超过30字）',
            `格式：「这是一份[${scenario.name}]，共${dfInfo.row_count}行、${dfInfo.col_count}列。」${qualityHint}`,
            '', '**第二部分：关键指标表**', '必须输出以下 atlas-table 格式（严格遵守）：',
            '', '\`\`\`atlas-table', '{',
            `  "title": "[${originalname}] 关键指标",`,
            `  "source": "基于 ${dfInfo.row_count.toLocaleString()} 行全量数据统计",`,
            '  "columns": ["指标名称", "指标値", "说明"],',
            '  "rows": [',
            `    ["数据总行数", "${dfInfo.row_count}", "有效数据行"],`,
            `    ["字段数", "${dfInfo.col_count}", "包括: ${fieldListStr}"],`,
            `    // 在此基础上，根据实际数据补充 5-6 个最重要的业务指标（已计算値：${metricsSummary}）`,
            '  ],', '  "highlight": 1,', '  "sortBy": -1,', '  "sortDir": "desc"', '}', '\`\`\`',
            '', '**第三部分：3个分析方向**（带字段名）',
            '格式：【①】具体操作（如「按门店汇总销售额排名」）',
            '', `数据场景：${scenario.name}，置信度：${(scenario.confidence * 100).toFixed(0)}%`,
            `主要数值字段：${scenario.primaryFields.join('、') || '无'}`,
            `分组字段：${scenario.groupFields.join('、') || '无'}`,
            `已计算指标：${metricsSummary}`,
            '', '注意：', '- rows 中的注释行必须删除，只保留真实数据行',
            '- 指标值直接用已计算的真实数值，不要编造',
            '- 输出不超过150字，不要有任何前置序言',
          ].join('\n');

          let aiAnalysis = "";
          try {
            const openai = createLLM();
            // 45s timeout: qwen3-max typically responds in 5-15s; abort if exceeded to avoid frontend timeout
            const aiAbortController = new AbortController();
            const aiTimeoutId = setTimeout(() => aiAbortController.abort(), 45_000);
            const result = await streamText({
              model: openai.chat(selectModel(dfInfo.row_count)),
              system: uploadSystemPrompt,
              messages: [{ role: "user", content: `文件名：${originalname}，共 ${dfInfo.row_count} 行 ${dfInfo.col_count} 列。字段：${fieldSummary}。${qualityIssues.length > 0 ? '数据质量：' + qualityIssues.join('；') : '数据质量良好'}。已计算指标：${metricsSummary}` }],
              maxOutputTokens: 800,
              abortSignal: aiAbortController.signal,
            });
            aiAnalysis = await result.text;
            clearTimeout(aiTimeoutId);
            if (!aiAnalysis.includes("atlas-table")) {
              const intro = aiAnalysis.split("\n")[0] || `这是一份${scenario.name}，共${dfInfo.row_count}行、${dfInfo.col_count}列。`;
              aiAnalysis = `${intro}\n\n${fallbackTableStr}`;
            }
          } catch (e) {
            const qualityNote = qualityIssues.length > 0 ? `\n\n⚠️ 数据质量提醒：${qualityIssues.join('；')}` : '';
            aiAnalysis = `这是一份**${scenario.name}**，共 ${dfInfo.row_count.toLocaleString()} 行、${dfInfo.col_count} 列。${qualityNote}\n\n${fallbackTableStr}`;
          }

          const suggestedActions: Array<{ label: string; prompt: string; icon: string }> = [];
          if (hasPayroll || (hasName && numericFields.length > 0)) suggestedActions.push({ icon: "📝", label: "生成工资条", prompt: `__PAYSLIP_INLINE__${sessionId}` });
          if (hasDividend) { const divField = numericFields.find(f => /分红|奖金|奖/.test(f)) || numericFields[0] || "奖金"; suggestedActions.push({ icon: "💰", label: "分红明细表", prompt: `帮我按${divField}从高到低生成分红明细表` }); suggestedActions.push({ icon: "🏆", label: "Top10 排名", prompt: `帮我找出${divField}最高的前10名和最低的后10名` }); }
          if (hasSales) { const salesField = numericFields.find(f => /销售|金额|gmv|revenue/.test(f.toLowerCase())) || numericFields[0] || "销售额"; suggestedActions.push({ icon: "📊", label: "销售汇总表", prompt: `帮我汇总销售数据，显示${salesField}、订单数和关键指标` }); if (hasStore) suggestedActions.push({ icon: "🏦", label: "门店排名", prompt: `帮我按门店分组汇总${salesField}，对比各门店表现并排名` }); }
          if (hasAttendance) suggestedActions.push({ icon: "📅", label: "考勤汇总", prompt: `__ATTENDANCE_INLINE__${sessionId}` });
          if (hasDate && !hasSales) suggestedActions.push({ icon: "📈", label: "趋势分析", prompt: "帮我按时间分析数据趋势，看看有什么规律" });
          if (suggestedActions.length < 2) { if (numericFields.length > 0) suggestedActions.push({ icon: "📊", label: "生成汇总表", prompt: `帮我汇总${numericFields.slice(0, 3).join('、')}等关键指标` }); else suggestedActions.push({ icon: "📊", label: "生成汇总表", prompt: "帮我生成数据汇总表，包含关键指标和统计" }); suggestedActions.push({ icon: "🔍", label: "全面分析", prompt: "帮我全面分析这份数据，找出关键规律、异常值和可优化方向" }); }
          suggestedActions.push({ icon: "✨", label: "自定义需求", prompt: "" });

          const finalResult = {
            session_id: sessionId, filename: originalname, file_url: fileUrl, status: "ready",
            df_info: { row_count: dfInfo.row_count, col_count: dfInfo.col_count, fields: dfInfo.fields, preview: dfInfo.preview },
            ai_analysis: aiAnalysis, suggested_actions: suggestedActions, quality_issues: qualityIssues,
            outlier_details: outlierDetails.length > 0 ? outlierDetails : undefined,
            field_mapping_hint: mappingEntries.length > 0 ? mappingEntries.map(([original, canonical]) => ({ original, canonical })) : undefined,
          };
          await storeUploadResult(sessionId, finalResult);
          await updateSession(sessionId, { status: "ready" });
          console.log(`[Atlas] Chunked upload background processing complete for session ${sessionId}`);
        } catch (bgErr: any) {
          console.error(`[Atlas] Chunked upload background processing failed:`, bgErr);
          const failedSessionId = chunkStore.get(uploadId)?.sessionId || "";
          await updateSession(failedSessionId, { status: "error" }).catch(() => {});
        }
      });
    } catch (err: any) {
      console.error("[Atlas] Upload chunk error:", err);
      res.status(500).json({ error: err.message || "Chunk upload failed" });
    }
  });

  // ── POST /api/atlas/upload-parsed ─────────────────────────────────────────────────────────
  // Receives frontend-parsed data (JSON). Skips server-side XLSX parsing entirely.
  app.post("/api/atlas/upload-parsed", optionalAuth, async (req: Request, res: Response) => {
    try {
      interface FrontendGroupedTop5Entry {
        label: string;
        sum: number;
        source?: string;
      }
      interface FrontendParsedField {
        name: string;
        type: "numeric" | "text" | "datetime";
        dtype: string;
        null_count: number;
        unique_count: number;
        sample: (string | number)[];
        sum?: number;
        min?: number;
        max?: number;
        avg?: number;
        top5?: Array<{ value: number; rowIndex: number }>;
        // Grouped top5: GROUP BY dimension field, SUM numeric field, TOP5 by sum
        groupedTop5?: FrontendGroupedTop5Entry[];
        groupByField?: string;
        // T7 fix: sum of ALL valid non-placeholder groups (for precise null-nickname amount)
        validGroupSum?: number;
        // Product-dimension groupedTop5 (GROUP BY 选购商品) for product Top queries
        productGroupedTop5?: FrontendGroupedTop5Entry[];
        productGroupByField?: string;
        // Category-dimension stats: for ALL categorical fields (省份/支付方式/城市/状态 etc.)
        categoryGroupedTop20?: Record<string, Array<{ label: string; count: number; sum?: number; avg?: number }>>;
      }
      const parsed = req.body as {
        filename: string;
        totalRowCount: number;
        colCount: number;
        fields: FrontendParsedField[];
        preview: Record<string, unknown>[];
        groupByField?: string;
        allGroupByFields?: Array<{ field: string; tier: number }>;
        // Phase 1: 达人昵称字段治理元数据（前端计算后透传）
        dataQuality?: Record<string, unknown>;
        // Category stats: full-dataset GROUP BY stats for ALL categorical fields
        categoryGroupedTop20?: Record<string, Array<{ label: string; count: number; sum?: number; avg?: number }>>;
      };

      if (!parsed || !parsed.filename || !parsed.fields) {
        res.status(400).json({ error: "Invalid parsed data" });
        return;
      }

      const sessionId = nanoid();
      const userId = (req as any).userId || 0;
      const originalname = parsed.filename;

      const dfInfo: DataFrameInfo = {
        row_count: parsed.totalRowCount,
        col_count: parsed.colCount,
        fields: parsed.fields.map(f => ({
          name: f.name,
          type: f.type,
          dtype: f.dtype,
          null_count: f.null_count,
          unique_count: f.unique_count,
          sample: f.sample,
          // Persist full-dataset stats so chat endpoint can use them without recomputing from preview
          ...(f.sum !== undefined ? { sum: f.sum, avg: f.avg, max: f.max, min: f.min } : {}),
          // Persist full-dataset top5 (value-descending) for accurate TopN in chat
          ...(f.top5 !== undefined ? { top5: f.top5 } : {}),
          // Persist grouped top5 (GROUP BY dimension field, SUM numeric field) for accurate aggregated TopN
          ...(f.groupedTop5 !== undefined ? { groupedTop5: f.groupedTop5 } : {}),
          ...(f.groupByField !== undefined ? { groupByField: f.groupByField } : {}),
          // T7 fix: persist validGroupSum (sum of ALL valid non-placeholder groups) for precise null-nickname amount
          ...(f.validGroupSum !== undefined ? { validGroupSum: f.validGroupSum } : {}),
          // Product-dimension groupedTop5 (GROUP BY 选购商品) for product Top queries
          ...(f.productGroupedTop5 !== undefined ? { productGroupedTop5: f.productGroupedTop5 } : {}),
          ...(f.productGroupByField !== undefined ? { productGroupByField: f.productGroupByField } : {}),
        })),
        preview: (parsed.preview || []).slice(0, 500),
        ...(parsed.groupByField !== undefined ? { groupByField: parsed.groupByField } : {}),
        ...(parsed.allGroupByFields !== undefined ? { allGroupByFields: parsed.allGroupByFields } : {}),
        // Phase 1: 透传前端生成的 dataQuality 元数据，存入 dfInfo JSON 列
        ...(parsed.dataQuality !== undefined ? { dataQuality: parsed.dataQuality } : {}),
        // Category stats: 透传分类字段全量预计算结果，存入 dfInfo JSON 列
        ...(parsed.categoryGroupedTop20 !== undefined ? { categoryGroupedTop20: parsed.categoryGroupedTop20 } : {}),
      };
      // Server-side fallback: if frontend didn't send groupByField (old cached code),
      // re-detect it server-side using the same V14.2 rules
      if (!dfInfo.groupByField) {
        const serverGroupByField = serverDetectGroupByField(dfInfo.fields);
        if (serverGroupByField) {
          console.log(`[Atlas] upload-parsed: frontend groupByField=null, server detected: ${serverGroupByField}`);
          dfInfo.groupByField = serverGroupByField;
          // Also compute groupedTop5 for all numeric fields using the server-detected groupByField
          const previewRows = parsed.preview || [];
          for (const field of dfInfo.fields) {
            if (field.type === "numeric" && !field.groupedTop5) {
              field.groupedTop5 = serverComputeGroupedTopN(previewRows, field.name, serverGroupByField, originalname);
              field.groupByField = serverGroupByField;
            }
          }
        }
      }

      await createSession({
        id: sessionId,
        userId,
        filename: originalname,
        originalName: originalname,
        fileKey: `atlas-parsed/${sessionId}`,
        fileUrl: "",
        fileSizeKb: 0,
        rowCount: parsed.totalRowCount,
        colCount: parsed.colCount,
        dfInfo: dfInfo as any,
         isMerged: 0,
        status: "uploading",
      });
      // Solution B: upload-parsed 使用前端已解析的 JSON 数据触发 Pipeline
      // 写入 pipelineStatus=running，由 runParsedPipelineInBackground 负责写终态 success/failed
      await updateSession(sessionId, {
        pipelineStatus: "running",
        pipelineError: null,
        pipelineStartedAt: new Date(),
        pipelineFinishedAt: null,
      }).catch(err => console.warn(`[Pipeline] Failed to write running status for ${sessionId}:`, err?.message));
      console.log(`[Pipeline] upload-parsed: pipelineStatus=running for session ${sessionId}`);
      res.json({
        session_id: sessionId,
        filename: originalname,
        file_url: "",
        status: "processing",
        df_info: dfInfo,
      });
      setImmediate(async () => {
        try {
          const workingData = parsed.preview || [];;
          const scenarioHint = detectScenario(dfInfo.fields);
          const requiredByScenario: Record<string, string[]> = {
            payroll:    ["\u57fa\u672c\u5de5\u8d44", "\u5458\u5de5\u59d3\u540d"],
            attendance: ["\u5458\u5de5\u59d3\u540d", "\u51fa\u52e4\u5929\u6570"],
            sales:      ["\u603b\u9500\u552e\u989d"],
            dividend:   ["\u5458\u5de5\u59d3\u540d"],
          };
          const requiredFields = requiredByScenario[scenarioHint.type] || [];
           const { normalizedData, fieldMapping } = normalizeFieldNames(workingData, requiredFields);
          await storeSessionData(sessionId, normalizedData);
          // Solution B: 从前端已解析的 JSON 数据运行 Pipeline
          // rawRows 使用原始 workingData（字段名未标准化）， fieldMapping 由 normalizeFieldNames 生成
          const rawRowsForPipeline = workingData.map(row => {
            const r: Record<string, string> = {};
            for (const [k, v] of Object.entries(row)) {
              r[k] = v === null || v === undefined ? "" : String(v);
            }
            return r;
          });
          // 异步运行 Pipeline，不阻塞当前 setImmediate 的其他工作
          runParsedPipelineInBackground(
            sessionId,
            userId,
            rawRowsForPipeline,
            fieldMapping,
            originalname
          ).catch(err => console.error(`[Pipeline] runParsedPipelineInBackground failed for ${sessionId}:`, err?.message));
          await updateSession(sessionId, {
            rowCount: dfInfo.row_count,
            colCount: dfInfo.col_count,
            dfInfo: dfInfo as any,
          }).catch(() => {});

          const scenario = detectScenario(dfInfo.fields);
          // Pass frontend-computed full-dataset stats so metrics are accurate for all rows
          const precomputedStats: PrecomputedFieldStat[] = parsed.fields
            .filter(f => f.sum !== undefined)
            .map(f => ({ name: f.name, sum: f.sum, avg: f.avg, max: f.max, min: f.min }));
          const keyMetrics = computeKeyMetrics(normalizedData, scenario, dfInfo, precomputedStats);

          // Structured full-dataset stats summary for AI prompt
          const numericFieldStats = dfInfo.fields
            .filter(f => f.type === "numeric" && f.sum !== undefined)
            .slice(0, 10)
            .map(f => [
              `${f.name}总计: ${f.sum!.toLocaleString()}`,
              `${f.name}均値: ${f.avg !== undefined ? f.avg.toFixed(2) : 'N/A'}`,
              `${f.name}最大: ${f.max !== undefined ? f.max.toLocaleString() : 'N/A'}`,
              `${f.name}最小: ${f.min !== undefined ? f.min.toLocaleString() : 'N/A'}`,
            ].join('\n'))
            .join('\n');
          const fieldSummary = dfInfo.fields.slice(0, 15).map(f => {
            const fe = parsed.fields.find(pf => pf.name === f.name);
            const statsStr = fe?.sum !== undefined
              ? `sum=${fe.sum >= 10000 ? (fe.sum / 10000).toFixed(1) + '\u4e07' : fe.sum.toFixed(0)},avg=${fe.avg?.toFixed(0)},max=${fe.max?.toFixed(0)}`
              : `${f.unique_count}\u4e2a\u552f\u4e00\u503c`;
            return `${f.name}(${f.type},${statsStr})`;
          }).join(", ");

          const qualityIssues: string[] = [];
          // NOTE: 全表缺失值警告已移除（Phase 1 起，缺失值提示由 detectDataQuality 专项处理，仅针对 groupByField 列）
          const mappingEntries = Object.entries(fieldMapping);
          if (mappingEntries.length > 0) {
            qualityIssues.push(`\u5b57\u6bb5\u8bc6\u522b\u63d0\u793a\uff1a\u5df2\u81ea\u52a8\u5c06 ${mappingEntries.map(([o, c]) => `\u300c${o}\u300d\u2192\u300c${c}\u300d`).join('\u3001')} \u5bf9\u9f50\u4e3a\u6807\u51c6\u5b57\u6bb5\u540d`);
          }

          const numericFields = dfInfo.fields.filter(f => f.type === "numeric").map(f => f.name);
          const metricsSummary = keyMetrics.map(m => `${m.name}: ${m.value}`).join("\u3001");

          const hasSales2 = scenario.type === "sales";
          const hasPayroll2 = scenario.type === "payroll";
          const hasAttendance2 = scenario.type === "attendance";
          const hasDividend2 = scenario.type === "dividend";
          const hasStore2 = scenario.groupFields.some(f => /\u95e8\u5e97|\u5e97\u94fa|store|shop/.test(f.toLowerCase()));
          const hasName2 = scenario.groupFields.some(f => /\u59d3\u540d|\u540d\u5b57|\u5458\u5de5|name|staff/.test(f.toLowerCase()));

          const fallbackTable = {
            title: `${originalname} \u5173\u952e\u6307\u6807`,
            columns: ["\u6307\u6807\u540d\u79f0", "\u6307\u6807\u503c"],
            rows: keyMetrics.map(m => [m.name, String(m.value)]),
            highlight: 1, sortBy: -1, sortDir: "desc",
          };
          const fallbackTableStr = "```atlas-table\n" + JSON.stringify(fallbackTable, null, 2) + "\n```";

          const fieldListStr = dfInfo.fields.slice(0, 4).map(f => f.name).join('\u3001') + (dfInfo.fields.length > 4 ? '\u7b49' : '');
          const qualityHint = qualityIssues.length > 0 ? '\uff08\u5e76\u52a0\u4e00\u53e5\u8d28\u91cf\u63d0\u9192\uff09' : '';

          const uploadSystemPrompt = [
            '\u4f60\u662f ATLAS\uff0c\u4e00\u4e2a\u4e13\u4e1a\u7684\u667a\u80fd\u6570\u636e\u5206\u6790\u52a9\u624b\u3002\u7528\u6237\u521a\u521a\u4e0a\u4f20\u4e86\u6587\u4ef6\uff0c\u4f60\u5fc5\u987b\u7acb\u523b\u8f93\u51fa\u4ee5\u4e0b\u5185\u5bb9\uff1a',
            '',
            `**\u7b2c\u4e00\u90e8\u5206\uff1a\u4e00\u53e5\u8bdd\u8bc6\u522b**\uff08\u4e0d\u8d85\u8fc730\u5b57\uff09`,
            `\u683c\u5f0f\uff1a\u300c\u8fd9\u662f\u4e00\u4efd[${scenario.name}]\uff0c\u5171${dfInfo.row_count}\u884c\u3001${dfInfo.col_count}\u5217\u3002\u300d${qualityHint}`,
            '',
            '**\u7b2c\u4e8c\u90e8\u5206\uff1a\u5173\u952e\u6307\u6807\u8868**',
            '\u5fc5\u987b\u8f93\u51fa\u4ee5\u4e0b atlas-table \u683c\u5f0f\uff08\u4e25\u683c\u9075\u5b88\uff09\uff1a',
            '',
            '```atlas-table',
            '{',
            `  "title": "[${originalname}] \u5173\u952e\u6307\u6807",`,
            '  "columns": ["\u6307\u6807\u540d\u79f0", "\u6307\u6807\u503c", "\u8bf4\u660e"],',
            '  "rows": [',
            `    ["\u6570\u636e\u603b\u884c\u6570", "${dfInfo.row_count}", "\u6709\u6548\u6570\u636e\u884c"],`,
            `    ["\u5b57\u6bb5\u6570", "${dfInfo.col_count}", "\u5305\u62ec: ${fieldListStr}"],`,
            `    // \u5728\u6b64\u57fa\u7840\u4e0a\uff0c\u6839\u636e\u5b9e\u9645\u6570\u636e\u8865\u5145 5-6 \u4e2a\u6700\u91cd\u8981\u7684\u4e1a\u52a1\u6307\u6807\uff08\u5df2\u8ba1\u7b97\u503c\uff1a${metricsSummary}\uff09`,
            '  ],',
            '  "highlight": 1,',
            '  "sortBy": -1,',
            '  "sortDir": "desc"',
            '}',
            '```',
            '',
            '**\u7b2c\u4e09\u90e8\u5206\uff1a3\u4e2a\u5206\u6790\u65b9\u5411**\uff08\u5e26\u5b57\u6bb5\u540d\uff09',
            '\u683c\u5f0f\uff1a\u3010\u2460\u3011\u5177\u4f53\u64cd\u4f5c',
            '',
            `\u6570\u636e\u573a\u666f\uff1a${scenario.name}\uff0c\u7f6e\u4fe1\u5ea6\uff1a${(scenario.confidence * 100).toFixed(0)}%`,
            `\u4e3b\u8981\u6570\u503c\u5b57\u6bb5\uff1a${scenario.primaryFields.join('\u3001') || '\u65e0'}`,
            `\u5206\u7ec4\u5b57\u6bb5\uff1a${scenario.groupFields.join('\u3001') || '\u65e0'}`,
            `\u5df2\u8ba1\u7b97\u6307\u6807\uff1a${metricsSummary}`,
            '',
            '\u6ce8\u610f\uff1a',
            '- rows \u4e2d\u7684\u6ce8\u91ca\u884c\u5fc5\u987b\u5220\u9664\uff0c\u53ea\u4fdd\u7559\u771f\u5b9e\u6570\u636e\u884c',
            '- \u6307\u6807\u503c\u76f4\u63a5\u7528\u5df2\u8ba1\u7b97\u7684\u771f\u5b9e\u6570\u503c\uff0c\u4e0d\u8981\u7f16\u9020',
            '- \u8f93\u51fa\u4e0d\u8d85\u8fc7150\u5b57\uff0c\u4e0d\u8981\u6709\u4efb\u4f55\u524d\u7f6e\u5e8f\u8a00',
          ].join('\n');

          let aiAnalysis = "";
          try {
            const openai = createLLM();
            const aiAbortController = new AbortController();
            const aiTimeoutId = setTimeout(() => aiAbortController.abort(), 45_000);
            const result = await streamText({
              model: openai.chat("qwen3-max"),
              system: uploadSystemPrompt,
              messages: [{
                role: "user",
                content: [
                `\u6587\u4ef6\u540d\uff1a${originalname}\uff0c\u5171 ${dfInfo.row_count.toLocaleString()} \u884c ${dfInfo.col_count} \u5217\u3002`,
                `\u5b57\u6bb5\u5217\u8868\uff1a${fieldSummary}`,
                numericFieldStats ? `\n\u2550\u2550 \u5168\u91cf\u7edf\u8ba1\u6458\u8981\uff08\u57fa\u4e8e ${dfInfo.row_count.toLocaleString()} \u884c\u5168\u91cf\u6570\u636e\uff0c\u975e\u6837\u672c\uff09\u2550\u2550\n\u91cd\u8981\u7ea6\u675f\uff1a\u8be2\u95ee\u603b\u91cf/\u5408\u8ba1/\u5747\u5024/\u6700\u5927/\u6700\u5c0f\u65f6\uff0c\u5fc5\u987b\u76f4\u63a5\u5f15\u7528\u4ee5\u4e0b\u5168\u91cf\u7edf\u8ba1\u5024\uff0c\u7981\u6b62\u5bf9\u6837\u672c\u91cd\u65b0\u8ba1\u7b97\u3002\n${numericFieldStats}\n\u2550\u2550 \u5168\u91cf\u7edf\u8ba1\u6458\u8981\u7ed3\u675f \u2550\u2550` : '',
                `${qualityIssues.length > 0 ? '\n\u6570\u636e\u8d28\u91cf\uff1a' + qualityIssues.join('\uff1b') : ''}`,
                `\n\u5df2\u8ba1\u7b97\u6307\u6807\uff1a${metricsSummary}`,
              ].filter(Boolean).join(''),
              }],
              maxOutputTokens: 600,
              abortSignal: aiAbortController.signal,
            });
            aiAnalysis = await result.text;
            clearTimeout(aiTimeoutId);
            if (!aiAnalysis.includes("atlas-table")) {
              const intro = aiAnalysis.split("\n")[0] || `\u8fd9\u662f\u4e00\u4efd${scenario.name}\uff0c\u5171${dfInfo.row_count}\u884c\u3001${dfInfo.col_count}\u5217\u3002`;
              aiAnalysis = `${intro}\n\n${fallbackTableStr}`;
            }
          } catch (e) {
            console.warn("[Atlas] upload-parsed AI failed, using fallback:", e);
            aiAnalysis = `\u8fd9\u662f\u4e00\u4efd**${scenario.name}**\uff0c\u5171 ${dfInfo.row_count.toLocaleString()} \u884c\u3001${dfInfo.col_count} \u5217\u3002\n\n${fallbackTableStr}`;
          }

          const suggestedActions: Array<{ label: string; prompt: string; icon: string }> = [];
          if (hasPayroll2 || (hasName2 && numericFields.length > 0)) {
            suggestedActions.push({ icon: "\ud83d\udcdd", label: "\u751f\u6210\u5de5\u8d44\u6761", prompt: `__PAYSLIP_INLINE__${sessionId}` });
          }
          if (hasDividend2) {
            const divField = numericFields.find(f => /\u5206\u7ea2|\u5956\u91d1|\u5956/.test(f)) || numericFields[0] || "\u5956\u91d1";
            suggestedActions.push({ icon: "\ud83d\udcb0", label: "\u5206\u7ea2\u660e\u7ec6\u8868", prompt: `\u5e2e\u6211\u6309${divField}\u4ece\u9ad8\u5230\u4f4e\u751f\u6210\u5206\u7ea2\u660e\u7ec6\u8868` });
          }
          if (hasSales2) {
            const salesField = numericFields.find(f => /\u9500\u552e|\u91d1\u989d|gmv|revenue/.test(f.toLowerCase())) || numericFields[0] || "\u9500\u552e\u989d";
            suggestedActions.push({ icon: "\ud83d\udcca", label: "\u9500\u552e\u6c47\u603b\u8868", prompt: `\u5e2e\u6211\u6c47\u603b\u9500\u552e\u6570\u636e\uff0c\u663e\u793a${salesField}\u3001\u8ba2\u5355\u6570\u548c\u5173\u952e\u6307\u6807` });
            if (hasStore2) {
              suggestedActions.push({ icon: "\ud83c\udfe6", label: "\u95e8\u5e97\u6392\u540d", prompt: `\u5e2e\u6211\u6309\u95e8\u5e97\u5206\u7ec4\u6c47\u603b${salesField}\uff0c\u5bf9\u6bd4\u5404\u95e8\u5e97\u8868\u73b0\u5e76\u6392\u540d` });
            }
          }
          if (hasAttendance2) {
            suggestedActions.push({ icon: "\ud83d\udcc5", label: "\u8003\u52e4\u6c47\u603b", prompt: `__ATTENDANCE_INLINE__${sessionId}` });
          }
          if (suggestedActions.length < 2) {
            if (numericFields.length > 0) {
              suggestedActions.push({ icon: "\ud83d\udcca", label: "\u751f\u6210\u6c47\u603b\u8868", prompt: `\u5e2e\u6211\u6c47\u603b${numericFields.slice(0, 3).join('\u3001')}\u7b49\u5173\u952e\u6307\u6807` });
            } else {
              suggestedActions.push({ icon: "\ud83d\udcca", label: "\u751f\u6210\u6c47\u603b\u8868", prompt: "\u5e2e\u6211\u751f\u6210\u6570\u636e\u6c47\u603b\u8868\uff0c\u5305\u542b\u5173\u952e\u6307\u6807\u548c\u7edf\u8ba1" });
            }
            suggestedActions.push({ icon: "\ud83d\udd0d", label: "\u5168\u9762\u5206\u6790", prompt: "\u5e2e\u6211\u5168\u9762\u5206\u6790\u8fd9\u4efd\u6570\u636e\uff0c\u627e\u51fa\u5173\u952e\u89c4\u5f8b\u3001\u5f02\u5e38\u503c\u548c\u53ef\u4f18\u5316\u65b9\u5411" });
          }
          suggestedActions.push({ icon: "\u2728", label: "\u81ea\u5b9a\u4e49\u9700\u6c42", prompt: "" });

          const finalResult = {
            session_id: sessionId,
            filename: originalname,
            file_url: "",
            status: "ready",
            df_info: dfInfo,
            ai_analysis: aiAnalysis,
            suggested_actions: suggestedActions,
            quality_issues: qualityIssues,
          };
          await storeUploadResult(sessionId, finalResult);
          await updateSession(sessionId, { status: "ready" });
          console.log(`[Atlas] upload-parsed complete: ${sessionId}, rows=${dfInfo.row_count}`);
        } catch (bgErr: any) {
          console.error(`[Atlas] upload-parsed background failed:`, bgErr);
          await updateSession(sessionId, { status: "error" }).catch(() => {});
        }
      });
    } catch (err: any) {
      console.error("[Atlas] upload-parsed error:", err);
      res.status(500).json({ error: err.message || "Upload failed" });
    }
  });

  // ── GET /api/atlas/status/:sessionId ───────────────────────────────────────────────────────────────────────────────────
  // Poll upload processing status. Returns full result when ready.
  app.get("/api/atlas/status/:sessionId", optionalAuth, async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const session = await getSession(sessionId);
      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      if (session.status === "ready") {
        // Try to load full result from S3
        const result = await loadUploadResult(sessionId);
        if (result) {
          res.json(result);
          return;
        }
        // Fallback: return basic info if result file not found
        res.json({
          session_id: sessionId,
          filename: session.originalName || session.filename,
          file_url: session.fileUrl,
          status: "ready",
          df_info: session.dfInfo || { row_count: session.rowCount, col_count: session.colCount, fields: [], preview: [] },
          ai_analysis: "数据已就绪，可以开始分析。",
          suggested_actions: [],
        });
        return;
      }
      if (session.status === "error") {
        res.status(500).json({ error: "文件处理失败，请重新上传" });
        return;
      }
      // Still processing (uploading)
      res.json({
        status: "processing",
        session_id: sessionId,
        pipelineStatus: session.pipelineStatus || null,
        pipelineError: session.pipelineError || null,
        resultSetId: session.resultSetId || null,
      });
    } catch (err: any) {
      console.error("[Atlas] Status error:", err);
      res.status(500).json({ error: err.message || "Status check failed" });
    }
  });

  // ── Debug API (H 阶段：Pipeline 测试支持) ─────────────────────────────────────

  // H-1: GET /api/atlas/debug/session/:sessionId
  app.get("/api/atlas/debug/session/:sessionId", optionalAuth, async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const session = await getSession(sessionId);
      if (!session) {
        res.status(404).json({ error: "Session not found", sessionId });
        return;
      }
      let resultSetSummary: any = null;
      const db = await getDb();
      if (db) {
        const rsWhere = session.resultSetId
          ? eq(resultSets.id, session.resultSetId)
          : eq(resultSets.sessionId, sessionId);
        const rsRows = await db.select().from(resultSets).where(rsWhere).limit(1);
        if (rsRows.length > 0) {
          const rs = rsRows[0];
          resultSetSummary = {
            id: rs.id,
            rowCount: rs.rowCount,
            computationVersion: rs.computationVersion,
            dataS3Key: rs.dataS3Key,
            metricsCount: Array.isArray(rs.metrics) ? (rs.metrics as any[]).length : 0,
            generatedAt: rs.generatedAt,
            skippedRowsCount: rs.skippedRowsCount,
            sourcePlatform: rs.sourcePlatform,
          };
        }
      }
      const ps = session.pipelineStatus;
      const diagnosis = !ps
        ? "Pipeline 未启动（upload-parsed 路径或旧数据）"
        : ps === "running" ? "Pipeline 正在执行，请等待或检查是否超时"
        : ps === "failed" ? `Pipeline 失败：${session.pipelineError || "无错误信息"}`
        : ps === "success" && !resultSetSummary ? "⚠️ 严重：pipelineStatus=success 但 ResultSet 为空，数据一致性异常"
        : ps === "success" && resultSetSummary ? `✅ Pipeline 成功，ResultSet 已保存（${resultSetSummary.rowCount} 行）`
        : "未知状态";
      res.json({
        sessionId,
        status: session.status,
        filename: session.originalName || session.filename,
        rowCount: session.rowCount,
        colCount: session.colCount,
        createdAt: session.createdAt,
        pipelineStatus: ps || null,
        pipelineError: session.pipelineError || null,
        pipelineStartedAt: session.pipelineStartedAt || null,
        pipelineFinishedAt: session.pipelineFinishedAt || null,
        resultSetId: session.resultSetId || null,
        resultSet: resultSetSummary,
        diagnosis,
      });
    } catch (err: any) {
      console.error("[Atlas] Debug session error:", err);
      res.status(500).json({ error: err.message || "Debug session failed" });
    }
  });

  // H-2: GET /api/atlas/debug/logs?filter=xxx&n=100
  app.get("/api/atlas/debug/logs", optionalAuth, async (req: Request, res: Response) => {
    try {
      const { filter = "", n = "100" } = req.query as { filter?: string; n?: string };
      const { execSync } = await import("child_process");
      const logFile = "/home/ubuntu/atlas-report/.manus-logs/devserver.log";
      const limit = Math.min(Math.max(parseInt(n, 10) || 100, 1), 500);
      let raw = "";
      try {
        if (filter) {
          raw = execSync(`grep -i ${JSON.stringify(filter)} ${logFile} | tail -${limit}`, { encoding: "utf8", timeout: 5000 });
        } else {
          raw = execSync(`tail -${limit} ${logFile}`, { encoding: "utf8", timeout: 5000 });
        }
      } catch { raw = ""; }
      const lines = raw.split("\n").filter(Boolean).map(line => {
        const m = line.match(/^\[(\d{4}-\d{2}-\d{2}T[^\]]+)\]\s*(.*)$/);
        return m ? { ts: m[1], msg: m[2] } : { ts: null, msg: line };
      });
      res.json({ total: lines.length, filter: filter || null, lines });
    } catch (err: any) {
      console.error("[Atlas] Debug logs error:", err);
      res.status(500).json({ error: err.message || "Debug logs failed" });
    }
  });

  // H-3: POST /api/atlas/debug/test-pipeline  body: { sessionId, pollSeconds? }
  app.post("/api/atlas/debug/test-pipeline", optionalAuth, async (req: Request, res: Response) => {
    try {
      const { sessionId, pollSeconds = 30 } = req.body as { sessionId: string; pollSeconds?: number };
      if (!sessionId) { res.status(400).json({ error: "sessionId is required" }); return; }
      const session = await getSession(sessionId);
      if (!session) { res.status(404).json({ error: "Session not found", sessionId }); return; }
      if (!session.fileKey) { res.status(400).json({ error: "Session has no fileKey", sessionId }); return; }
      // 重置 pipelineStatus 为 running
      await updateSession(sessionId, {
        pipelineStatus: "running",
        pipelineError: null,
        pipelineStartedAt: new Date(),
        pipelineFinishedAt: null,
      } as any);
      // 从 S3 下载文件 buffer
      const { url: s3Url } = await storageGet(session.fileKey);
      const fileResp = await fetch(s3Url);
      if (!fileResp.ok) { res.status(500).json({ error: `S3 download failed: ${fileResp.status}`, sessionId }); return; }
      const fileBuffer = Buffer.from(await fileResp.arrayBuffer());
      const userId = (req as any).userId || session.userId || 0;
      // 异步触发 pipeline（不等待完成）
      runPipelineInBackground(
        sessionId, userId, fileBuffer,
        session.originalName || session.filename || "file.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      // 轮询等待结果
      const maxWait = Math.min(Math.max(Number(pollSeconds) || 30, 5), 120) * 1000;
      let waited = 0;
      let finalStatus = "running";
      let finalError: string | null = null;
      let finalResultSetId: string | null = null;
      const db = await getDb();
      while (waited < maxWait) {
        await new Promise(r => setTimeout(r, 2000));
        waited += 2000;
        if (db) {
          const rows = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
          const s = rows[0];
          if (s) {
            finalStatus = s.pipelineStatus || "running";
            finalError = s.pipelineError || null;
            finalResultSetId = s.resultSetId || null;
            if (finalStatus === "success" || finalStatus === "failed") break;
          }
        }
      }
      let resultSetSummary: any = null;
      if (db && finalResultSetId) {
        const rsRows = await db.select().from(resultSets).where(eq(resultSets.id, finalResultSetId)).limit(1);
        if (rsRows.length > 0) {
          const rs = rsRows[0];
          resultSetSummary = { id: rs.id, rowCount: rs.rowCount, computationVersion: rs.computationVersion, dataS3Key: rs.dataS3Key, metricsCount: Array.isArray(rs.metrics) ? (rs.metrics as any[]).length : 0, generatedAt: rs.generatedAt };
        }
      }
      res.json({
        sessionId,
        triggered: true,
        waitedMs: waited,
        pipelineStatus: finalStatus,
        pipelineError: finalError,
        resultSetId: finalResultSetId,
        resultSet: resultSetSummary,
        verdict: finalStatus === "success" && resultSetSummary
          ? `✅ Pipeline 成功，ResultSet 已保存（${resultSetSummary.rowCount} 行）`
          : finalStatus === "success" && !resultSetSummary
          ? "⚠️ Pipeline 成功但 ResultSet 为空（数据一致性异常）"
          : finalStatus === "failed"
          ? `❌ Pipeline 失败：${finalError || "无错误信息"}`
          : `⏳ Pipeline 超时（${waited}ms），仍在 running`,
      });
    } catch (err: any) {
      console.error("[Atlas] Debug test-pipeline error:", err);
      res.status(500).json({ error: err.message || "Debug test-pipeline failed" });
    }
  });
}
