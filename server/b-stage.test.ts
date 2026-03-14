/**
 * ATLAS V3.0 — B 阶段单元测试
 * ─────────────────────────────────────────────────────────────────
 * 测试五层架构管道的核心功能
 */

import { describe, it, expect } from "vitest";
import { createPipelineContext } from "@shared/pipeline";
import { ErrorLevel } from "@shared/pipeline";

// ── Layer 2: Governance 测试 ──────────────────────────────────────

import {
  step6DataCleaning,
  step7Deduplication,
  runGovernance,
} from "./pipeline/governance";

describe("B2: Governance 层", () => {
  describe("step6DataCleaning", () => {
    it("应该将原始字段名映射为标准字段名", () => {
      const ctx = createPipelineContext("test-job", "test-user");
      const rawRows = [
        { "订单编号": "001", "实付金额": "100.50", "商品名称": "测试商品" },
      ];
      const fieldMapping = {
        "订单编号": "order_id",
        "实付金额": "pay_amount",
        "商品名称": "product_name",
      };

      const result = step6DataCleaning(ctx, rawRows, fieldMapping);

      expect(result.cleanedRows.length).toBe(1);
      expect(result.cleanedRows[0].order_id).toBe("001");
      expect(result.cleanedRows[0].pay_amount).toBe(100.50);
      expect(result.cleanedRows[0].product_name).toBe("测试商品");
    });

    it("应该跳过空行", () => {
      const ctx = createPipelineContext("test-job", "test-user");
      const rawRows = [
        { "订单编号": "001", "实付金额": "100" },
        { "订单编号": "", "实付金额": "" },
        { "订单编号": "002", "实付金额": "200" },
      ];
      const fieldMapping = {
        "订单编号": "order_id",
        "实付金额": "pay_amount",
      };

      const result = step6DataCleaning(ctx, rawRows, fieldMapping);

      expect(result.cleanedRows.length).toBe(2);
      expect(result.skippedCount).toBe(1);
    });

    it("应该处理数值中的逗号和货币符号", () => {
      const ctx = createPipelineContext("test-job", "test-user");
      const rawRows = [
        { "实付金额": "1,234.56" },
        { "实付金额": "¥2,345.67" },
        { "实付金额": "$3,456.78" },
      ];
      const fieldMapping = { "实付金额": "pay_amount" };

      const result = step6DataCleaning(ctx, rawRows, fieldMapping);

      expect(result.cleanedRows[0].pay_amount).toBe(1234.56);
      expect(result.cleanedRows[1].pay_amount).toBe(2345.67);
      expect(result.cleanedRows[2].pay_amount).toBe(3456.78);
    });

    it("应该记录被跳过行的示例（最多 5 条）", () => {
      const ctx = createPipelineContext("test-job", "test-user");
      const rawRows = Array.from({ length: 10 }, () => ({
        "订单编号": "",
        "实付金额": "",
      }));
      const fieldMapping = {
        "订单编号": "order_id",
        "实付金额": "pay_amount",
      };

      const result = step6DataCleaning(ctx, rawRows, fieldMapping);

      expect(result.skippedCount).toBe(10);
      expect(result.skippedRows.length).toBe(5); // 最多 5 条
    });

    it("应该处理横杠和破折号为 null", () => {
      const ctx = createPipelineContext("test-job", "test-user");
      const rawRows = [
        { "订单编号": "001", "实付金额": "-" },
        { "订单编号": "002", "实付金额": "—" },
      ];
      const fieldMapping = {
        "订单编号": "order_id",
        "实付金额": "pay_amount",
      };

      const result = step6DataCleaning(ctx, rawRows, fieldMapping);

      expect(result.cleanedRows[0].pay_amount).toBeNull();
      expect(result.cleanedRows[1].pay_amount).toBeNull();
    });
  });

  describe("step7Deduplication", () => {
    it("应该基于 order_id 去重，保留最后一条", () => {
      const ctx = createPipelineContext("test-job", "test-user");
      const rows = [
        { order_id: "001", pay_amount: 100 },
        { order_id: "001", pay_amount: 150 }, // 重复，应保留这条
        { order_id: "002", pay_amount: 200 },
      ];

      const result = step7Deduplication(ctx, rows);

      expect(result.afterCount).toBe(2);
      expect(result.duplicatesRemoved).toBe(1);
      // 保留最后一条
      const order001 = result.deduplicatedRows.find(r => r.order_id === "001");
      expect(order001?.pay_amount).toBe(150);
    });

    it("没有 order_id 字段时应跳过去重", () => {
      const ctx = createPipelineContext("test-job", "test-user");
      const rows = [
        { employee_name: "张三", base_salary: 8000 },
        { employee_name: "李四", base_salary: 9000 },
      ];

      const result = step7Deduplication(ctx, rows);

      expect(result.afterCount).toBe(2);
      expect(result.duplicatesRemoved).toBe(0);
    });

    it("没有重复数据时应返回原数据", () => {
      const ctx = createPipelineContext("test-job", "test-user");
      const rows = [
        { order_id: "001", pay_amount: 100 },
        { order_id: "002", pay_amount: 200 },
        { order_id: "003", pay_amount: 300 },
      ];

      const result = step7Deduplication(ctx, rows);

      expect(result.afterCount).toBe(3);
      expect(result.duplicatesRemoved).toBe(0);
    });
  });

  describe("runGovernance", () => {
    it("应该完成清洗+去重的完整流程", () => {
      const ctx = createPipelineContext("test-job", "test-user");
      const rawRows = [
        { "订单编号": "001", "实付金额": "100" },
        { "订单编号": "001", "实付金额": "150" },
        { "订单编号": "", "实付金额": "" },
        { "订单编号": "002", "实付金额": "200" },
      ];
      const fieldMapping = {
        "订单编号": "order_id",
        "实付金额": "pay_amount",
      };

      const result = runGovernance(ctx, rawRows, fieldMapping);

      expect(result.rows.length).toBe(2); // 1 空行 + 1 重复
      expect(result.skippedCount).toBe(1);
      expect(result.duplicatesRemoved).toBe(1);
    });
  });
});

// ── Layer 3: Computation 测试 ──────────────────────────────────────

import { step8Compute } from "./pipeline/computation";

describe("B3: Computation 层", () => {
  it("应该计算核心口径", () => {
    const ctx = createPipelineContext("test-job", "test-user");
    const input = {
      rows: [
        { order_id: "001", pay_amount: 100, quantity: 2, refund_status: null, product_name: "商品A", store_name: "店铺1" },
        { order_id: "002", pay_amount: 200, quantity: 1, refund_status: null, product_name: "商品B", store_name: "店铺1" },
        { order_id: "003", pay_amount: 150, quantity: 3, refund_status: "已退款", refund_amount: 150, product_name: "商品A", store_name: "店铺2" },
      ],
      sourceFiles: [{
        fileName: "test.csv",
        s3Key: "test/test.csv",
        totalRows: 4,
        dataRows: 3,
        fieldCount: 6,
        platform: "douyin",
      }],
      skippedRows: [],
      skippedCount: 0,
      fields: ["order_id", "pay_amount", "quantity", "refund_status", "product_name", "store_name"],
      platform: "douyin",
      isMultiFile: false,
    };

    const rs = step8Compute(ctx, input);

    // 验证 ResultSet 基本结构
    expect(rs.jobId).toBe("test-job");
    expect(rs.rowCount).toBe(3);
    expect(rs.sourcePlatform).toBe("douyin");
    expect(rs.isMultiFile).toBe(false);

    // 验证核心口径
    const totalSales = rs.metrics.find(m => m.name === "total_sales");
    expect(totalSales).toBeDefined();
    expect("value" in totalSales!).toBe(true);
    if ("value" in totalSales!) {
      expect(totalSales.value).toBe("300.00"); // 100 + 200，不含已退款的 150
    }

    const totalOrders = rs.metrics.find(m => m.name === "total_orders");
    expect(totalOrders).toBeDefined();
    if ("value" in totalOrders!) {
      expect(totalOrders.value).toBe("3"); // 3 个不同订单
    }

    const refundOrders = rs.metrics.find(m => m.name === "refund_orders");
    expect(refundOrders).toBeDefined();
    if ("value" in refundOrders!) {
      expect(refundOrders.value).toBe("1");
    }

    const refundRate = rs.metrics.find(m => m.name === "refund_rate");
    expect(refundRate).toBeDefined();
    if ("value" in refundRate!) {
      expect(refundRate.value).toBe("33.33"); // 1/3 * 100
    }
  });

  it("应该执行工资条模板计算", () => {
    const ctx = createPipelineContext("test-job", "test-user");
    const input = {
      rows: [
        {
          employee_name: "张三",
          base_salary: 10000,
          performance_bonus: 2000,
          overtime_pay: 500,
          allowance: 300,
          deduction: 100,
          social_insurance: 800,
          housing_fund: 500,
        },
      ],
      sourceFiles: [{
        fileName: "工资表.xlsx",
        s3Key: "test/salary.xlsx",
        totalRows: 2,
        dataRows: 1,
        fieldCount: 8,
        platform: "unknown",
      }],
      skippedRows: [],
      skippedCount: 0,
      fields: ["employee_name", "base_salary", "performance_bonus", "overtime_pay", "allowance", "deduction", "social_insurance", "housing_fund"],
      platform: "unknown",
      isMultiFile: false,
      templateId: "L1-02",
    };

    const rs = step8Compute(ctx, input);

    // 验证模板计算结果
    const grossPay = rs.metrics.find(m => m.name === "gross_pay");
    expect(grossPay).toBeDefined();
    if (grossPay && "groups" in grossPay) {
      const zhangsan = grossPay.groups.find(g => g.key === "张三");
      expect(zhangsan).toBeDefined();
      expect(zhangsan!.value).toBe("12800.00"); // 10000 + 2000 + 500 + 300
    }

    const netPay = rs.metrics.find(m => m.name === "net_pay");
    expect(netPay).toBeDefined();
    if (netPay && "groups" in netPay) {
      const zhangsan = netPay.groups.find(g => g.key === "张三");
      expect(zhangsan).toBeDefined();
      // 应发 12800 - 扣除 1400 - 个税 = 实发
      // 应税所得 = 12800 - 1400 - 5000 = 6400
      // 个税 = 6400 * 10% - 210 = 430
      // 实发 = 12800 - 1400 - 430 = 10970
      expect(zhangsan!.value).toBe("10970.00");
    }
  });

  it("应该执行利润统计模板计算", () => {
    const ctx = createPipelineContext("test-job", "test-user");
    const input = {
      rows: [
        { pay_amount: 1000, cost: 400, platform_fee: 50, commission: 30, logistics_cost: 20 },
        { pay_amount: 2000, cost: 800, platform_fee: 100, commission: 60, logistics_cost: 40 },
      ],
      sourceFiles: [{
        fileName: "利润数据.csv",
        s3Key: "test/profit.csv",
        totalRows: 3,
        dataRows: 2,
        fieldCount: 5,
        platform: "unknown",
      }],
      skippedRows: [],
      skippedCount: 0,
      fields: ["pay_amount", "cost", "platform_fee", "commission", "logistics_cost"],
      platform: "unknown",
      isMultiFile: false,
      templateId: "L1-04",
    };

    const rs = step8Compute(ctx, input);

    const totalRevenue = rs.metrics.find(m => m.name === "total_revenue");
    expect(totalRevenue).toBeDefined();
    if ("value" in totalRevenue!) {
      expect(totalRevenue.value).toBe("3000.00");
    }

    const grossProfit = rs.metrics.find(m => m.name === "gross_profit");
    expect(grossProfit).toBeDefined();
    if ("value" in grossProfit!) {
      expect(grossProfit.value).toBe("1800.00"); // 3000 - 1200
    }

    const netProfit = rs.metrics.find(m => m.name === "net_profit");
    expect(netProfit).toBeDefined();
    if ("value" in netProfit!) {
      expect(netProfit.value).toBe("1500.00"); // 1800 - (150+90+60) = 1800 - 300
    }
  });

  it("ResultSet 应包含所有可审计字段", () => {
    const ctx = createPipelineContext("test-job", "test-user");
    const input = {
      rows: [{ order_id: "001", pay_amount: 100 }],
      sourceFiles: [{
        fileName: "test.csv",
        s3Key: "test/test.csv",
        totalRows: 2,
        dataRows: 1,
        fieldCount: 2,
        platform: "unknown",
      }],
      skippedRows: [],
      skippedCount: 0,
      fields: ["order_id", "pay_amount"],
      platform: "unknown",
      isMultiFile: false,
    };

    const rs = step8Compute(ctx, input);

    // 验证 8 个可审计字段
    expect(rs.jobId).toBe("test-job");
    expect(rs.sourceFiles).toHaveLength(1);
    expect(rs.filtersApplied).toBeDefined();
    expect(rs.skippedRowsCount).toBe(0);
    expect(rs.skippedRowsSample).toHaveLength(0);
    expect(rs.computationVersion).toBeDefined();
    expect(rs.templateId).toBeNull();
    expect(rs.createdAt).toBeGreaterThan(0);
  });
});

// ── Layer 4: Expression 测试 ──────────────────────────────────────

import { buildExpressionPrompt, buildDataSummary } from "./pipeline/expression";
import { createEmptyResultSet } from "@shared/resultSet";

describe("B4: Expression 层", () => {
  it("系统 prompt 应包含硬约束", () => {
    const rs = createEmptyResultSet("test-job");
    rs.metrics = [
      { name: "total_sales", displayName: "总销售额", value: "1000.00", unit: "元", formula: "SUM(pay_amount)" },
    ];
    rs.sourceFiles = [{
      fileName: "test.csv",
      s3Key: "test/test.csv",
      totalRows: 10,
      dataRows: 9,
      fieldCount: 5,
      platform: "douyin",
    }];
    rs.rowCount = 9;

    const output = buildExpressionPrompt(rs);

    // 验证硬约束存在
    expect(output.systemPrompt).toContain("所有数字必须来自 V3.0 Pipeline 的 ResultSet");
    expect(output.systemPrompt).toContain("不能自行计算");
    // 验证数据注入
    expect(output.systemPrompt).toContain("总销售额");
    expect(output.systemPrompt).toContain("1000.00");
    // 验证数据概况
    expect(output.systemPrompt).toContain("test.csv");
    expect(output.systemPrompt).toContain("9");
  });

  it("数据摘要应包含核心指标", () => {
    const rs = createEmptyResultSet("test-job");
    rs.metrics = [
      { name: "total_sales", displayName: "总销售额", value: "5000.00", unit: "元", formula: "SUM(pay_amount)" },
      { name: "total_orders", displayName: "总订单数", value: "100", unit: "个", formula: "COUNT(DISTINCT order_id)" },
    ];
    rs.sourceFiles = [{
      fileName: "data.xlsx",
      s3Key: "test/data.xlsx",
      totalRows: 101,
      dataRows: 100,
      fieldCount: 10,
      platform: "tmall",
    }];
    rs.sourcePlatform = "tmall";
    rs.rowCount = 100;

    const summary = buildDataSummary(rs);

    expect(summary).toContain("总销售额");
    expect(summary).toContain("5000.00");
    expect(summary).toContain("总订单数");
    expect(summary).toContain("100");
    expect(summary).toContain("tmall");
  });
});

// ── Layer 1: Ingestion 部分测试（不依赖 S3）──────────────────────

import {
  step3FormatParse,
  step4PlatformDetect,
  step5FieldMapping,
} from "./pipeline/ingestion";

describe("B1: Ingestion 层（非 S3 依赖部分）", () => {
  describe("step3FormatParse", () => {
    it("应该解析 CSV 内容", () => {
      const ctx = createPipelineContext("test-job", "test-user");
      const csvContent = Buffer.from(
        "订单编号,实付金额,商品名称\n001,100.50,测试商品\n002,200.00,另一商品",
        "utf-8"
      );

      const result = step3FormatParse(ctx, csvContent, "test.csv");

      expect(result).not.toBeNull();
      expect(result!.headers).toContain("订单编号");
      expect(result!.headers).toContain("实付金额");
      expect(result!.dataRows).toBe(2);
    });

    it("空文件应返回 null 并设置错误", () => {
      const ctx = createPipelineContext("test-job", "test-user");
      const csvContent = Buffer.from("订单编号,实付金额\n", "utf-8");

      const result = step3FormatParse(ctx, csvContent, "empty.csv");

      expect(result).toBeNull();
      expect(ctx.aborted).toBe(true);
    });
  });

  describe("step4PlatformDetect", () => {
    it("应该识别抖音平台", () => {
      const ctx = createPipelineContext("test-job", "test-user");
      const headers = ["订单编号", "达人昵称", "小店名称", "商品实付", "实付金额"];

      const result = step4PlatformDetect(ctx, headers);

      expect(result.platform).toBe("douyin");
      expect(result.confidence).toBeGreaterThanOrEqual(2);
    });

    it("应该识别天猫平台", () => {
      const ctx = createPipelineContext("test-job", "test-user");
      const headers = ["订单编号", "买家会员名", "宝贝标题", "宝贝数量", "实付金额"];

      const result = step4PlatformDetect(ctx, headers);

      expect(result.platform).toBe("tmall");
    });

    it("无法识别时应返回 unknown", () => {
      const ctx = createPipelineContext("test-job", "test-user");
      const headers = ["姓名", "底薪", "绩效"];

      const result = step4PlatformDetect(ctx, headers);

      expect(result.platform).toBe("unknown");
    });
  });

  describe("step5FieldMapping", () => {
    it("应该映射标准字段名", () => {
      const ctx = createPipelineContext("test-job", "test-user");
      const headers = ["订单编号", "实付金额", "商品名称", "自定义字段"];

      const result = step5FieldMapping(ctx, headers);

      expect(result.mappedFields["订单编号"]).toBe("order_id");
      expect(result.mappedFields["实付金额"]).toBe("pay_amount");
      expect(result.mappedFields["商品名称"]).toBe("product_name");
      expect(result.unmappedFields).toContain("自定义字段");
    });

    it("所有字段都无法映射时应中断管道", () => {
      const ctx = createPipelineContext("test-job", "test-user");
      const headers = ["xxx_field_1", "yyy_field_2"];

      step5FieldMapping(ctx, headers);

      expect(ctx.aborted).toBe(true);
    });
  });
});
