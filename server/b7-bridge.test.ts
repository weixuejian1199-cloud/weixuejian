/**
 * B7 Bridge Tests — Pipeline integration with atlas.ts
 * Tests the bridge module that connects the new pipeline to the existing upload flow.
 */
import { describe, it, expect, vi } from "vitest";

// Test the bridge module's exported functions exist and have correct signatures
describe("B7 Pipeline Bridge", () => {
  it("should export runPipelineInBackground function", async () => {
    const bridge = await import("./pipeline/bridge");
    expect(typeof bridge.runPipelineInBackground).toBe("function");
  });

  it("should export saveResultSet function", async () => {
    const bridge = await import("./pipeline/bridge");
    expect(typeof bridge.saveResultSet).toBe("function");
  });

  it("should export getResultSetForSession function", async () => {
    const bridge = await import("./pipeline/bridge");
    expect(typeof bridge.getResultSetForSession).toBe("function");
  });

  it("should export getResultSetById function", async () => {
    const bridge = await import("./pipeline/bridge");
    expect(typeof bridge.getResultSetById).toBe("function");
  });

  // Solution B: 新增函数导出测试
  it("should export runPipelineFromParsedData function (Solution B)", async () => {
    const bridge = await import("./pipeline/bridge");
    expect(typeof bridge.runPipelineFromParsedData).toBe("function");
  });

  it("should export runParsedPipelineInBackground function (Solution B)", async () => {
    const bridge = await import("./pipeline/bridge");
    expect(typeof bridge.runParsedPipelineInBackground).toBe("function");
  });

  it("should run runPipelineFromParsedData with valid data and return ResultSet", async () => {
    const bridge = await import("./pipeline/bridge");
    // 使用电商订单数据，并提供正确的 fieldMapping（原始名 → 标准名）
    // fieldMapping 由 fieldAliases.normalizeFieldNames 生成，格式为 { "原始字段名": "standard_field_name" }
    const rawRows = [
      { "订单号": "DY001", "实付金额": "500", "订单应付金额": "550" },
      { "订单号": "DY002", "实付金额": "600", "订单应付金额": "650" },
      { "订单号": "DY003", "实付金额": "700", "订单应付金额": "750" },
    ];
    // fieldMapping: 原始字段名 → STANDARD_FIELDS 中的标准名
    // "订单号" → "order_id"，"实付金额" → "pay_amount"
    const fieldMapping: Record<string, string> = {
      "订单号": "order_id",
      "实付金额": "pay_amount",
      "订单应付金额": "pay_amount",
    };
    const result = await bridge.runPipelineFromParsedData(
      "test-session-001",
      0,
      rawRows,
      fieldMapping,
      "test.xlsx"
    );
    expect(result.success).toBe(true);
    expect(result.resultSet).toBeDefined();
    expect(result.resultSet?.rowCount).toBe(3);
    expect(result.resultSet?.metrics.length).toBeGreaterThan(0);
  });

  it("should handle empty rawRows gracefully in runPipelineFromParsedData", async () => {
    const bridge = await import("./pipeline/bridge");
    const result = await bridge.runPipelineFromParsedData(
      "test-session-empty",
      0,
      [],
      {},
      "empty.xlsx"
    );
    // 空数据应返回失败（清洗后无有效数据）
    expect(result.success).toBe(false);
    expect(result.errorSummary).toBeDefined();
  });
});

// Test pipeline integration with atlas.ts import
describe("B7 Atlas Integration", () => {
  it("should have pipeline bridge imported in atlas.ts", async () => {
    // Verify the import exists in atlas.ts by reading the file
    const fs = await import("fs");
    const atlasContent = fs.readFileSync("server/atlas.ts", "utf-8");
    // V3.0: import now includes getResultSetForSession as well
    expect(atlasContent).toContain('runPipelineInBackground');
    expect(atlasContent).toContain('from "./pipeline/bridge"');
  });

  it("should call runPipelineInBackground in upload endpoint", async () => {
    const fs = await import("fs");
    const atlasContent = fs.readFileSync("server/atlas.ts", "utf-8");
    expect(atlasContent).toContain("runPipelineInBackground(sessionId, userId, buffer, originalname, mimetype)");
  });

  it("should have non-blocking pipeline call (V2.4: bridge handles all errors internally)", async () => {
    const fs = await import("fs");
    const atlasContent = fs.readFileSync("server/atlas.ts", "utf-8");
    // V2.4: runPipelineInBackground is called directly (no .catch wrapper needed)
    // because bridge.ts handles all exceptions internally and writes success/failed status
    expect(atlasContent).toContain('runPipelineInBackground(sessionId, userId, buffer, originalname, mimetype)');
    // Verify bridge.ts handles errors internally (writes failed status on exception)
    const bridgeContent = fs.readFileSync("server/pipeline/bridge.ts", "utf-8");
    expect(bridgeContent).toContain('pipelineStatus: "failed"');
    expect(bridgeContent).toContain('pipelineStatus: "success"');
  });
});

// Test pipeline module structure
describe("B7 Pipeline Module Structure", () => {
  it("should export runPipeline from pipeline/index", async () => {
    const pipeline = await import("./pipeline/index");
    expect(typeof pipeline.runPipeline).toBe("function");
  });

  it("should have all 5 layers available", async () => {
    const ingestion = await import("./pipeline/ingestion");
    const governance = await import("./pipeline/governance");
    const computation = await import("./pipeline/computation");
    const expression = await import("./pipeline/expression");
    const delivery = await import("./pipeline/delivery");

    // Check each module has at least one exported function
    const ingestionExports = Object.values(ingestion).filter(v => typeof v === 'function');
    const governanceExports = Object.values(governance).filter(v => typeof v === 'function');
    const computationExports = Object.values(computation).filter(v => typeof v === 'function');
    const expressionExports = Object.values(expression).filter(v => typeof v === 'function');
    const deliveryExports = Object.values(delivery).filter(v => typeof v === 'function');

    expect(ingestionExports.length).toBeGreaterThan(0);
    expect(governanceExports.length).toBeGreaterThan(0);
    expect(computationExports.length).toBeGreaterThan(0);
    expect(expressionExports.length).toBeGreaterThan(0);
    expect(deliveryExports.length).toBeGreaterThan(0);
  });
});

// Test ResultSet schema alignment
describe("B7 ResultSet Schema", () => {
  it("should have resultSetId column in sessions schema", async () => {
    const fs = await import("fs");
    const schemaContent = fs.readFileSync("drizzle/schema.ts", "utf-8");
    // Sessions table should have resultSetId field
    expect(schemaContent).toContain('resultSetId');
    // It should be in the sessions table definition
    const sessionsBlock = schemaContent.split('export const sessions')[1]?.split('});')[0] || '';
    expect(sessionsBlock).toContain('resultSetId');
  });

  it("should have result_sets table in schema", async () => {
    const fs = await import("fs");
    const schemaContent = fs.readFileSync("drizzle/schema.ts", "utf-8");
    expect(schemaContent).toContain('export const resultSets');
    expect(schemaContent).toContain('"result_sets"');
  });

  it("should have all 8 auditable fields in result_sets schema", async () => {
    const fs = await import("fs");
    const schemaContent = fs.readFileSync("drizzle/schema.ts", "utf-8");
    const rsBlock = schemaContent.split('export const resultSets')[1]?.split('});')[0] || '';

    // 8 auditable fields from the V3.0 spec
    expect(rsBlock).toContain('sourceFiles');
    expect(rsBlock).toContain('filtersApplied');
    expect(rsBlock).toContain('skippedRowsCount');
    expect(rsBlock).toContain('skippedRowsSample');
    expect(rsBlock).toContain('metrics');
    expect(rsBlock).toContain('computationVersion');
    expect(rsBlock).toContain('templateId');
    expect(rsBlock).toContain('generatedAt');
  });
});
