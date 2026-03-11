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
): GroupedTop5Entry[] {
  const groupSums: Map<string, number> = new Map();
  for (const row of rows) {
    const groupVal = row[groupField];
    const numVal = Number(row[numericField]);
    if (groupVal === null || groupVal === undefined || groupVal === "") continue;
    if (isNaN(numVal)) continue;
    const key = String(groupVal);
    groupSums.set(key, (groupSums.get(key) ?? 0) + numVal);
  }
  // Sort by sum descending, take topN
  const sorted = Array.from(groupSums.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN);
  return sorted.map(([label, sum]) => ({ label, sum, source: sourceFilename }));
}

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
        field.groupedTop5 = computeGroupedTopN(rows, h, groupByField, file.name);
        field.groupByField = groupByField;
      }
    }

    return field;
  });

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
  };
}

