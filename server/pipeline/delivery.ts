/**
 * ATLAS V3.0 — Delivery 层（第 5 层）
 * ─────────────────────────────────────────────────────────────────
 * B 阶段交付物 B5：导出引擎 + ResultSet 持久化
 *
 * 职责：
 *   - 从 ResultSet 导出 Excel/CSV（导出同源）
 *   - 将 ResultSet 持久化到数据库
 *   - 确保页面显示、导出、AI 引用的数字完全一致
 *
 * 设计原则：
 *   - 导出同源：Excel 和页面看到的数字必须来自同一个 ResultSet
 *   - 导出文件上传到 S3，返回下载链接
 *   - 支持按模板格式导出
 */

import * as XLSX from "xlsx";
import Decimal from "decimal.js";
import { nanoid } from "nanoid";
import type { ResultSet } from "@shared/resultSet";
import type { ExportPayload } from "@shared/types";
import { getDisplayName } from "@shared/fieldAliases";
import { getTemplateById, type TemplateDefinition } from "@shared/templates";
import { storagePut } from "../storage";

// ── Phase 4：三阶段拦截（V4.0）────────────────────────────────────────────

/**
 * 校验 ExportPayload 的完整性和合法性
 * 拒绝没有完整 metricKey / groupByKey / aggType 的导出请求
 */
function validateExportPayload(payload: ExportPayload | undefined): { valid: boolean; error?: string } {
  if (!payload) {
    return { valid: false, error: "未找到导出载荷" };
  }

  // 校验 metricKey
  if (!payload.metricKey || payload.metricKey.startsWith("unknown_")) {
    return {
      valid: false,
      error: `导出失败：字段身份未确认 (metricKey=${payload.metricKey})，请联系管理员确认字段身份后再导出`
    };
  }

  // 校验 groupByKey
  if (!payload.groupByKey) {
    return {
      valid: false,
      error: `导出失败：分组字段身份未确认 (groupByField=${payload.groupByField})`
    };
  }

  // 校验 aggType
  if (!payload.aggType) {
    return {
      valid: false,
      error: `导出失败：聚合类型未确认`
    };
  }

  return { valid: true };
}

// ── 导出格式 ──────────────────────────────────────────────────────

export type ExportFormat = "xlsx" | "csv";

export interface ExportOptions {
  /** 导出格式 */
  format: ExportFormat;
  /** 自定义文件名（不含扩展名） */
  fileName?: string;
  /** 是否包含汇总行 */
  includeSummary?: boolean;
  /** 是否包含清洗日志 Sheet */
  includeCleaningLog?: boolean;
}

export interface ExportResult {
  /** 导出文件的 S3 URL */
  url: string;
  /** 导出文件的 S3 Key */
  s3Key: string;
  /** 文件名 */
  fileName: string;
  /** 文件大小（字节） */
  fileSize: number;
}

// ── 导出引擎 ──────────────────────────────────────────────────────

/**
 * 从 ResultSet 导出 Excel/CSV 文件。
 * 确保导出的数字与页面显示完全一致（导出同源）。
 */
export async function exportFromResultSet(
  resultSet: ResultSet,
  options: ExportOptions
): Promise<ExportResult> {
  const { format, includeSummary = true, includeCleaningLog = false } = options;

  // ── Phase 4：三阶段拦截 - unknown 字段拦截（V4.0）────────────────────────
  const validation = validateExportPayload(resultSet.exportPayload);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // 确定文件名
  const baseName = options.fileName || generateFileName(resultSet);
  const ext = format === "xlsx" ? ".xlsx" : ".csv";
  const fullFileName = `${baseName}${ext}`;

  // 创建工作簿
  const workbook = XLSX.utils.book_new();

  // 获取模板定义（如果有）
  const template = resultSet.templateId
    ? getTemplateById(resultSet.templateId)
    : null;

  // Sheet 1: 汇总统计（如果启用）
  if (includeSummary && format === "xlsx") {
    const summarySheet = buildSummarySheet(resultSet);
    XLSX.utils.book_append_sheet(workbook, summarySheet, "汇总统计");
  }

  // Sheet 2: 数据明细（全量）
  const dataSheet = buildDataSheet(resultSet, template);
  XLSX.utils.book_append_sheet(workbook, dataSheet, "数据明细（全量）");

  // Sheet 3: 清洗日志（如果启用）
  if (includeCleaningLog && format === "xlsx") {
    const logSheet = buildCleaningLogSheet(resultSet);
    XLSX.utils.book_append_sheet(workbook, logSheet, "数据清洗日志");
  }

  // 生成文件 Buffer
  const buffer = XLSX.write(workbook, {
    type: "buffer",
    bookType: format === "xlsx" ? "xlsx" : "csv",
  });

  // 上传到 S3
  const suffix = nanoid(8);
  const s3Key = `atlas-exports/${resultSet.jobId}/${suffix}-${fullFileName}`;
  const mimeType = format === "xlsx"
    ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    : "text/csv";

  const { url } = await storagePut(s3Key, Buffer.from(buffer), mimeType);

  return {
    url,
    s3Key,
    fileName: fullFileName,
    fileSize: buffer.byteLength,
  };
}

// ── Sheet 构建 ──────────────────────────────────────────────────

/**
 * 判断字段是否是日期/时间字段
 */
function isDateTimeField(fieldName: string): boolean {
  const dateTimeKeywords = [
    "时间", "日期", "timestamp", "created_at", "updated_at", "completed_at",
    "submitted_at", "paid_at", "cancelled_at", "shipped_at", "delivered_at",
    "order_time", "pay_time", "finish_time", "submit_time", "create_time",
    "update_time", "start_time", "end_time", "expire_time", "deadline",
    "time", "date", "datetime",
  ];
  const lowerFieldName = fieldName.toLowerCase();
  return dateTimeKeywords.some(keyword => lowerFieldName.includes(keyword));
}

/**
 * 格式化日期/时间为可读字符串
 */
function formatDateTime(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  // 如果是 Date 对象
  if (value instanceof Date) {
    return value.toISOString().replace('T', ' ').substring(0, 19); // "YYYY-MM-DD HH:mm:ss"
  }

  // 如果是字符串
  if (typeof value === "string") {
    // 检查是否是 ISO 8601 格式
    if (value.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)) {
      return value.replace('T', ' ').substring(0, 19);
    }
    // 检查是否已经是格式化的日期/时间
    if (value.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)) {
      return value;
    }
    // 尝试解析为日期
    try {
      const parsed = new Date(value);
      if (!isNaN(parsed.getTime())) {
        return parsed.toISOString().replace('T', ' ').substring(0, 19);
      }
    } catch {
      // 忽略解析错误
    }
  }

  return null;
}

/**
 * 构建数据明细 Sheet。
 * 使用 ResultSet 中的 standardizedRows 作为数据源。
 */
function buildDataSheet(
  resultSet: ResultSet,
  template: TemplateDefinition | null | undefined
): XLSX.WorkSheet {
  // 确定列顺序
  let columns: string[];
  if (template) {
    // 模板模式：使用模板定义的列顺序
    columns = template.exportColumns;
  } else {
    // 自由模式：使用 ResultSet 中的字段顺序
    columns = resultSet.fields;
  }

  // 构建表头（使用中文显示名）
  const headerRow = columns.map(col => {
    if (template) {
      // 从模板字段中查找显示名
      const field = [...template.requiredFields, ...template.optionalFields]
        .find(f => f.fieldName === col);
      if (field) return field.displayName;
    }
    return getDisplayName(col);
  });

  // 构建数据行
  const dataRows = resultSet.standardizedRows.map(row => {
    return columns.map(col => {
      const value = row[col];
      if (value === null || value === undefined) return "";

      // 检查是否是日期/时间字段，如果是则格式化
      if (isDateTimeField(col)) {
        const formatted = formatDateTime(value);
        if (formatted !== null) {
          return formatted;
        }
      }

      // 普通数值字段，直接返回
      return value;
    });
  });

  // 合并表头和数据
  const allRows = [headerRow, ...dataRows];
  return XLSX.utils.aoa_to_sheet(allRows);
}

/**
 * 构建汇总统计 Sheet。
 * 展示所有口径的计算结果。
 */
function buildSummarySheet(resultSet: ResultSet): XLSX.WorkSheet {
  const rows: (string | number)[][] = [];

  // 标题行
  rows.push(["ATLAS 数据分析报告"]);
  rows.push([]);

  // 基本信息
  rows.push(["数据概况"]);
  rows.push(["数据来源", resultSet.sourceFiles.map(f => f.fileName).join("、")]);
  rows.push(["来源平台", resultSet.sourcePlatform]);
  rows.push(["有效数据行数", resultSet.rowCount]);
  rows.push(["跳过行数", resultSet.skippedRowsCount]);
  rows.push(["计算引擎版本", resultSet.computationVersion]);
  rows.push(["计算时间", new Date(resultSet.createdAt).toLocaleString("zh-CN")]);
  rows.push([]);

  // 核心指标
  rows.push(["核心指标", "数值", "单位", "计算公式"]);
  for (const metric of resultSet.metrics) {
    if ("value" in metric && metric.value !== undefined) {
      rows.push([
        metric.displayName,
        Number(metric.value) || metric.value,
        metric.unit,
        metric.formula,
      ]);
    }
  }
  rows.push([]);

  // 分组指标
  for (const metric of resultSet.metrics) {
    if ("groups" in metric && metric.groups && metric.groups.length > 0) {
      rows.push([metric.displayName]);
      rows.push(["名称", "数值", "单位"]);
      for (const group of metric.groups) {
        rows.push([group.key, Number(group.value) || group.value, metric.unit]);
      }
      rows.push([]);
    }
  }

  return XLSX.utils.aoa_to_sheet(rows);
}

/**
 * 构建清洗日志 Sheet。
 */
function buildCleaningLogSheet(resultSet: ResultSet): XLSX.WorkSheet {
  const rows: (string | number)[][] = [];

  rows.push(["步骤", "步骤名称", "操作", "影响行数", "详细信息"]);

  for (const log of resultSet.cleaningLog) {
    rows.push([
      log.step,
      log.stepName,
      log.action,
      log.affectedRows,
      log.details || "",
    ]);
  }

  if (resultSet.skippedRowsSample.length > 0) {
    rows.push([]);
    rows.push(["被跳过的行示例"]);
    rows.push(["行号", "原因", "数据预览"]);
    for (const sample of resultSet.skippedRowsSample) {
      rows.push([
        sample.rowNumber,
        sample.reason,
        JSON.stringify(sample.preview),
      ]);
    }
  }

  return XLSX.utils.aoa_to_sheet(rows);
}

// ── 辅助函数 ──────────────────────────────────────────────────────

/**
 * 生成导出文件名。
 */
function generateFileName(resultSet: ResultSet): string {
  const date = new Date(resultSet.createdAt);
  const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;

  if (resultSet.templateId) {
    const template = getTemplateById(resultSet.templateId);
    if (template) {
      return template.exportFileName
        .replace("{date}", dateStr)
        .replace("{month}", String(date.getMonth() + 1));
    }
  }

  const platform = resultSet.sourcePlatform !== "unknown"
    ? `_${resultSet.sourcePlatform}`
    : "";
  return `ATLAS_数据报表${platform}_${dateStr}`;
}
