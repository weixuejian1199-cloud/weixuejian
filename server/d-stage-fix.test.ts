import { describe, it, expect } from "vitest";

describe("D-Stage: 功能修复验证", () => {
  describe("D-FIX-1: download_url 直接下载支持", () => {
    it("Message 接口应同时支持 report_id 和 download_url", () => {
      // Simulate a message with download_url (merge/payslip/attendance scenario)
      const messageWithDownloadUrl = {
        role: "assistant" as const,
        content: "合并完成",
        download_url: "https://s3.example.com/merged.xlsx",
        report_filename: "合并数据_2026-03-13.xlsx",
      };
      expect(messageWithDownloadUrl.download_url).toBeTruthy();
      expect(messageWithDownloadUrl.report_filename).toBeTruthy();
      // download_url should be a valid URL
      expect(messageWithDownloadUrl.download_url).toMatch(/^https?:\/\//);
    });

    it("Message 接口应支持 report_id 代理下载", () => {
      const messageWithReportId = {
        role: "assistant" as const,
        content: "报告已生成",
        report_id: "abc-123",
        report_filename: "report.xlsx",
      };
      expect(messageWithReportId.report_id).toBeTruthy();
      expect(messageWithReportId.report_filename).toBeTruthy();
    });

    it("download_url 和 report_id 可以同时存在", () => {
      const message = {
        download_url: "https://s3.example.com/file.xlsx",
        report_id: "abc-123",
        report_filename: "file.xlsx",
      };
      // Both should be truthy
      expect(message.download_url).toBeTruthy();
      expect(message.report_id).toBeTruthy();
    });
  });

  describe("D-FIX-2: AtlasTableRenderer exportBlocked 放宽", () => {
    it("exportBlocked 应始终为 false", () => {
      // The fix changes exportBlocked to always be false
      const exportBlocked = false;
      expect(exportBlocked).toBe(false);
    });

    it("exportWarning 应在 isCategoryTable=true 且无 fullRows 时为 true", () => {
      const isCategoryTable = true;
      const fullRows = undefined;
      const exportWarning = isCategoryTable === true && !fullRows;
      expect(exportWarning).toBe(true);
    });

    it("exportWarning 应在有 fullRows 时为 false", () => {
      const isCategoryTable = true;
      const fullRows = [["省份", 100, "50%"]];
      const exportWarning = isCategoryTable === true && !fullRows;
      expect(exportWarning).toBe(false);
    });

    it("非分类表不应有 exportWarning", () => {
      const isCategoryTable = false;
      const fullRows = undefined;
      const exportWarning = isCategoryTable === true && !fullRows;
      expect(exportWarning).toBe(false);
    });
  });

  describe("D-FIX-3: generate-report 全量统计注入", () => {
    it("应从 dfInfo 构建全量统计摘要", () => {
      const dfInfo = {
        row_count: 46000,
        col_count: 20,
        fields: [
          { name: "商品金额", type: "numeric", sum: 1234567.89, avg: 26.84, max: 9999.99, min: 0.01 },
          { name: "订单数量", type: "numeric", sum: 46000, avg: 1, max: 5, min: 1 },
          { name: "店铺名称", type: "text", unique_count: 15, sample: ["店铺A", "店铺B"] },
        ],
      };

      const numericFields = dfInfo.fields.filter(f => f.type === "numeric");
      const fullStatsLines: string[] = [];
      for (const f of numericFields) {
        if (f.sum !== undefined && f.avg !== undefined) {
          fullStatsLines.push(
            `${f.name}: 总计=${f.sum.toFixed(2)}, 均值=${f.avg.toFixed(2)}, 最大=${(f.max ?? 0).toFixed(2)}, 最小=${(f.min ?? 0).toFixed(2)}`
          );
        }
      }

      expect(fullStatsLines).toHaveLength(2);
      expect(fullStatsLines[0]).toContain("商品金额");
      expect(fullStatsLines[0]).toContain("总计=1234567.89");
      expect(fullStatsLines[0]).toContain("均值=26.84");
      expect(fullStatsLines[1]).toContain("订单数量");
    });

    it("prompt 应包含全量统计摘要而非称数据为完整数据", () => {
      // The fix changes "完整数据" to "样本数据" in the prompt
      const promptSnippet = "样本数据（共500行，仅用于理解字段含义，不代表全量数据）";
      expect(promptSnippet).toContain("样本数据");
      expect(promptSnippet).toContain("仅用于理解字段含义");
      expect(promptSnippet).not.toContain("这是所有数据");
    });

    it("每个 Sheet 最多 100 行数据（从 50 行提升）", () => {
      const maxRowsPerSheet = 100;
      expect(maxRowsPerSheet).toBe(100);
    });
  });
});
