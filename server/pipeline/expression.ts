/**
 * ATLAS V3.0 — Expression 层（第 4 层）
 * ─────────────────────────────────────────────────────────────────
 * B 阶段交付物 B4：AI 表达层 — 将 ResultSet 注入 prompt
 *
 * 对应管道步骤：Step 9（表达输出）
 *
 * 职责：
 *   9. 将 ResultSet 的计算结果格式化为 AI 可读的 prompt
 *      - 构建系统 prompt（含硬约束）
 *      - 构建数据 prompt（ResultSet 摘要 + 清洗日志）
 *      - 确保 AI 只能引用 ResultSet 中的数字
 *
 * 设计原则：
 *   - AI 是"表达层"，不是"计算层"
 *   - 所有数字必须来自 ResultSet
 *   - prompt 中的硬约束不可被用户覆盖
 */

import type { ResultSet } from "@shared/resultSet";
import {
  SYSTEM_PROMPT_TEMPLATE,
  formatResultSetForPrompt,
  formatCleaningLogForPrompt,
  buildDataPrompt,
} from "@shared/aiConstraints";

// ── 表达层输出 ──────────────────────────────────────────────────────

export interface ExpressionOutput {
  /** 系统 prompt（含硬约束 + 数据注入） */
  systemPrompt: string;
  /** ResultSet 摘要文本（用于 AI 引用） */
  resultSetSummary: string;
  /** 清洗日志摘要 */
  cleaningLogSummary: string;
  /** 数据上下文 prompt */
  dataPrompt: string;
}

/**
 * 构建 AI 表达层的完整 prompt。
 * 将 ResultSet 的计算结果注入到系统 prompt 中。
 */
export function buildExpressionPrompt(resultSet: ResultSet): ExpressionOutput {
  // 格式化 ResultSet 为 AI 可读文本
  const resultSetSummary = formatResultSetForPrompt(resultSet.metrics);

  // 格式化清洗日志
  const cleaningLogSummary = formatCleaningLogForPrompt(resultSet.cleaningLog);

  // 构建数据 prompt
  const dataPrompt = buildDataPrompt(resultSetSummary, cleaningLogSummary);

  // 构建完整的系统 prompt
  const systemPrompt = `${SYSTEM_PROMPT_TEMPLATE}

${dataPrompt}

## 数据概况
- 数据来源：${resultSet.sourceFiles.map(f => f.fileName).join("、") || "未知"}
- 来源平台：${resultSet.sourcePlatform}
- 有效数据行数：${resultSet.rowCount}
- 跳过行数：${resultSet.skippedRowsCount}
- 计算引擎版本：${resultSet.computationVersion}
- 计算时间：${new Date(resultSet.createdAt).toLocaleString("zh-CN")}
${resultSet.templateId ? `- 使用模板：${resultSet.templateId}` : "- 模式：自由对话"}`;

  return {
    systemPrompt,
    resultSetSummary,
    cleaningLogSummary,
    dataPrompt,
  };
}

/**
 * 构建简洁的数据摘要（用于聊天上下文、报告标题等）。
 */
export function buildDataSummary(resultSet: ResultSet): string {
  const lines: string[] = [];

  lines.push(`数据来源：${resultSet.sourceFiles.map(f => f.fileName).join("、")}`);
  lines.push(`平台：${resultSet.sourcePlatform}`);
  lines.push(`有效行数：${resultSet.rowCount}`);

  if (resultSet.skippedRowsCount > 0) {
    lines.push(`跳过行数：${resultSet.skippedRowsCount}`);
  }

  // 添加核心指标
  for (const metric of resultSet.metrics) {
    if ("value" in metric && metric.value !== undefined) {
      lines.push(`${metric.displayName}：${metric.value} ${metric.unit}`);
    }
  }

  return lines.join("\n");
}
