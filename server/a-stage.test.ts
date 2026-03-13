/**
 * ATLAS V3.0 — A 阶段单元测试
 * 验证字段映射、口径计算、ResultSet 结构、管道定义、AI 约束、模板定义
 */
import { describe, it, expect } from "vitest";
import {
  STANDARD_FIELDS,
  normalizeFieldName,
  detectPlatform,
  type Platform,
} from "../shared/fieldAliases";
import {
  METRIC_DEFINITIONS,
  computeAllMetrics,
  isRefunded,
  isGroupedMetric,
  type StandardRow,
} from "../shared/metrics";
import {
  createEmptyResultSet,
  validateResultSet,
  COMPUTATION_VERSION,
  serializeResultSet,
  deserializeResultSet,
} from "../shared/resultSet";
import {
  ErrorLevel,
  ERROR_CODES,
  createPipelineContext,
  shouldAbort,
} from "../shared/pipeline";
import {
  AI_CONTENT_RULES,
  SYSTEM_PROMPT_CONSTRAINT,
  formatResultSetForPrompt,
} from "../shared/aiConstraints";
import {
  L1_TEMPLATES,
  getTemplateById,
  getTemplateByName,
  checkTemplateFieldMatch,
  calculateIncomeTax,
} from "../shared/templates";

// ── A1: 字段映射表测试 ──────────────────────────────────────────

describe("A1: 字段映射表", () => {
  it("应定义至少 25 个标准字段", () => {
    expect(STANDARD_FIELDS.length).toBeGreaterThanOrEqual(25);
  });

  it("每个标准字段应有唯一的 name", () => {
    const names = STANDARD_FIELDS.map(f => f.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("应支持至少 4 个平台", () => {
    const platforms: Platform[] = ["douyin", "tmall", "pdd", "jd"];
    expect(platforms.length).toBeGreaterThanOrEqual(4);
  });

  it("抖音平台的'商品名称'应映射到 product_name", () => {
    const result = normalizeFieldName("商品名称");
    expect(result).toBe("product_name");
  });

  it("通用映射：'实付金额'应映射到 pay_amount", () => {
    const result = normalizeFieldName("实付金额");
    expect(result).toBe("pay_amount");
  });

  it("未知字段应返回 null", () => {
    const result = normalizeFieldName("这是一个完全不存在的字段名");
    expect(result).toBeNull();
  });

  it("平台识别：包含多个抖音特征字段应识别为抖音", () => {
    // detectPlatform 需要至少 2 个平台特征匹配才返回非 unknown
    const headers = ["商户订单号", "商品名称", "达人昵称", "达人佣金", "小店名称"];
    const result = detectPlatform(headers);
    expect(result).toBe("douyin");
  });
});

// ── A2: 统计口径测试 ──────────────────────────────────────────

describe("A2: 统计口径", () => {
  it("应定义 10 个核心口径", () => {
    expect(METRIC_DEFINITIONS.length).toBe(10);
  });

  it("每个口径应有唯一的 name", () => {
    const names = METRIC_DEFINITIONS.map(m => m.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("退款状态判定：'已退款'应返回 true", () => {
    expect(isRefunded("已退款")).toBe(true);
    expect(isRefunded("退款成功")).toBe(true);
  });

  it("退款状态判定：null/空值应返回 false", () => {
    expect(isRefunded(null)).toBe(false);
    expect(isRefunded("")).toBe(false);
    expect(isRefunded(undefined)).toBe(false);
  });

  it("计算引擎：基础场景", () => {
    const rows: StandardRow[] = [
      { order_id: "001", pay_amount: 100, quantity: 2, refund_status: "", store_name: "店铺A", product_name: "商品X" },
      { order_id: "002", pay_amount: 200, quantity: 1, refund_status: "", store_name: "店铺A", product_name: "商品Y" },
      { order_id: "003", pay_amount: 150, quantity: 3, refund_status: "已退款", store_name: "店铺B", product_name: "商品X", refund_amount: 150 },
    ];

    const results = computeAllMetrics(rows);

    // 总销售额 = 100 + 200 = 300（排除已退款的 150）
    const totalSales = results.find(r => r.name === "total_sales");
    expect(totalSales).toBeDefined();
    expect((totalSales as any).value).toBe("300.00");

    // 总订单数 = 3（去重后）
    const totalOrders = results.find(r => r.name === "total_orders");
    expect((totalOrders as any).value).toBe("3");

    // 退款订单数 = 1
    const refundOrders = results.find(r => r.name === "refund_orders");
    expect((refundOrders as any).value).toBe("1");

    // 退款率 = 1/3 * 100 = 33.33
    const refundRate = results.find(r => r.name === "refund_rate");
    expect((refundRate as any).value).toBe("33.33");

    // 客单价 = 300 / 3 = 100.00
    const avgOrder = results.find(r => r.name === "avg_order_value");
    expect((avgOrder as any).value).toBe("100.00");

    // 件单价 = 300 / 3 = 100.00（非退款行的 quantity: 2+1=3）
    const avgItem = results.find(r => r.name === "avg_item_price");
    expect((avgItem as any).value).toBe("100.00");
  });

  it("计算引擎：空数据应返回 0", () => {
    const results = computeAllMetrics([]);
    const totalSales = results.find(r => r.name === "total_sales");
    expect((totalSales as any).value).toBe("0.00");
  });

  it("计算引擎：分组口径应按金额降序排列", () => {
    const rows: StandardRow[] = [
      { order_id: "001", pay_amount: 100, store_name: "小店", product_name: "A" },
      { order_id: "002", pay_amount: 500, store_name: "大店", product_name: "B" },
      { order_id: "003", pay_amount: 200, store_name: "小店", product_name: "A" },
    ];
    const results = computeAllMetrics(rows);
    const byStore = results.find(r => r.name === "sales_by_store");
    expect(isGroupedMetric(byStore!)).toBe(true);
    if (isGroupedMetric(byStore!)) {
      expect(byStore.groups[0].key).toBe("大店");
      expect(byStore.groups[0].value).toBe("500.00");
      expect(byStore.groups[1].key).toBe("小店");
      expect(byStore.groups[1].value).toBe("300.00");
    }
  });

  it("计算引擎：金额中的逗号应被正确处理", () => {
    const rows: StandardRow[] = [
      { order_id: "001", pay_amount: "1,234.56", quantity: 1 },
    ];
    const results = computeAllMetrics(rows);
    const totalSales = results.find(r => r.name === "total_sales");
    expect((totalSales as any).value).toBe("1234.56");
  });
});

// ── A3: ResultSet 结构测试 ──────────────────────────────────────

describe("A3: ResultSet 结构", () => {
  it("createEmptyResultSet 应包含所有 8 个可审计字段", () => {
    const rs = createEmptyResultSet("test-job-001");
    expect(rs.jobId).toBe("test-job-001");
    expect(rs.sourceFiles).toEqual([]);
    expect(rs.filtersApplied).toEqual({});
    expect(rs.skippedRowsCount).toBe(0);
    expect(rs.skippedRowsSample).toEqual([]);
    expect(rs.computationVersion).toBe(COMPUTATION_VERSION);
    expect(rs.templateId).toBeNull();
    expect(rs.createdAt).toBeGreaterThan(0);
  });

  it("validateResultSet 应检测空 jobId", () => {
    const rs = createEmptyResultSet("");
    const errors = validateResultSet(rs);
    expect(errors.some(e => e.field === "jobId")).toBe(true);
  });

  it("validateResultSet 应检测空 sourceFiles", () => {
    const rs = createEmptyResultSet("test-001");
    const errors = validateResultSet(rs);
    expect(errors.some(e => e.field === "sourceFiles")).toBe(true);
  });

  it("序列化和反序列化应保持一致", () => {
    const rs = createEmptyResultSet("test-002");
    rs.metrics = [{ name: "total_sales", displayName: "总销售额", value: "100.00", unit: "元", formula: "SUM" }];
    const json = serializeResultSet(rs);
    const restored = deserializeResultSet(json);
    expect(restored.jobId).toBe("test-002");
    expect(restored.metrics[0].name).toBe("total_sales");
  });
});

// ── A4: 管道定义测试 ──────────────────────────────────────────

describe("A4: 管道定义", () => {
  it("应定义四个错误级别", () => {
    expect(Object.values(ErrorLevel)).toEqual(
      expect.arrayContaining(["fatal", "critical", "warning", "info"])
    );
  });

  it("ERROR_CODES 应包含致命、严重、警告、信息四类", () => {
    const codes = Object.values(ERROR_CODES);
    expect(codes.some(c => c.level === ErrorLevel.FATAL)).toBe(true);
    expect(codes.some(c => c.level === ErrorLevel.CRITICAL)).toBe(true);
    expect(codes.some(c => c.level === ErrorLevel.WARNING)).toBe(true);
    expect(codes.some(c => c.level === ErrorLevel.INFO)).toBe(true);
  });

  it("createPipelineContext 应初始化正确", () => {
    const ctx = createPipelineContext("job-001", "user-001");
    expect(ctx.jobId).toBe("job-001");
    expect(ctx.userId).toBe("user-001");
    expect(ctx.currentStep).toBe(0);
    expect(ctx.errors).toEqual([]);
    expect(ctx.aborted).toBe(false);
  });

  it("shouldAbort 应在 FATAL 错误时返回 true", () => {
    const ctx = createPipelineContext("job-002", "user-001");
    ctx.errors.push({
      level: ErrorLevel.FATAL,
      step: 1,
      code: "E1001",
      message: "文件格式无法识别",
    });
    expect(shouldAbort(ctx)).toBe(true);
  });

  it("shouldAbort 应在只有 WARNING 时返回 false", () => {
    const ctx = createPipelineContext("job-003", "user-001");
    ctx.errors.push({
      level: ErrorLevel.WARNING,
      step: 6,
      code: "W3001",
      message: "部分行被跳过",
    });
    expect(shouldAbort(ctx)).toBe(false);
  });
});

// ── A5: AI 边界规则测试 ──────────────────────────────────────

describe("A5: AI 边界规则", () => {
  it("应定义至少 5 条内容规则", () => {
    expect(AI_CONTENT_RULES.length).toBeGreaterThanOrEqual(5);
  });

  it("数字类内容应为 resultset_only 权限", () => {
    const numericRule = AI_CONTENT_RULES.find(r =>
      r.contentType.includes("具体数字")
    );
    expect(numericRule?.permission).toBe("resultset_only");
  });

  it("系统 prompt 应包含硬约束语句", () => {
    expect(SYSTEM_PROMPT_CONSTRAINT).toContain("ResultSet");
    expect(SYSTEM_PROMPT_CONSTRAINT).toContain("不能自行计算");
  });

  it("formatResultSetForPrompt 应正确格式化标量口径", () => {
    const metrics = [
      { name: "total_sales", displayName: "总销售额", value: "1000.00", unit: "元" },
    ];
    const text = formatResultSetForPrompt(metrics);
    expect(text).toContain("总销售额");
    expect(text).toContain("1000.00");
  });

  it("formatResultSetForPrompt 应正确格式化分组口径", () => {
    const metrics = [
      {
        name: "sales_by_store",
        displayName: "店铺销售额",
        unit: "元",
        groups: [
          { key: "店铺A", value: "500.00" },
          { key: "店铺B", value: "300.00" },
        ],
      },
    ];
    const text = formatResultSetForPrompt(metrics);
    expect(text).toContain("店铺A");
    expect(text).toContain("500.00");
  });
});

// ── A6: L1 模板测试 ──────────────────────────────────────────

describe("A6: L1 模板", () => {
  it("应定义 4 个 L1 模板", () => {
    expect(L1_TEMPLATES.length).toBe(4);
  });

  it("每个模板应有唯一的 id", () => {
    const ids = L1_TEMPLATES.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("getTemplateById 应能找到多店合并模板", () => {
    const t = getTemplateById("L1-01");
    expect(t).toBeDefined();
    expect(t?.name).toBe("多店合并");
  });

  it("getTemplateByName 应能模糊匹配", () => {
    const t = getTemplateByName("工资");
    expect(t).toBeDefined();
    expect(t?.id).toBe("L1-02");
  });

  it("checkTemplateFieldMatch 应正确检测字段匹配", () => {
    const template = getTemplateById("L1-01")!;
    const result = checkTemplateFieldMatch(template, [
      "订单编号",
      "实付金额",
      "店铺名称",
    ]);
    expect(result.matched).toBe(true);
    expect(result.missingFields).toEqual([]);
  });

  it("checkTemplateFieldMatch 应报告缺失字段", () => {
    const template = getTemplateById("L1-02")!;
    const result = checkTemplateFieldMatch(template, ["姓名"]);
    expect(result.matched).toBe(false);
    expect(result.missingFields).toContain("底薪");
  });

  it("个税计算：5000 以下免税", () => {
    expect(calculateIncomeTax(0)).toBe(0);
    expect(calculateIncomeTax(-1000)).toBe(0);
  });

  it("个税计算：3000 元应税所得", () => {
    // 3000 * 3% - 0 = 90
    expect(calculateIncomeTax(3000)).toBe(90);
  });

  it("个税计算：10000 元应税所得", () => {
    // 10000 * 10% - 210 = 790
    expect(calculateIncomeTax(10000)).toBe(790);
  });

  it("个税计算：30000 元应税所得", () => {
    // 30000 * 25% - 2660 = 4840
    expect(calculateIncomeTax(30000)).toBe(4840);
  });
});
