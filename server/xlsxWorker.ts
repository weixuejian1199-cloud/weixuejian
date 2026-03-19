/**
 * XLSX Worker Thread — 内存优化 + 多 Sheet 支持
 *
 * 策略：
 * - 遍历所有 sheet，每个 sheet 都计算统计数据
 * - 每个 sheet 只保留前 200 行用于 AI 分析和预览
 * - columnStats 来自第一个 sheet（向后兼容）
 *
 * 通过 atlas.ts 中的 parseExcelBufferAsync() 调用。
 */

import { workerData, parentPort } from "worker_threads";
import * as XLSX from "xlsx";

interface WorkerInput {
  buffer: ArrayBuffer;
  filename: string;
}

interface ColumnStats {
  sum: number;
  min: number;
  max: number;
  count: number;
  nullCount: number;
  uniqueValues: Set<string>;
  isNumeric: boolean;
  sample: (string | number)[];
}

interface SheetInfo {
  name: string;
  rowCount: number;
  colCount: number;
  columns: string[];
  preview: Record<string, unknown>[];
  columnStats: Record<string, {
    sum: number;
    min: number;
    max: number;
    count: number;
    nullCount: number;
    uniqueCount: number;
    isNumeric: boolean;
    sample: (string | number)[];
  }>;
}

interface WorkerOutput {
  /** 第一个 sheet 的前 200 行（用于 AI 分析和预览） */
  data: Record<string, unknown>[];
  sheetNames: string[];
  /** 所有 sheet 的详细信息 */
  sheets: SheetInfo[];
  /** 所有 sheet 合计行数 */
  totalRowCount: number;
  /** 第一个 sheet 的列统计（向后兼容） */
  columnStats: Record<string, {
    sum: number;
    min: number;
    max: number;
    count: number;
    nullCount: number;
    uniqueCount: number;
    isNumeric: boolean;
    sample: (string | number)[];
  }>;
  parseTimeMs: number;
  error?: string;
}

const PREVIEW_ROWS = 200;

/** 解析单个 sheet，返回预览数据、统计信息 */
function parseSheet(sheet: XLSX.WorkSheet): {
  previewRows: Record<string, unknown>[];
  columnStats: SheetInfo["columnStats"];
  totalRowCount: number;
  columns: string[];
} {
  // 检测真实表头行（跳过空白行）
  let headerRowIndex = 0;
  const firstPass = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: false,
    range: 0,
  });
  const hasEmptyHeaders =
    firstPass.length > 0 &&
    Object.keys(firstPass[0]).some((k) => k.startsWith("__EMPTY"));

  if (hasEmptyHeaders) {
    for (let r = 1; r <= 5; r++) {
      const candidate = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: null,
        raw: false,
        range: r,
      });
      if (
        candidate.length > 0 &&
        !Object.keys(candidate[0]).some((k) => k.startsWith("__EMPTY")) &&
        Object.keys(candidate[0]).some((k) => k.trim() !== "")
      ) {
        headerRowIndex = r;
        break;
      }
    }
  }

  const allRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: false,
    range: headerRowIndex,
  });

  const cleanRows = allRows.filter((row) =>
    Object.values(row).some((v) => v !== null && v !== undefined && v !== "")
  );

  const totalRowCount = cleanRows.length;
  if (totalRowCount === 0) {
    return { previewRows: [], columnStats: {}, totalRowCount: 0, columns: [] };
  }

  const columns = Object.keys(cleanRows[0]);
  const statsMap: Record<string, ColumnStats> = {};
  for (const col of columns) {
    statsMap[col] = {
      sum: 0, min: Infinity, max: -Infinity,
      count: 0, nullCount: 0,
      uniqueValues: new Set(),
      isNumeric: true, sample: [],
    };
  }

  const previewRows: Record<string, unknown>[] = [];
  for (let i = 0; i < cleanRows.length; i++) {
    const row = cleanRows[i];
    if (i < PREVIEW_ROWS) previewRows.push(row);

    for (const col of columns) {
      const raw = row[col];
      const st = statsMap[col];
      if (raw === null || raw === undefined || raw === "") {
        st.nullCount++;
        continue;
      }
      st.count++;
      const strVal = String(raw);
      if (st.uniqueValues.size <= 10000) st.uniqueValues.add(strVal);
      if (st.sample.length < 5) st.sample.push(strVal);
      const num = Number(raw);
      if (!isNaN(num) && isFinite(num)) {
        st.sum += num;
        if (num < st.min) st.min = num;
        if (num > st.max) st.max = num;
      } else {
        st.isNumeric = false;
      }
    }
  }

  const columnStats: SheetInfo["columnStats"] = {};
  for (const col of columns) {
    const st = statsMap[col];
    columnStats[col] = {
      sum: st.isNumeric ? st.sum : 0,
      min: st.isNumeric && st.min !== Infinity ? st.min : 0,
      max: st.isNumeric && st.max !== -Infinity ? st.max : 0,
      count: st.count,
      nullCount: st.nullCount,
      uniqueCount: st.uniqueValues.size,
      isNumeric: st.isNumeric,
      sample: st.sample,
    };
  }

  return { previewRows, columnStats, totalRowCount, columns };
}

function parseExcel(buffer: Buffer, filename: string): WorkerOutput {
  const startTime = Date.now();
  try {
    const workbook = XLSX.read(buffer, {
      type: "buffer",
      cellDates: true,
      dense: true,
    });

    const sheetNames = workbook.SheetNames;
    const sheets: SheetInfo[] = [];
    let totalRowCount = 0;

    for (const sheetName of sheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const { previewRows, columnStats, totalRowCount: sheetRowCount, columns } = parseSheet(sheet);

      sheets.push({
        name: sheetName,
        rowCount: sheetRowCount,
        colCount: columns.length,
        columns,
        preview: previewRows,
        columnStats,
      });

      totalRowCount += sheetRowCount;
    }

    const parseTimeMs = Date.now() - startTime;
    const primarySheet = sheets[0];

    console.log(
      `[Atlas] XLSX 解析完成：${parseTimeMs}ms，${sheetNames.length} 个 sheet，共 ${totalRowCount} 行` +
      (sheetNames.length > 1 ? `（sheets: ${sheetNames.join("、")}）` : "")
    );

    return {
      data: primarySheet?.preview || [],
      sheetNames,
      sheets,
      totalRowCount,
      columnStats: primarySheet?.columnStats || {},
      parseTimeMs,
    };
  } catch (e: any) {
    return {
      data: [],
      sheetNames: [],
      sheets: [],
      totalRowCount: 0,
      columnStats: {},
      parseTimeMs: Date.now() - startTime,
      error: e?.message || "XLSX 解析失败",
    };
  }
}

// Execute and send result back to parent
const input = workerData as WorkerInput;
const result = parseExcel(Buffer.from(input.buffer), input.filename);
parentPort?.postMessage(result);
