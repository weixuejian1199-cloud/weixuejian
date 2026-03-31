/**
 * 情绪/意图检测器 — 纯函数
 *
 * 对应 brain.json aciHub.riskGates 设计：
 * - 高强度词任一命中 → level=high
 * - 中强度词>=2个 → level=high; 1个 → level=medium
 * - 否定词(不想/不会/没有/并非)修饰情绪词时不计入
 */

import type { EmotionAnalysis, RefundIntentAnalysis } from './types.js';

// ─── 关键词库（brain.json emotionKeywords）────────────────

const HIGH_EMOTION_KEYWORDS = [
  '投诉', '律师', '12315', '工商', '法院', '曝光', '媒体', '消协',
];

const MEDIUM_EMOTION_KEYWORDS = [
  '不满意', '差评', '太慢了', '骗人', '坑人', '垃圾', '举报',
  '失望', '生气', '无语', '恶心', '后悔', '上当',
];

const NEGATION_WORDS = ['不想', '不会', '没有', '并非', '不是', '不要'];

const REFUND_KEYWORDS = ['退款', '赔偿', '补偿', '退钱', '赔钱'];

// ─── 否定词排除 ──────────────────────────────────────────

function isNegated(text: string, keyword: string): boolean {
  const idx = text.indexOf(keyword);
  if (idx < 0) return false;
  // 检查关键词前面是否紧邻否定词
  const prefix = text.slice(Math.max(0, idx - 4), idx);
  return NEGATION_WORDS.some((neg) => prefix.endsWith(neg));
}

function findMatches(text: string, keywords: readonly string[]): string[] {
  return keywords.filter((kw) => text.includes(kw) && !isNegated(text, kw));
}

// ─── 导出函数 ─────────────────────────────────────────────

export function detectEmotion(text: string): EmotionAnalysis {
  const normalized = text.trim();
  const highMatches = findMatches(normalized, HIGH_EMOTION_KEYWORDS);
  const mediumMatches = findMatches(normalized, MEDIUM_EMOTION_KEYWORDS);

  let level: EmotionAnalysis['level'];
  if (highMatches.length > 0) {
    level = 'high';
  } else if (mediumMatches.length >= 2) {
    level = 'high';
  } else if (mediumMatches.length === 1) {
    level = 'medium';
  } else {
    level = 'none';
  }

  return {
    level,
    matchedKeywords: [...highMatches, ...mediumMatches],
    highCount: highMatches.length,
    mediumCount: mediumMatches.length,
  };
}

export function detectRefundIntent(text: string): RefundIntentAnalysis {
  const normalized = text.trim();
  const matches = findMatches(normalized, REFUND_KEYWORDS);
  return {
    detected: matches.length > 0,
    matchedKeywords: matches,
  };
}
