/**
 * ATLAS Multi-Agent Router
 *
 * 意图识别 → 分发给对应 Agent：
 * - data_analysis: 数据分析 Agent（Excel/CSV 分析、报表生成）
 * - hr: HR Agent（工资条、考勤、个税计算）
 * - quality_monitor: 质量监控 Agent（监控 Qwen 回复质量，介入纠正）
 * - general: 通用助手 Agent（问答、使用引导、业务知识）
 */

import { ENV } from "../_core/env";

// ── Agent 类型 ────────────────────────────────────────────────────────────────

export type AgentType = "data_analysis" | "hr" | "quality_monitor" | "general";

export interface AgentContext {
  conversationId: string;
  userId: number;
  userName: string;
  userMessage: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  files?: Array<{ name: string; url: string; type: string }>;
}

export interface AgentResult {
  agentType: AgentType;
  content: string;
  suggestedActions?: string[]; // 快捷操作按钮
  requiresFile?: boolean;      // 是否需要用户上传文件
  metadata?: Record<string, unknown>;
}

// ── System Prompts ────────────────────────────────────────────────────────────

const AGENT_PROMPTS: Record<AgentType, string> = {
  data_analysis: `你是 ATLAS 数据分析专家，专注于企业数据分析和报表生成。

你的能力：
- 分析 Excel/CSV 数据文件，识别关键字段和数据模式
- 生成销售报表、门店汇总、平台对比分析
- 支持自然语言查询（如"自营前10名业绩"→自动找字段、排序、取前10）
- 字段语义理解：会员=用户=昵称，业绩=销售额=GMV，门店=店铺=网点
- 主动识别数据异常和趋势

## 图表输出格式
当需要展示图表时，使用以下格式输出（会被自动渲染为交互式图表）：

\`\`\`atlas-chart
{
  "type": "bar",
  "title": "各门店销售额对比",
  "xKey": "store",
  "yKey": "sales",
  "unit": "元",
  "data": [
    { "store": "北京店", "sales": 12000 },
    { "store": "上海店", "sales": 18500 }
  ]
}
\`\`\`

支持的图表类型：bar（柱状图）、line（折线图）、pie（饼图）、area（面积图）
多系列时 yKey 可以是数组："yKey": ["sales", "target"]

## 回复风格
- 直接给出分析结果，不要说"我来帮你分析"
- 数据分析结果优先用图表展示，再用文字说明
- 提供可点击的后续操作选项（用 [操作] 格式标注）
- 最多3步完成报告生成
- 数据表格用 Markdown 表格格式

当用户请求"综合分析"时，主动列出多个分析方向供选择。`,

  hr: `你是 ATLAS HR 助手，专注于人力资源数据处理。

你的能力：
- 工资条计算（基本工资、绩效、社保、个税）
- 考勤汇总（出勤天数、迟到早退、加班统计）
- 个税计算（专项附加扣除、年终奖）
- 员工绩效排名和对比分析
- 生成标准 Excel 格式的工资表

回复风格：
- 给出精确的计算结果，附带计算说明
- 提供可下载的 Excel 文件选项
- 对异常数据（如工资异常低/高）主动提醒
- 保护员工隐私，不在对话中显示完整身份证号`,

  quality_monitor: `你是 ATLAS 质量监控助手（小虾米），负责监控和优化 AI 回复质量。

你的职责：
- 实时监控 Qwen AI 的回复，识别理解偏差
- 当 Qwen 误解用户意图时，主动介入纠正
- 提供更准确的回复或引导用户重新表达
- 记录常见误解模式，用于持续优化

回复风格：
- 简洁直接，不绕弯子
- 明确指出哪里出了问题
- 给出正确的处理方向`,

  general: `你是 ATLAS 智能助手，一个专业的企业数据分析和报表生成平台的助手。

你的能力：
- 解答 ATLAS 使用问题
- 引导用户完成数据分析流程
- 解答业务知识问题（电商、零售、HR等）
- 当用户上传文件时，主动引导进行数据分析

回复风格：
- 友好专业，用简洁的语言
- 主动提供操作引导（如"你可以上传 Excel 文件，我来帮你分析"）
- 识别用户真实需求，推荐合适的功能
- 对话结束时主动提示下一步操作`,
};

// ── 意图识别 ──────────────────────────────────────────────────────────────────

/**
 * 基于规则的快速意图识别（无需 API 调用，毫秒级响应）
 */
export function detectIntentFast(message: string, hasFiles: boolean): AgentType {
  const msg = message.toLowerCase();

  // 数据分析关键词
  const dataKeywords = [
    "分析", "报表", "报告", "excel", "csv", "数据", "统计", "汇总",
    "销售", "业绩", "gmv", "营业额", "门店", "店铺", "平台", "排名",
    "对比", "趋势", "图表", "可视化", "导出", "下载", "生成报告",
    "前10", "前十", "top10", "自营", "代运营", "天猫", "京东", "抖音",
  ];

  // HR 关键词
  const hrKeywords = [
    "工资", "薪资", "薪酬", "工资条", "考勤", "出勤", "迟到", "早退",
    "加班", "社保", "个税", "绩效", "奖金", "年终奖", "员工", "人员",
    "hr", "人力", "招聘", "离职", "入职", "花名册",
  ];

  // 质量监控关键词（通常是管理员使用）
  const qualityKeywords = [
    "监控", "质量", "纠正", "误解", "错误回复", "小虾米", "介入",
    "qwen", "千问", "ai回复", "回复质量",
  ];

  if (hasFiles) return "data_analysis";

  const dataScore = dataKeywords.filter(k => msg.includes(k)).length;
  const hrScore = hrKeywords.filter(k => msg.includes(k)).length;
  const qualityScore = qualityKeywords.filter(k => msg.includes(k)).length;

  if (qualityScore > 0) return "quality_monitor";
  if (hrScore > dataScore && hrScore > 0) return "hr";
  if (dataScore > 0) return "data_analysis";

  return "general";
}

// ── Agent 执行 ────────────────────────────────────────────────────────────────

interface StreamAgentParams extends AgentContext {
  agentType?: AgentType; // 如果已知，跳过意图识别
  onToken: (token: string) => void;
  onDone: (result: AgentResult) => void;
  onError?: (err: Error) => void;
}

export async function streamAgentReply(params: StreamAgentParams): Promise<void> {
  const {
    userMessage,
    history = [],
    files = [],
    onToken,
    onDone,
    onError,
  } = params;

  const hasFiles = files.length > 0;
  const agentType = params.agentType ?? detectIntentFast(userMessage, hasFiles);
  const systemPrompt = AGENT_PROMPTS[agentType];

  const apiKey = ENV.dashScopeApiKey;
  const baseUrl = ENV.dashScopeBaseUrl || "https://dashscope.aliyuncs.com/compatible-mode/v1";

  if (!apiKey) {
    onDone({
      agentType,
      content: "AI 服务暂时不可用，请稍后再试。",
    });
    return;
  }

  // 构建消息历史（最近10条）
  const recentHistory = history.slice(-10);
  const messages = [
    { role: "system" as const, content: systemPrompt },
    ...recentHistory,
    { role: "user" as const, content: userMessage },
  ];

  // 如果有文件，追加文件信息到用户消息
  if (hasFiles) {
    const fileDesc = files.map(f => `- ${f.name} (${f.type})`).join("\n");
    messages[messages.length - 1].content = `${userMessage}\n\n用户上传的文件：\n${fileDesc}`;
  }

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "qwen3-max-2026-01-23",
        messages,
        stream: true,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`AI API error: ${response.status} ${errText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let fullReply = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "data: [DONE]") continue;
        if (!trimmed.startsWith("data: ")) continue;

        try {
          const json = JSON.parse(trimmed.slice(6));
          const token = json.choices?.[0]?.delta?.content ?? "";
          if (token) {
            fullReply += token;
            onToken(token);
          }
        } catch {
          // skip malformed lines
        }
      }
    }

    // 根据 Agent 类型生成后续操作建议
    const suggestedActions = getSuggestedActions(agentType, userMessage, fullReply);

    onDone({
      agentType,
      content: fullReply || "（无回复）",
      suggestedActions,
    });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error(`[Agent:${agentType}] Error:`, error.message);
    if (onError) {
      onError(error);
    } else {
      onDone({
        agentType,
        content: "AI 回复出现错误，请稍后再试。",
      });
    }
  }
}

// ── 后续操作建议 ──────────────────────────────────────────────────────────────

function getSuggestedActions(
  agentType: AgentType,
  userMessage: string,
  reply: string
): string[] {
  const msg = userMessage.toLowerCase();

  switch (agentType) {
    case "data_analysis":
      if (msg.includes("分析") || msg.includes("报告")) {
        return ["下载 Excel", "生成 PDF 报告", "继续分析", "查看图表"];
      }
      if (msg.includes("排名") || msg.includes("前10") || msg.includes("top")) {
        return ["导出排名表", "查看趋势", "对比上期"];
      }
      return ["上传数据文件", "生成报告", "查看示例"];

    case "hr":
      if (msg.includes("工资") || msg.includes("薪资")) {
        return ["下载工资条 Excel", "查看个税明细", "导出全员工资表"];
      }
      if (msg.includes("考勤")) {
        return ["导出考勤表", "查看异常记录", "生成考勤报告"];
      }
      return ["上传考勤数据", "计算工资", "生成报告"];

    case "quality_monitor":
      return ["查看监控日志", "标记为误解", "优化提示词"];

    case "general":
      if (reply.includes("上传") || reply.includes("文件")) {
        return ["上传 Excel 文件", "查看使用教程", "联系支持"];
      }
      return ["开始数据分析", "生成报告", "查看功能介绍"];

    default:
      return [];
  }
}
