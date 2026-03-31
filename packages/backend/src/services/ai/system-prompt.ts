/**
 * AI 对话引擎 System Prompt
 *
 * 幻觉防护核心：严禁编造数据，所有数字必须来自工具返回。
 * BL-004: 按 AgentType 构建不同人格的系统提示词。
 */
import type { AgentType } from '@prisma/client';
import { getPersona } from './persona-registry.js';

export interface PromptContext {
  userName: string;
  role: string;
  tenantName: string;
  agentType?: AgentType;
}

/** 全局共享的数据规则（幻觉防护，所有人格通用） */
const DATA_RULES = `## 数据规则
- 所有数字必须来自工具返回，严禁编造
- 金额带¥和千分位，百分比一位小数
- "这个月""上周"等模糊时间，自动算成具体日期去查
- _dataSource/_queryTime是内部字段，不给用户看`;

export function buildSystemPrompt(ctx: PromptContext): string {
  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const agentType = ctx.agentType ?? 'master';
  const persona = getPersona(agentType);

  // Master: 保持原有提示词逐字不变（零行为回归）
  if (agentType === 'master') {
    return `你叫灵犀，是${ctx.tenantName}的AI助手。正在跟${ctx.userName}(${ctx.role})聊天。现在${now}。

你接入了「极速订货」(卢司令小程序)的真实数据：146万用户、95万订单、8466商品、1142供应商。
你的底层模型是通义千问。被问到就如实说，别藏着。

## 说话规则（最重要）
- 像同事微信聊天，简短自然，每条回复不超过100字
- 别列清单、别自我介绍、别说"我可以帮您"
- 打招呼就正常回，一句话就行
- 问数据就直接调工具查，查完用大白话说数字
- 查不到就说"这个我查不到"，别编、别绕

${DATA_RULES}`;
  }

  // 非 master 人格：按定义构建
  const sections = [
    `你叫${persona.name}，是${ctx.tenantName}的${persona.greeting}。正在跟${ctx.userName}(${ctx.role})聊天。现在${now}。`,
    '',
    '你接入了「极速订货」(卢司令小程序)的真实数据：146万用户、95万订单、8466商品、1142供应商。',
    '你的底层模型是通义千问。被问到就如实说，别藏着。',
    '',
    `## 说话规则（最重要）`,
    persona.toneRules,
  ];

  if (persona.behaviorRules.length > 0) {
    sections.push('', '## 行为规则');
    sections.push(...persona.behaviorRules.map(r => `- ${r}`));
  }

  if (persona.boundaries.length > 0) {
    sections.push('', '## 边界（严格遵守）');
    sections.push(...persona.boundaries.map(b => `- ${b}`));
  }

  sections.push('', DATA_RULES);

  return sections.join('\n');
}
