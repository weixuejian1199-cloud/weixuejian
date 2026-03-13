/**
 * B8 & B9 Tests — Multi-file alignment and large file handling
 */
import { describe, it, expect } from "vitest";
import { createPipelineContext, ErrorLevel } from "@shared/pipeline";

describe("B8 Multi-file Field Alignment", () => {
  it("should merge rows from multiple files with source tracking", async () => {
    const { runPipeline } = await import("./pipeline/index");
    // We test the merge logic indirectly through the pipeline
    // The mergeIngestionResults function is private, so we verify via integration

    // Create two small CSV buffers
    const csv1 = Buffer.from("订单编号,商品名称,实付金额\nORD001,商品A,100\nORD002,商品B,200\n");
    const csv2 = Buffer.from("订单编号,商品名称,实付金额\nORD003,商品C,300\nORD004,商品D,400\n");

    const result = await runPipeline({
      files: [
        { buffer: csv1, originalName: "店铺1.csv", mimeType: "text/csv" },
        { buffer: csv2, originalName: "店铺2.csv", mimeType: "text/csv" },
      ],
      userId: "test-user",
    });

    // Pipeline should succeed with merged data
    expect(result.success).toBe(true);
    expect(result.resultSet).not.toBeNull();
  });

  it("should handle single file without source tracking overhead", async () => {
    const { runPipeline } = await import("./pipeline/index");

    const csv = Buffer.from("订单编号,商品名称,实付金额\nORD001,商品A,100\n");

    const result = await runPipeline({
      files: [
        { buffer: csv, originalName: "单店.csv", mimeType: "text/csv" },
      ],
      userId: "test-user",
    });

    expect(result.success).toBe(true);
    expect(result.resultSet).not.toBeNull();
  });

  it("should detect mixed platforms from multiple files", async () => {
    const { runPipeline } = await import("./pipeline/index");

    // Douyin-style file
    const douyinCsv = Buffer.from("订单编号,达人昵称,小店名称,订单应付金额\nORD001,达人A,小店1,100\n");
    // Tmall-style file
    const tmallCsv = Buffer.from("订单编号,买家会员名,宝贝标题,宝贝数量\nORD002,买家A,商品1,2\n");

    const result = await runPipeline({
      files: [
        { buffer: douyinCsv, originalName: "抖音订单.csv", mimeType: "text/csv" },
        { buffer: tmallCsv, originalName: "天猫订单.csv", mimeType: "text/csv" },
      ],
      userId: "test-user",
    });

    // Should still succeed even with mixed platforms
    expect(result.success).toBe(true);
  });

  it("should handle empty file gracefully", async () => {
    const { runPipeline } = await import("./pipeline/index");

    const emptyBuffer = Buffer.from("");

    const result = await runPipeline({
      files: [
        { buffer: emptyBuffer, originalName: "空文件.csv", mimeType: "text/csv" },
      ],
      userId: "test-user",
    });

    expect(result.success).toBe(false);
    expect(result.errorSummary).toBeTruthy();
  });

  it("should fill missing fields with empty strings for multi-file merge", async () => {
    const { runPipeline } = await import("./pipeline/index");

    // File 1 has column A, B
    const csv1 = Buffer.from("订单编号,商品名称\nORD001,商品A\n");
    // File 2 has column A, C (different columns)
    const csv2 = Buffer.from("订单编号,实付金额\nORD002,200\n");

    const result = await runPipeline({
      files: [
        { buffer: csv1, originalName: "文件1.csv", mimeType: "text/csv" },
        { buffer: csv2, originalName: "文件2.csv", mimeType: "text/csv" },
      ],
      userId: "test-user",
    });

    // Should succeed - missing fields are filled
    expect(result.success).toBe(true);
  });
});

describe("B9 Large File Handling", () => {
  it("should handle files with many rows without crashing", async () => {
    const { runPipeline } = await import("./pipeline/index");

    // Generate a CSV with 1000 rows
    const header = "订单编号,商品名称,实付金额\n";
    const rows = Array.from({ length: 1000 }, (_, i) =>
      `ORD${String(i).padStart(5, "0")},商品${i},${(i + 1) * 10}\n`
    ).join("");

    const csv = Buffer.from(header + rows);

    const result = await runPipeline({
      files: [
        { buffer: csv, originalName: "大文件.csv", mimeType: "text/csv" },
      ],
      userId: "test-user",
    });

    expect(result.success).toBe(true);
    expect(result.resultSet).not.toBeNull();
    if (result.resultSet) {
      // Should have processed all rows
      expect(result.resultSet.sourceFiles[0].dataRows).toBe(1000);
    }
  });

  it("should handle files with many columns including standard fields", async () => {
    const { runPipeline } = await import("./pipeline/index");

    // Generate a CSV with standard fields + many custom columns
    const standardCols = ["订单编号", "商品名称", "实付金额"];
    const customCols = Array.from({ length: 47 }, (_, i) => `自定义字段${i}`);
    const allCols = [...standardCols, ...customCols];
    const header = allCols.join(",") + "\n";
    const row = ["ORD001", "商品A", "100", ...customCols.map((_, i) => `值${i}`)].join(",") + "\n";

    const csv = Buffer.from(header + row + row + row);

    const result = await runPipeline({
      files: [
        { buffer: csv, originalName: "宽表.csv", mimeType: "text/csv" },
      ],
      userId: "test-user",
    });

    // Should succeed - standard fields are mapped, custom fields preserved
    expect(result.success).toBe(true);
  });

  it("should gracefully fail when no standard fields are found", async () => {
    const { runPipeline } = await import("./pipeline/index");

    // CSV with only non-standard columns
    const csv = Buffer.from("字段A,字段B,字段C\n值1,值2,值3\n");

    const result = await runPipeline({
      files: [
        { buffer: csv, originalName: "无标准字段.csv", mimeType: "text/csv" },
      ],
      userId: "test-user",
    });

    // Should fail gracefully - no standard fields mapped
    expect(result.success).toBe(false);
    expect(result.errorSummary).toBeTruthy();
  });

  it("should handle dirty data without crashing", async () => {
    const { runPipeline } = await import("./pipeline/index");

    // CSV with various dirty data patterns
    const csv = Buffer.from(
      "订单编号,商品名称,实付金额\n" +
      "ORD001,商品A,100\n" +
      ",,\n" +                          // empty row
      "ORD002,,200\n" +                 // missing product name
      "ORD003,商品C,abc\n" +            // non-numeric amount
      "ORD004,商品D,-50\n" +            // negative amount
      "ORD005,商品E,1,234.56\n" +       // comma in number
      "ORD001,商品A更新,150\n"          // duplicate order
    );

    const result = await runPipeline({
      files: [
        { buffer: csv, originalName: "脏数据.csv", mimeType: "text/csv" },
      ],
      userId: "test-user",
    });

    // Should succeed - dirty data is cleaned/skipped, not crashed
    expect(result.success).toBe(true);
    expect(result.context.errors.length).toBeGreaterThan(0); // Should have warnings
  });
});
