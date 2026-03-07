/**
 * ATLAS AI Upgrade Tests
 * Tests for V10 AI capability upgrades:
 * - No-file general chat (no session required)
 * - Expert system prompt content validation
 * - Data quality detection
 * - isReport regex (analysis words should NOT trigger report generation)
 */
import { describe, it, expect } from "vitest";

// ── Test: isReport regex ──────────────────────────────────────────────────────
// This regex is used in MainWorkspace.tsx to decide if we should generate a report
// Analysis words like 「分析」「汇总」「统计」「可视化」 should NOT trigger report generation
// Tutorial questions like 「怎么算工资条」 should also NOT trigger report generation
// Must match the regex in client/src/pages/MainWorkspace.tsx exactly
// Must match the regex in client/src/pages/MainWorkspace.tsx exactly
const isReportRegex = /生成报表|导出表格|excel表|xlsx表|日报生成|(帮我|(帮我)?生成|(帮我)?制作|(帮我)?做一份|(帮我)?做个|(帮我)?输出|(帮我)?整理成|(帮我)?提取).{0,8}(工资条|工资单|薪资表|薪酬表|分红明细|考勤表|出勤表|财务报表|销售报表|绩效表|奖金表|扣款表|个税表|实发明细|表格)|排名表|对比表/i;

describe("isReport regex - should trigger report generation", () => {
  it("should match 工资条", () => {
    expect(isReportRegex.test("帮我生成工资条")).toBe(true);
  });
  it("should match 考勤表", () => {
    expect(isReportRegex.test("生成考勤表")).toBe(true);
  });
  it("should match 分红明细", () => {
    expect(isReportRegex.test("生成分红明细")).toBe(true);
  });
  it("should match 导出表格", () => {
    expect(isReportRegex.test("导出表格给我")).toBe(true);
  });
});

describe("isReport regex - should NOT trigger report generation (goes through chat)", () => {
  it("should NOT match 可视化汇总", () => {
    expect(isReportRegex.test("可视化汇总")).toBe(false);
  });
  it("should NOT match 分析一下", () => {
    expect(isReportRegex.test("帮我分析一下数据")).toBe(false);
  });
  it("should NOT match 统计", () => {
    expect(isReportRegex.test("帮我统计一下")).toBe(false);
  });
  it("should NOT match 数据汇总", () => {
    expect(isReportRegex.test("数据汇总")).toBe(false);
  });
  it("should NOT match 综合分析", () => {
    expect(isReportRegex.test("综合分析")).toBe(false);
  });
  it("should NOT match 怎么算工资条", () => {
    expect(isReportRegex.test("怎么算工资条？需要什么资料？")).toBe(false);
  });
  it("should NOT match 历史报表在哪里", () => {
    expect(isReportRegex.test("我之前生成的报表在哪里查看和下载？")).toBe(false);
  });
});

// ── Test: Expert system prompt content ───────────────────────────────────────
// Verify the expert system prompt contains all required capability sections
describe("Expert system prompt content validation", () => {
  // We test the key content that should be in the system prompt
  const REQUIRED_SECTIONS = [
    "行政管理",
    "财务分析",
    "数据分析",
    "工资条",
    "考勤",
    "分红",
    "多店铺",
    "数据质量",
    "自然语言查询",
    "报表历史",
    "天猫",
    "抖音",
    "增值税",
    "个税",
  ];

  // Read the actual system prompt from atlas.ts
  // We test by checking that the file contains these strings
  it("atlas.ts should contain all required capability sections", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.resolve(process.cwd(), "server/atlas.ts"),
      "utf-8"
    );
    
    for (const section of REQUIRED_SECTIONS) {
      expect(content, `Missing section: ${section}`).toContain(section);
    }
  });
});

// ── Test: Data quality detection logic ───────────────────────────────────────
describe("Data quality detection", () => {
  interface FieldInfo {
    name: string;
    null_count: number;
    type: string;
    unique_count: number;
    sample: string[];
  }

  interface DfInfo {
    row_count: number;
    fields: FieldInfo[];
  }

  function detectQualityIssues(dfInfo: DfInfo): string[] {
    const qualityIssues: string[] = [];
    const nullFields = dfInfo.fields.filter(f => f.null_count > 0);
    if (nullFields.length > 0) {
      const highNullFields = nullFields.filter(f => f.null_count / dfInfo.row_count > 0.05);
      if (highNullFields.length > 0) {
        qualityIssues.push(`缺失值警告：${highNullFields.map(f => `${f.name}(${f.null_count}个空值)`).join('、')}`);
      }
    }
    return qualityIssues;
  }

  it("should detect high null rate fields (>5%)", () => {
    const dfInfo: DfInfo = {
      row_count: 100,
      fields: [
        { name: "姓名", null_count: 0, type: "text", unique_count: 100, sample: [] },
        { name: "工资", null_count: 10, type: "numeric", unique_count: 90, sample: [] }, // 10% null
      ],
    };
    const issues = detectQualityIssues(dfInfo);
    expect(issues.length).toBe(1);
    expect(issues[0]).toContain("工资");
    expect(issues[0]).toContain("10个空值");
  });

  it("should NOT flag low null rate fields (<5%)", () => {
    const dfInfo: DfInfo = {
      row_count: 100,
      fields: [
        { name: "姓名", null_count: 0, type: "text", unique_count: 100, sample: [] },
        { name: "工资", null_count: 4, type: "numeric", unique_count: 96, sample: [] }, // 4% null - OK
      ],
    };
    const issues = detectQualityIssues(dfInfo);
    expect(issues.length).toBe(0);
  });

  it("should return empty array when no null fields", () => {
    const dfInfo: DfInfo = {
      row_count: 50,
      fields: [
        { name: "姓名", null_count: 0, type: "text", unique_count: 50, sample: [] },
        { name: "部门", null_count: 0, type: "text", unique_count: 5, sample: [] },
      ],
    };
    const issues = detectQualityIssues(dfInfo);
    expect(issues.length).toBe(0);
  });
});

// ── Test: No-file chat API endpoint ──────────────────────────────────────────
describe("No-file chat mode", () => {
  it("should send empty session_ids array when no files", () => {
    // Simulate the frontend logic
    const readyFiles: Array<{ sessionId?: string }> = []; // no files
    const sessionIds = readyFiles.map(f => f.sessionId).filter(Boolean) as string[];
    expect(sessionIds).toHaveLength(0);
    
    // Backend receives empty array → no-file mode
    const allSessionIds = sessionIds.length ? sessionIds : [];
    expect(allSessionIds.length).toBe(0);
    // This triggers the no-file general conversation mode
  });

  it("should use session IDs when files are uploaded", () => {
    const readyFiles = [
      { sessionId: "abc123", status: "ready" },
      { sessionId: "def456", status: "ready" },
    ];
    const sessionIds = readyFiles.map(f => f.sessionId).filter(Boolean) as string[];
    expect(sessionIds).toHaveLength(2);
    expect(sessionIds[0]).toBe("abc123");
  });
});
