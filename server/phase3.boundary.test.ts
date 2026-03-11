/**
 * ATLAS Phase 3 — 边界数据回归测试
 * ──────────────────────────────────────────────────────────────────────────────
 * 覆盖以下四类边界场景：
 *   1. 极端大数值（工资字段 99999999）→ outlier 检测正确触发
 *   2. 空文件 / 仅有表头无数据 → 友好错误，不崩溃
 *   3. 文件名含特殊字符（淘宝#流水&2026.xlsx）→ 平台关键词识别正常
 *   4. 文件名无平台关键词（1月数据.xlsx）→ 降级处理（回退为文件名去扩展名）
 */
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";

// ── 复用 atlas.ts 中的纯函数（在测试中内联实现，与生产逻辑保持一致）──────────

type FieldType = "numeric" | "text" | "datetime";

interface FieldInfo {
  name: string;
  type: FieldType;
  null_count: number;
  unique_count: number;
  sample: (string | number)[];
}

interface DataFrameInfo {
  row_count: number;
  col_count: number;
  fields: FieldInfo[];
  preview: Record<string, unknown>[];
}

function inferType(values: unknown[]): FieldType {
  const nonNull = values.filter(v => v !== null && v !== undefined && v !== "");
  if (nonNull.length === 0) return "text";
  const numericCount = nonNull.filter(v => !isNaN(Number(v))).length;
  if (numericCount / nonNull.length > 0.8) return "numeric";
  const datePatterns = [/^\d{4}[-/]\d{2}[-/]\d{2}/, /^\d{2}[-/]\d{2}[-/]\d{4}/];
  const dateCount = nonNull.filter(v => datePatterns.some(p => p.test(String(v)))).length;
  if (dateCount / nonNull.length > 0.5) return "datetime";
  return "text";
}

function buildDataFrameInfo(data: Record<string, unknown>[]): DataFrameInfo {
  if (data.length === 0) {
    return { row_count: 0, col_count: 0, fields: [], preview: [] };
  }
  const columns = Object.keys(data[0]);
  const fields: FieldInfo[] = columns.map(col => {
    const values = data.map(row => row[col]);
    const nonNull = values.filter(v => v !== null && v !== undefined && v !== "");
    const unique = new Set(nonNull.map(String)).size;
    const type = inferType(values);
    const sample = nonNull.slice(0, 5).map(v => (type === "numeric" ? Number(v) : String(v)));
    return {
      name: col,
      type,
      null_count: values.length - nonNull.length,
      unique_count: unique,
      sample,
    };
  });
  return {
    row_count: data.length,
    col_count: columns.length,
    fields,
    preview: data.slice(0, 5),
  };
}

function parseExcelBuffer(buffer: Buffer): { data: Record<string, unknown>[]; sheetNames: string[] } {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetNames = workbook.SheetNames;
  const sheet = workbook.Sheets[sheetNames[0]];
  let data = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: false });
  data = data.filter(row => Object.values(row).some(v => v !== null && v !== undefined && v !== ""));
  return { data, sheetNames };
}

/** 复用 atlas.ts P0-B outlier 检测逻辑（已修复：改用中位数替代均值） */
function detectOutlierWarnings(
  workingData: Record<string, unknown>[],
  fields: FieldInfo[]
): string[] {
  const numericFields = fields.filter(f => f.type === "numeric");
  const warnings: string[] = [];
  for (const field of numericFields.slice(0, 6)) {
    const vals = workingData
      .map(row => Number(row[field.name]))
      .filter(v => !isNaN(v) && v > 0);
    if (vals.length < 3) continue;
    // BUG FIX: use median instead of mean — mean is skewed by outliers themselves
    const sortedVals = [...vals].sort((a, b) => a - b);
    const median = sortedVals[Math.floor(sortedVals.length / 2)];
    const outlierVals = vals.filter(v => v > median * 5);
    if (outlierVals.length > 0 && median > 0) {
      const maxVal = Math.max(...outlierVals);
      const fmtV = (n: number) => n >= 10000 ? `${(n / 10000).toFixed(1)}万` : n.toFixed(0);
      warnings.push(`${field.name}(最高值${fmtV(maxVal)}，约为中位数${fmtV(median)}的${Math.round(maxVal / median)}倍)`);
    }
  }
  return warnings;
}

/** 复用 atlas.ts P1-C 平台识别降级逻辑 */
function resolvePlatformName(
  filename: string,
  platformNamesOverride?: string
): string {
  const platformKeywords = ["淘宝", "天猫", "京东", "拼多多", "抖音", "快手", "1688", "闲鱼", "苏宁", "唯品会", "小红书"];
  if (platformNamesOverride) return platformNamesOverride;
  const baseName = filename.replace(/\.[^.]+$/, "");
  const found = platformKeywords.find(k => baseName.includes(k));
  return found || baseName;
}

// ── 边界场景 1：极端大数值 ─────────────────────────────────────────────────────

describe("边界场景 1：极端大数值（工资字段 99999999）", () => {
  function createExtremeValueBuffer(): Buffer {
    const wb = XLSX.utils.book_new();
    // 正常员工工资约 8000，插入一个极端值 99999999（约为均值的 12500 倍）
    const data = [
      ["姓名", "基本工资", "绩效工资"],
      ["张三", 8000, 2000],
      ["李四", 7500, 1800],
      ["王五", 8200, 2200],
      ["赵六", 7800, 1900],
      ["极端值员工", 99999999, 2000], // 异常高值
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, "工资表");
    return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  }

  it("应正确解析含极端大数值的文件（不抛异常）", () => {
    const buffer = createExtremeValueBuffer();
    expect(() => parseExcelBuffer(buffer)).not.toThrow();
    const { data } = parseExcelBuffer(buffer);
    expect(data).toHaveLength(5);
  });

  it("极端大数值应被 buildDataFrameInfo 正确识别为 numeric 类型", () => {
    const { data } = parseExcelBuffer(createExtremeValueBuffer());
    const dfInfo = buildDataFrameInfo(data);
    const salaryField = dfInfo.fields.find(f => f.name === "基本工资");
    expect(salaryField).toBeDefined();
    expect(salaryField!.type).toBe("numeric");
  });

  it("outlier 检测应对极端大数值（>5倍均值）触发预警", () => {
    const { data } = parseExcelBuffer(createExtremeValueBuffer());
    const dfInfo = buildDataFrameInfo(data);
    const warnings = detectOutlierWarnings(data, dfInfo.fields);
    // 99999999 >> 均值 ~8300，应触发预警
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("基本工资");
  });

  it("异常高值预警信息应包含字段名和倍数描述", () => {
    const { data } = parseExcelBuffer(createExtremeValueBuffer());
    const dfInfo = buildDataFrameInfo(data);
    const warnings = detectOutlierWarnings(data, dfInfo.fields);
    const salaryWarning = warnings.find(w => w.includes("基本工资"));
    expect(salaryWarning).toBeDefined();
    // 修复后使用中位数作为基准，预警文本应包含“中位数”
    expect(salaryWarning).toMatch(/最高值.+中位数.+倍/);
  });

  it("极端值不应导致 NaN 或 Infinity（Decimal 安全性）", () => {
    const { data } = parseExcelBuffer(createExtremeValueBuffer());
    const dfInfo = buildDataFrameInfo(data);
    const warnings = detectOutlierWarnings(data, dfInfo.fields);
    // 所有预警文本不应包含 NaN 或 Infinity
    for (const w of warnings) {
      expect(w).not.toContain("NaN");
      expect(w).not.toContain("Infinity");
    }
  });
});

// ── 边界场景 2：空文件 / 仅有表头无数据 ──────────────────────────────────────

describe("边界场景 2：空文件 / 仅有表头无数据", () => {
  function createHeaderOnlyBuffer(): Buffer {
    const wb = XLSX.utils.book_new();
    // 仅有表头，无数据行
    const ws = XLSX.utils.aoa_to_sheet([["姓名", "基本工资", "绩效工资"]]);
    XLSX.utils.book_append_sheet(wb, ws, "工资表");
    return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  }

  function createCompletelyEmptyBuffer(): Buffer {
    const wb = XLSX.utils.book_new();
    // 完全空的 sheet
    const ws = XLSX.utils.aoa_to_sheet([]);
    XLSX.utils.book_append_sheet(wb, ws, "空表");
    return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  }

  it("仅有表头的文件应解析为 0 行数据（不抛异常）", () => {
    const buffer = createHeaderOnlyBuffer();
    expect(() => parseExcelBuffer(buffer)).not.toThrow();
    const { data } = parseExcelBuffer(buffer);
    expect(data).toHaveLength(0);
  });

  it("完全空的文件应解析为 0 行数据（不抛异常）", () => {
    const buffer = createCompletelyEmptyBuffer();
    expect(() => parseExcelBuffer(buffer)).not.toThrow();
    const { data } = parseExcelBuffer(buffer);
    expect(data).toHaveLength(0);
  });

  it("空数据的 buildDataFrameInfo 应返回 row_count=0 且 fields 为空数组", () => {
    const dfInfo = buildDataFrameInfo([]);
    expect(dfInfo.row_count).toBe(0);
    expect(dfInfo.col_count).toBe(0);
    expect(dfInfo.fields).toHaveLength(0);
    expect(dfInfo.preview).toHaveLength(0);
  });

  it("空数据的 outlier 检测应返回空预警数组（不崩溃）", () => {
    const dfInfo = buildDataFrameInfo([]);
    expect(() => detectOutlierWarnings([], dfInfo.fields)).not.toThrow();
    const warnings = detectOutlierWarnings([], dfInfo.fields);
    expect(warnings).toHaveLength(0);
  });

  it("仅有表头文件的 dfInfo 应正确反映 row_count=0", () => {
    const { data } = parseExcelBuffer(createHeaderOnlyBuffer());
    const dfInfo = buildDataFrameInfo(data);
    expect(dfInfo.row_count).toBe(0);
  });
});

// ── 边界场景 3：文件名含特殊字符 ─────────────────────────────────────────────

describe("边界场景 3：文件名含特殊字符（淘宝#流水&2026.xlsx）", () => {
  const specialCharFilenames = [
    "淘宝#流水&2026.xlsx",
    "天猫!销售@数据#2026.xlsx",
    "京东$订单%明细^2026.csv",
    "拼多多(1月)数据[完整版].xlsx",
    "抖音流水 - 副本 (2).xlsx",
  ];

  it.each(specialCharFilenames)(
    "文件名 %s 应正确识别平台关键词（不抛异常）",
    (filename) => {
      expect(() => resolvePlatformName(filename)).not.toThrow();
      const platform = resolvePlatformName(filename);
      expect(typeof platform).toBe("string");
      expect(platform.length).toBeGreaterThan(0);
    }
  );

  it("淘宝#流水&2026.xlsx 应识别为「淘宝」", () => {
    expect(resolvePlatformName("淘宝#流水&2026.xlsx")).toBe("淘宝");
  });

  it("天猫!销售@数据#2026.xlsx 应识别为「天猫」", () => {
    expect(resolvePlatformName("天猫!销售@数据#2026.xlsx")).toBe("天猫");
  });

  it("京东$订单%明细^2026.csv 应识别为「京东」", () => {
    expect(resolvePlatformName("京东$订单%明细^2026.csv")).toBe("京东");
  });

  it("拼多多(1月)数据[完整版].xlsx 应识别为「拼多多」", () => {
    expect(resolvePlatformName("拼多多(1月)数据[完整版].xlsx")).toBe("拼多多");
  });

  it("抖音流水 - 副本 (2).xlsx 应识别为「抖音」", () => {
    expect(resolvePlatformName("抖音流水 - 副本 (2).xlsx")).toBe("抖音");
  });

  it("用户手动覆盖平台名称时应优先使用覆盖值", () => {
    // 即使文件名含淘宝，用户手动改为「自营店」后应以用户输入为准
    expect(resolvePlatformName("淘宝#流水&2026.xlsx", "自营店")).toBe("自营店");
  });
});

// ── 边界场景 4：文件名无平台关键词（降级处理）────────────────────────────────

describe("边界场景 4：文件名无平台关键词时的降级处理", () => {
  const noKeywordFilenames = [
    { filename: "1月数据.xlsx", expected: "1月数据" },
    { filename: "销售流水.csv", expected: "销售流水" },
    { filename: "data_export_20260101.xlsx", expected: "data_export_20260101" },
    { filename: "report.xlsx", expected: "report" },
    { filename: "2026年Q1汇总.xlsx", expected: "2026年Q1汇总" },
  ];

  it.each(noKeywordFilenames)(
    "文件名 $filename 应降级为去扩展名的文件名「$expected」",
    ({ filename, expected }) => {
      const platform = resolvePlatformName(filename);
      expect(platform).toBe(expected);
    }
  );

  it("降级结果不应为空字符串", () => {
    const platform = resolvePlatformName("1月数据.xlsx");
    expect(platform.length).toBeGreaterThan(0);
  });

  it("降级结果不应包含文件扩展名", () => {
    const platform = resolvePlatformName("1月数据.xlsx");
    expect(platform).not.toContain(".xlsx");
    expect(platform).not.toContain(".csv");
  });

  it("用户在确认弹框中修改降级名称后应以用户输入为准", () => {
    // 模拟用户在弹框中将「1月数据」改为「线下门店」
    const platform = resolvePlatformName("1月数据.xlsx", "线下门店");
    expect(platform).toBe("线下门店");
  });

  it("含多个平台关键词时应匹配第一个出现的关键词", () => {
    // 「淘宝天猫联营.xlsx」→ 应匹配「淘宝」（排在关键词列表前面）
    const platform = resolvePlatformName("淘宝天猫联营.xlsx");
    expect(platform).toBe("淘宝");
  });

  it("无扩展名的文件名应直接返回原文件名", () => {
    const platform = resolvePlatformName("无扩展名文件");
    expect(platform).toBe("无扩展名文件");
  });
});

// ── 合并场景：session_ids 少于 2 个时的错误处理 ───────────────────────────────

describe("合并接口前置校验逻辑", () => {
  function validateMergeRequest(sessionIds: string[]): { valid: boolean; error?: string } {
    if (!sessionIds?.length || sessionIds.length < 2) {
      return { valid: false, error: "至少需要 2 个文件才能合并" };
    }
    return { valid: true };
  }

  it("session_ids 为空数组时应返回错误", () => {
    const result = validateMergeRequest([]);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("至少需要 2 个文件");
  });

  it("session_ids 只有 1 个时应返回错误", () => {
    const result = validateMergeRequest(["session-001"]);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("至少需要 2 个文件");
  });

  it("session_ids 有 2 个时应通过校验", () => {
    const result = validateMergeRequest(["session-001", "session-002"]);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("session_ids 有 3 个时应通过校验", () => {
    const result = validateMergeRequest(["s1", "s2", "s3"]);
    expect(result.valid).toBe(true);
  });
});
