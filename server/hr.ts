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
import ExcelJS from "exceljs"; // P2: WPS-compatible Excel generation
import Decimal from "decimal.js";
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
  // P1-B: Use Decimal.js to eliminate floating-point errors
  const gross = Decimal.max(0, new Decimal(opts.grossSalary).plus(opts.bonus ?? 0));
  // Estimate insurance if not provided: 养老8% + 医疗2% + 失业0.5% = 10.5%
  const insurance = opts.insurance !== undefined
    ? Decimal.max(0, new Decimal(opts.insurance))
    : gross.mul('0.105').toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const threshold = new Decimal(5000);
  const taxableIncome = Decimal.max(0, gross.minus(insurance).minus(threshold));
  let incomeTax = new Decimal(0);
  for (const bracket of TAX_BRACKETS) {
    if (taxableIncome.lte(bracket.limit)) {
      incomeTax = taxableIncome.mul(bracket.rate).minus(bracket.deduction).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
      break;
    }
  }
  incomeTax = Decimal.max(0, incomeTax);
  const netSalary = gross.minus(insurance).minus(incomeTax).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return {
    grossSalary: gross.toNumber(),
    insurance: insurance.toNumber(),
    taxableIncome: taxableIncome.toNumber(),
     incomeTax: incomeTax.toNumber(),
    netSalary: netSalary.toNumber(),
  };
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
  // Fallback: simple keyword matching (P2-C: expanded synonyms)
  const find = (keywords: string[]) =>
    headers.find(h => keywords.some(k => h.toLowerCase().includes(k))) ?? "";
  return {
    nameCol:       find(["姓名", "name", "员工", "员工姓名", "员工名", "人员", "人员姓名", "staff", "employee", "emp_name"]),
    emailCol:      find(["邮箱", "email", "mail", "邮件", "电子邮件", "电子邮箱"]),
    baseSalaryCol: find(["基本工资", "底薪", "基础工资", "固定工资", "月薪", "标准工资", "岗位工资", "合同工资", "应发基本", "base", "base_salary", "basic_salary"]),
    bonusCol:      find(["奖金", "绩效", "提成", "绩效工资", "绩效奖金", "KPI", "kpi", "季度奖", "年终奖", "全勤奖", "项目奖金", "销售提成", "超额提成", "bonus", "incentive", "performance", "commission"]),
    deductionCol:  find(["扣款", "罚款", "扣除", "缺勤扣款", "违规扣款", "事假扣款", "病假扣款", "迟到扣款", "应扣合计", "deduct", "deduction", "penalty"]),
    insuranceCol:  find(["五险", "社保", "insurance", "公积金", "五险一金", "社保公积金", "个人社保", "个人公积金", "社保扣款", "公积金扣款"]),
    deptCol:       find(["部门", "dept", "department", "所属部门", "归属部门", "团队", "组别", "科室"]),
  };
}

// 判断考勤表格式：明细格式（每天一行，有打卡时间）还是汇总格式（每人一行，有出勤天数）
function detectAttendanceFormat(headers: string[]): "detail" | "summary" {
  const lh = headers.map(h => h.toLowerCase());
  const hasSummaryFields = lh.some(h =>
    ["出勤", "应出勤", "实出勤", "出勤天数", "应勤", "实勤",
     "迟到次数", "旷工次数", "旷工天数", "早退次数",
     "absent_days", "late_count", "present_days"].some(k => h.includes(k))
  );
  const hasDetailFields = lh.some(h =>
    ["上班时间", "下班时间", "打卡", "签到", "签退", "check_in", "check_out",
     "入厂", "出厂"].some(k => h.includes(k))
  );
  if (hasSummaryFields && !hasDetailFields) return "summary";
  return "detail";
}

interface AttendanceSummaryFieldMap {
  nameCol: string; deptCol: string;
  presentDaysCol: string; absentDaysCol: string;
  lateDaysCol: string; earlyLeaveDaysCol: string; overtimeHoursCol: string;
}

function detectAttendanceSummaryFields(headers: string[]): AttendanceSummaryFieldMap {
  const find = (keywords: string[]) =>
    headers.find(h => keywords.some(k => h.toLowerCase().includes(k))) ?? "";
  return {
    nameCol:          find(["姓名", "name", "员工", "人员", "staff"]),
    deptCol:          find(["部门", "dept", "department"]),
    presentDaysCol:   find(["实出勤", "出勤天数", "实勤", "出勤", "present", "应出勤"]),
    absentDaysCol:    find(["旷工", "缺勤", "absent", "旷工天数", "缺勤天数"]),
    lateDaysCol:      find(["迟到", "late", "迟到次数", "迟到天数"]),
    earlyLeaveDaysCol:find(["早退", "early", "早退次数", "早退天数"]),
    overtimeHoursCol: find(["加班", "overtime", "加班时长", "加班小时"]),
  };
}

function analyzeAttendanceSummary(
  data: Record<string, unknown>[],
  fieldMap: AttendanceSummaryFieldMap
): {
  records: AttendanceRecord[];
  summary: { totalEmployees: number; totalDays: number; attendanceRate: number; lateCount: number; absentCount: number; earlyLeaveCount: number; overtimeHours: number };
  byEmployee: Record<string, { name: string; dept: string; presentDays: number; lateDays: number; absentDays: number; earlyLeaveDays: number; overtimeHours: number }>;
} {
  const byEmployee: Record<string, { name: string; dept: string; presentDays: number; lateDays: number; absentDays: number; earlyLeaveDays: number; overtimeHours: number }> = {};
  for (const row of data) {
    const name = String(row[fieldMap.nameCol] ?? "").trim();
    if (!name) continue;
    const dept = String(row[fieldMap.deptCol] ?? "").trim();
    const toNum = (col: string) => { const v = parseFloat(String(row[col] ?? "0")); return isNaN(v) ? 0 : v; };
    byEmployee[name] = {
      name, dept,
      presentDays:    toNum(fieldMap.presentDaysCol),
      absentDays:     toNum(fieldMap.absentDaysCol),
      lateDays:       toNum(fieldMap.lateDaysCol),
      earlyLeaveDays: toNum(fieldMap.earlyLeaveDaysCol),
      overtimeHours:  toNum(fieldMap.overtimeHoursCol),
    };
  }
  const employees = Object.values(byEmployee);
  const totalPresent = employees.reduce((s, e) => s + e.presentDays, 0);
  const totalAbsent  = employees.reduce((s, e) => s + e.absentDays, 0);
  const summary = {
    totalEmployees: employees.length,
    totalDays: totalPresent + totalAbsent,
    attendanceRate: totalPresent + totalAbsent > 0
      ? Math.round(totalPresent / (totalPresent + totalAbsent) * 100) : 100,
    lateCount:       employees.reduce((s, e) => s + e.lateDays, 0),
    absentCount:     totalAbsent,
    earlyLeaveCount: employees.reduce((s, e) => s + e.earlyLeaveDays, 0),
    overtimeHours:   Math.round(employees.reduce((s, e) => s + e.overtimeHours, 0) * 10) / 10,
  };
  // Build synthetic records (one per employee, no date/time detail)
  const records: AttendanceRecord[] = employees.map(e => ({
    name: e.name, date: "", checkIn: "", checkOut: "", dept: e.dept,
    status: e.absentDays > 0 ? "absent" : e.lateDays > 0 ? "late" : "normal",
    lateMinutes: e.lateDays * 60, overtimeMinutes: Math.round(e.overtimeHours * 60),
  }));
  return { records, summary, byEmployee };
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
  const find2 = (keywords: string[]) =>
    headers.find(h => keywords.some(k => h.toLowerCase().includes(k))) ?? "";
  return {
    nameCol:     find2(["姓名", "name", "员工", "人员", "staff", "employee"]),
    dateCol:     find2(["日期", "date", "时间", "考勤日期"]),
    checkInCol:  find2(["上班", "签到", "打卡", "上班打卡", "check_in", "checkin", "上班时间", "入厂时间"]),
    checkOutCol: find2(["下班", "签退", "下班打卡", "check_out", "checkout", "下班时间", "出厂时间"]),
    deptCol:     find2(["部门", "dept", "department", "所属部门"]),
    statusCol:   find2(["状态", "status", "考勤", "考勤状态"]),
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


// P2: WPS-compatible payslip generator using ExcelJS
// generatePayslipExcelWPS — same data structure, proper OOXML styles for WPS
async function generatePayslipExcelWPS(employees: Array<{
  name: string; dept: string; baseSalary: number; bonus: number;
  deduction: number; insurance: number; tax: TaxResult;
}>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ATLAS";
  wb.created = new Date();

  const headerFill: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
  const headerFont: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  const headerAlign: Partial<ExcelJS.Alignment> = { horizontal: "center", vertical: "middle" };
  const lightBlueFill: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F4FD" } };
  const thinBorder: Partial<ExcelJS.Borders> = {
    top: { style: "thin", color: { argb: "FFCCCCCC" } },
    left: { style: "thin", color: { argb: "FFCCCCCC" } },
    bottom: { style: "thin", color: { argb: "FFCCCCCC" } },
    right: { style: "thin", color: { argb: "FFCCCCCC" } },
  };
  const moneyFmt = '#,##0.00';

  // Sheet 1: 工资汇总
  const ws1 = wb.addWorksheet("工资汇总");
  ws1.columns = [
    { header: "姓名",         key: "name",          width: 12 },
    { header: "部门",         key: "dept",          width: 12 },
    { header: "应发工资",     key: "gross",         width: 14 },
    { header: "奖金/绩效",   key: "bonus",         width: 14 },
    { header: "扣款",         key: "deduction",     width: 12 },
    { header: "五险一金",     key: "insurance",     width: 14 },
    { header: "应纳税所得额", key: "taxableIncome", width: 16 },
    { header: "个人所得税",   key: "incomeTax",     width: 14 },
    { header: "实发工资",     key: "netSalary",     width: 14 },
  ];
  ws1.getRow(1).eachCell(cell => {
    cell.fill = headerFill; cell.font = headerFont;
    cell.alignment = headerAlign; cell.border = thinBorder;
  });
  ws1.getRow(1).height = 22;
  for (const e of employees) {
    const row = ws1.addRow({
      name: e.name, dept: e.dept,
      gross: e.tax.grossSalary, bonus: e.bonus, deduction: e.deduction,
      insurance: e.tax.insurance, taxableIncome: e.tax.taxableIncome,
      incomeTax: e.tax.incomeTax, netSalary: e.tax.netSalary,
    });
    for (let c = 3; c <= 9; c++) { row.getCell(c).numFmt = moneyFmt; row.getCell(c).border = thinBorder; }
    row.getCell(1).border = thinBorder; row.getCell(2).border = thinBorder;
    row.height = 18;
  }

  // Sheet 2: 个人工资条
  const ws2 = wb.addWorksheet("个人工资条");
  ws2.columns = [
    { key: "a", width: 18 }, { key: "b", width: 16 },
    { key: "c", width: 18 }, { key: "d", width: 16 },
  ];
  for (const e of employees) {
    const titleRow = ws2.addRow([`员工工资条 — ${e.name}`, "", "", ""]);
    ws2.mergeCells(`A${titleRow.number}:D${titleRow.number}`);
    titleRow.getCell(1).fill = headerFill;
    titleRow.getCell(1).font = { ...headerFont, size: 12 };
    titleRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
    titleRow.height = 24;
    const subHeader = ws2.addRow(["项目", "金额（元）", "项目", "金额（元）"]);
    subHeader.eachCell(cell => {
      cell.fill = lightBlueFill; cell.font = { bold: true, size: 10 };
      cell.alignment = { horizontal: "center" }; cell.border = thinBorder;
    });
    const dataRows: [string, number, string, number][] = [
      ["基本工资",  e.baseSalary,       "五险一金（个人）", e.tax.insurance],
      ["奖金/绩效", e.bonus,            "个人所得税",     e.tax.incomeTax],
      ["扣款",      e.deduction,        "应纳税所得额",   e.tax.taxableIncome],
      ["应发工资",  e.tax.grossSalary,  "实发工资",       e.tax.netSalary],
    ];
    for (const [la, va, lb, vb] of dataRows) {
      const r = ws2.addRow([la, va, lb, vb]);
      r.getCell(1).border = thinBorder;
      r.getCell(2).numFmt = moneyFmt; r.getCell(2).border = thinBorder;
      r.getCell(3).border = thinBorder;
      r.getCell(4).numFmt = moneyFmt; r.getCell(4).border = thinBorder;
      r.height = 18;
    }
    ws2.addRow([]); ws2.addRow([]);
  }

  // Sheet 3: 个税明细
  const ws3 = wb.addWorksheet("个税明细");
  ws3.columns = [
    { header: "姓名",         key: "name",          width: 12 },
    { header: "应发工资",     key: "gross",         width: 14 },
    { header: "五险一金",     key: "insurance",     width: 14 },
    { header: "起征点",       key: "threshold",     width: 10 },
    { header: "应纳税所得额", key: "taxableIncome", width: 16 },
    { header: "适用税率",     key: "rate",          width: 12 },
    { header: "个税",         key: "incomeTax",     width: 12 },
    { header: "实发工资",     key: "netSalary",     width: 14 },
  ];
  ws3.getRow(1).eachCell(cell => {
    cell.fill = lightBlueFill; cell.font = { bold: true, size: 11 };
    cell.alignment = { horizontal: "center" }; cell.border = thinBorder;
  });
  ws3.getRow(1).height = 22;
  for (const e of employees) {
    const bracket = TAX_BRACKETS.find(b => e.tax.taxableIncome <= b.limit) || TAX_BRACKETS[TAX_BRACKETS.length - 1];
    const row = ws3.addRow({
      name: e.name, gross: e.tax.grossSalary, insurance: e.tax.insurance,
      threshold: 5000, taxableIncome: e.tax.taxableIncome,
      rate: `${(bracket.rate * 100).toFixed(0)}%`,
      incomeTax: e.tax.incomeTax, netSalary: e.tax.netSalary,
    });
    [2, 3, 4, 5, 7, 8].forEach(c => { row.getCell(c).numFmt = moneyFmt; });
    row.eachCell(cell => { cell.border = thinBorder; });
    row.height = 18;
  }

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
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
      const excelBuffer = await generatePayslipExcelWPS(employees);

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

  // ── POST /api/hr/payslip/from-atlas-session (P1-B: inline payslip from existing atlas session) ──
  // Accepts an atlas sessionId, fetches the file from S3, runs full payslip generation inline.
  // This avoids re-uploading the file when user clicks "生成工资条" from the chat quick-action.
  app.post("/api/hr/payslip/from-atlas-session", async (req: Request, res: Response) => {
    try {
      const { sessionId, period } = req.body as { sessionId: string; period?: string };
      if (!sessionId) { res.status(400).json({ error: "sessionId 必填" }); return; }

      // 1. Load atlas session from DB to get fileKey
      const { getSession } = await import("./db");
      const session = await getSession(sessionId);
      if (!session || !session.fileKey) { res.status(404).json({ error: "会话不存在或文件已过期" }); return; }

      // 2. Fetch file from S3
      const { url: fileUrl } = await storageGet(session.fileKey);
      const fileRes = await fetch(fileUrl);
      if (!fileRes.ok) { res.status(404).json({ error: "文件已过期，请重新上传" }); return; }
      const arrayBuf = await fileRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      const filename = session.originalName || session.filename;

      // 3. Parse data
      const data = parseFile(buffer, filename);
      if (data.length === 0) { res.status(400).json({ error: "文件为空或格式不正确" }); return; }
      const headers = Object.keys(data[0]);

      // 4. Auto-detect field mapping
      const fieldMap = await detectPayslipFields(headers);

      // 5. Create HR payslip record
      const id = nanoid();
      const userId = (req as any).userId || 0;
      await createHrPayslip({
        id,
        userId,
        filename,
        fileKey: session.fileKey,
        fileUrl: fileUrl,
        fileSizeKb: Math.ceil(buffer.length / 1024),
        employeeCount: data.length,
        fieldMap: fieldMap as any,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        status: "ready",
      });

      // 6. Generate payslip
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

      if (employees.length === 0) {
        res.status(400).json({ error: "未找到有效员工数据，请检查字段映射" });
        return;
      }

      // 7. Generate Excel
      const excelBuffer = await generatePayslipExcelWPS(employees);
      const reportKey = `hr-payslip-reports/${id}-${Date.now()}.xlsx`;
      const { url: reportUrl } = await storagePut(reportKey, excelBuffer, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

      // 8. Summary stats
      const totalPayroll = employees.reduce((s, e) => s + e.tax.grossSalary, 0);
      const totalNetPay = employees.reduce((s, e) => s + e.tax.netSalary, 0);
      const totalTax = employees.reduce((s, e) => s + e.tax.incomeTax, 0);
      const avgSalary = Math.round(totalNetPay / employees.length);
      const summary = { totalPayroll, totalNetPay, totalTax, avgSalary };

      await updateHrPayslip(id, {
        fieldMap: fieldMap as any,
        period,
        employeeCount: employees.length,
        summary: summary as any,
        reportFileKey: reportKey,
        reportFileUrl: reportUrl,
        status: "ready",
      });

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
        fieldMap,
        period: period || new Date().toISOString().slice(0, 7),
      });
    } catch (err: any) {
      console.error("[HR] Payslip from-atlas-session error:", err);
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
      const tableFormat = detectAttendanceFormat(headers); // "detail" | "summary"
      const fieldMap = tableFormat === "summary"
        ? detectAttendanceSummaryFields(headers)
        : await detectAttendanceFields(headers);
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

      res.json({ id, headers, fieldMap, tableFormat, preview, rowCount: data.length });
    } catch (err: any) {
      console.error("[HR] Attendance upload error:", err);
      res.status(500).json({ error: err.message || "Upload failed" });
    }
  });

  // ── POST /api/hr/attendance/analyze ─────────────────────────────────────

  app.post("/api/hr/attendance/analyze", async (req: Request, res: Response) => {
    try {
      const { id, fieldMap, tableFormat, period, workStartHour, workEndHour } = req.body as {
        id: string;
        fieldMap: Record<string, string>;
        tableFormat?: "detail" | "summary";
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

      // P0-A: 根据格式选择对应的分析函数
      const fmt = tableFormat ?? detectAttendanceFormat(Object.keys(data[0] ?? {}));
      const { records, summary, byEmployee } = fmt === "summary"
        ? analyzeAttendanceSummary(data, fieldMap as unknown as AttendanceSummaryFieldMap)
        : analyzeAttendance(data, fieldMap as any, workStartHour ?? 9, workEndHour ?? 18);

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
  }); // end attendance/analyze

  // ── POST /api/hr/attendance/from-atlas-session (P1-B: inline attendance from existing atlas session) ──
  app.post("/api/hr/attendance/from-atlas-session", async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.body as { sessionId: string };
      if (!sessionId) { res.status(400).json({ error: "sessionId 必填" }); return; }

      // 1. Load atlas session from DB to get fileKey
      const { getSession } = await import("./db");
      const session = await getSession(sessionId);
      if (!session || !session.fileKey) { res.status(404).json({ error: "会话不存在或文件已过期" }); return; }

      // 2. Fetch file from S3
      const { url: fileUrl } = await storageGet(session.fileKey);
      const fileRes = await fetch(fileUrl);
      if (!fileRes.ok) { res.status(404).json({ error: "文件已过期，请重新上传" }); return; }
      const arrayBuf = await fileRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      const filename = session.originalName || session.filename;

      // 3. Parse data
      const data = parseFile(buffer, filename);
      if (data.length === 0) { res.status(400).json({ error: "文件为空或格式不正确" }); return; }
      const headers = Object.keys(data[0]);

      // 4. Auto-detect field mapping
      const fieldMap = await detectAttendanceFields(headers);

      // 5. Create HR attendance record
      const id = nanoid();
      const userId = (req as any).userId || 0;
      await createHrAttendance({
        id,
        userId,
        filename,
        fileKey: session.fileKey,
        fileUrl: fileUrl,
        fileSizeKb: Math.ceil(buffer.length / 1024),
        rowCount: data.length,
        fieldMap: fieldMap as any,
        status: "ready",
      });

      // 6. Analyze attendance
      const { records, summary, byEmployee } = analyzeAttendance(data, fieldMap);

      // 7. Generate Excel
      const excelBuffer = generateAttendanceExcel(byEmployee, records, summary);
      const reportKey = `hr-attendance-reports/${id}-${Date.now()}.xlsx`;
      const { url: reportUrl } = await storagePut(reportKey, excelBuffer, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

      await updateHrAttendance(id, {
        fieldMap: fieldMap as any,
        summary: summary as any,
        reportFileKey: reportKey,
        reportFileUrl: reportUrl,
        status: "ready",
      });

      const employeeCount = Object.keys(byEmployee).length;
      res.json({
        id,
        downloadUrl: reportUrl,
        employeeCount,
        summary,
      });
    } catch (err: any) {
      console.error("[HR] Attendance from-atlas-session error:", err);
      res.status(500).json({ error: err.message || "Analysis failed" });
    }
  });

  // ── GET /api/hr/attendance/download/:id ───────────────────────────────────────

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
