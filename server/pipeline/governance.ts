/**
 * ATLAS V3.0 — Governance 层（第 2 层）
 * ─────────────────────────────────────────────────────────────────
 * B 阶段交付物 B2：数据清洗 → 去重 → 类型转换 → 脏数据处理
 *
 * 对应管道步骤：Step 6 ~ Step 7
 *
 * 职责：
 *   6. 数据清洗：空行去除、字段修剪、类型强制转换
 *   7. 去重：基于 order_id 去重，保留最新记录
 *
 * 设计原则：
 *   - 每一行被跳过都要记录原因
 *   - 脏数据不丢弃，记录到 skippedRows
 *   - 类型转换失败的数值字段置为 null，不中断处理
 */

import Decimal from "decimal.js";
import {
  type PipelineContext,
  ErrorLevel,
} from "@shared/pipeline";
import type { StandardRow } from "@shared/metrics";
import type { SkippedRowSample } from "@shared/resultSet";
import { getFieldType } from "@shared/fieldAliases";

// ── Step 6: 数据清洗 ──────────────────────────────────────────────

export interface CleaningResult {
  /** 清洗后的标准化行数据 */
  cleanedRows: StandardRow[];
  /** 被跳过的行 */
  skippedRows: SkippedRowSample[];
  /** 跳过行数 */
  skippedCount: number;
  /** 类型转换警告 */
  typeWarnings: string[];
}

/**
 * 将原始行数据转换为标准化行数据。
 * 包括：字段重命名、空行去除、字段修剪、类型强制转换。
 */
export function step6DataCleaning(
  ctx: PipelineContext,
  rawRows: Record<string, string>[],
  fieldMapping: Record<string, string>
): CleaningResult {
  ctx.currentStep = 6;

  const cleanedRows: StandardRow[] = [];
  const skippedRows: SkippedRowSample[] = [];
  const typeWarnings: string[] = [];
  let skippedCount = 0;

  // 反转映射：原始名 → 标准名
  const reverseMap = new Map<string, string>();
  for (const [rawName, stdName] of Object.entries(fieldMapping)) {
    reverseMap.set(rawName, stdName);
  }

  for (let i = 0; i < rawRows.length; i++) {
    const rawRow = rawRows[i];
    const rowNumber = i + 2; // 1-based, +1 for header

    // 检查是否为空行（所有字段都为空）
    const allEmpty = Object.values(rawRow).every(
      v => v === null || v === undefined || String(v).trim() === ""
    );
    if (allEmpty) {
      skippedCount++;
      if (skippedRows.length < 5) {
        skippedRows.push({
          rowNumber,
          reason: "空行",
          preview: Object.fromEntries(
            Object.entries(rawRow).slice(0, 5).map(([k, v]) => [k, String(v)])
          ),
        });
      }
      continue;
    }

    // 字段重命名 + 类型转换
    const standardRow: StandardRow = {};
    let hasAnyValue = false;

    for (const [rawName, rawValue] of Object.entries(rawRow)) {
      const stdName = reverseMap.get(rawName);
      if (!stdName) {
        // 未映射的字段也保留（以原始名存储），便于导出
        standardRow[rawName] = rawValue;
        continue;
      }

      const fieldType = getFieldType(stdName);
      const trimmedValue = String(rawValue ?? "").trim();

      if (trimmedValue === "" || trimmedValue === "-" || trimmedValue === "—") {
        standardRow[stdName] = null;
        continue;
      }

      hasAnyValue = true;

      switch (fieldType) {
        case "number": {
          const numVal = parseNumericValue(trimmedValue);
          if (numVal !== null) {
            standardRow[stdName] = numVal;
          } else {
            standardRow[stdName] = trimmedValue; // 保留原始值
            if (typeWarnings.length < 20) {
              typeWarnings.push(
                `第 ${rowNumber} 行「${stdName}」值「${trimmedValue}」无法转为数字`
              );
            }
          }
          break;
        }
        case "integer": {
          const intVal = parseIntegerValue(trimmedValue);
          if (intVal !== null) {
            standardRow[stdName] = intVal;
          } else {
            standardRow[stdName] = trimmedValue;
            if (typeWarnings.length < 20) {
              typeWarnings.push(
                `第 ${rowNumber} 行「${stdName}」值「${trimmedValue}」无法转为整数`
              );
            }
          }
          break;
        }
        case "datetime": {
          // 日期时间保持字符串格式，不做转换
          standardRow[stdName] = trimmedValue;
          break;
        }
        default: {
          // string 类型直接赋值
          standardRow[stdName] = trimmedValue;
        }
      }
    }

    if (!hasAnyValue) {
      skippedCount++;
      if (skippedRows.length < 5) {
        skippedRows.push({
          rowNumber,
          reason: "所有标准字段均为空",
          preview: Object.fromEntries(
            Object.entries(rawRow).slice(0, 5).map(([k, v]) => [k, String(v)])
          ),
        });
      }
      continue;
    }

    cleanedRows.push(standardRow);
  }

  // 记录清洗日志
  if (skippedCount > 0) {
    ctx.errors.push({
      level: ErrorLevel.WARNING,
      step: 6,
      code: "W3001",
      message: `清洗过程中跳过了 ${skippedCount} 行（空行或无效数据）`,
    });
  }

  if (typeWarnings.length > 0) {
    ctx.errors.push({
      level: ErrorLevel.WARNING,
      step: 6,
      code: "W3003",
      message: `${typeWarnings.length} 个字段值类型转换异常`,
      details: typeWarnings.slice(0, 5).join("；"),
    });
  }

  ctx.errors.push({
    level: ErrorLevel.INFO,
    step: 6,
    code: "I4006",
    message: `数据清洗完成：${cleanedRows.length} 行有效数据，${skippedCount} 行被跳过`,
  });

  return {
    cleanedRows,
    skippedRows,
    skippedCount,
    typeWarnings,
  };
}

// ── Step 7: 去重 ──────────────────────────────────────────────────

export interface DeduplicationResult {
  /** 去重后的行数据 */
  deduplicatedRows: StandardRow[];
  /** 去重前行数 */
  beforeCount: number;
  /** 去重后行数 */
  afterCount: number;
  /** 移除的重复行数 */
  duplicatesRemoved: number;
}

/**
 * 基于 order_id 去重。
 * 如果没有 order_id 字段，跳过去重步骤。
 * 保留最后一条记录（假设后面的记录更新）。
 */
export function step7Deduplication(
  ctx: PipelineContext,
  rows: StandardRow[]
): DeduplicationResult {
  ctx.currentStep = 7;

  const beforeCount = rows.length;

  // 检查是否有 order_id 字段
  const hasOrderId = rows.some(
    row => row.order_id !== null && row.order_id !== undefined && row.order_id !== ""
  );

  if (!hasOrderId) {
    ctx.errors.push({
      level: ErrorLevel.INFO,
      step: 7,
      code: "I4007",
      message: "数据中无订单编号字段，跳过去重步骤",
    });
    return {
      deduplicatedRows: rows,
      beforeCount,
      afterCount: beforeCount,
      duplicatesRemoved: 0,
    };
  }

  // 基于 order_id 去重，保留最后一条
  const orderMap = new Map<string, StandardRow>();
  const noIdRows: StandardRow[] = [];

  for (const row of rows) {
    const orderId = row.order_id;
    if (orderId === null || orderId === undefined || String(orderId).trim() === "") {
      noIdRows.push(row);
      continue;
    }
    const key = String(orderId).trim();
    orderMap.set(key, row); // 后面的覆盖前面的
  }

  const deduplicatedRows = Array.from(orderMap.values()).concat(noIdRows);
  const duplicatesRemoved = beforeCount - deduplicatedRows.length;

  if (duplicatesRemoved > 0) {
    ctx.errors.push({
      level: ErrorLevel.WARNING,
      step: 7,
      code: "W3004",
      message: `去重移除了 ${duplicatesRemoved} 行重复数据（基于订单编号）`,
    });
  } else {
    ctx.errors.push({
      level: ErrorLevel.INFO,
      step: 7,
      code: "I4007",
      message: "去重检查完成，未发现重复数据",
    });
  }

  return {
    deduplicatedRows,
    beforeCount,
    afterCount: deduplicatedRows.length,
    duplicatesRemoved,
  };
}

// ── Governance 层统一入口 ──────────────────────────────────────────

export interface GovernanceResult {
  /** 清洗去重后的标准化行数据 */
  rows: StandardRow[];
  /** 被跳过的行 */
  skippedRows: SkippedRowSample[];
  /** 跳过行数 */
  skippedCount: number;
  /** 去重移除的行数 */
  duplicatesRemoved: number;
}

/**
 * 执行完整的 Governance 层处理（Step 6 ~ Step 7）。
 */
export function runGovernance(
  ctx: PipelineContext,
  rawRows: Record<string, string>[],
  fieldMapping: Record<string, string>
): GovernanceResult {
  // Step 6: 数据清洗
  const cleaning = step6DataCleaning(ctx, rawRows, fieldMapping);
  if (ctx.aborted) {
    return {
      rows: [],
      skippedRows: cleaning.skippedRows,
      skippedCount: cleaning.skippedCount,
      duplicatesRemoved: 0,
    };
  }

  // Step 7: 去重
  const dedup = step7Deduplication(ctx, cleaning.cleanedRows);

  return {
    rows: dedup.deduplicatedRows,
    skippedRows: cleaning.skippedRows,
    skippedCount: cleaning.skippedCount,
    duplicatesRemoved: dedup.duplicatesRemoved,
  };
}

// ── 辅助函数 ──────────────────────────────────────────────────────

/**
 * 解析数值字段。
 * 处理逗号分隔、货币符号、百分号等。
 */
function parseNumericValue(value: string): number | null {
  // 去掉逗号、空格、货币符号
  let cleaned = value.replace(/[,，\s¥$￥]/g, "").trim();

  // 处理百分号
  if (cleaned.endsWith("%")) {
    cleaned = cleaned.slice(0, -1);
    try {
      const d = new Decimal(cleaned);
      return d.div(100).toNumber();
    } catch {
      return null;
    }
  }

  // 处理括号表示负数：(123.45) → -123.45
  if (cleaned.startsWith("(") && cleaned.endsWith(")")) {
    cleaned = "-" + cleaned.slice(1, -1);
  }

  if (cleaned === "" || cleaned === "-" || cleaned === "—") return null;

  try {
    return new Decimal(cleaned).toNumber();
  } catch {
    return null;
  }
}

/**
 * 解析整数字段。
 */
function parseIntegerValue(value: string): number | null {
  const numVal = parseNumericValue(value);
  if (numVal === null) return null;
  return Math.round(numVal);
}
