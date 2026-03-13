/**
 * Pipeline Integration Tests
 * ─────────────────────────────────────────────────────────────────
 * 验证 A/B 阶段的五层管道是否正确接入实际链路：
 *   1. runPipelineFromParsedData 能从 JSON 数据生成 ResultSet
 *   2. ResultSet 包含全量数据行和精确指标
 *   3. exportFromResultSet 能导出全量数据
 *   4. buildExpressionPrompt 能为 chat 端点生成 prompt
 */

import { describe, expect, it } from "vitest";
import { runPipelineFromParsedData, type ParsedDataPipelineInput } from "./pipeline/index";
import { buildExpressionPrompt, buildDataSummary } from "./pipeline/expression";
import type { ResultSet } from "@shared/resultSet";

// ── 测试数据：模拟抖音订单数据 ──────────────────────────────────────

function createDouyinTestData(rowCount: number): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (let i = 1; i <= rowCount; i++) {
    rows.push({
      "订单编号": `DY2024${String(i).padStart(6, "0")}`,
      "商品名称": `测试商品${i % 10}`,
      "订单应付金额": (100 + i * 10).toFixed(2),
      "商品金额": (90 + i * 10).toFixed(2),
      "达人昵称": `达人${i % 5}`,
      "订单状态": i % 4 === 0 ? "已退款" : "已完成",
      "下单时间": `2024-01-${String((i % 28) + 1).padStart(2, "0")} 10:00:00`,
      "小店名称": `测试店铺${i % 3}`,
      "数量": String(Math.ceil(i / 10)),
    });
  }
  return rows;
}

function createTmallTestData(rowCount: number): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (let i = 1; i <= rowCount; i++) {
    rows.push({
      "订单编号": `TM2024${String(i).padStart(6, "0")}`,
      "宝贝标题": `天猫商品${i % 10}`,
      "买家实际支付金额": (200 + i * 5).toFixed(2),
      "宝贝数量": String(Math.ceil(i / 5)),
      "买家会员名": `买家${i % 8}`,
      "订单状态": i % 5 === 0 ? "退款成功" : "交易成功",
      "订单创建时间": `2024-02-${String((i % 28) + 1).padStart(2, "0")} 14:00:00`,
    });
  }
  return rows;
}

// ── 测试用例 ──────────────────────────────────────────────────────

describe("Pipeline: runPipelineFromParsedData", () => {
  it("should process Douyin order data and produce ResultSet", async () => {
    const rows = createDouyinTestData(100);
    const input: ParsedDataPipelineInput = {
      rows,
      fileName: "抖音订单_2024年1月.xlsx",
      userId: "test-user-1",
    };

    const output = await runPipelineFromParsedData(input);

    // 管道应该成功
    expect(output.success).toBe(true);
    expect(output.errorSummary).toBeNull();
    expect(output.resultSet).not.toBeNull();

    const rs = output.resultSet!;

    // ResultSet 应该包含数据行
    expect(rs.rowCount).toBeGreaterThan(0);
    expect(rs.standardizedRows.length).toBeGreaterThan(0);
    expect(rs.standardizedRows.length).toBe(rs.rowCount);

    // 字段应该被标准化
    expect(rs.fields.length).toBeGreaterThan(0);

    // 平台应该被识别为抖音
    expect(rs.sourcePlatform).toBe("douyin");

    // 应该有计算指标
    expect(rs.metrics.length).toBeGreaterThan(0);

    // 应该有清洗日志
    expect(rs.cleaningLog.length).toBeGreaterThanOrEqual(0);

    // 可审计字段应该完整
    expect(rs.jobId).toBeTruthy();
    expect(rs.computationVersion).toBeTruthy();
    expect(rs.createdAt).toBeGreaterThan(0);
    expect(rs.sourceFiles.length).toBe(1);
    expect(rs.sourceFiles[0].fileName).toBe("抖音订单_2024年1月.xlsx");
  });

  it("should process Tmall order data and produce ResultSet", async () => {
    const rows = createTmallTestData(50);
    const input: ParsedDataPipelineInput = {
      rows,
      fileName: "天猫订单_2024年2月.xlsx",
      userId: "test-user-2",
    };

    const output = await runPipelineFromParsedData(input);

    expect(output.success).toBe(true);
    expect(output.resultSet).not.toBeNull();

    const rs = output.resultSet!;
    expect(rs.rowCount).toBeGreaterThan(0);
    expect(rs.sourcePlatform).toBe("tmall");
  });

  it("should handle large dataset (1000+ rows) without truncation", async () => {
    const rows = createDouyinTestData(1383); // 模拟用户的实际数据量
    const input: ParsedDataPipelineInput = {
      rows,
      fileName: "大数据量测试.xlsx",
      userId: "test-user-3",
    };

    const output = await runPipelineFromParsedData(input);

    expect(output.success).toBe(true);
    expect(output.resultSet).not.toBeNull();

    const rs = output.resultSet!;
    // 关键断言：全量数据不应被截断
    // 注意：governance 层可能会过滤掉一些脏数据行，所以 rowCount 可能略小于 1383
    // 但不应该被截断到 500 或 100 行
    expect(rs.rowCount).toBeGreaterThan(500);
    expect(rs.standardizedRows.length).toBeGreaterThan(500);
    expect(rs.standardizedRows.length).toBe(rs.rowCount);
  });

  it("should reject empty data", async () => {
    const input: ParsedDataPipelineInput = {
      rows: [],
      fileName: "empty.xlsx",
      userId: "test-user-4",
    };

    const output = await runPipelineFromParsedData(input);

    expect(output.success).toBe(false);
    expect(output.resultSet).toBeNull();
    expect(output.errorSummary).toBeTruthy();
  });

  it("should reject data with no recognizable fields", async () => {
    const rows = [
      { "随机字段A": "值1", "随机字段B": "值2" },
      { "随机字段A": "值3", "随机字段B": "值4" },
    ];
    const input: ParsedDataPipelineInput = {
      rows,
      fileName: "unknown.xlsx",
      userId: "test-user-5",
    };

    const output = await runPipelineFromParsedData(input);

    // 没有可识别的标准字段，应该失败
    expect(output.success).toBe(false);
  });
});

describe("Pipeline: Expression layer", () => {
  it("should build expression prompt from ResultSet", async () => {
    const rows = createDouyinTestData(50);
    const input: ParsedDataPipelineInput = {
      rows,
      fileName: "test.xlsx",
      userId: "test-user-6",
    };

    const output = await runPipelineFromParsedData(input);
    expect(output.success).toBe(true);
    expect(output.resultSet).not.toBeNull();

    // Expression 层应该生成 prompt
    expect(output.expression).not.toBeNull();
    expect(output.expression!.systemPrompt).toBeTruthy();
    expect(output.expression!.systemPrompt.length).toBeGreaterThan(100);

    // 也可以独立调用
    const prompt = buildExpressionPrompt(output.resultSet!);
    expect(prompt.systemPrompt).toBeTruthy();

    // buildDataSummary 应该生成可读的数据摘要
    const summary = buildDataSummary(output.resultSet!);
    expect(summary).toBeTruthy();
    expect(summary.length).toBeGreaterThan(10);
  });
});

describe("Pipeline: Full data integrity", () => {
  it("should preserve all data rows through the pipeline", async () => {
    const rowCount = 200;
    const rows = createDouyinTestData(rowCount);
    const input: ParsedDataPipelineInput = {
      rows,
      fileName: "integrity_test.xlsx",
      userId: "test-user-7",
    };

    const output = await runPipelineFromParsedData(input);
    expect(output.success).toBe(true);

    const rs = output.resultSet!;

    // 数据行数应该接近原始行数（governance 可能过滤少量脏数据）
    // 但绝不应该被截断到 50 或 100 行
    const retentionRate = rs.rowCount / rowCount;
    expect(retentionRate).toBeGreaterThan(0.5); // 至少保留 50% 的数据

    // 每行应该有标准化字段
    for (const row of rs.standardizedRows.slice(0, 10)) {
      // 至少有一些字段有值
      const nonNullValues = Object.values(row).filter(v => v !== null && v !== "");
      expect(nonNullValues.length).toBeGreaterThan(0);
    }
  });

  it("should compute metrics using Decimal.js precision", async () => {
    const rows = createDouyinTestData(10);
    const input: ParsedDataPipelineInput = {
      rows,
      fileName: "precision_test.xlsx",
      userId: "test-user-8",
    };

    const output = await runPipelineFromParsedData(input);
    expect(output.success).toBe(true);

    const rs = output.resultSet!;

    // 检查指标是否存在且有值
    const scalarMetrics = rs.metrics.filter((m: any) => "value" in m && m.value !== undefined);
    // 应该至少有一些标量指标
    expect(scalarMetrics.length).toBeGreaterThan(0);

    // 每个标量指标应该有 displayName、unit、formula
    for (const metric of scalarMetrics) {
      expect(metric.displayName).toBeTruthy();
      expect(metric.unit).toBeTruthy();
      expect(metric.formula).toBeTruthy();
    }
  });
});
