// server/xlsxWorker.ts
import { workerData, parentPort } from "worker_threads";
import * as XLSX from "xlsx";
function parseExcel(buffer, filename) {
  try {
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const sheetNames = workbook.SheetNames;
    const sheet = workbook.Sheets[sheetNames[0]];
    let data = XLSX.utils.sheet_to_json(sheet, {
      defval: null,
      raw: false
    });
    const hasEmptyHeaders = data.length > 0 && Object.keys(data[0]).some((k) => k.startsWith("__EMPTY"));
    if (hasEmptyHeaders) {
      for (let headerRow = 1; headerRow <= 5; headerRow++) {
        const candidate = XLSX.utils.sheet_to_json(
          sheet,
          {
            defval: null,
            raw: false,
            range: headerRow
          }
        );
        if (candidate.length > 0 && !Object.keys(candidate[0]).some((k) => k.startsWith("__EMPTY")) && Object.keys(candidate[0]).some((k) => k.trim() !== "")) {
          data = candidate;
          break;
        }
      }
    }
    data = data.filter(
      (row) => Object.values(row).some(
        (v) => v !== null && v !== void 0 && v !== ""
      )
    );
    return { data, sheetNames };
  } catch (e) {
    return { data: [], sheetNames: [], error: e?.message || "XLSX parse failed" };
  }
}
var input = workerData;
var result = parseExcel(Buffer.from(input.buffer), input.filename);
parentPort?.postMessage(result);
