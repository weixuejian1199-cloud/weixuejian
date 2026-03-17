// server/xlsxWorker.mjs — Multi-Sheet support
import { workerData, parentPort } from "worker_threads";
import * as XLSX from "xlsx";

var PREVIEW_ROWS = 200;

function parseSheet(sheet, sheetName) {
  let headerRowIndex = 0;
  const firstPass = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false, range: 0 });
  const hasEmptyHeaders = firstPass.length > 0 && Object.keys(firstPass[0]).some((k) => k.startsWith("__EMPTY"));
  if (hasEmptyHeaders) {
    for (let r = 1; r <= 5; r++) {
      const candidate = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false, range: r });
      if (candidate.length > 0 && !Object.keys(candidate[0]).some((k) => k.startsWith("__EMPTY")) && Object.keys(candidate[0]).some((k) => k.trim() !== "")) {
        headerRowIndex = r;
        break;
      }
    }
  }

  const allRows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false, range: headerRowIndex });
  const cleanRows = allRows.filter((row) => Object.values(row).some((v) => v !== null && v !== undefined && v !== ""));
  const totalRowCount = cleanRows.length;

  if (totalRowCount === 0) return { data: [], totalRowCount: 0, columnStats: {} };

  const columns = Object.keys(cleanRows[0]);
  const statsMap = {};
  for (const col of columns) {
    statsMap[col] = { sum: 0, min: Infinity, max: -Infinity, count: 0, nullCount: 0, uniqueValues: new Set(), isNumeric: true, sample: [] };
  }

  const previewRows = [];
  for (let i = 0; i < cleanRows.length; i++) {
    const row = cleanRows[i];
    if (i < PREVIEW_ROWS) previewRows.push(row);
    for (const col of columns) {
      const raw = row[col];
      const st = statsMap[col];
      if (raw === null || raw === undefined || raw === "") { st.nullCount++; continue; }
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

  const columnStats = {};
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

  return { data: previewRows, totalRowCount, columnStats };
}

function parseExcel(buffer, filename) {
  const startTime = Date.now();
  try {
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, dense: true });
    const sheetNames = workbook.SheetNames;

    // Parse all sheets
    const sheets = sheetNames.map((name) => {
      const result = parseSheet(workbook.Sheets[name], name);
      return { name, ...result };
    });

    // Primary sheet = first sheet (for backward compat)
    const primary = sheets[0];

    console.log(`[Atlas] XLSX parse: ${Date.now() - startTime}ms, sheets: ${sheetNames.length}, primary rows: ${primary.totalRowCount}`);

    return {
      // Backward-compat fields (primary sheet)
      data: primary.data,
      sheetNames,
      totalRowCount: primary.totalRowCount,
      columnStats: primary.columnStats,
      parseTimeMs: Date.now() - startTime,
      // New: all sheets
      sheets,
    };
  } catch (e) {
    return {
      data: [], sheetNames: [], totalRowCount: 0, columnStats: {},
      parseTimeMs: Date.now() - startTime,
      sheets: [],
      error: e?.message || "XLSX parse failed",
    };
  }
}

var input = workerData;
var result = parseExcel(Buffer.from(input.buffer), input.filename);
parentPort?.postMessage(result);
