/**
 * ATLAS V3.0 — ResultSet 数据结构定义
 * ─────────────────────────────────────────────────────────────────
 * A 阶段交付物 A3：唯一真值源结构 + 8 个可审计字段
 *
 * 核心设计原则：
 *   ResultSet 是整个系统的"唯一真值源"。
 *   页面显示、Excel 导出、IM 回复、AI 表达，全部从 ResultSet 读取数字。
 *   任何环节都不允许绕过 ResultSet 自行生成数字。
 *
 * 冻结规则：本文件经 A 阶段验收后冻结。后续只允许新增字段，不允许修改已有字段的含义。
 */

import type { MetricResult } from "./metrics";

// ── 可审计字段类型 ──────────────────────────────────────────────────

/** 参与计算的源文件信息 */
export interface SourceFileInfo {
  /** 原始文件名 */
  fileName: string;
  /** S3 存储路径 */
  s3Key: string;
  /** 文件总行数（含表头） */
  totalRows: number;
  /** 有效数据行数（不含表头和空行） */
  dataRows: number;
  /** 字段数 */
  fieldCount: number;
  /** 识别的平台 */
  platform: string;
}

/** 应用的筛选条件 */
export interface FiltersApplied {
  /** 时间范围筛选 */
  dateRange?: {
    start: string; // ISO 8601
    end: string;
  };
  /** 店铺筛选 */
  storeFilter?: string[];
  /** 平台筛选 */
  platformFilter?: string[];
  /** 其他自定义筛选 */
  custom?: Record<string, string | number | boolean>;
}

/** 被跳过的行示例 */
export interface SkippedRowSample {
  /** 行号（1-based） */
  rowNumber: number;
  /** 跳过原因 */
  reason: string;
  /** 原始行数据（前 5 个字段） */
  preview: Record<string, string>;
}

// ── ResultSet 主结构 ──────────────────────────────────────────────

export interface ResultSet {
  // ── 可审计字段（8 个，A 阶段必须落进 schema）──────────────────

  /** 本次计算任务的唯一标识，用于日志关联和问题排查 */
  jobId: string;

  /** 参与本次计算的源文件列表 */
  sourceFiles: SourceFileInfo[];

  /** 本次计算应用的筛选条件 */
  filtersApplied: FiltersApplied;

  /** 被跳过的脏数据行数 */
  skippedRowsCount: number;

  /** 被跳过行的前 5 条示例（含跳过原因） */
  skippedRowsSample: SkippedRowSample[];

  /** 计算引擎版本号，用于结果复现 */
  computationVersion: string;

  /** 使用的模板 ID（自由对话则为 null） */
  templateId: string | null;

  /** ResultSet 生成时间（UTC，Unix 毫秒时间戳） */
  createdAt: number;

  // ── 计算结果数据 ──────────────────────────────────────────────

  /** 核心口径计算结果（10 个标量 + 分组口径） */
  metrics: MetricResult[];

  /** 标准化后的数据行（用于导出和追溯） */
  standardizedRows: Record<string, string | number | null>[];

  /** 数据行数（标准化后的有效行数） */
  rowCount: number;

  /** 字段列表（标准化后的字段名） */
  fields: string[];

  // ── 元数据 ──────────────────────────────────────────────────

  /** 数据来源平台（如果多文件来自不同平台，为 "mixed"） */
  sourcePlatform: string;

  /** 是否为多文件合并结果 */
  isMultiFile: boolean;

  /** 清洗日志摘要 */
  cleaningLog: CleaningLogEntry[];
}

// ── 清洗日志 ──────────────────────────────────────────────────────

export interface CleaningLogEntry {
  /** 处理步骤编号（1-9） */
  step: number;
  /** 步骤名称 */
  stepName: string;
  /** 操作描述 */
  action: string;
  /** 影响的行数 */
  affectedRows: number;
  /** 详细信息 */
  details?: string;
}

// ── ResultSet 工厂函数 ──────────────────────────────────────────

/** 当前计算引擎版本号 */
export const COMPUTATION_VERSION = "1.0.0";

/**
 * 创建一个空的 ResultSet 骨架。
 * 用于初始化，后续由各管道步骤填充数据。
 */
export function createEmptyResultSet(jobId: string): ResultSet {
  return {
    // 可审计字段
    jobId,
    sourceFiles: [],
    filtersApplied: {},
    skippedRowsCount: 0,
    skippedRowsSample: [],
    computationVersion: COMPUTATION_VERSION,
    templateId: null,
    createdAt: Date.now(),

    // 计算结果
    metrics: [],
    standardizedRows: [],
    rowCount: 0,
    fields: [],

    // 元数据
    sourcePlatform: "unknown",
    isMultiFile: false,
    cleaningLog: [],
  };
}

// ── ResultSet 验证 ──────────────────────────────────────────────

export interface ValidationError {
  field: string;
  message: string;
}

/**
 * 验证 ResultSet 的完整性。
 * 确保所有可审计字段都已填充。
 */
export function validateResultSet(rs: ResultSet): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!rs.jobId) {
    errors.push({ field: "jobId", message: "jobId 不能为空" });
  }
  if (!rs.sourceFiles || rs.sourceFiles.length === 0) {
    errors.push({ field: "sourceFiles", message: "sourceFiles 不能为空" });
  }
  if (!rs.computationVersion) {
    errors.push({
      field: "computationVersion",
      message: "computationVersion 不能为空",
    });
  }
  if (!rs.createdAt || rs.createdAt <= 0) {
    errors.push({ field: "createdAt", message: "createdAt 必须为正整数" });
  }
  if (!rs.metrics || rs.metrics.length === 0) {
    errors.push({ field: "metrics", message: "metrics 不能为空" });
  }
  if (rs.skippedRowsCount < 0) {
    errors.push({
      field: "skippedRowsCount",
      message: "skippedRowsCount 不能为负数",
    });
  }
  if (
    rs.skippedRowsSample.length > 5
  ) {
    errors.push({
      field: "skippedRowsSample",
      message: "skippedRowsSample 最多保留 5 条",
    });
  }

  return errors;
}

// ── ResultSet 序列化（用于导出和持久化）──────────────────────────

/**
 * 将 ResultSet 序列化为可存储的 JSON 字符串。
 * 用于数据库持久化和 API 传输。
 */
export function serializeResultSet(rs: ResultSet): string {
  return JSON.stringify(rs);
}

/**
 * 从 JSON 字符串反序列化 ResultSet。
 */
export function deserializeResultSet(json: string): ResultSet {
  return JSON.parse(json) as ResultSet;
}
