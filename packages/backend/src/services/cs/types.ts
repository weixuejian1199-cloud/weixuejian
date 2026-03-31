/**
 * ACI 客服中枢 MVP — 类型定义
 *
 * 对应 brain.json aciHub 设计 + Prisma Schema 枚举
 */

// ─── 枚举镜像（与 Prisma 枚举保持一致）──────────────────────

export type AciDecision = 'APPROVE' | 'REJECT' | 'REJECT_WITH_APPEAL' | 'ESCALATE';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

// ─── 情绪检测 ─────────────────────────────────────────────

export interface EmotionAnalysis {
  level: 'none' | 'low' | 'medium' | 'high';
  matchedKeywords: string[];
  highCount: number;
  mediumCount: number;
}

export interface RefundIntentAnalysis {
  detected: boolean;
  matchedKeywords: string[];
}

// ─── FAQ 匹配 ─────────────────────────────────────────────

export type FaqCategory = 'shipping' | 'payment' | 'return' | 'product' | 'account' | 'general';

export interface FaqEntry {
  id: string;
  keywords: string[];
  synonyms?: string[];
  question: string;
  answer: string;
  category: FaqCategory;
}

export interface FaqMatch {
  faqId: string;
  question: string;
  answer: string;
  category: FaqCategory;
  confidence: number;
  isReturnRelated: boolean;
}

// ─── 退货判断引擎 ──────────────────────────────────────────

export interface OrderSnapshot {
  orderId: string;
  processNode: number;
  totalAmount: number;
  payDate: string | null;
  shipmentsDate: string | null;
  receivedDate: string | null;
  itemCategory: string | null;
  buyerName: string | null;
}

export interface JudgmentInput {
  messageContent: string;
  order: OrderSnapshot | null;
  emotion: EmotionAnalysis;
  refundIntent: RefundIntentAnalysis;
  recentReturnCount: number;
  isOpened: boolean | null;
  isFoodCategory: boolean;
}

export interface TriggeredRule {
  code: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
  description: string;
  evidence: string;
}

export interface JudgmentOutput {
  decision: AciDecision;
  reason: string;
  reasonForCustomer: string;
  riskLevel: RiskLevel;
  confidence: number;
  triggeredRules: TriggeredRule[];
  context: OrderSnapshot | Record<string, never>;
  executionAllowed: false;
  disclaimer: string;
  processingTimeMs: number;
}

// ─── 编排器 ───────────────────────────────────────────────

export interface IncomingMessagePayload {
  channelType: string;
  channelId: string;
  externalUserId: string;
  buyerName?: string;
  orderId?: string;
  content: string;
  msgType?: string;
}

export interface OrchestratorResult {
  sessionId: string;
  messageId: string;
  processing: {
    faqMatched: boolean;
    isReturnRelated: boolean;
    judgmentTriggered: boolean;
  };
  draftReply?: {
    messageId: string;
    content: string;
    source: 'faq' | 'judgment';
  };
  judgment?: JudgmentOutput & { recordId: string };
  ticketId?: string;
}
