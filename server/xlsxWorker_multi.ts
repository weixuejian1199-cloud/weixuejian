/**
 * XLSX Worker Thread — Multi-Sheet Support
 * 
 * 支持识别 Excel 中的多个表格（sheet）
 */

import { workerData, parentPort } from "worker_threads";
import * as XLSX from "xlsx";

interface SheetInfo {
  name: string;
  rowCount: number;
  colCount: number;
  columns: string[];
  preview: Record<string, unknown>[];
  sampleRows: Record<string, unknown>[];
}

interface WorkerOutput {
  data: Record<string, unknown>[];  // First sheet preview
  sheetNames: string[];
  sheets: SheetInfo[];  // All sheets info
  totalRowCount: number;
  parseTimeMs: number;
  error?: string;
}

const PREVIEW_ROWS = 200;
const SAMPLE_ROWS = 20;

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
    
    // 处理所有 sheet
    for (const sheetName of sheetNames) {
      const sheet = workbook.Sheets[sheetName];
      
      // 检测表头行
      let headerRowIndex = 0;
      const firstPass = XLSX.utils.sheet_to_json(sheet, {
        defval: null,
        raw: false,
        range: 0,
      });
      
      const hasEmptyHeaders = firstPass.length > 0 && 
        Object.keys(firstPass[0]).some(k => k.startsWith("__EMPTY"));
      
      if (hasEmptyHeaders) {
        for (let r = 1; r <= 5; r++) {
          const candidate = XLSX.utils.sheet_to_json(sheet, {
            defval: null,
            raw: false,
            range: r,
          });
          if (candidate.length > 0 && 
              !Object.keys(candidate[0]).some(k => k.startsWith("__EMPTY"))) {
            headerRowIndex = r;
            break;
          }
        }
      }
      
      // 读取数据
      const allRows = XLSX.utils.sheet_to_json(sheet, {
        defval: null,
        raw: false,
        range: headerRowIndex,
      });
      
      const cleanRows = allRows.filter(row =>
        Object.values(row).some(v => v !== null && v !== undefined && v !== "")
      );
      
      const columns = cleanRows.length > 0 ? Object.keys(cleanRows[0]) : [];
      
      sheets.push({
        name: sheetName,
        rowCount: cleanRows.length,
        colCount: columns.length,
        columns,
        preview: cleanRows.slice(0, PREVIEW_ROWS),
        sampleRows: cleanRows.slice(0, SAMPLE_ROWS),
      });
      
      totalRowCount += cleanRows.length;
    }
    
    console.log(`[XLSX] 多表格解析完成：${sheetNames.length}个表，共${totalRowCount}行`);
    
    return {
      data: sheets[0]?.preview || [],
      sheetNames,
      sheets,
      totalRowCount,
      parseTimeMs: Date.now() - startTime,
    };
  } catch (e: any) {
    return {
      data: [],
      sheetNames: [],
      sheets: [],
      totalRowCount: 0,
      parseTimeMs: Date.now() - startTime,
      error: e?.message || "XLSX parse failed",
    };
  }
}

const input = workerData as WorkerInput;
const result = parseExcel(Buffer.from(input.buffer), input.filename);
parentPort?.postMessage(result);
