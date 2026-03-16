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

// Category grouped entry: for categorical fields (省份/支付方式/城市/状态 etc.)
// count = number of rows in this category
// sum = sum of the primary numeric field for this category (if available)
// avg = avg of the primary numeric field for this category (if available)
export interface CategoryGroupedEntry {
  label: string;   // category value (e.g. "山东", "抗音支付")
  count: number;   // row count in this category
  sum?: number;    // sum of primary numeric field (optional)
  avg?: number;    // avg of primary numeric field (optional)
  // 修复项 C：结构化字段元数据（仅在数组第一个元素中存在，用于导出匹配）
  fieldName?: string;    // 原始字段名（如「收货省份」），辅助信息
  categoryKey?: string;  // 标准化 key（如 "province"），用于导出强绑定
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
// 修复 #1: 提高阈值，让绝大多数文件走内联路径
const MAX_FULL_ROWS_INLINE = 50_000; // 5 万行以内约 5-10MB JSON
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

/**
 * 修复项 C：字段名关键词 → 标准 category_key 映射表
 * 用于为分类字段分配结构化 key，让前端导出能精确匹配，不依赖 AI 文案命名
 * 匹配顺序：按数组顺序逐个检查，第一个命中的关键词决定 key
 */
const CATEGORY_KEY_MAP: Array<{ keywords: string[]; key: string }> = [
  { keywords: ["省", "省份"], key: "province" },
  { keywords: ["城市", "市"], key: "city" },
  { keywords: ["地区", "区域", "地域"], key: "region" },
  { keywords: ["国家"], key: "country" },
  { keywords: ["支付", "付款", "结算"], key: "payment_method" },
  { keywords: ["订单状态", "订单类型"], key: "order_status" },
  { keywords: ["状态"], key: "status" },
  { keywords: ["类型"], key: "type" },
  { keywords: ["类别", "品类", "分类"], key: "category" },
  { keywords: ["渠道"], key: "channel" },
  { keywords: ["来源"], key: "source" },
  { keywords: ["平台"], key: "platform" },
  { keywords: ["门店"], key: "store" },
  { keywords: ["仓库", "仓"], key: "warehouse" },
  { keywords: ["等级", "级别"], key: "level" },
  { keywords: ["性别"], key: "gender" },
  { keywords: ["标签"], key: "tag" },
  { keywords: ["行业"], key: "industry" },
  { keywords: ["部门"], key: "department" },
  { keywords: ["岗位", "职位"], key: "position" },
];

/**
 * 修复项 C：根据字段名分配标准 category_key
 * 匹配失败时返回 "field__{fieldName}"（确保唯一性）
 */
function getCategoryKey(fieldName: string): string {
  for (const { keywords, key } of CATEGORY_KEY_MAP) {
    if (keywords.some(kw => fieldName.includes(kw))) return key;
  }
  // 匹配失败：使用字段名本身作为 key（加前缀避免与标准 key 冲突）
  return `field__${fieldName}`;
}

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

    // 修复项 C：分配标准 category_key，用于前端导出强绑定
    const categoryKey = getCategoryKey(h);
    // 使用 category_key 作为 result 的 key，同一 key 可能对应多个字段（如多个包含「省」的字段）
    // 如果已存在相同 key，附加字段名区分
    const resultKey = result[categoryKey] ? `${categoryKey}__${h}` : categoryKey;

    result[resultKey] = sorted.map(([label, count], idx) => {
      const entry: CategoryGroupedEntry = { label, count };
      if (primaryNumericField && sumMap.has(label)) {
        entry.sum = sumMap.get(label)!;
        entry.avg = entry.sum / count;
      }
      // 修复项 C：在第一个 entry 中注入字段元数据（前端导出匹配用）
      if (idx === 0) {
        entry.fieldName = h;         // 原始字段名（如「收货省份」）
        entry.categoryKey = resultKey; // 实际使用的 key
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
        if (field.null_count !== undefined) {
          existing.null_count += field.null_count;
        }
        // Recalculate avg from merged sum and non-null count
        if (existing.sum !== undefined) {
          const nonNullCount = deduplicatedRows.length - existing.null_count;
          existing.avg = nonNullCount > 0 ? existing.sum / nonNullCount : 0;
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

  // ── 修复项 A：过滤全空行，与服务端 atlas.ts 第248行逻辑对齐 ──
  // 全空行（如文件末尾空白行、中间分隔行）会导致 totalRowCount 虚高，
  // 使 categoryGroupedTop20 的 count 校验失效。
  const rawRowCount = rows.length; // 过滤前原始行数，用于行数差异日志
  rows = rows.filter(row =>
    Object.values(row).some(v => v !== null && v !== undefined && v !== "")
  );
  const filteredCount = rawRowCount - rows.length;
  if (filteredCount > 0) {
    console.info(
      `[ATLAS 空行过滤] ${file.name}: 原始 ${rawRowCount} 行，过滤 ${filteredCount} 个全空行，有效行数 ${rows.length}`
    );
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
      allRows: [],
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
      // Product-dimension groupedTop5: GROUP BY 选购商品, SUM numeric field, TOP20
      // Only compute if productGroupByField is different from the primary groupByField
      if (productGroupByField && productGroupByField !== groupByField) {
        const productGroupedResult = computeGroupedTopN(rows, h, productGroupByField, file.name);
        field.productGroupedTop5 = productGroupedResult.entries;
        field.productGroupByField = productGroupByField;
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

  // 修复项 B：分流规则
  // ≤ 50000 行：内联传输全量数据，服务端直接存 S3（替代 preview 作为业务真源）
  // > 50000 行：不内联，避免 JSON body 超出部署层反向代理限制（HTTP 413）
  //   全量 rows 存入 _allRowsRef，前端通过 upload-rows 分批上传到服务端
  //   全量统计（sum/avg/max/min/groupedTop5/categoryGroupedTop20）仍来自前端预计算，准确性不受影响
  const inlineRowLimit = MAX_FULL_ROWS_INLINE;
  const allRows: Record<string, unknown>[] | undefined =
    totalRowCount <= inlineRowLimit ? rows : undefined;

  if (totalRowCount > inlineRowLimit) {
    console.info(
      `[ATLAS 分流] ${file.name}: 行数 ${totalRowCount} > ${inlineRowLimit}，内联跳过，将通过 upload-rows 分批上传全量数据`
    );
  }

  const result: ParsedFileData = {
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
    categoryGroupedTop20: Object.keys(categoryGroupedTop20).length > 0 ? categoryGroupedTop20 : undefined,
  };

  // 大文件：将全量 rows 存入 _allRowsRef，供前端分批上传使用
  // （不内联到 upload-parsed，避免 HTTP 413）
  if (totalRowCount > inlineRowLimit) {
    (result as any)._allRowsRef = rows;
  }

  return result;
}