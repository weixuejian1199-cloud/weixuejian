/**
 * parseFile.ts — 前端本地解析 Excel/CSV
 *
 * 策略：
 * - 全量扫描所有行，计算数值列的 sum/avg/max/min/count（统计 100% 准确）
 * - 只保留前 500 行作为预览和 AI 样本（内存效率）
 * - 返回 ParsedFileData，直接发给服务器 /api/atlas/upload-parsed
 */

import * as XLSX from "xlsx";

export interface ColumnStat {
  sum: number;
  min: number;
  max: number;
  count: number; // non-null numeric count
  nullCount: number;
  uniqueValues: Set<string>; // for text columns, track unique count (cap at 1000)
  // top5 heap: keep the 5 largest values seen so far (value + rowIndex)
  top5Heap: Array<{ value: number; rowIndex: number }>;
}

// Grouped topN entry: group label + aggregated sum from full dataset
export interface GroupedTop5Entry {
  label: string;   // e.g. "达人昵称" value
  sum: number;     // aggregated sum of the numeric field for this group
  source?: string; // source filename (for multi-file UNION)
}

export interface ParsedField {
  name: string;
  type: "numeric" | "text" | "datetime";
  dtype: string;
  null_count: number;
  unique_count: number;
  sample: (string | number)[];
  // numeric stats (only for numeric columns) — all computed from FULL dataset
  sum?: number;
  min?: number;
  max?: number;
  avg?: number;
  // top5: value-descending, each entry is { value, rowIndex } — from full dataset (row-level)
  top5?: Array<{ value: number; rowIndex: number }>;
  // groupedTop5: GROUP BY dimension field, SUM numeric field, TOP20 by sum — from full dataset
  groupedTop5?: GroupedTop5Entry[];
  // which dimension field was used for groupedTop5
  groupByField?: string;
  // T7: sum of ALL valid (non-placeholder) groups — used to compute null-nickname amount
  // null_nickname_amount = field.sum - validGroupSum
  validGroupSum?: number;
}

// ── Phase 1：数据质量元数据 ─────────────────────────────────────────────────

/**
 * DataQuality：达人昵称字段治理规则产生的元数据。
 * Phase 1 中 layer_used 始终为 "raw"，rules_applied 始终为 []，
 * cleaned_groupedTopN 始终为 null（Phase 3 用户确认 forward fill 后才赋值）。
 */
export interface DataQuality {
  /** 当前展示层：Phase 1 固定为 "raw" */
  layer_used: "raw" | "cleaned";
  /** 已触发的治理规则列表：Phase 1 固定为 [] */
  rules_applied: string[];
  /** 触发快照：用于判断各条件是否触发 */
  trigger_snapshot: {
    null_rate: number;          // 空值率，保留 4 位小数
    unique_count: number;       // 原始唯一值数量（含无效值）
    top1_ratio: number;         // Top1 金额占比（基于全量 groupedTopN），保留 4 位小数
    placeholder_count: number;  // 占位符数量（"-" / "—" / "N/A" / "无"）
  };
  /** 受影响的行数（无效值行数） */
  affected_rows: number;
  /** Raw vs Cleaned 对比摘要：Phase 1 cleaned 字段均为 null */
  before_vs_after_summary: {
    raw_groupedTop1_sum: number;
    cleaned_groupedTop1_sum: number | null;
    raw_valid_rows: number;
    cleaned_valid_rows: number | null;
  };
  /**
   * Cleaned 层聚合结果。
   * Phase 1 固定为 null；Phase 3 用户确认 forward fill 后赋值。
   * 前端通过此字段是否非 null 来决定是否显示 Raw/Cleaned 切换开关。
   */
  cleaned_groupedTopN: GroupedTop5Entry[] | null;
  /** 操作模式 */
  operator_mode: "auto_suggested" | "user_enabled" | "user_disabled";
  /** 原始无效值总数（null + 占位符 + 疑似商品名） */
  raw_invalid_count: number;
  /** 渲染层实际过滤的无效值数量（label 命中无效值集合的条目数） */
  filtered_invalid_count: number;
  /** 无效值分类明细 */
  invalid_value_breakdown: {
    null_or_empty: number;
    placeholder: number;
    suspected_product_name: number;
  };
  /** 疑似商品名列表，最多 20 条 */
  suspected_product_names: string[];
}

export interface ParsedFileData {
  filename: string;
  totalRowCount: number;
  colCount: number;
  fields: ParsedField[];
  preview: Record<string, unknown>[]; // first 500 rows
  sampleRows: Record<string, unknown>[]; // first 20 rows for AI prompt
  // The dimension field used for groupedTop5 (e.g. "达人昵称")
  groupByField?: string;
  // All detected dimension fields by priority tier (for multi-dim grouping)
  allGroupByFields?: Array<{ field: string; tier: number }>;
  // Phase 1: 达人昵称字段治理元数据（仅当 groupByField 存在时生成）
  dataQuality?: DataQuality;
}

const PREVIEW_ROWS = 500;
const SAMPLE_ROWS = 20;
// Store top 20 for grouping so AI can return Top10/Top20 accurately
const GROUPED_TOP_N = 20;

/**
 * Priority-tiered dimension field detection.
 *
 * Rules (applied in order):
 * 1. Candidate field MUST be text type (not numeric/amount/fee/price etc.)
 * 2. Field name must NOT contain amount/fee/price patterns (金额/优惠/费用/佣金/补贴/承担/支付/单价)
 * 3. After filtering, rank by tier:
 *    Tier 1 (达人/主播 — influencer): exact "达人昵称" > "主播昵称" > "达人名称" > "主播名称" > "达人ID" > "主播ID" > other 达人/主播
 *    Tier 2 (昵称 — nickname): "昵称"
 *    Tier 3 (姓名/人员): "姓名", "员工姓名", "用户名", "名字"
 *    Tier 4 (店铺/商家): "店铺名称", "店铺", "商家名称", "商家"
 *    Tier 5 (商品/SKU/品牌): "商品名称", "商品", "SKU", "品牌"
 * 4. NO fallback: if no qualifying field found, return null — never infer from product/store names
 */

/** Patterns that indicate a field is a monetary/fee amount — must NOT be used as group-by dimension */
const AMOUNT_FIELD_PATTERNS = [
  "金额", "优惠", "费用", "佣金", "补贴", "承担", "支付", "单价",
  "price", "amount", "money", "fee", "cost",
];

/** Numeric-type keywords that disqualify a field as a dimension */
const NUMERIC_TYPE_KEYWORDS = [
  "numeric", "number", "float", "double", "decimal",
  "amount", "price", "money", "fee", "int", "integer", "bigint",
];

/**
 * Returns true if the field name matches an amount/fee pattern and should be excluded from grouping.
 */
function isAmountField(fieldName: string): boolean {
  const lower = fieldName.toLowerCase();
  return AMOUNT_FIELD_PATTERNS.some((p) => fieldName.includes(p) || lower.includes(p.toLowerCase()));
}

/**
 * Returns true if the detected dtype indicates a numeric/monetary column.
 */
function isNumericDtype(dtype: string): boolean {
  const lower = dtype.toLowerCase();
  return NUMERIC_TYPE_KEYWORDS.some((k) => lower.includes(k));
}

const DIMENSION_TIERS: Array<{ tier: number; keywords: string[] }> = [
  // Tier 1: influencer fields — ordered by specificity (exact match preferred)
  { tier: 1, keywords: ["达人昵称", "主播昵称", "达人名称", "主播名称", "达人ID", "主播ID", "达人", "主播"] },
  { tier: 2, keywords: ["昵称"] },
  { tier: 3, keywords: ["姓名", "员工姓名", "用户名", "名字"] },
  { tier: 4, keywords: ["店铺名称", "店铺", "商家名称", "商家"] },
  { tier: 5, keywords: ["商品名称", "商品", "SKU", "品牌"] },
];

/**
 * Detect all valid dimension fields from headers.
 * fieldTypes maps header name → detected type ("numeric" | "text" | "datetime").
 *
 * Filtering rules (MUST pass ALL):
 * 1. Field type must be "text" or "datetime" (not "numeric")
 * 2. Field name must NOT match AMOUNT_FIELD_PATTERNS
 *
 * Returns fields sorted by tier (ascending = higher priority).
 */
function detectAllGroupByFields(
  headers: string[],
  fieldTypes?: Record<string, "numeric" | "text" | "datetime">
): Array<{ field: string; tier: number }> {
  const result: Array<{ field: string; tier: number }> = [];
  const seen = new Set<string>();

  for (const { tier, keywords } of DIMENSION_TIERS) {
    for (const kw of keywords) {
      // Within each tier, prefer exact match first, then contains
      const exactMatches = headers.filter((h) => !seen.has(h) && h === kw);
      const containsMatches = headers.filter((h) => !seen.has(h) && h !== kw && h.includes(kw));
      for (const h of [...exactMatches, ...containsMatches]) {
        if (seen.has(h)) continue;
        // Rule 1: must be text type (if type info available)
        if (fieldTypes && fieldTypes[h] === "numeric") continue;
        // Rule 2: field name must not contain amount/fee patterns
        if (isAmountField(h)) continue;
        result.push({ field: h, tier });
        seen.add(h);
      }
    }
  }
  return result;
}

/**
 * Returns the highest-priority valid dimension field, or null if none qualify.
 * Never falls back to store/product names when looking for influencer fields.
 */
function detectGroupByField(
  headers: string[],
  fieldTypes?: Record<string, "numeric" | "text" | "datetime">
): string | null {
  const all = detectAllGroupByFields(headers, fieldTypes);
  return all.length > 0 ? all[0].field : null;
}

/**
 * Compute GROUP BY + SUM topN for a numeric field, grouped by a dimension field.
 * Returns topN entries sorted by aggregated sum descending.
 * Default topN = 20 so callers can slice to any smaller N (Top5, Top10, Top20).
 */
function computeGroupedTopN(
  rows: Record<string, unknown>[],
  numericField: string,
  groupField: string,
  sourceFilename: string,
  topN = GROUPED_TOP_N
): { entries: GroupedTop5Entry[]; validTotalSum: number } {
  const groupSums: Map<string, number> = new Map();
  for (const row of rows) {
    const groupVal = row[groupField];
    const numVal = Number(row[numericField]);
    if (groupVal === null || groupVal === undefined || groupVal === "") continue;
    if (isNaN(numVal)) continue;
    const key = String(groupVal).trim();
    // Filter out placeholder values (e.g. "-", "—", "N/A", "无") from groupBy ranking
    if (key === "" || key === "-" || key === "—" || key === "--" || key === "——" ||
        key === "N/A" || key === "n/a" || key === "NA" || key === "na" ||
        key === "无" || key === "null" || key === "NULL" || key === "None" || key === "none") continue;
    groupSums.set(key, (groupSums.get(key) ?? 0) + numVal);
  }
  // Compute total sum of ALL valid groups (not just top N) — used for null-nickname amount
  const validTotalSum = Array.from(groupSums.values()).reduce((a, b) => a + b, 0);
  // Sort by sum descending, take topN
  const sorted = Array.from(groupSums.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN);
  return { entries: sorted.map(([label, sum]) => ({ label, sum, source: sourceFilename })), validTotalSum };
}

// ── Phase 1：detectDataQuality ──────────────────────────────────────────────

/**
 * 无效值判断：null / 空字符串 / trim 后为空 / 精确匹配占位符
 */
function isNullOrEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  const s = String(v).trim();
  return s === "";
}

const PLACEHOLDER_VALUES = new Set(["-", "—", "N/A", "无"]);

/**
 * 占位符判断：精确匹配 "-" / "—" / "N/A" / "无"
 */
function isPlaceholder(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  return PLACEHOLDER_VALUES.has(String(v).trim());
}

/**
 * 疑似商品名特征词
 */
const PRODUCT_NAME_KEYWORDS = ["【", "专属", "体验装", "ml", "g*", "支", "袋", "箱", "件"];

/**
 * 疑似商品名判断：长度 > 25 且包含特征词
 */
function isSuspectedProductName(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  const s = String(v).trim();
  if (s.length <= 25) return false;
  return PRODUCT_NAME_KEYWORDS.some((kw) => s.includes(kw));
}

/**
 * detectDataQuality：检测 groupByField 列的数据质量，生成 DataQuality 元数据。
 *
 * 调用时机：在 computeGroupedTopN 之后（需要 groupedTopN 结果计算 top1_ratio）。
 * 不修改 rows，不影响 computeGroupedTopN 的输入。
 *
 * @param rows         全量行数据
 * @param groupByField 分组字段名（达人昵称列）
 * @param groupedTopN  已计算好的 groupedTopN 结果（用于计算 top1_ratio）
 */
function detectDataQuality(
  rows: Record<string, unknown>[],
  groupByField: string,
  groupedTopN: GroupedTop5Entry[]
): DataQuality {
  const totalRows = rows.length;

  let nullOrEmptyCount = 0;
  let placeholderCount = 0;
  let suspectedProductNameCount = 0;
  const suspectedProductNames: string[] = [];
  // 用于统计 groupByField 列的唯一值（含无效值）
  const uniqueRaw = new Set<string>();

  for (const row of rows) {
    const v = row[groupByField];
    if (isNullOrEmpty(v)) {
      nullOrEmptyCount++;
    } else if (isPlaceholder(v)) {
      placeholderCount++;
      uniqueRaw.add(String(v).trim());
    } else if (isSuspectedProductName(v)) {
      suspectedProductNameCount++;
      const s = String(v).trim();
      uniqueRaw.add(s);
      if (suspectedProductNames.length < 20 && !suspectedProductNames.includes(s)) {
        suspectedProductNames.push(s);
      }
    } else {
      uniqueRaw.add(String(v).trim());
    }
  }

  const rawInvalidCount = nullOrEmptyCount + placeholderCount + suspectedProductNameCount;
  const nullRate = totalRows > 0 ? parseFloat((nullOrEmptyCount / totalRows).toFixed(4)) : 0;

  // top1_ratio：Top1 的 sum 占所有 groupedTopN 条目总 sum 的比例
  const totalSum = groupedTopN.reduce((acc, e) => acc + e.sum, 0);
  const top1Sum = groupedTopN.length > 0 ? groupedTopN[0].sum : 0;
  const top1Ratio = totalSum > 0 ? parseFloat((top1Sum / totalSum).toFixed(4)) : 0;

  // filtered_invalid_count：渲染层会过滤掉的条目数
  // 即 groupedTopN 中 label 属于无效值集合（占位符）的条目数
  const filteredInvalidCount = groupedTopN.filter(
    (e) => isPlaceholder(e.label) || isNullOrEmpty(e.label)
  ).length;

  // raw_groupedTop1_sum：Raw 层 Top1 的 sum（过滤无效 label 后的第一名）
  const validTopN = groupedTopN.filter(
    (e) => !isPlaceholder(e.label) && !isNullOrEmpty(e.label)
  );
  const rawGroupedTop1Sum = validTopN.length > 0 ? validTopN[0].sum : 0;

  return {
    layer_used: "raw",
    rules_applied: [],
    trigger_snapshot: {
      null_rate: nullRate,
      unique_count: uniqueRaw.size,
      top1_ratio: top1Ratio,
      placeholder_count: placeholderCount,
    },
    affected_rows: rawInvalidCount,
    before_vs_after_summary: {
      raw_groupedTop1_sum: rawGroupedTop1Sum,
      cleaned_groupedTop1_sum: null,
      raw_valid_rows: totalRows - nullOrEmptyCount,
      cleaned_valid_rows: null,
    },
    cleaned_groupedTopN: null,
    operator_mode: "auto_suggested",
    raw_invalid_count: rawInvalidCount,
    filtered_invalid_count: filteredInvalidCount,
    invalid_value_breakdown: {
      null_or_empty: nullOrEmptyCount,
      placeholder: placeholderCount,
      suspected_product_name: suspectedProductNameCount,
    },
    suspected_product_names: suspectedProductNames,
  };
}

// ── 类型导出（供 AtlasContext 和 MainWorkspace 使用）──────────────────────

function detectType(values: unknown[]): "numeric" | "text" | "datetime" {
  const nonNull = values.filter((v) => v !== null && v !== undefined && v !== "");
  if (nonNull.length === 0) return "text";
  const numericCount = nonNull.filter((v) => !isNaN(Number(v))).length;
  if (numericCount / nonNull.length > 0.8) return "numeric";
  // Simple datetime check
  const dateCount = nonNull.filter((v) => {
    const s = String(v);
    return /\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(s) || /^\d{5,}$/.test(s);
  }).length;
  if (dateCount / nonNull.length > 0.7) return "datetime";
  return "text";
}

export async function parseFile(file: File): Promise<ParsedFileData> {
  const buffer = await file.arrayBuffer();
  const ext = file.name.split(".").pop()?.toLowerCase();

  let rows: Record<string, unknown>[];

  if (ext === "csv") {
    const text = new TextDecoder("utf-8").decode(buffer);
    const wb = XLSX.read(text, { type: "string", raw: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(ws, { defval: null });
  } else {
    // xlsx / xls — use dense mode for speed, skip formula evaluation
    const wb = XLSX.read(buffer, {
      type: "array",
      raw: false,
      cellDates: false,
      sheetStubs: false,
    });
    const ws = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(ws, { defval: null });
  }

  const totalRowCount = rows.length;
  if (totalRowCount === 0) {
    return {
      filename: file.name,
      totalRowCount: 0,
      colCount: 0,
      fields: [],
      preview: [],
      sampleRows: [],
    };
  }

  const headers = Object.keys(rows[0]);
  const colCount = headers.length;

  // Build per-column stats by scanning ALL rows
  const stats: Record<string, ColumnStat> = {};
  for (const h of headers) {
    stats[h] = { sum: 0, min: Infinity, max: -Infinity, count: 0, nullCount: 0, uniqueValues: new Set(), top5Heap: [] };
  }

  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx];
    for (const h of headers) {
      const v = row[h];
      const stat = stats[h];
      if (v === null || v === undefined || v === "") {
        stat.nullCount++;
      } else {
        const n = Number(v);
        if (!isNaN(n)) {
          stat.sum += n;
          if (n < stat.min) stat.min = n;
          if (n > stat.max) stat.max = n;
          stat.count++;
          // Maintain top5 heap (keep largest 5)
          const heap = stat.top5Heap;
          if (heap.length < 5) {
            heap.push({ value: n, rowIndex: rowIdx });
            if (heap.length === 5) heap.sort((a, b) => a.value - b.value); // min-heap order
          } else if (n > heap[0].value) {
            heap[0] = { value: n, rowIndex: rowIdx };
            heap.sort((a, b) => a.value - b.value);
          }
        } else {
          if (stat.uniqueValues.size < 1000) {
            stat.uniqueValues.add(String(v));
          }
        }
      }
    }
  }

  // Detect column types using first 200 rows sample
  const sampleForType = rows.slice(0, 200);

  // First pass: detect all column types so we can filter out numeric fields from groupBy
  const headerTypes: Record<string, "numeric" | "text" | "datetime"> = {};
  for (const h of headers) {
    const sampleVals = sampleForType.map((r) => r[h]);
    headerTypes[h] = detectType(sampleVals);
  }

  // Detect dimension fields with priority tiers — pass type map to filter out numeric fields
  const allGroupByFields = detectAllGroupByFields(headers, headerTypes);
  // Primary groupBy field = highest priority tier (null if no qualifying text field found)
  const groupByField = allGroupByFields.length > 0 ? allGroupByFields[0].field : null;

  // ── 计算 groupedTopN（用于 detectDataQuality 的 top1_ratio 计算）──────────
  // 取第一个数值字段的 groupedTopN 作为代表（通常是主要金额字段）
  let representativeGroupedTopN: GroupedTop5Entry[] = [];

  const fields: ParsedField[] = headers.map((h) => {
    const sampleVals = sampleForType.map((r) => r[h]);
    const type = headerTypes[h];
    const stat = stats[h];
    const isNumeric = type === "numeric";

    const field: ParsedField = {
      name: h,
      type,
      dtype: isNumeric ? "float64" : "object",
      null_count: stat.nullCount,
      unique_count: isNumeric ? stat.count : stat.uniqueValues.size,
      sample: sampleVals.filter((v) => v !== null && v !== undefined && v !== "").slice(0, 5) as (string | number)[],
    };

    if (isNumeric && stat.count > 0) {
      field.sum = stat.sum;
      field.min = stat.min;
      field.max = stat.max;
      field.avg = stat.sum / stat.count;
      // top5 sorted descending by value (full dataset, row-level)
      field.top5 = [...stat.top5Heap].sort((a, b) => b.value - a.value);
      // groupedTopN: GROUP BY primary dimension field, SUM this numeric field, TOP20 by sum
      if (groupByField) {
        const groupedResult = computeGroupedTopN(rows, h, groupByField, file.name);
        field.groupedTop5 = groupedResult.entries;
        field.validGroupSum = groupedResult.validTotalSum; // T7: total sum of ALL valid groups
        field.groupByField = groupByField;
        // 用第一个数値字段的 groupedTopN 作为 dataQuality 的代表
        if (representativeGroupedTopN.length === 0 && field.groupedTop5.length > 0) {
          representativeGroupedTopN = field.groupedTop5;
        }
      }
    }

    return field;
  });

  // ── Phase 1：生成 dataQuality 元数据 ──────────────────────────────────────
  // 仅当 groupByField 存在时生成（无分组字段的文件不生成）
  let dataQuality: DataQuality | undefined;
  if (groupByField) {
    dataQuality = detectDataQuality(rows, groupByField, representativeGroupedTopN);
  }

  const preview = rows.slice(0, PREVIEW_ROWS);
  const sampleRows = rows.slice(0, SAMPLE_ROWS);

  return {
    filename: file.name,
    totalRowCount,
    colCount,
    fields,
    preview,
    sampleRows,
    groupByField: groupByField ?? undefined,
    allGroupByFields: allGroupByFields.length > 0 ? allGroupByFields : undefined,
    dataQuality,
  };
}
