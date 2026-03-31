/**
 * AI 幻觉防护增强模块 — BL-021
 *
 * Phase 1b 基础：工具函数数字直接嵌入模板 + 金额附加数据来源引用。
 * Phase 2 增强：
 *   (1) 关键指标自动校验 — AI回复中的数字 vs 工具返回的原始数字
 *   (2) 数据声明来源标注 — AI回复附加数据来源
 *   (3) 财务类回复强制审计 — 数据来源 + 查询时间
 *   (4) 数据冲突检测 — 不同工具返回数据矛盾时告警
 */
import type { AgentType } from '@prisma/client';
import type { ToolExecutionResult } from './types.js';
import { logger } from '../../utils/logger.js';

// ─── 类型定义 ────────────────────────────────────────────────

export interface NumberMismatch {
  /** AI回复中出现的数字 */
  aiNumber: number;
  /** AI回复中数字的原始文本 */
  aiText: string;
  /** 工具返回中最接近的数字（如有） */
  closestToolNumber?: number;
  /** 偏差率（百分比） */
  deviationPercent?: number;
}

export interface ValidationResult {
  /** 是否通过校验（无异常） */
  passed: boolean;
  /** 数字不一致列表 */
  numberMismatches: NumberMismatch[];
  /** 数据来源标注 */
  sourceAttribution: string | null;
  /** 财务审计尾注（仅财务类人格） */
  financeAuditTrail: string | null;
  /** 数据冲突告警 */
  dataConflicts: DataConflict[];
}

export interface DataConflict {
  /** 冲突字段名 */
  field: string;
  /** 工具A名称和值 */
  toolA: { name: string; value: number };
  /** 工具B名称和值 */
  toolB: { name: string; value: number };
  /** 偏差率（百分比） */
  deviationPercent: number;
}

// ─── 常量 ────────────────────────────────────────────────────

/** 数字偏差容忍阈值（百分比）—— 超过此值视为不一致 */
const NUMBER_DEVIATION_THRESHOLD = 1;

/** 冲突检测偏差阈值（百分比）—— 同名字段不同工具返回差异超过此值视为冲突 */
const CONFLICT_DEVIATION_THRESHOLD = 5;

/** 财务类人格列表 */
const FINANCE_AGENT_TYPES: AgentType[] = ['finance', 'settlement'];

/** 数字提取正则：匹配 ¥1,234.56 / 1234 / 12.3% / 1,234 等格式 */
const NUMBER_PATTERN = /¥?\s*[\d,]+(?:\.\d+)?%?/g;

/** 小数字过滤阈值 —— 低于此值的数字不参与校验（页码/序号等噪声） */
const MIN_SIGNIFICANT_NUMBER = 10;

// ─── 核心函数 ────────────────────────────────────────────────

/**
 * 执行完整的幻觉防护校验
 */
export function validateResponse(
  aiContent: string,
  toolResults: ToolExecutionResult[],
  agentType?: AgentType,
): ValidationResult {
  // 如果没有工具调用，跳过校验
  if (toolResults.length === 0 || toolResults.every(r => r.error)) {
    return {
      passed: true,
      numberMismatches: [],
      sourceAttribution: null,
      financeAuditTrail: null,
      dataConflicts: [],
    };
  }

  const successfulResults = toolResults.filter(r => !r.error && r.result != null);

  // (1) 关键指标自动校验
  const numberMismatches = validateNumbers(aiContent, successfulResults);

  // (2) 数据来源标注
  const sourceAttribution = buildSourceAttribution(successfulResults);

  // (3) 财务类审计尾注
  const financeAuditTrail = buildFinanceAuditTrail(successfulResults, agentType);

  // (4) 数据冲突检测
  const dataConflicts = detectDataConflicts(successfulResults);

  const passed = numberMismatches.length === 0 && dataConflicts.length === 0;

  if (!passed) {
    logger.warn(
      {
        mismatchCount: numberMismatches.length,
        conflictCount: dataConflicts.length,
        agentType,
      },
      '[hallucination-guard] Validation issues detected',
    );
  }

  return {
    passed,
    numberMismatches,
    sourceAttribution,
    financeAuditTrail,
    dataConflicts,
  };
}

// ─── (1) 关键指标自动校验 ────────────────────────────────────

/**
 * 从 AI 回复中提取数字，与工具返回的数字对比。
 * 不一致的数字返回为 mismatch。
 */
export function validateNumbers(
  aiContent: string,
  toolResults: ToolExecutionResult[],
): NumberMismatch[] {
  const aiNumbers = extractNumbersFromText(aiContent);
  const toolNumbers = extractNumbersFromResults(toolResults);

  if (aiNumbers.length === 0 || toolNumbers.length === 0) return [];

  const mismatches: NumberMismatch[] = [];

  for (const { value: aiNum, text: aiText } of aiNumbers) {
    // 跳过小数字（页码、序号等噪声）
    if (Math.abs(aiNum) < MIN_SIGNIFICANT_NUMBER) continue;

    // 查找工具结果中是否有匹配的数字
    const match = findClosestMatch(aiNum, toolNumbers);

    if (!match) {
      // AI 编造了一个工具结果中不存在的数字
      mismatches.push({ aiNumber: aiNum, aiText });
    } else if (match.deviation > NUMBER_DEVIATION_THRESHOLD) {
      // 数字存在但偏差超过阈值
      mismatches.push({
        aiNumber: aiNum,
        aiText,
        closestToolNumber: match.toolNumber,
        deviationPercent: match.deviation,
      });
    }
  }

  return mismatches;
}

/**
 * 从文本中提取数字及其原始文本
 */
export function extractNumbersFromText(
  text: string,
): Array<{ value: number; text: string }> {
  const results: Array<{ value: number; text: string }> = [];
  const matches = text.matchAll(NUMBER_PATTERN);

  for (const match of matches) {
    const raw = match[0];
    // 移除 ¥、逗号、%、空格
    const cleaned = raw.replace(/[¥,%\s]/g, '');
    const num = parseFloat(cleaned);
    if (!isNaN(num) && isFinite(num)) {
      results.push({ value: num, text: raw });
    }
  }

  return results;
}

/**
 * 从工具执行结果中递归提取所有数字
 */
export function extractNumbersFromResults(
  toolResults: ToolExecutionResult[],
): number[] {
  const numbers: number[] = [];

  for (const result of toolResults) {
    if (result.result != null) {
      extractNumbers(result.result, numbers);
    }
  }

  // 去重
  return [...new Set(numbers)];
}

function extractNumbers(data: unknown, acc: number[]): void {
  if (typeof data === 'number' && isFinite(data)) {
    acc.push(data);
    return;
  }
  if (typeof data === 'string') {
    const num = parseFloat(data);
    if (!isNaN(num) && isFinite(num)) acc.push(num);
    return;
  }
  if (Array.isArray(data)) {
    for (const item of data) extractNumbers(item, acc);
    return;
  }
  if (data !== null && typeof data === 'object') {
    for (const value of Object.values(data)) {
      extractNumbers(value, acc);
    }
  }
}

function findClosestMatch(
  aiNum: number,
  toolNumbers: number[],
): { toolNumber: number; deviation: number } | null {
  let closest: { toolNumber: number; deviation: number } | null = null;

  for (const toolNum of toolNumbers) {
    // 精确匹配（浮点容差）
    if (Math.abs(aiNum - toolNum) < 0.01) {
      return { toolNumber: toolNum, deviation: 0 };
    }

    // 百分比偏差
    const base = Math.abs(toolNum) || 1;
    const deviation = (Math.abs(aiNum - toolNum) / base) * 100;

    if (!closest || deviation < closest.deviation) {
      closest = { toolNumber: toolNum, deviation };
    }
  }

  // 只返回偏差在合理范围内的匹配（<200%，否则视为不相关的数字）
  if (closest && closest.deviation < 200) return closest;
  return null;
}

// ─── (2) 数据来源标注 ────────────────────────────────────────

/**
 * 从工具结果中提取数据来源，构建标注文本
 */
export function buildSourceAttribution(
  toolResults: ToolExecutionResult[],
): string | null {
  const sources: Map<string, string> = new Map();

  for (const result of toolResults) {
    if (!result.result || typeof result.result !== 'object') continue;
    const data = result.result as Record<string, unknown>;
    const source = data['_dataSource'] as string | undefined;
    const time = data['_queryTime'] as string | undefined;

    if (source) {
      sources.set(source, time ?? new Date().toISOString());
    }
  }

  if (sources.size === 0) return null;

  const parts: string[] = [];
  for (const [source, time] of sources) {
    const timeStr = formatQueryTime(time);
    parts.push(`${source} (${timeStr})`);
  }

  return `数据来源：${parts.join('、')}`;
}

// ─── (3) 财务类审计尾注 ──────────────────────────────────────

/**
 * 财务类人格强制附加数据来源和查询时间
 */
export function buildFinanceAuditTrail(
  toolResults: ToolExecutionResult[],
  agentType?: AgentType,
): string | null {
  if (!agentType || !FINANCE_AGENT_TYPES.includes(agentType)) return null;

  const sources: string[] = [];
  let latestTime = '';

  for (const result of toolResults) {
    if (!result.result || typeof result.result !== 'object') continue;
    const data = result.result as Record<string, unknown>;
    const source = data['_dataSource'] as string | undefined;
    const time = data['_queryTime'] as string | undefined;

    if (source && !sources.includes(source)) sources.push(source);
    if (time && time > latestTime) latestTime = time;
  }

  if (sources.length === 0) return null;

  const timeStr = formatQueryTime(latestTime || new Date().toISOString());
  return `\n---\n数据来源：${sources.join('、')}｜查询时间：${timeStr}\n⚠️ 以上数据由系统自动生成，财务决策请以原始单据为准`;
}

// ─── (4) 数据冲突检测 ────────────────────────────────────────

/**
 * 检测不同工具返回的同名数值字段是否存在矛盾
 */
export function detectDataConflicts(
  toolResults: ToolExecutionResult[],
): DataConflict[] {
  if (toolResults.length < 2) return [];

  // 收集每个工具的顶层数值字段
  const fieldMap = new Map<string, Array<{ toolName: string; value: number }>>();

  for (const result of toolResults) {
    if (!result.result || typeof result.result !== 'object') continue;
    const data = result.result as Record<string, unknown>;

    for (const [key, value] of Object.entries(data)) {
      // 跳过内部字段
      if (key.startsWith('_')) continue;
      if (typeof value !== 'number' || !isFinite(value)) continue;

      if (!fieldMap.has(key)) fieldMap.set(key, []);
      fieldMap.get(key)!.push({ toolName: result.toolName, value });
    }
  }

  const conflicts: DataConflict[] = [];

  for (const [field, entries] of fieldMap) {
    if (entries.length < 2) continue;

    // 比较所有对（一般只有2-3个工具，O(n²)可接受）
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i]!;
        const b = entries[j]!;
        const base = Math.abs(a.value) || 1;
        const deviation = (Math.abs(a.value - b.value) / base) * 100;

        if (deviation > CONFLICT_DEVIATION_THRESHOLD) {
          conflicts.push({
            field,
            toolA: { name: a.toolName, value: a.value },
            toolB: { name: b.toolName, value: b.value },
            deviationPercent: Math.round(deviation * 10) / 10,
          });
        }
      }
    }
  }

  return conflicts;
}

// ─── 辅助函数 ────────────────────────────────────────────────

function formatQueryTime(isoTime: string): string {
  try {
    const date = new Date(isoTime);
    return date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  } catch {
    return isoTime;
  }
}
