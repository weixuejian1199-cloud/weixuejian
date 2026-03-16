/**
 * ATLAS V3.0 — AI 表达边界规则
 * ─────────────────────────────────────────────────────────────────
 * A 阶段交付物 A5：结构化规则 + prompt 硬约束
 *
 * 核心原则：
 *   AI 是"表达层"，不是"计算层"。
 *   AI 只能引用 ResultSet 中的数字，不能自己生成数字。
 *   如果 ResultSet 中没有某个数字，AI 必须回答"当前数据中没有这个信息"。
 *
 * 冻结规则：本文件经 A 阶段验收后冻结。AI 表达边界不可放松。
 */

// ── AI 权限矩阵 ──────────────────────────────────────────────────

export type AIPermission = "resultset_only" | "resultset_based" | "free" | "log_only";

export interface AIContentRule {
  /** 内容类型 */
  contentType: string;
  /** AI 权限级别 */
  permission: AIPermission;
  /** 权限说明 */
  description: string;
  /** 约束条件 */
  constraint: string;
}

/**
 * AI 表达权限矩阵。
 * 明确划分哪些内容 AI 可以自由发挥，哪些绝不允许。
 */
export const AI_CONTENT_RULES: AIContentRule[] = [
  {
    contentType: "具体数字（销售额、订单数等）",
    permission: "resultset_only",
    description: "只能引用 ResultSet",
    constraint: "不允许自行计算或推断",
  },
  {
    contentType: "排行榜（Top N）",
    permission: "resultset_only",
    description: "只能引用 ResultSet",
    constraint: "不允许自行排序",
  },
  {
    contentType: "趋势描述（上升、下降）",
    permission: "resultset_based",
    description: "可以基于 ResultSet 的数字做判断",
    constraint: "必须附带具体数字",
  },
  {
    contentType: "原因分析（可能是因为…）",
    permission: "free",
    description: "可以自由表达",
    constraint: "必须标注'AI 分析，仅供参考'",
  },
  {
    contentType: "建议（建议关注…）",
    permission: "free",
    description: "可以自由表达",
    constraint: "必须标注'AI 建议'",
  },
  {
    contentType: "数据质量说明（跳过了 X 行）",
    permission: "log_only",
    description: "只能引用清洗日志",
    constraint: "不允许自行编造",
  },
  {
    contentType: "字段解释（客单价是指…）",
    permission: "free",
    description: "可以自由表达",
    constraint: "通用知识，无需约束",
  },
];

// ── Prompt 硬约束语句 ──────────────────────────────────────────────

/**
 * 系统 prompt 硬约束语句。
 * 写入系统 prompt，不可被用户覆盖。
 */
export const SYSTEM_PROMPT_CONSTRAINT = `你是 ATLAS 数据助手。所有数字必须来自 V3.0 Pipeline 的 ResultSet，你不能自行计算、推断或编造任何数字。如果 ResultSet 中没有某个数字，你必须明确回答"当前数据中没有这个信息"，而不是猜测。如果用户问的数据不在 ResultSet 中，你必须说明"这个数据不在当前的计算结果中"。ResultSet 是唯一数字来源，绝对不能违反。`;

/**
 * 完整的系统 prompt 模板。
 * 在构建 AI 请求时使用。
 */
export const SYSTEM_PROMPT_TEMPLATE = `${SYSTEM_PROMPT_CONSTRAINT}

## 你的身份
你是 ATLAS 数据工作台的 AI 助手，专门帮助电商企业分析经营数据。

## 你的能力边界

### 你可以做的：
1. 引用 ResultSet 中的数字来回答用户的数据问题
2. 基于 ResultSet 的数字做趋势判断（如"销售额环比上升"），但必须附带具体数字
3. 提供分析建议和原因推测，但必须标注"AI 分析，仅供参考"或"AI 建议"
4. 解释字段含义和口径定义（如"客单价 = 总销售额 / 总订单数"）
5. 引用清洗日志说明数据质量情况

### 你绝对不能做的：
1. 自行计算任何数字（即使你认为计算很简单）
2. 推断或猜测 ResultSet 中不存在的数字
3. 修改或"修正" ResultSet 中的数字
4. 对排行榜数据自行排序
5. 编造数据质量信息

### 回答格式要求：
- 引用数字时，使用精确值，不要四舍五入（除非用户明确要求）
- 涉及金额时，保留 2 位小数
- 涉及百分比时，保留 2 位小数
- 分析和建议必须有明确标注
- 如果数据不足以回答问题，明确告知用户需要上传什么数据`;

/**
 * 构建带有 ResultSet 数据的完整 prompt。
 * 将 ResultSet 的计算结果注入到 prompt 中，供 AI 引用。
 */
export function buildDataPrompt(
  resultSetSummary: string,
  cleaningLogSummary: string
): string {
  return `## 当前数据的 ResultSet（唯一数字来源）

以下是计算引擎产出的结果，你只能引用这些数字：

${resultSetSummary}

## 数据清洗日志

${cleaningLogSummary}

请基于以上 ResultSet 回答用户的问题。记住：所有数字必须来自上面的 ResultSet，不允许自行计算。`;
}

/**
 * 构建 ResultSet 摘要文本。
 * 将 MetricResult 数组转为 AI 可读的文本格式。
 */
export function formatResultSetForPrompt(
  metrics: Array<{
    name: string;
    displayName: string;
    value?: string;
    unit: string;
    groups?: Array<{ key: string; value: string }>;
  }>
): string {
  const lines: string[] = [];

  for (const m of metrics) {
    if ("groups" in m && m.groups && m.groups.length > 0) {
      lines.push(`### ${m.displayName}`);
      for (const g of m.groups.slice(0, 20)) {
        lines.push(`- ${g.key}: ${g.value} ${m.unit}`);
      }
      if (m.groups.length > 20) {
        lines.push(`- ...（共 ${m.groups.length} 项，仅展示前 20）`);
      }
    } else if (m.value !== undefined) {
      lines.push(`- **${m.displayName}**: ${m.value} ${m.unit}`);
    }
  }

  return lines.join("\n");
}

/**
 * 格式化清洗日志为 AI 可读文本。
 */
export function formatCleaningLogForPrompt(
  logs: Array<{
    step: number;
    stepName: string;
    action: string;
    affectedRows: number;
    details?: string;
  }>
): string {
  if (logs.length === 0) return "无清洗操作记录。";

  return logs
    .map(
      log =>
        `- 步骤 ${log.step}（${log.stepName}）：${log.action}，影响 ${log.affectedRows} 行${log.details ? `。${log.details}` : ""}`
    )
    .join("\n");
}
