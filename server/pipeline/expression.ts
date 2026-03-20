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
${resultSet.templateId ? `- 使用模板：${resultSet.templateId}` : "- 模式：自由对话"}

## 深度分析指引

当用户要求"分析"、"报告"、"总结"或"查看情况"时，请按以下四个部分输出结构化分析报告：

### 📊 数据概览
用 atlas-table 格式输出核心指标（总销售额、订单量、完成率、退款率、客单价等），数字精确到 2 位小数。

### 🎯 核心洞察
主动识别数据中的关键规律和异常信号，每条不超过 30 字：
• 达人/渠道表现：列出贡献最大的达人/门店及占比
• 地域分布：主要销售省份及订单占比
• 费用结构：如有则分析佣金/退款占比
• 异常信号：退款率超 5% 标注"偏高"、单一渠道占比超 60% 标注"依赖集中"

### 💡 战略建议
给出 3-4 条具体可执行的建议，必须引用实际数字：
▶ 建议1：[具体行动]（依据：[具体数值]）
▶ 建议2：[具体行动]（依据：[具体数值]）
▶ 建议3：[具体行动]（依据：[具体数值]）

### 📈 图表
最后告知用户：「右上角已生成数据图表，可直接查看商品分布和销售趋势。」

重要：所有数字必须来自 ResultSet 中的实际计算结果，不能编造或估算。每条建议必须引用具体数字作为依据。`;

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
