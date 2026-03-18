/**
 * ATLAS V3.0 — Computation 层（第 3 层）
 * ─────────────────────────────────────────────────────────────────
 * B 阶段交付物 B3：口径计算 → 模板执行 → ResultSet 生成
 *
 * 对应管道步骤：Step 8
 *
 * 职责：
 *   8. 执行确定性计算引擎，生成 ResultSet
 *      - 核心口径计算（10 个标量 + 分组口径）
 *      - 模板公式计算（如果指定了模板）
 *      - 填充所有可审计字段
 *
 * 设计原则：
 *   - 所有计算使用 Decimal.js 精确计算
 *   - ResultSet 是唯一真值源，生成后不可修改
 *   - 模板计算复用核心口径引擎
 */

import Decimal from "decimal.js";
import {
  type PipelineContext,
  ErrorLevel,
} from "@shared/pipeline";
import {
  computeAllMetrics,
  type StandardRow,
  type MetricResult,
} from "@shared/metrics";
import {
  type ResultSet,
  type SourceFileInfo,
  type SkippedRowSample,
  type CleaningLogEntry,
  createEmptyResultSet,
  COMPUTATION_VERSION,
} from "@shared/resultSet";
import {
  type TemplateDefinition,
  getTemplateById,
  calculateIncomeTax,
} from "@shared/templates";

// ── Step 8: 计算引擎 ──────────────────────────────────────────────

export interface ComputationInput {
  /** 清洗后的标准化行数据 */
  rows: StandardRow[];
  /** 源文件信息 */
  sourceFiles: SourceFileInfo[];
  /** 被跳过的行 */
  skippedRows: SkippedRowSample[];
  /** 跳过行数 */
  skippedCount: number;
  /** 标准化后的字段列表 */
  fields: string[];
  /** 平台 */
  platform: string;
  /** 是否多文件 */
  isMultiFile: boolean;
  /** 模板 ID（可选） */
  templateId?: string;
}

/**
 * 执行计算引擎，生成 ResultSet。
 */
export function step8Compute(
  ctx: PipelineContext,
  input: ComputationInput
): ResultSet {
  ctx.currentStep = 8;

  const rs = createEmptyResultSet(ctx.jobId);

  // 填充可审计字段
  rs.sourceFiles = input.sourceFiles;
  rs.skippedRowsCount = input.skippedCount;
  rs.skippedRowsSample = input.skippedRows.slice(0, 5);
  rs.sourcePlatform = input.platform;
  rs.isMultiFile = input.isMultiFile;
  rs.fields = input.fields;
  rs.rowCount = input.sourceFiles.reduce((sum, f) => sum + f.dataRows, 0);
  rs.standardizedRows = input.rows.map(row => {
    const cleanRow: Record<string, string | number | null> = {};
    for (const [key, value] of Object.entries(row)) {
      cleanRow[key] = value === undefined ? null : (value as string | number | null);
    }
    return cleanRow;
  });

  // 判断 ResultSet 类型
  // 如果是模板生成的汇总表，则为 aggregate
  // 否则默认为 full_detail（完整明细）
  rs.resultType = input.templateId ? "aggregate" : "full_detail";

  // 执行核心口径计算
  try {
    rs.metrics = computeAllMetrics(input.rows);

    ctx.errors.push({
      level: ErrorLevel.INFO,
      step: 8,
      code: "I4008",
      message: `核心口径计算完成：${rs.metrics.length} 个指标`,
    });
  } catch (err: any) {
    ctx.errors.push({
      level: ErrorLevel.CRITICAL,
      step: 8,
      code: "E2005",
      message: "核心口径计算失败",
      details: err?.message,
    });
    // 计算失败不中断，返回空 metrics
    rs.metrics = [];
  }

  // 如果指定了模板，执行模板计算
  if (input.templateId) {
    rs.templateId = input.templateId;
    const template = getTemplateById(input.templateId);
    if (template) {
      try {
        const templateMetrics = executeTemplate(template, input.rows);
        rs.metrics = [...rs.metrics, ...templateMetrics];

        ctx.errors.push({
          level: ErrorLevel.INFO,
          step: 8,
          code: "I4008",
          message: `模板「${template.name}」计算完成：${templateMetrics.length} 个额外指标`,
        });
      } catch (err: any) {
        ctx.errors.push({
          level: ErrorLevel.CRITICAL,
          step: 8,
          code: "E2006",
          message: `模板「${template.name}」计算失败`,
          details: err?.message,
        });
      }
    }
  }

  // 构建清洗日志
  rs.cleaningLog = buildCleaningLog(ctx);

  return rs;
}

// ── 模板计算引擎 ──────────────────────────────────────────────────

/**
 * 执行模板公式计算。
 * 根据模板定义的公式，对数据行执行计算。
 */
function executeTemplate(
  template: TemplateDefinition,
  rows: StandardRow[]
): MetricResult[] {
  switch (template.id) {
    case "L1-01":
      return executeMultiStoreMerge(rows);
    case "L1-02":
      return executePayroll(rows);
    case "L1-03":
      return executeAttendance(rows);
    case "L1-04":
      return executeProfit(rows);
    default:
      return [];
  }
}

/**
 * L1-01: 多店合并模板计算
 */
function executeMultiStoreMerge(rows: StandardRow[]): MetricResult[] {
  const results: MetricResult[] = [];

  // 按店铺分组统计
  const storeGroups = new Map<string, { orders: Set<string>; sales: Decimal }>();

  for (const row of rows) {
    const store = String(row.store_name || "未知店铺").trim();
    if (!storeGroups.has(store)) {
      storeGroups.set(store, { orders: new Set(), sales: new Decimal(0) });
    }
    const group = storeGroups.get(store)!;

    const orderId = row.order_id;
    if (orderId !== null && orderId !== undefined) {
      group.orders.add(String(orderId));
    }

    const amt = safeDecimal(row.pay_amount);
    if (amt) {
      group.sales = group.sales.plus(amt);
    }
  }

  // 店铺订单数
  const storeOrderCounts = Array.from(storeGroups.entries()).map(([key, g]) => ({
    key,
    value: String(g.orders.size),
  }));
  results.push({
    name: "store_order_count",
    displayName: "店铺订单数",
    groups: storeOrderCounts,
    unit: "个",
    formula: "COUNT(DISTINCT order_id) GROUP BY store_name",
  });

  // 店铺销售额
  const storeSales = Array.from(storeGroups.entries()).map(([key, g]) => ({
    key,
    value: g.sales.toFixed(2),
  }));
  results.push({
    name: "store_sales",
    displayName: "店铺销售额",
    groups: storeSales,
    unit: "元",
    formula: "SUM(pay_amount) GROUP BY store_name",
  });

  return results;
}

/**
 * L1-02: 工资条模板计算
 * 为每个员工计算应发合计、扣除合计、应税所得、个税、实发工资
 */
function executePayroll(rows: StandardRow[]): MetricResult[] {
  const results: MetricResult[] = [];

  // 按员工分组
  const employeeGroups = new Map<string, StandardRow[]>();
  for (const row of rows) {
    const name = String(row.employee_name || "").trim();
    if (!name) continue;
    if (!employeeGroups.has(name)) {
      employeeGroups.set(name, []);
    }
    employeeGroups.get(name)!.push(row);
  }

  const grossPayGroups: Array<{ key: string; value: string }> = [];
  const netPayGroups: Array<{ key: string; value: string }> = [];
  const taxGroups: Array<{ key: string; value: string }> = [];

  for (const [name, empRows] of Array.from(employeeGroups.entries())) {
    // 取第一行（工资条通常每人一行）
    const row = empRows[0];

    const baseSalary = safeDecimal(row.base_salary) || new Decimal(0);
    const performanceBonus = safeDecimal(row.performance_bonus) || new Decimal(0);
    const overtimePay = safeDecimal(row.overtime_pay) || new Decimal(0);
    const allowance = safeDecimal(row.allowance) || new Decimal(0);

    const deduction = safeDecimal(row.deduction) || new Decimal(0);
    const socialInsurance = safeDecimal(row.social_insurance) || new Decimal(0);
    const housingFund = safeDecimal(row.housing_fund) || new Decimal(0);

    const grossPay = baseSalary.plus(performanceBonus).plus(overtimePay).plus(allowance);
    const totalDeduction = deduction.plus(socialInsurance).plus(housingFund);
    const taxableIncome = grossPay.minus(totalDeduction).minus(5000);
    const tax = calculateIncomeTax(Math.max(0, taxableIncome.toNumber()));
    const netPay = grossPay.minus(totalDeduction).minus(tax);

    grossPayGroups.push({ key: name, value: grossPay.toFixed(2) });
    netPayGroups.push({ key: name, value: netPay.toFixed(2) });
    taxGroups.push({ key: name, value: new Decimal(tax).toFixed(2) });
  }

  results.push({
    name: "gross_pay",
    displayName: "应发合计",
    groups: grossPayGroups,
    unit: "元",
    formula: "base_salary + performance_bonus + overtime_pay + allowance",
  });

  results.push({
    name: "income_tax",
    displayName: "个人所得税",
    groups: taxGroups,
    unit: "元",
    formula: "按七级超额累进税率计算",
  });

  results.push({
    name: "net_pay",
    displayName: "实发工资",
    groups: netPayGroups,
    unit: "元",
    formula: "gross_pay - total_deduction - income_tax",
  });

  return results;
}

/**
 * L1-03: 考勤汇总模板计算
 */
function executeAttendance(rows: StandardRow[]): MetricResult[] {
  const results: MetricResult[] = [];

  // 按员工分组
  const employeeGroups = new Map<string, StandardRow[]>();
  for (const row of rows) {
    const name = String(row.employee_name || "").trim();
    if (!name) continue;
    if (!employeeGroups.has(name)) {
      employeeGroups.set(name, []);
    }
    employeeGroups.get(name)!.push(row);
  }

  const attendanceRateGroups: Array<{ key: string; value: string }> = [];
  const lateCountGroups: Array<{ key: string; value: string }> = [];
  const absentDaysGroups: Array<{ key: string; value: string }> = [];

  for (const [name, empRows] of Array.from(employeeGroups.entries())) {
    const expectedDays = empRows.length;

    let lateCount = 0;
    let absentDays = 0;
    let actualDays = 0;

    for (const row of empRows) {
      const status = String(row.attendance_status || "").trim();
      const clockIn = String(row.clock_in || "").trim();

      // 缺勤判定
      if (["缺勤", "旷工"].includes(status)) {
        absentDays++;
        continue;
      }

      // 请假不算出勤也不算缺勤
      if (["请假", "事假", "病假", "年假", "产假", "婚假"].includes(status)) {
        continue;
      }

      actualDays++;

      // 迟到判定
      if (status === "迟到" || (clockIn && clockIn > "09:00")) {
        lateCount++;
      }
    }

    const attendanceRate = expectedDays > 0
      ? new Decimal(actualDays).div(expectedDays).times(100)
      : new Decimal(0);

    attendanceRateGroups.push({ key: name, value: attendanceRate.toFixed(2) });
    lateCountGroups.push({ key: name, value: String(lateCount) });
    absentDaysGroups.push({ key: name, value: String(absentDays) });
  }

  results.push({
    name: "attendance_rate",
    displayName: "出勤率",
    groups: attendanceRateGroups,
    unit: "%",
    formula: "actual_days / expected_days * 100",
  });

  results.push({
    name: "late_count",
    displayName: "迟到次数",
    groups: lateCountGroups,
    unit: "次",
    formula: "COUNT(*) WHERE clock_in > '09:00' OR status = '迟到'",
  });

  results.push({
    name: "absent_days",
    displayName: "缺勤天数",
    groups: absentDaysGroups,
    unit: "天",
    formula: "COUNT(*) WHERE status IN ('缺勤','旷工')",
  });

  return results;
}

/**
 * L1-04: 利润统计模板计算
 */
function executeProfit(rows: StandardRow[]): MetricResult[] {
  const results: MetricResult[] = [];

  let totalRevenue = new Decimal(0);
  let totalCost = new Decimal(0);
  let totalPlatformFee = new Decimal(0);
  let totalCommission = new Decimal(0);
  let totalLogistics = new Decimal(0);
  let totalRefund = new Decimal(0);

  for (const row of rows) {
    const revenue = safeDecimal(row.pay_amount);
    if (revenue) totalRevenue = totalRevenue.plus(revenue);

    const cost = safeDecimal(row.cost);
    if (cost) totalCost = totalCost.plus(cost);

    const platformFee = safeDecimal(row.platform_fee);
    if (platformFee) totalPlatformFee = totalPlatformFee.plus(platformFee);

    const commission = safeDecimal(row.commission);
    if (commission) totalCommission = totalCommission.plus(commission);

    const logistics = safeDecimal(row.logistics_cost);
    if (logistics) totalLogistics = totalLogistics.plus(logistics);

    const refund = safeDecimal(row.refund_amount);
    if (refund) totalRefund = totalRefund.plus(refund);
  }

  const grossProfit = totalRevenue.minus(totalCost);
  const grossMargin = totalRevenue.gt(0)
    ? grossProfit.div(totalRevenue).times(100)
    : new Decimal(0);
  const totalExpenses = totalPlatformFee.plus(totalCommission).plus(totalLogistics);
  const netProfit = grossProfit.minus(totalExpenses).minus(totalRefund);
  const netMargin = totalRevenue.gt(0)
    ? netProfit.div(totalRevenue).times(100)
    : new Decimal(0);

  results.push({
    name: "total_revenue",
    displayName: "总收入",
    value: totalRevenue.toFixed(2),
    unit: "元",
    formula: "SUM(pay_amount)",
  });

  results.push({
    name: "total_cost",
    displayName: "总成本",
    value: totalCost.toFixed(2),
    unit: "元",
    formula: "SUM(cost)",
  });

  results.push({
    name: "gross_profit",
    displayName: "毛利润",
    value: grossProfit.toFixed(2),
    unit: "元",
    formula: "total_revenue - total_cost",
  });

  results.push({
    name: "gross_margin",
    displayName: "毛利率",
    value: grossMargin.toFixed(2),
    unit: "%",
    formula: "gross_profit / total_revenue * 100",
  });

  results.push({
    name: "total_expenses",
    displayName: "总费用",
    value: totalExpenses.toFixed(2),
    unit: "元",
    formula: "SUM(platform_fee) + SUM(commission) + SUM(logistics_cost)",
  });

  results.push({
    name: "net_profit",
    displayName: "净利润",
    value: netProfit.toFixed(2),
    unit: "元",
    formula: "gross_profit - total_expenses - SUM(refund_amount)",
  });

  results.push({
    name: "net_margin",
    displayName: "净利率",
    value: netMargin.toFixed(2),
    unit: "%",
    formula: "net_profit / total_revenue * 100",
  });

  return results;
}

// ── 辅助函数 ──────────────────────────────────────────────────────

/**
 * 安全地将字段值转为 Decimal。
 */
function safeDecimal(value: string | number | null | undefined): Decimal | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    if (isNaN(value)) return null;
    return new Decimal(value);
  }
  const cleaned = String(value).replace(/[,，\s¥$￥]/g, "").trim();
  if (cleaned === "" || cleaned === "-" || cleaned === "—") return null;
  try {
    return new Decimal(cleaned);
  } catch {
    return null;
  }
}

/**
 * 从 PipelineContext 的错误日志构建清洗日志。
 */
function buildCleaningLog(ctx: PipelineContext): CleaningLogEntry[] {
  const logs: CleaningLogEntry[] = [];

  for (const err of ctx.errors) {
    if (err.step >= 1 && err.step <= 8) {
      const stepNames: Record<number, string> = {
        1: "文件接收",
        2: "编码检测",
        3: "格式解析",
        4: "平台识别",
        5: "字段映射",
        6: "数据清洗",
        7: "去重",
        8: "计算引擎",
      };

      logs.push({
        step: err.step,
        stepName: stepNames[err.step] || `步骤 ${err.step}`,
        action: err.message,
        affectedRows: 0, // 从消息中解析或默认 0
        details: err.details,
      });
    }
  }

  return logs;
}
