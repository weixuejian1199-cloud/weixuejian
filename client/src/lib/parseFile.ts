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
  // top5: value-descending, each entry is { value, rowIndex } — from full dataset
  top5?: Array<{ value: number; rowIndex: number }>;
}

export interface ParsedFileData {
  filename: string;
  totalRowCount: number;
  colCount: number;
  fields: ParsedField[];
  preview: Record<string, unknown>[]; // first 500 rows
  sampleRows: Record<string, unknown>[]; // first 20 rows for AI prompt
}

const PREVIEW_ROWS = 500;
const SAMPLE_ROWS = 20;

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
  const fields: ParsedField[] = headers.map((h) => {
    const sampleVals = sampleForType.map((r) => r[h]);
    const type = detectType(sampleVals);
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
      // top5 sorted descending by value (full dataset)
      field.top5 = [...stat.top5Heap].sort((a, b) => b.value - a.value);
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
  };
}
