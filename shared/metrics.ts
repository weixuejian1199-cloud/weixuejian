/**
 * ATLAS V3.0 — 统计口径定义
 * ─────────────────────────────────────────────────────────────────
 * A 阶段交付物 A2：10 个核心口径的精确计算规则
 *
 * 设计原则：
 *   1. 每个口径有唯一的 name、精确的 formula、明确的 precision
 *   2. 所有口径由确定性计算引擎执行，AI 不得自行解释或修改
 *   3. 新增口径必须走变更审批流程
 *   4. 口径之间的依赖关系显式声明
 *
 * 冻结规则：本文件经 A 阶段验收后冻结，后续只允许新增口径，不允许修改已有口径的计算规则。
 */

import Decimal from "decimal.js";

// ── 口径定义类型 ──────────────────────────────────────────────────

export interface MetricDefinition {
  /** 口径唯一标识 */
  name: string;
  /** 中文显示名 */
  displayName: string;
  /** 计算公式描述（人类可读） */
  formula: string;
  /** 结果精度：小数位数 */
  precision: number;
  /** 结果单位 */
  unit: "元" | "个" | "件" | "%" | "元/单" | "元/件";
  /** 依赖的标准字段 */
  requiredFields: string[];
  /** 依赖的其他口径（用于计算顺序排序） */
  dependsOn: string[];
  /** 说明 */
  description: string;
}

// ── 退款状态判定 ──────────────────────────────────────────────────

/**
 * 判断一行数据是否为"已退款"状态。
 * 退款状态的判定需要兼容各平台的不同表述。
 */
export const REFUND_STATUS_VALUES = [
  "已退款",
  "退款成功",
  "退款完成",
  "全额退款",
  "退货退款成功",
  "售后完成",
  "退款关闭", // 注意：退款关闭不算已退款
];

export const REFUNDED_VALUES = new Set([
  "已退款",
  "退款成功",
  "退款完成",
  "全额退款",
  "退货退款成功",
  "售后完成",
]);

export function isRefunded(refundStatus: string | null | undefined): boolean {
  if (!refundStatus) return false;
  return REFUNDED_VALUES.has(refundStatus.trim());
}

// ── 10 个核心口径定义 ──────────────────────────────────────────────

export const METRIC_DEFINITIONS: MetricDefinition[] = [
  {
    name: "total_sales",
    displayName: "总销售额",
    formula: "SUM(pay_amount) WHERE refund_status != '已退款'",
    precision: 2,
    unit: "元",
    requiredFields: ["pay_amount", "refund_status"],
    dependsOn: [],
    description: "所有未退款订单的实付金额之和。不含已退款订单。",
  },
  {
    name: "total_orders",
    displayName: "总订单数",
    formula: "COUNT(DISTINCT order_id)",
    precision: 0,
    unit: "个",
    requiredFields: ["order_id"],
    dependsOn: [],
    description: "去重后的订单总数。同一订单号只计一次。",
  },
  {
    name: "refund_orders",
    displayName: "退款订单数",
    formula: "COUNT(DISTINCT order_id) WHERE refund_status = '已退款'",
    precision: 0,
    unit: "个",
    requiredFields: ["order_id", "refund_status"],
    dependsOn: [],
    description: "退款状态为已退款的去重订单数。",
  },
  {
    name: "refund_rate",
    displayName: "退款率",
    formula: "退款订单数 / 总订单数 * 100",
    precision: 2,
    unit: "%",
    requiredFields: ["order_id", "refund_status"],
    dependsOn: ["refund_orders", "total_orders"],
    description: "退款订单占总订单的百分比。总订单数为 0 时返回 0。",
  },
  {
    name: "avg_order_value",
    displayName: "客单价",
    formula: "总销售额 / 总订单数",
    precision: 2,
    unit: "元/单",
    requiredFields: ["pay_amount", "order_id", "refund_status"],
    dependsOn: ["total_sales", "total_orders"],
    description: "平均每单实付金额。总订单数为 0 时返回 0。",
  },
  {
    name: "avg_item_price",
    displayName: "件单价",
    formula: "总销售额 / SUM(quantity)",
    precision: 2,
    unit: "元/件",
    requiredFields: ["pay_amount", "quantity", "refund_status"],
    dependsOn: ["total_sales"],
    description: "平均每件商品的实付金额。总件数为 0 时返回 0。",
  },
  {
    name: "avg_refund_amount",
    displayName: "平均退款金额",
    formula: "SUM(refund_amount) / 退款订单数",
    precision: 2,
    unit: "元",
    requiredFields: ["refund_amount", "order_id", "refund_status"],
    dependsOn: ["refund_orders"],
    description: "平均每笔退款的金额。退款订单数为 0 时返回 0。",
  },
  {
    name: "sales_by_store",
    displayName: "店铺销售额",
    formula: "SUM(pay_amount) GROUP BY store_name",
    precision: 2,
    unit: "元",
    requiredFields: ["pay_amount", "store_name", "refund_status"],
    dependsOn: [],
    description: "按店铺分组的销售额汇总。不含已退款订单。",
  },
  {
    name: "sales_by_talent",
    displayName: "达人销售额",
    formula: "SUM(pay_amount) GROUP BY talent_name",
    precision: 2,
    unit: "元",
    requiredFields: ["pay_amount", "talent_name", "refund_status"],
    dependsOn: [],
    description: "按达人分组的销售额汇总。不含已退款订单。",
  },
  {
    name: "sales_by_product",
    displayName: "商品销售额",
    formula: "SUM(pay_amount) GROUP BY product_name",
    precision: 2,
    unit: "元",
    requiredFields: ["pay_amount", "product_name", "refund_status"],
    dependsOn: [],
    description: "按商品分组的销售额汇总。不含已退款订单。",
  },
];

// ── 口径计算引擎 ──────────────────────────────────────────────────

export interface StandardRow {
  [fieldName: string]: string | number | null | undefined;
}

export interface ScalarMetricResult {
  name: string;
  displayName: string;
  value: string; // Decimal 字符串，保留精度
  unit: string;
  formula: string;
}

export interface GroupedMetricResult {
  name: string;
  displayName: string;
  groups: Array<{
    key: string;
    value: string; // Decimal 字符串
  }>;
  unit: string;
  formula: string;
}

export type MetricResult = ScalarMetricResult | GroupedMetricResult;

export function isGroupedMetric(r: MetricResult): r is GroupedMetricResult {
  return "groups" in r;
}

/**
 * 安全地将字段值转为 Decimal。
 * 处理逗号分隔的数字、空值等。
 */
function toDecimal(value: string | number | null | undefined): Decimal | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    if (isNaN(value)) return null;
    return new Decimal(value);
  }
  // 去掉逗号、空格、¥、$等
  const cleaned = String(value)
    .replace(/[,，\s¥$￥]/g, "")
    .trim();
  if (cleaned === "" || cleaned === "-" || cleaned === "—") return null;
  try {
    return new Decimal(cleaned);
  } catch {
    return null;
  }
}

/**
 * 计算所有核心口径。
 * 输入：标准化后的行数据（字段名已映射为标准字段名）
 * 输出：所有口径的计算结果
 */
export function computeAllMetrics(rows: StandardRow[]): MetricResult[] {
  const results: MetricResult[] = [];

  // ── 基础聚合 ──────────────────────────────────────────────────

  // 非退款行
  const nonRefundedRows = rows.filter(
    row => !isRefunded(row.refund_status as string)
  );

  // 总销售额
  let totalSales = new Decimal(0);
  for (const row of nonRefundedRows) {
    const amt = toDecimal(row.pay_amount);
    if (amt) totalSales = totalSales.plus(amt);
  }

  // 总订单数（去重）
  const allOrderIds = new Set<string>();
  for (const row of rows) {
    const oid = row.order_id;
    if (oid !== null && oid !== undefined && oid !== "") {
      allOrderIds.add(String(oid));
    }
  }
  const totalOrders = allOrderIds.size;

  // 退款订单数（去重）
  const refundedOrderIds = new Set<string>();
  for (const row of rows) {
    if (isRefunded(row.refund_status as string)) {
      const oid = row.order_id;
      if (oid !== null && oid !== undefined && oid !== "") {
        refundedOrderIds.add(String(oid));
      }
    }
  }
  const refundOrders = refundedOrderIds.size;

  // 总件数
  let totalQuantity = new Decimal(0);
  for (const row of nonRefundedRows) {
    const qty = toDecimal(row.quantity);
    if (qty) totalQuantity = totalQuantity.plus(qty);
  }

  // 退款总额
  let totalRefundAmount = new Decimal(0);
  for (const row of rows) {
    if (isRefunded(row.refund_status as string)) {
      const amt = toDecimal(row.refund_amount);
      if (amt) totalRefundAmount = totalRefundAmount.plus(amt);
    }
  }

  // ── 标量口径 ──────────────────────────────────────────────────

  results.push({
    name: "total_sales",
    displayName: "总销售额",
    value: totalSales.toFixed(2),
    unit: "元",
    formula: "SUM(pay_amount) WHERE refund_status != '已退款'",
  });

  results.push({
    name: "total_orders",
    displayName: "总订单数",
    value: String(totalOrders),
    unit: "个",
    formula: "COUNT(DISTINCT order_id)",
  });

  results.push({
    name: "refund_orders",
    displayName: "退款订单数",
    value: String(refundOrders),
    unit: "个",
    formula: "COUNT(DISTINCT order_id) WHERE refund_status = '已退款'",
  });

  const refundRate =
    totalOrders > 0
      ? new Decimal(refundOrders).div(totalOrders).times(100)
      : new Decimal(0);
  results.push({
    name: "refund_rate",
    displayName: "退款率",
    value: refundRate.toFixed(2),
    unit: "%",
    formula: "退款订单数 / 总订单数 * 100",
  });

  const avgOrderValue =
    totalOrders > 0 ? totalSales.div(totalOrders) : new Decimal(0);
  results.push({
    name: "avg_order_value",
    displayName: "客单价",
    value: avgOrderValue.toFixed(2),
    unit: "元/单",
    formula: "总销售额 / 总订单数",
  });

  const avgItemPrice = totalQuantity.gt(0)
    ? totalSales.div(totalQuantity)
    : new Decimal(0);
  results.push({
    name: "avg_item_price",
    displayName: "件单价",
    value: avgItemPrice.toFixed(2),
    unit: "元/件",
    formula: "总销售额 / SUM(quantity)",
  });

  const avgRefundAmt =
    refundOrders > 0
      ? totalRefundAmount.div(refundOrders)
      : new Decimal(0);
  results.push({
    name: "avg_refund_amount",
    displayName: "平均退款金额",
    value: avgRefundAmt.toFixed(2),
    unit: "元",
    formula: "SUM(refund_amount) / 退款订单数",
  });

  // ── 分组口径 ──────────────────────────────────────────────────

  // 按店铺
  const salesByStore = groupSum(nonRefundedRows, "store_name", "pay_amount");
  results.push({
    name: "sales_by_store",
    displayName: "店铺销售额",
    groups: salesByStore,
    unit: "元",
    formula: "SUM(pay_amount) GROUP BY store_name",
  });

  // 按达人
  const salesByTalent = groupSum(nonRefundedRows, "talent_name", "pay_amount");
  results.push({
    name: "sales_by_talent",
    displayName: "达人销售额",
    groups: salesByTalent,
    unit: "元",
    formula: "SUM(pay_amount) GROUP BY talent_name",
  });

  // 按商品
  const salesByProduct = groupSum(
    nonRefundedRows,
    "product_name",
    "pay_amount"
  );
  results.push({
    name: "sales_by_product",
    displayName: "商品销售额",
    groups: salesByProduct,
    unit: "元",
    formula: "SUM(pay_amount) GROUP BY product_name",
  });

  return results;
}

/**
 * 分组求和辅助函数。
 * 按 groupField 分组，对 sumField 求和，按金额降序排列。
 */
function groupSum(
  rows: StandardRow[],
  groupField: string,
  sumField: string
): Array<{ key: string; value: string }> {
  const groups = new Map<string, Decimal>();

  for (const row of rows) {
    const key = row[groupField];
    if (key === null || key === undefined || key === "") continue;
    const keyStr = String(key).trim();
    if (!keyStr) continue;

    const val = toDecimal(row[sumField]);
    if (!val) continue;

    const current = groups.get(keyStr) ?? new Decimal(0);
    groups.set(keyStr, current.plus(val));
  }

  return Array.from(groups.entries())
    .map(([key, value]) => ({ key, value: value.toFixed(2) }))
    .sort((a, b) => new Decimal(b.value).minus(a.value).toNumber());
}
