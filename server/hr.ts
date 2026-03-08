/**
 * ATLAS HR Module — Payslip & Attendance API Routes
 * ──────────────────────────────────────────────────
 * POST /api/hr/payslip/upload    — Upload salary Excel, auto-detect fields
 * POST /api/hr/payslip/generate  — Generate formatted payslip Excel with tax calc
 * GET  /api/hr/payslip/download/:id — Download payslip Excel from S3
 * POST /api/hr/attendance/upload — Upload attendance Excel, auto-detect fields
 * POST /api/hr/attendance/analyze — Analyze attendance, generate summary report
 * GET  /api/hr/attendance/download/:id — Download attendance report from S3
 */

import type { Express, Request, Response } from "express";
import multer from "multer";
import { nanoid } from "nanoid";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { ENV } from "./_core/env";
import { createPatchedFetch } from "./_core/patchedFetch";
import { storagePut, storageGet } from "./storage";
import {
  createHrPayslip, updateHrPayslip, getHrPayslip,
  createHrAttendance, updateHrAttendance, getHrAttendance,
} from "./db";

// ── LLM ──────────────────────────────────────────────────────────────────────

function createLLM() {
  const baseURL = ENV.forgeApiUrl.endsWith("/v1")
    ? ENV.forgeApiUrl
    : `${ENV.forgeApiUrl}/v1`;
  return createOpenAI({
    baseURL,
    apiKey: ENV.forgeApiKey,
    fetch: createPatchedFetch(fetch),
  });
}

// ── Multer ────────────────────────────────────────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = file.originalname.split(".").pop()?.toLowerCase();
    if (["xlsx", "xls", "csv"].includes(ext || "")) cb(null, true);
    else cb(new Error(`不支持的文件格式: ${ext}`));
  },
});

// ── Excel/CSV parsing ─────────────────────────────────────────────────────────

function parseFile(buffer: Buffer, filename: string): Record<string, unknown>[] {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "csv") {
    const text = buffer.toString("utf-8");
    const result = Papa.parse<Record<string, unknown>>(text, {
      header: true, skipEmptyLines: true, dynamicTyping: true,
    });
    return result.data;
  }
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null, raw: false });
}

// ── 2024 China Individual Income Tax Calculator ───────────────────────────────
// Monthly tax: progressive rates on (taxable income - 5000 threshold)

interface TaxResult {
  grossSalary: number;   // 应发工资
  insurance: number;     // 五险一金（个人部分）
  taxableIncome: number; // 应纳税所得额 = 应发 - 五险一金 - 5000起征点
  incomeTax: number;     // 个税
  netSalary: number;     // 实发工资
}

const TAX_BRACKETS = [
  { limit: 3000,  rate: 0.03, deduction: 0 },
  { limit: 12000, rate: 0.10, deduction: 210 },
  { limit: 25000, rate: 0.20, deduction: 1410 },
  { limit: 35000, rate: 0.25, deduction: 2660 },
  { limit: 55000, rate: 0.30, deduction: 4410 },
  { limit: 80000, rate: 0.35, deduction: 7160 },
  { limit: Infinity, rate: 0.45, deduction: 15160 },
];

export function calcTax(opts: {
  grossSalary: number;
  bonus?: number;
  insurance?: number; // if not provided, estimate as 10.5% of gross
}): TaxResult {
  const gross = Math.max(0, opts.grossSalary + (opts.bonus ?? 0));
  // Estimate insurance if not provided: 养老8% + 医疗2% + 失业0.5% = 10.5%
  const insurance = opts.insurance !== undefined
    ? Math.max(0, opts.insurance)
    : Math.round(gross * 0.105);
  const threshold = 5000;
  const taxableIncome = Math.max(0, gross - insurance - threshold);

  let incomeTax = 0;
  for (const bracket of TAX_BRACKETS) {
    if (taxableIncome <= bracket.limit) {
      incomeTax = Math.round(taxableIncome * bracket.rate - bracket.deduction);
      break;
    }
  }
  incomeTax = Math.max(0, incomeTax);
  const netSalary = Math.round(gross - insurance - incomeTax);

  return { grossSalary: gross, insurance, taxableIncome, incomeTax, netSalary };
}

// ── AI field detection ────────────────────────────────────────────────────────

async function detectPayslipFields(headers: string[]): Promise<{
  nameCol: string; emailCol: string; baseSalaryCol: string;
  bonusCol: string; deductionCol: string; insuranceCol: string; deptCol: string;
}> {
  const openai = createLLM();
  const prompt = `以下是工资表的列名，请识别每个字段对应哪一列（返回列名原文，找不到返回空字符串）：
列名列表：${headers.join("、")}

需要识别：
- nameCol: 员工姓名列
- emailCol: 邮箱列
- baseSalaryCol: 基本工资/底薪列
- bonusCol: 奖金/绩效/提成列
- deductionCol: 扣款/罚款列
- insuranceCol: 五险一金/社保列（个人部分）
- deptCol: 部门列

只返回JSON，格式：{"nameCol":"","emailCol":"","baseSalaryCol":"","bonusCol":"","deductionCol":"","insuranceCol":"","deptCol":""}`;

  try {
    const result = await generateText({
      model: openai.chat("gemini-2.5-flash"),
      messages: [{ role: "user", content: prompt }],
    });
    const json = result.text.match(/\{[\s\S]*\}/)?.[0];
    if (json) return JSON.parse(json);
  } catch (e) {
    console.warn("[HR] Field detection failed:", e);
  }
  // Fallback: simple keyword matching
  const find = (keywords: string[]) =>
    headers.find(h => keywords.some(k => h.toLowerCase().includes(k))) ?? "";
  return {
    nameCol: find(["姓名", "name", "员工"]),
    emailCol: find(["邮箱", "email", "mail"]),
    baseSalaryCol: find(["基本工资", "底薪", "基础工资", "base"]),
    bonusCol: find(["奖金", "绩效", "提成", "bonus"]),
    deductionCol: find(["扣款", "罚款", "扣除", "deduct"]),
    insuranceCol: find(["五险", "社保", "insurance", "公积金"]),
    deptCol: find(["部门", "dept", "department"]),
  };
}

async function detectAttendanceFields(headers: string[]): Promise<{
  nameCol: string; dateCol: string; checkInCol: string;
  checkOutCol: string; deptCol: string; statusCol: string;
}> {
  const openai = createLLM();
  const prompt = `以下是考勤表的列名，请识别每个字段对应哪一列（返回列名原文，找不到返回空字符串）：
列名列表：${headers.join("、")}

需要识别：
- nameCol: 员工姓名列
- dateCol: 日期列
- checkInCol: 上班打卡/签到时间列
- checkOutCol: 下班打卡/签退时间列
- deptCol: 部门列
- statusCol: 考勤状态列（正常/迟到/旷工等，如有）

只返回JSON，格式：{"nameCol":"","dateCol":"","checkInCol":"","checkOutCol":"","deptCol":"","statusCol":""}`;

  try {
    const result = await generateText({
      model: openai.chat("gemini-2.5-flash"),
      messages: [{ role: "user", content: prompt }],
    });
    const json = result.text.match(/\{[\s\S]*\}/)?.[0];
    if (json) return JSON.parse(json);
  } catch (e) {
    console.warn("[HR] Attendance field detection failed:", e);
  }
  const find = (keywords: string[]) =>
    headers.find(h => keywords.some(k => h.toLowerCase().includes(k))) ?? "";
  return {
    nameCol: find(["姓名", "name", "员工"]),
    dateCol: find(["日期", "date", "时间"]),
    checkInCol: find(["上班", "签到", "打卡", "check_in", "checkin", "上班时间"]),
    checkOutCol: find(["下班", "签退", "check_out", "checkout", "下班时间"]),
    deptCol: find(["部门", "dept"]),
    statusCol: find(["状态", "status", "考勤"]),
  };
}

// ── Attendance analysis ───────────────────────────────────────────────────────

interface AttendanceRecord {
  name: string;
  date: string;
  checkIn: string;
  checkOut: string;
  dept: string;
  status: string; // 'normal' | 'late' | 'absent' | 'early_leave'
  lateMinutes: number;
  overtimeMinutes: number;
}

function analyzeAttendance(
  data: Record<string, unknown>[],
  fieldMap: { nameCol: string; dateCol: string; checkInCol: string; checkOutCol: string; deptCol: string; statusCol: string },
  workStartHour = 9,   // 9:00 AM
  workEndHour = 18,    // 6:00 PM
  lateThresholdMin = 15, // 15 min grace period
): {
  records: AttendanceRecord[];
  summary: {
    totalEmployees: number;
    totalDays: number;
    attendanceRate: number;
    lateCount: number;
    absentCount: number;
    earlyLeaveCount: number;
    overtimeHours: number;
  };
  byEmployee: Record<string, {
    name: string; dept: string; presentDays: number; lateDays: number;
    absentDays: number; earlyLeaveDays: number; overtimeHours: number;
  }>;
} {
  const records: AttendanceRecord[] = [];
  const byEmployee: Record<string, {
    name: string; dept: string; presentDays: number; lateDays: number;
    absentDays: number; earlyLeaveDays: number; overtimeHours: number;
  }> = {};

  for (const row of data) {
    const name = String(row[fieldMap.nameCol] ?? "").trim();
    if (!name) continue;

    const date = String(row[fieldMap.dateCol] ?? "").trim();
    const checkIn = String(row[fieldMap.checkInCol] ?? "").trim();
    const checkOut = String(row[fieldMap.checkOutCol] ?? "").trim();
    const dept = String(row[fieldMap.deptCol] ?? "").trim();
    const rawStatus = String(row[fieldMap.statusCol] ?? "").trim();

    // Parse time HH:MM or HH:MM:SS
    const parseTime = (t: string): number | null => {
      const m = t.match(/(\d{1,2}):(\d{2})/);
      if (!m) return null;
      return parseInt(m[1]) * 60 + parseInt(m[2]);
    };

    let status = "normal";
    let lateMinutes = 0;
    let overtimeMinutes = 0;

    // If status column exists and has explicit value, use it
    if (rawStatus && ["旷工", "缺勤", "absent"].some(k => rawStatus.includes(k))) {
      status = "absent";
    } else if (rawStatus && ["迟到", "late"].some(k => rawStatus.includes(k))) {
      status = "late";
    } else if (checkIn) {
      const inMin = parseTime(checkIn);
      const outMin = checkOut ? parseTime(checkOut) : null;
      const workStart = workStartHour * 60;
      const workEnd = workEndHour * 60;

      if (inMin !== null && inMin > workStart + lateThresholdMin) {
        status = "late";
        lateMinutes = inMin - workStart;
      }
      if (outMin !== null && outMin < workEnd - 5) {
        status = status === "late" ? "late" : "early_leave";
      }
      if (outMin !== null && outMin > workEnd + 30) {
        overtimeMinutes = outMin - workEnd;
      }
    } else if (!checkIn && !rawStatus) {
      status = "absent";
    }

    records.push({ name, date, checkIn, checkOut, dept, status, lateMinutes, overtimeMinutes });

    if (!byEmployee[name]) {
      byEmployee[name] = { name, dept, presentDays: 0, lateDays: 0, absentDays: 0, earlyLeaveDays: 0, overtimeHours: 0 };
    }
    const emp = byEmployee[name];
    if (status === "absent") emp.absentDays++;
    else {
      emp.presentDays++;
      if (status === "late") emp.lateDays++;
      if (status === "early_leave") emp.earlyLeaveDays++;
    }
    emp.overtimeHours += overtimeMinutes / 60;
  }

  const totalEmployees = Object.keys(byEmployee).length;
  const totalDays = records.length;
  const absentCount = records.filter(r => r.status === "absent").length;
  const lateCount = records.filter(r => r.status === "late").length;
  const earlyLeaveCount = records.filter(r => r.status === "early_leave").length;
  const overtimeHours = records.reduce((s, r) => s + r.overtimeMinutes / 60, 0);
  const attendanceRate = totalDays > 0 ? Math.round(((totalDays - absentCount) / totalDays) * 100) : 0;

  return {
    records,
    summary: { totalEmployees, totalDays, attendanceRate, lateCount, absentCount, earlyLeaveCount, overtimeHours: Math.round(overtimeHours * 10) / 10 },
    byEmployee,
  };
}

// ── Generate payslip Excel ────────────────────────────────────────────────────

function generatePayslipExcel(employees: Array<{
  name: string; dept: string; baseSalary: number; bonus: number;
  deduction: number; insurance: number; tax: TaxResult;
}>): Buffer {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Summary
  const summaryHeaders = ["姓名", "部门", "应发工资", "奖金/绩效", "扣款", "五险一金", "应纳税所得额", "个人所得税", "实发工资"];
  const summaryRows = employees.map(e => [
    e.name, e.dept,
    e.tax.grossSalary, e.bonus, e.deduction, e.tax.insurance,
    e.tax.taxableIncome, e.tax.incomeTax, e.tax.netSalary,
  ]);

  const summaryData = [summaryHeaders, ...summaryRows];
  const ws1 = XLSX.utils.aoa_to_sheet(summaryData);

  // Style header row
  const range1 = XLSX.utils.decode_range(ws1["!ref"] || "A1");
  for (let c = range1.s.c; c <= range1.e.c; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    if (ws1[addr]) {
      ws1[addr].s = {
        font: { bold: true, color: { rgb: "FFFFFF" } },
        fill: { fgColor: { rgb: "1E3A5F" } },
        alignment: { horizontal: "center" },
      };
    }
  }
  // Number format for salary columns
  for (let r = 1; r <= summaryRows.length; r++) {
    for (let c = 2; c <= 8; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (ws1[addr]) ws1[addr].z = "#,##0.00";
    }
  }
  ws1["!cols"] = summaryHeaders.map((h, i) => ({ wch: i === 0 ? 10 : i === 1 ? 10 : 14 }));
  XLSX.utils.book_append_sheet(wb, ws1, "工资汇总");

  // Sheet 2: Individual payslips (one per employee, stacked vertically)
  const slipRows: (string | number)[][] = [];
  for (const e of employees) {
    slipRows.push([`员工工资条 — ${e.name}`, "", "", ""]);
    slipRows.push(["项目", "金额（元）", "项目", "金额（元）"]);
    slipRows.push(["基本工资", e.baseSalary, "五险一金（个人）", e.tax.insurance]);
    slipRows.push(["奖金/绩效", e.bonus, "个人所得税", e.tax.incomeTax]);
    slipRows.push(["扣款", e.deduction, "应纳税所得额", e.tax.taxableIncome]);
    slipRows.push(["应发工资", e.tax.grossSalary, "实发工资", e.tax.netSalary]);
    slipRows.push(["", "", "", ""]);
    slipRows.push(["", "", "", ""]);
  }
  const ws2 = XLSX.utils.aoa_to_sheet(slipRows);
  ws2["!cols"] = [{ wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws2, "个人工资条");

  // Sheet 3: Tax details
  const taxHeaders = ["姓名", "应发工资", "五险一金", "起征点", "应纳税所得额", "适用税率", "个税", "实发工资"];
  const taxRows = employees.map(e => {
    const bracket = TAX_BRACKETS.find(b => e.tax.taxableIncome <= b.limit) || TAX_BRACKETS[TAX_BRACKETS.length - 1];
    return [
      e.name, e.tax.grossSalary, e.tax.insurance, 5000,
      e.tax.taxableIncome, `${(bracket.rate * 100).toFixed(0)}%`,
      e.tax.incomeTax, e.tax.netSalary,
    ];
  });
  const ws3 = XLSX.utils.aoa_to_sheet([taxHeaders, ...taxRows]);
  const range3 = XLSX.utils.decode_range(ws3["!ref"] || "A1");
  for (let c = range3.s.c; c <= range3.e.c; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    if (ws3[addr]) ws3[addr].s = { font: { bold: true }, fill: { fgColor: { rgb: "E8F4FD" } } };
  }
  ws3["!cols"] = taxHeaders.map(() => ({ wch: 14 }));
  XLSX.utils.book_append_sheet(wb, ws3, "个税明细");

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

// ── Generate attendance Excel ─────────────────────────────────────────────────

function generateAttendanceExcel(
  byEmployee: Record<string, { name: string; dept: string; presentDays: number; lateDays: number; absentDays: number; earlyLeaveDays: number; overtimeHours: number }>,
  records: AttendanceRecord[],
  summary: { totalEmployees: number; totalDays: number; attendanceRate: number; lateCount: number; absentCount: number; earlyLeaveCount: number; overtimeHours: number },
): Buffer {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Summary by employee
  const sumHeaders = ["姓名", "部门", "出勤天数", "迟到次数", "旷工天数", "早退次数", "加班小时", "出勤率"];
  const employees = Object.values(byEmployee);
  const totalWorkDays = employees.length > 0
    ? Math.max(...employees.map(e => e.presentDays + e.absentDays))
    : 0;
  const sumRows = employees.map(e => {
    const total = e.presentDays + e.absentDays;
    const rate = total > 0 ? `${Math.round((e.presentDays / total) * 100)}%` : "0%";
    return [e.name, e.dept, e.presentDays, e.lateDays, e.absentDays, e.earlyLeaveDays, Math.round(e.overtimeHours * 10) / 10, rate];
  });
  const ws1 = XLSX.utils.aoa_to_sheet([sumHeaders, ...sumRows]);
  const r1 = XLSX.utils.decode_range(ws1["!ref"] || "A1");
  for (let c = r1.s.c; c <= r1.e.c; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    if (ws1[addr]) ws1[addr].s = { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "1E3A5F" } } };
  }
  ws1["!cols"] = sumHeaders.map(() => ({ wch: 12 }));
  XLSX.utils.book_append_sheet(wb, ws1, "考勤汇总");

  // Sheet 2: Anomaly details (late / absent / early leave)
  const anomalies = records.filter(r => r.status !== "normal");
  const anomHeaders = ["姓名", "部门", "日期", "上班时间", "下班时间", "状态", "迟到分钟", "加班小时"];
  const statusLabel: Record<string, string> = { late: "迟到", absent: "旷工", early_leave: "早退", normal: "正常" };
  const anomRows = anomalies.map(r => [
    r.name, r.dept, r.date, r.checkIn, r.checkOut,
    statusLabel[r.status] || r.status,
    r.lateMinutes || "", r.overtimeMinutes > 0 ? Math.round(r.overtimeMinutes / 60 * 10) / 10 : "",
  ]);
  const ws2 = XLSX.utils.aoa_to_sheet([anomHeaders, ...anomRows]);
  ws2["!cols"] = anomHeaders.map(() => ({ wch: 12 }));
  XLSX.utils.book_append_sheet(wb, ws2, "异常明细");

  // Sheet 3: Overall stats
  const statsData = [
    ["考勤统计概览", ""],
    ["总人数", summary.totalEmployees],
    ["总记录数", summary.totalDays],
    ["出勤率", `${summary.attendanceRate}%`],
    ["迟到次数", summary.lateCount],
    ["旷工次数", summary.absentCount],
    ["早退次数", summary.earlyLeaveCount],
    ["总加班小时", summary.overtimeHours],
  ];
  const ws3 = XLSX.utils.aoa_to_sheet(statsData);
  ws3["!cols"] = [{ wch: 16 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws3, "统计概览");

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

// ── Register HR routes ────────────────────────────────────────────────────────

export function registerHrRoutes(app: Express) {

  // ── POST /api/hr/payslip/upload ──────────────────────────────────────────

  app.post("/api/hr/payslip/upload", upload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
      const { originalname, buffer, mimetype } = req.file;
      const ext = originalname.split(".").pop()?.toLowerCase() || "xlsx";

      // Upload to S3
      const id = nanoid();
      const fileKey = `hr-payslip-uploads/${id}.${ext}`;
      const { url: fileUrl } = await storagePut(fileKey, buffer, mimetype);

      // Parse data
      const data = parseFile(buffer, originalname);
      if (data.length === 0) { res.status(400).json({ error: "文件为空或格式不正确" }); return; }

      const headers = Object.keys(data[0]);
      const fieldMap = await detectPayslipFields(headers);

      // Preview: first 5 rows
      const preview = data.slice(0, 5);

      // Save to DB
      const userId = (req as any).userId || 0;
      await createHrPayslip({
        id,
        userId,
        filename: originalname,
        fileKey,
        fileUrl,
        fileSizeKb: Math.ceil(buffer.length / 1024),
        employeeCount: data.length,
        fieldMap: fieldMap as any,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        status: "ready",
      });

      res.json({ id, headers, fieldMap, preview, employeeCount: data.length });
    } catch (err: any) {
      console.error("[HR] Payslip upload error:", err);
      res.status(500).json({ error: err.message || "Upload failed" });
    }
  });

  // ── POST /api/hr/payslip/generate ────────────────────────────────────────

  app.post("/api/hr/payslip/generate", async (req: Request, res: Response) => {
    try {
      const { id, fieldMap, period } = req.body as {
        id: string;
        fieldMap: { nameCol: string; emailCol: string; baseSalaryCol: string; bonusCol: string; deductionCol: string; insuranceCol: string; deptCol: string };
        period?: string;
      };

      const record = await getHrPayslip(id);
      if (!record || !record.fileKey) { res.status(404).json({ error: "记录不存在或已过期" }); return; }

      // Load file from S3
      const { url } = await storageGet(record.fileKey);
      const fileRes = await fetch(url);
      if (!fileRes.ok) { res.status(404).json({ error: "文件已过期，请重新上传" }); return; }
      const arrayBuf = await fileRes.arrayBuffer();
      const data = parseFile(Buffer.from(arrayBuf), record.filename);

      // Process each employee
      const employees = data.map(row => {
        const name = String(row[fieldMap.nameCol] ?? "").trim();
        const dept = String(row[fieldMap.deptCol] ?? "").trim();
        const baseSalary = parseFloat(String(row[fieldMap.baseSalaryCol] ?? "0")) || 0;
        const bonus = parseFloat(String(row[fieldMap.bonusCol] ?? "0")) || 0;
        const deduction = parseFloat(String(row[fieldMap.deductionCol] ?? "0")) || 0;
        const insurance = fieldMap.insuranceCol
          ? parseFloat(String(row[fieldMap.insuranceCol] ?? "")) || undefined
          : undefined;
        const email = String(row[fieldMap.emailCol] ?? "").trim();

        const grossSalary = baseSalary + bonus - deduction;
        const tax = calcTax({ grossSalary, insurance });

        return { name, dept, email, baseSalary, bonus, deduction, insurance: tax.insurance, tax };
      }).filter(e => e.name);

      if (employees.length === 0) { res.status(400).json({ error: "未找到有效员工数据，请检查字段映射" }); return; }

      // Generate Excel
      const excelBuffer = generatePayslipExcel(employees);

      // Upload to S3
      const reportKey = `hr-payslip-reports/${id}-${Date.now()}.xlsx`;
      const { url: reportUrl } = await storagePut(reportKey, excelBuffer, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

      // Summary stats
      const totalPayroll = employees.reduce((s, e) => s + e.tax.grossSalary, 0);
      const totalNetPay = employees.reduce((s, e) => s + e.tax.netSalary, 0);
      const totalTax = employees.reduce((s, e) => s + e.tax.incomeTax, 0);
      const avgSalary = Math.round(totalNetPay / employees.length);

      const summary = { totalPayroll, totalNetPay, totalTax, avgSalary };

      // Update DB
      await updateHrPayslip(id, {
        fieldMap: fieldMap as any,
        period,
        employeeCount: employees.length,
        summary: summary as any,
        reportFileKey: reportKey,
        reportFileUrl: reportUrl,
        status: "ready",
      });

      // Return preview data (first 10 employees)
      const previewData = employees.slice(0, 10).map(e => ({
        name: e.name, dept: e.dept, email: e.email,
        grossSalary: e.tax.grossSalary, insurance: e.tax.insurance,
        incomeTax: e.tax.incomeTax, netSalary: e.tax.netSalary,
      }));

      res.json({
        id,
        downloadUrl: reportUrl,
        employeeCount: employees.length,
        summary,
        preview: previewData,
      });
    } catch (err: any) {
      console.error("[HR] Payslip generate error:", err);
      res.status(500).json({ error: err.message || "Generation failed" });
    }
  });

  // ── GET /api/hr/payslip/download/:id ────────────────────────────────────

  app.get("/api/hr/payslip/download/:id", async (req: Request, res: Response) => {
    try {
      const record = await getHrPayslip(req.params.id);
      if (!record?.reportFileKey) { res.status(404).json({ error: "报表不存在或已过期" }); return; }
      const { url } = await storageGet(record.reportFileKey);
      const s3Res = await fetch(url);
      if (!s3Res.ok) { res.status(502).json({ error: "文件获取失败" }); return; }
      const filename = `工资条-${record.id}.xlsx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
      const { Readable } = await import("stream");
      if (s3Res.body) { Readable.fromWeb(s3Res.body as any).pipe(res); }
      else { res.send(Buffer.from(await s3Res.arrayBuffer())); }
    } catch (err: any) {
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/hr/attendance/upload ──────────────────────────────────────

  app.post("/api/hr/attendance/upload", upload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
      const { originalname, buffer, mimetype } = req.file;
      const ext = originalname.split(".").pop()?.toLowerCase() || "xlsx";

      const id = nanoid();
      const fileKey = `hr-attendance-uploads/${id}.${ext}`;
      const { url: fileUrl } = await storagePut(fileKey, buffer, mimetype);

      const data = parseFile(buffer, originalname);
      if (data.length === 0) { res.status(400).json({ error: "文件为空或格式不正确" }); return; }

      const headers = Object.keys(data[0]);
      const fieldMap = await detectAttendanceFields(headers);
      const preview = data.slice(0, 5);

      const userId = (req as any).userId || 0;
      await createHrAttendance({
        id,
        userId,
        filename: originalname,
        fileKey,
        fileUrl,
        fileSizeKb: Math.ceil(buffer.length / 1024),
        rowCount: data.length,
        fieldMap: fieldMap as any,
        status: "analyzing",
      });

      res.json({ id, headers, fieldMap, preview, rowCount: data.length });
    } catch (err: any) {
      console.error("[HR] Attendance upload error:", err);
      res.status(500).json({ error: err.message || "Upload failed" });
    }
  });

  // ── POST /api/hr/attendance/analyze ─────────────────────────────────────

  app.post("/api/hr/attendance/analyze", async (req: Request, res: Response) => {
    try {
      const { id, fieldMap, period, workStartHour, workEndHour } = req.body as {
        id: string;
        fieldMap: { nameCol: string; dateCol: string; checkInCol: string; checkOutCol: string; deptCol: string; statusCol: string };
        period?: string;
        workStartHour?: number;
        workEndHour?: number;
      };

      const record = await getHrAttendance(id);
      if (!record?.fileKey) { res.status(404).json({ error: "记录不存在" }); return; }

      const { url } = await storageGet(record.fileKey);
      const fileRes = await fetch(url);
      if (!fileRes.ok) { res.status(404).json({ error: "文件已过期，请重新上传" }); return; }
      const arrayBuf = await fileRes.arrayBuffer();
      const data = parseFile(Buffer.from(arrayBuf), record.filename);

      const { records, summary, byEmployee } = analyzeAttendance(
        data, fieldMap, workStartHour ?? 9, workEndHour ?? 18,
      );

      // Generate Excel report
      const excelBuffer = generateAttendanceExcel(byEmployee, records, summary);
      const reportKey = `hr-attendance-reports/${id}-${Date.now()}.xlsx`;
      const { url: reportUrl } = await storagePut(reportKey, excelBuffer, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

      await updateHrAttendance(id, {
        fieldMap: fieldMap as any,
        period,
        summary: summary as any,
        reportFileKey: reportKey,
        reportFileUrl: reportUrl,
        status: "ready",
      });

      // Return top anomalies (first 20)
      const anomalies = records
        .filter(r => r.status !== "normal")
        .slice(0, 50)
        .map(r => ({
          name: r.name, dept: r.dept, date: r.date,
          checkIn: r.checkIn, checkOut: r.checkOut,
          status: r.status, lateMinutes: r.lateMinutes,
        }));

      const employeeStats = Object.values(byEmployee).map(e => ({
        name: e.name, dept: e.dept,
        presentDays: e.presentDays, lateDays: e.lateDays,
        absentDays: e.absentDays, earlyLeaveDays: e.earlyLeaveDays,
        overtimeHours: Math.round(e.overtimeHours * 10) / 10,
        attendanceRate: Math.round(
          (e.presentDays / Math.max(1, e.presentDays + e.absentDays)) * 100
        ),
      }));

      res.json({ id, summary, anomalies, employeeStats, downloadUrl: reportUrl });
    } catch (err: any) {
      console.error("[HR] Attendance analyze error:", err);
      res.status(500).json({ error: err.message || "Analysis failed" });
    }
  });

  // ── GET /api/hr/attendance/download/:id ─────────────────────────────────

  app.get("/api/hr/attendance/download/:id", async (req: Request, res: Response) => {
    try {
      const record = await getHrAttendance(req.params.id);
      if (!record?.reportFileKey) { res.status(404).json({ error: "报表不存在" }); return; }
      const { url } = await storageGet(record.reportFileKey);
      const s3Res = await fetch(url);
      if (!s3Res.ok) { res.status(502).json({ error: "文件获取失败" }); return; }
      const filename = `考勤汇总-${record.id}.xlsx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
      const { Readable } = await import("stream");
      if (s3Res.body) { Readable.fromWeb(s3Res.body as any).pipe(res); }
      else { res.send(Buffer.from(await s3Res.arrayBuffer())); }
    } catch (err: any) {
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  });
}
