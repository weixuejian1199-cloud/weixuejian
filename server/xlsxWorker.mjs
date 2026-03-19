// server/xlsxWorker.ts
import { workerData, parentPort } from "worker_threads";
import * as XLSX from "xlsx";
var PREVIEW_ROWS = 200;
function parseSheet(sheet) {
  let headerRowIndex = 0;
  const firstPass = XLSX.utils.sheet_to_json(sheet, {
    defval: null,
    raw: false,
    range: 0
  });
  const hasEmptyHeaders = firstPass.length > 0 && Object.keys(firstPass[0]).some((k) => k.startsWith("__EMPTY"));
  if (hasEmptyHeaders) {
    for (let r = 1; r <= 5; r++) {
      const candidate = XLSX.utils.sheet_to_json(sheet, {
        defval: null,
        raw: false,
        range: r
      });
      if (candidate.length > 0 && !Object.keys(candidate[0]).some((k) => k.startsWith("__EMPTY")) && Object.keys(candidate[0]).some((k) => k.trim() !== "")) {
        headerRowIndex = r;
        break;
      }
    }
  }
  const allRows = XLSX.utils.sheet_to_json(sheet, {
    defval: null,
    raw: false,
    range: headerRowIndex
  });
  const cleanRows = allRows.filter(
    (row) => Object.values(row).some((v) => v !== null && v !== void 0 && v !== "")
  );
  const totalRowCount = cleanRows.length;
  if (totalRowCount === 0) {
    return { previewRows: [], columnStats: {}, totalRowCount: 0, columns: [] };
  }
  const columns = Object.keys(cleanRows[0]);
  const statsMap = {};
  for (const col of columns) {
    statsMap[col] = {
      sum: 0,
      min: Infinity,
      max: -Infinity,
      count: 0,
      nullCount: 0,
      uniqueValues: /* @__PURE__ */ new Set(),
      isNumeric: true,
      sample: []
    };
  }
  const previewRows = [];
  for (let i = 0; i < cleanRows.length; i++) {
    const row = cleanRows[i];
    if (i < PREVIEW_ROWS) previewRows.push(row);
    for (const col of columns) {
      const raw = row[col];
      const st = statsMap[col];
      if (raw === null || raw === void 0 || raw === "") {
        st.nullCount++;
        continue;
      }
      st.count++;
      const strVal = String(raw);
      if (st.uniqueValues.size <= 1e4) st.uniqueValues.add(strVal);
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
      sample: st.sample
    };
  }
  return { previewRows, columnStats, totalRowCount, columns };
}
function parseExcel(buffer, filename) {
  const startTime = Date.now();
  try {
    const workbook = XLSX.read(buffer, {
      type: "buffer",
      cellDates: true,
      dense: true
    });
    const sheetNames = workbook.SheetNames;
    const sheets = [];
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
        columnStats
      });
      totalRowCount += sheetRowCount;
    }
    const parseTimeMs = Date.now() - startTime;
    const primarySheet = sheets[0];
    console.log(
      `[Atlas] XLSX \u89E3\u6790\u5B8C\u6210\uFF1A${parseTimeMs}ms\uFF0C${sheetNames.length} \u4E2A sheet\uFF0C\u5171 ${totalRowCount} \u884C` + (sheetNames.length > 1 ? `\uFF08sheets: ${sheetNames.join("\u3001")}\uFF09` : "")
    );
    return {
      data: primarySheet?.preview || [],
      sheetNames,
      sheets,
      totalRowCount,
      columnStats: primarySheet?.columnStats || {},
      parseTimeMs
    };
  } catch (e) {
    return {
      data: [],
      sheetNames: [],
      sheets: [],
      totalRowCount: 0,
      columnStats: {},
      parseTimeMs: Date.now() - startTime,
      error: e?.message || "XLSX \u89E3\u6790\u5931\u8D25"
    };
  }
}
var input = workerData;
var result = parseExcel(Buffer.from(input.buffer), input.filename);
parentPort?.postMessage(result);
