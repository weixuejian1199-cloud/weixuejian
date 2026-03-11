/**
 * XLSX Worker Thread
 * Runs XLSX.read() in a separate thread so the main event loop is never blocked.
 * Called via parseExcelBufferAsync() in atlas.ts.
 */

import { workerData, parentPort } from "worker_threads";
import * as XLSX from "xlsx";

interface WorkerInput {
  buffer: Buffer;
  filename: string;
}

interface FieldInfo {
  name: string;
  type: "numeric" | "text" | "datetime";
  dtype: string;
  null_count: number;
  unique_count: number;
  sample: (string | number)[];
}

interface WorkerOutput {
  data: Record<string, unknown>[];
  sheetNames: string[];
  error?: string;
}

function parseExcel(buffer: Buffer, filename: string): WorkerOutput {
  try {
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const sheetNames = workbook.SheetNames;
    const sheet = workbook.Sheets[sheetNames[0]];

    // First pass: try default parsing (header row = row 1)
    let data = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: null,
      raw: false,
    });

    // Detect __EMPTY columns — means the real header is not on row 1
    const hasEmptyHeaders =
      data.length > 0 &&
      Object.keys(data[0]).some((k) => k.startsWith("__EMPTY"));

    if (hasEmptyHeaders) {
      for (let headerRow = 1; headerRow <= 5; headerRow++) {
        const candidate = XLSX.utils.sheet_to_json<Record<string, unknown>>(
          sheet,
          {
            defval: null,
            raw: false,
            range: headerRow,
          }
        );
        if (
          candidate.length > 0 &&
          !Object.keys(candidate[0]).some((k) => k.startsWith("__EMPTY")) &&
          Object.keys(candidate[0]).some((k) => k.trim() !== "")
        ) {
          data = candidate;
          break;
        }
      }
    }

    // Clean up blank separator rows
    data = data.filter((row) =>
      Object.values(row).some(
        (v) => v !== null && v !== undefined && v !== ""
      )
    );

    return { data, sheetNames };
  } catch (e: any) {
    return { data: [], sheetNames: [], error: e?.message || "XLSX parse failed" };
  }
}

// Execute and send result back to parent
const input = workerData as WorkerInput;
const result = parseExcel(Buffer.from(input.buffer), input.filename);
parentPort?.postMessage(result);
