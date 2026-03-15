/**
 * parseFile.ts — 前端本地解析 Excel/CSV
 *
 * 策略：
 * - 全量扫描所有行，计算数值列的 sum/avg/max/min/count（统计 100% 准确）
 * - 只保留前 500 行作为预览和 AI 样本（内存效率）
 * - 返回 ParsedFileData，直接发给服务器 /api/atlas/upload-parsed
 */

import * as XLSX from "xlsx";

// ── SPU 标准化映射表 ──────────────────────────────────────────────────────────
// 格式：{ 原始商品名: 标准 SPU 名称 }
// 规则：
//   - 命中映射表 → 合并到标准名称
//   - 未命中 → 保持原名，不自动猜测合并
//   - 后续由业务方持续补充，不在运行时做模糊推断
export const SPU_MAPPING: Record<string, string> = {
  // 一条根 2包 系列（去渠道前缀/仓库前缀，保留核心名称+规格）
  "【胡说老王专属】中国台湾金门一条根-3片/包*2包-(（抖店nj）一条根2包)": "一条根2包",
  "【胡说老王专属】中国台湾金门一条根-3片/包*2包-((抖店nj）一条根2包)": "一条根2包",
  "（抖店nj）一条根2包": "一条根2包",
  "【抖店】新一条根2包": "一条根2包",
  // 一条根 8包 系列
  "【胡说老王专属】中国台湾金门一条根-3片/包*8包-(（抖店nj）一条根8包)": "一条根8包",
  "【胡说老王专属】中国台湾金门一条根-3片/包*8包-((抖店nj）一条根8包)": "一条根8包",
  "（抖店nj）一条根8包": "一条根8包",
  "【抖店】新一条根8包": "一条根8包",
  // TODO: 后续由业务方补充更多映射
};

/**
 * 将商品名标准化：命中 SPU_MAPPING 则返回标准名称，否则返回原名。
 * 不做模糊匹配，不做 AI 猜测，严格精确匹配。
 */
export function normalizeSPU(productName: string): string {
  return SPU_MAPPING[productName.trim()] ?? productName.trim();
}

// 组合装统计入口的稳定 key
export const COMBO_ORDERS_KEY = "combo_orders";
export const COMBO_ORDERS_DISPLAY = "组合装订单";

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

// Category grouped entry: for categorical fields (省份/支付方式/城市/状态 etc.)
// count = number of rows in this category
// sum = sum of the primary numeric field for this category (if available)
// avg = avg of the primary numeric field for this category (if available)
export interface CategoryGroupedEntry {
  label: string;   // category value (e.g. "山东", "抗音支付")
  count: number;   // row count in this category
  sum?: number;    // sum of primary numeric field (optional)
  avg?: number;    // avg of primary numeric field (optional)
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
  // Product-dimension groupedTop5: GROUP BY 选购商品, SUM numeric field, TOP20 by sum
  // Used for "商品 Top" queries — separate from talent-dimension groupedTop5
  productGroupedTop5?: GroupedTop5Entry[];
  // Which product field was used for productGroupedTop5 (e.g. "选购商品")
  productGroupByField?: string;
  // Category-dimension stats: for ALL categorical fields (省份/支付方式/城市/状态 etc.)
  // Key = category field name, Value = top20 entries with count/sum/avg
  categoryGroupedTop20?: Record<string, CategoryGroupedEntry[]>;
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
  allRows: Record<string, unknown>[]; // 全量行（用于前端导出）
  // The dimension field used for groupedTop5 (e.g. "达人昵称")
  groupByField?: string;
  // All detected dimension fields by priority tier (for multi-dim grouping)
  allGroupByFields?: Array<{ field: string; tier: number }>;
  // Phase 1: 达人昵称字段治理元数据（仅当 groupByField 存在时生成）
  dataQuality?: DataQuality;
  // Category stats: full-dataset GROUP BY stats for ALL categorical fields
  // Key = field name (e.g. "省份", "支付方式"), Value = top20 entries
  categoryGroupedTop20?: Record<string, CategoryGroupedEntry[]>;
}

const PREVIEW_ROWS = 500;
const SAMPLE_ROWS = 20;
// Store top 50 for grouping so AI can return Top10/Top20/Top50 accurately
// Increased from 20 to fix city/product dimension truncation (e.g. 22 cities only showing 20)
const GROUPED_TOP_N = 50;

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

// ── 分类字段全量预计算 ─────────────────────────────────────────────────────────

/**
 * 分类字段识别规则：
 * - 包含以下关键词的字段被识别为分类字段（省/市/城市/支付/状态/渠道/门店/仓库/来源/平台/类型/等级/标签/地区/区域/国家/性别/品类/类别/行业/部门/岗位/职位）
 * - 排除自由文本字段（备注/地址/说明/描述/内容/详情/评价/留言/原因/问题）
 * - 排除金额/数值字段（isAmountField 判断）
 * - 排除 unique_count 占比 > 50% 的字段（自由文本）
 * - 排除已作为 groupByField/productGroupByField 的字段（避免重复）
 * - 最多统计 20 个分类字段（避免 prompt 过长）
 */
const CATEGORY_FIELD_KEYWORDS = [
  "省", "市", "城市", "地区", "区域", "国家", "地域",
  "支付", "付款", "结算",
  "状态", "类型", "类别", "品类", "分类", "等级", "级别",
  "渠道", "来源", "平台", "门店", "仓库", "仓",
  "性别", "标签", "行业", "部门", "岗位", "职位",
];

const FREE_TEXT_FIELD_KEYWORDS = [
  "备注", "地址", "说明", "描述", "内容", "详情", "评价", "留言", "原因", "问题",
  "remark", "address", "description", "comment", "note",
];

const MAX_CATEGORY_FIELDS = 20;

/**
 * 判断字段名是否为分类字段（基于关键词）
 */
function isCategoryField(fieldName: string): boolean {
  const lower = fieldName.toLowerCase();
  // 排除自由文本字段
  if (FREE_TEXT_FIELD_KEYWORDS.some(kw => fieldName.includes(kw) || lower.includes(kw.toLowerCase()))) return false;
  // 排除金额字段
  if (isAmountField(fieldName)) return false;
  // 包含分类关键词
  return CATEGORY_FIELD_KEYWORDS.some(kw => fieldName.includes(kw) || lower.includes(kw.toLowerCase()));
}

/**
 * 计算所有分类字段的全量 GROUP BY 统计（count/sum/avg）
 * @param rows 全量行数据
 * @param headers 所有字段名
 * @param headerTypes 字段类型映射
 * @param primaryNumericField 主要数值字段名（用于计算 sum/avg，通常是金额字段）
 * @param excludeFields 排除的字段（已作为 groupByField/productGroupByField）
 * @param totalRowCount 总行数（用于判断 unique_count 占比）
 * @returns Record<fieldName, CategoryGroupedEntry[]>
 */
function computeCategoryStats(
  rows: Record<string, unknown>[],
  headers: string[],
  headerTypes: Record<string, "numeric" | "text" | "datetime">,
  primaryNumericField: string | null,
  excludeFields: Set<string>,
  totalRowCount: number
): Record<string, CategoryGroupedEntry[]> {
  const result: Record<string, CategoryGroupedEntry[]> = {};
  let fieldCount = 0;

  for (const h of headers) {
    if (fieldCount >= MAX_CATEGORY_FIELDS) break;
    // 只处理文本/日期类型字段
    if (headerTypes[h] === "numeric") continue;
    // 排除已处理的字段
    if (excludeFields.has(h)) continue;
    // 判断是否为分类字段
    if (!isCategoryField(h)) continue;

    // 全量 GROUP BY 统计
    const countMap = new Map<string, number>();
    const sumMap = new Map<string, number>();

    for (const row of rows) {
      const catVal = row[h];
      if (catVal === null || catVal === undefined || catVal === "") continue;
      const key = String(catVal).trim();
      if (key === "" || key === "-" || key === "—" || key === "N/A" || key === "无") continue;

      countMap.set(key, (countMap.get(key) ?? 0) + 1);

      if (primaryNumericField) {
        const numVal = Number(row[primaryNumericField]);
        if (!isNaN(numVal)) {
          sumMap.set(key, (sumMap.get(key) ?? 0) + numVal);
        }
      }
    }

    // 排除自由文本字段：unique_count 占比 > 50%
    const uniqueCount = countMap.size;
    if (uniqueCount > totalRowCount * 0.5) continue;
    // 至少有 2 个不同值才有统计意义
    if (uniqueCount < 2) continue;

    // 按 count 降序排列，取 Top20
    const sorted = Array.from(countMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, GROUPED_TOP_N);

    result[h] = sorted.map(([label, count]) => {
      const entry: CategoryGroupedEntry = { label, count };
      if (primaryNumericField && sumMap.has(label)) {
        entry.sum = sumMap.get(label)!;
        entry.avg = entry.sum / count;
      }
      return entry;
    });

    fieldCount++;
  }

  return result;
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

/**
 * 合并多个已解析文件的数据，并去重
 * @param parsedFiles - 已解析的文件列表
 * @param keyField - 用于去重的字段名（如"主订单编号"）
 * @returns 合并后的 ParsedFileData
 */
export function mergeParsedFiles(
  parsedFiles: ParsedFileData[],
  keyField: string = "主订单编号"
): ParsedFileData {
  if (parsedFiles.length === 0) {
    return {
      filename: "merged",
      totalRowCount: 0,
      colCount: 0,
      fields: [],
      preview: [],
      sampleRows: [],
      allRows: [],
    };
  }

  if (parsedFiles.length === 1) {
    return parsedFiles[0];
  }

  // 合并所有行（全量）
  const allRows = parsedFiles.flatMap(f => f.allRows || f.sampleRows || []);
  const totalRowCount = allRows.length;

  if (totalRowCount === 0) {
    return parsedFiles[0];
  }

  // 去重：基于 keyField，保留第一次出现的记录
  const seenKeys = new Set<string>();
  const deduplicatedRows: Record<string, unknown>[] = [];

  for (const row of allRows) {
    const key = String(row[keyField] ?? "");
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      deduplicatedRows.push(row);
    }
  }

  // 合并字段统计（取所有文件的字段并集）
  const fieldMap = new Map<string, ParsedField>();

  for (const parsed of parsedFiles) {
    for (const field of parsed.fields) {
      const existing = fieldMap.get(field.name);
      if (existing) {
        // 合并统计
        if (field.sum !== undefined && existing.sum !== undefined) {
          existing.sum += field.sum;
        }
        if (field.min !== undefined && existing.min !== undefined) {
          existing.min = Math.min(existing.min, field.min);
        }
        if (field.max !== undefined && existing.max !== undefined) {
          existing.max = Math.max(existing.max, field.max);
        }
        if (field.count !== undefined && existing.count !== undefined) {
          existing.count += field.count;
        }
        if (field.null_count !== undefined) {
          existing.null_count += field.null_count;
        }
        if (existing.avg !== undefined && existing.sum !== undefined && existing.count !== undefined) {
          existing.avg = existing.sum / existing.count;
        }
      } else {
        fieldMap.set(field.name, { ...field });
      }
    }
  }

  const fields = Array.from(fieldMap.values());
  const colCount = fields.length;
  const headers = fields.map(f => f.name);

  // 取第一个文件的列名作为标准
  const preview = deduplicatedRows.slice(0, 10);

  return {
    filename: "合并数据",
    totalRowCount: deduplicatedRows.length,
    colCount,
    fields,
    preview,
    sampleRows: deduplicatedRows.slice(0, 500), // 限制 500 行
    allRows: deduplicatedRows, // 全量行（用于前端导出）
  };
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

  // P3：过滤全空行（文件末尾空白行、中间分隔行），使 totalRowCount 与服务端口径对齐
  rows = rows.filter(row =>
    Object.values(row).some(v => v !== null && v !== undefined && v !== "")
  );

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
  // Product-dimension groupBy field: detect "选购商品" or similar product name field
  // Used for product-level Top N queries ("商品 Top", "销售数量 Top" etc.)
  const PRODUCT_FIELD_KEYWORDS = ["选购商品", "商品名称", "商品名", "SKU名称", "SKU", "品名"];
  const productGroupByField = PRODUCT_FIELD_KEYWORDS
    .map(kw => headers.find(h => h === kw || h.includes(kw)))
    .find(h => h !== undefined && headerTypes[h] !== "numeric" && !isAmountField(h)) ?? null;

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
      // Product-dimension groupedTop5: GROUP BY 选购商品, SUM numeric field, TOP50
      // P2: 商品口径分离：含分号的行进入组合装池，不含分号的行进入单品池
      // 单品池经 SPU_MAPPING 标准化后再做 GROUP BY
      if (productGroupByField && productGroupByField !== groupByField) {
        // 分离单品和组合装
        const singleRows: Record<string, unknown>[] = [];
        const comboRows: Record<string, unknown>[] = [];
        for (const row of rows) {
          const productVal = row[productGroupByField];
          if (productVal === null || productVal === undefined || productVal === "") continue;
          const productStr = String(productVal);
          if (productStr.includes(";") || productStr.includes("；")) {
            comboRows.push(row);
          } else {
            singleRows.push(row);
          }
        }
        // 单品池：先用 SPU_MAPPING 标准化商品名，再做 GROUP BY
        const normalizedSingleRows = singleRows.map(row => ({
          ...row,
          [productGroupByField]: normalizeSPU(String(row[productGroupByField] ?? "")),
        }));
        const productGroupedResult = computeGroupedTopN(normalizedSingleRows, h, productGroupByField, file.name);
        field.productGroupedTop5 = productGroupedResult.entries;
        field.productGroupByField = productGroupByField;
        // 组合装池：单独统计订单数和金额（不拆分到任何主品）
        // 存入 field 上的临时属性，后面在 mergedCategoryGroupedTop20 里统一写入
        const comboSum = comboRows.reduce((s, row) => {
          const v = Number(row[h]);
          return isNaN(v) ? s : s + v;
        }, 0);
        (field as unknown as Record<string, unknown>)._comboOrderCount = comboRows.length;
        (field as unknown as Record<string, unknown>)._comboOrderSum = comboSum;
      } else if (productGroupByField && productGroupByField === groupByField) {
        // If product field IS the primary groupBy field, reuse groupedTop5 as productGroupedTop5
        field.productGroupedTop5 = field.groupedTop5;
        field.productGroupByField = productGroupByField;
      }
    }

    return field;
  });

  // ── Phase 1：生成 dataQuality 元数据 ──────────────────────────────────────────────
  // 仅当 groupByField 存在时生成（无分组字段的文件不生成）
  let dataQuality: DataQuality | undefined;
  if (groupByField) {
    dataQuality = detectDataQuality(rows, groupByField, representativeGroupedTopN);
  }

  // ── 分类字段全量预计算 ──────────────────────────────────────────────
  // 找到主要数值字段（金额字段，用于计算分类字段的 sum/avg）
  const PRIMARY_AMOUNT_KEYWORDS = ['商品金额', '订单应付金额', '订单金额', '销售额', '金额'];
  const primaryNumericField = (() => {
    // 先找包含金额关键词的数值字段
    for (const kw of PRIMARY_AMOUNT_KEYWORDS) {
      const found = fields.find(f => f.type === 'numeric' && f.name.includes(kw));
      if (found) return found.name;
    }
    // 如果没有，取第一个数值字段
    return fields.find(f => f.type === 'numeric')?.name ?? null;
  })();

  // 排除已作为 groupByField 和 productGroupByField 的字段
  const excludeFromCategory = new Set<string>();
  if (groupByField) excludeFromCategory.add(groupByField);
  if (productGroupByField) excludeFromCategory.add(productGroupByField);

  const categoryGroupedTop20 = computeCategoryStats(
    rows,
    headers,
    headerTypes,
    primaryNumericField,
    excludeFromCategory,
    totalRowCount
  );

  const preview = rows.slice(0, PREVIEW_ROWS);
  const sampleRows = rows.slice(0, SAMPLE_ROWS);

  // P4a：将达人/商品 Top20 合并进 categoryGroupedTop20，让三级匹配逻辑能命中这两个维度
  // groupedTop5 实际存的是 Top20（GROUPED_TOP_N=20），字段名是历史命名残留
  const mergedCategoryGroupedTop20: Record<string, CategoryGroupedEntry[]> = { ...categoryGroupedTop20 };

  // 将达人维度 groupedTop5 合并进去（以 groupByField 为 key）
  if (groupByField) {
    // 取所有数値字段中最主要的那个的 groupedTop5
    const talentField = fields.find(f => f.groupByField === groupByField && f.groupedTop5 && f.groupedTop5.length > 0);
    if (talentField?.groupedTop5 && !mergedCategoryGroupedTop20[groupByField]) {
      mergedCategoryGroupedTop20[groupByField] = talentField.groupedTop5.map(e => ({
        label: e.label,
        count: 0, // groupedTop5 没有行数统计，用 0 占位
        sum: e.sum,
        avg: undefined,
      }));
    }
  }

  // 将商品维度 productGroupedTop5 合并进去（以 productGroupByField 为 key）
  if (productGroupByField) {
    const productField = fields.find(f => f.productGroupByField === productGroupByField && f.productGroupedTop5 && f.productGroupedTop5.length > 0);
    if (productField?.productGroupedTop5 && !mergedCategoryGroupedTop20[productGroupByField]) {
      mergedCategoryGroupedTop20[productGroupByField] = productField.productGroupedTop5.map(e => ({
        label: e.label,
        count: 0,
        sum: e.sum,
        avg: undefined,
      }));
    }
    // P2：组合装订单单独写入，使用稳定 key COMBO_ORDERS_KEY
    // 取主要数値字段中统计到的组合装订单数和金额
    const primaryProductField = fields.find(f =>
      f.productGroupByField === productGroupByField &&
      (f as unknown as Record<string, unknown>)._comboOrderCount !== undefined
    );
    if (primaryProductField) {
      const comboCount = (primaryProductField as unknown as Record<string, unknown>)._comboOrderCount as number;
      const comboSum = (primaryProductField as unknown as Record<string, unknown>)._comboOrderSum as number;
      if (comboCount > 0) {
        mergedCategoryGroupedTop20[COMBO_ORDERS_KEY] = [{
          label: COMBO_ORDERS_DISPLAY,
          count: comboCount,
          sum: comboSum,
          avg: comboCount > 0 ? comboSum / comboCount : 0,
        }];
      }
    }
  }

  return {
    filename: file.name,
    totalRowCount,
    colCount,
    fields,
    preview,
    sampleRows,
    allRows: rows, // 全量行（用于前端导出）
    groupByField: groupByField ?? undefined,
    allGroupByFields: allGroupByFields.length > 0 ? allGroupByFields : undefined,
    dataQuality,
    categoryGroupedTop20: Object.keys(mergedCategoryGroupedTop20).length > 0 ? mergedCategoryGroupedTop20 : undefined,
  };
}