/**
 * 退货判断决策引擎 — ACI 客服中枢核心
 *
 * 对应 brain.json aciHub.decisionTreeFlow:
 * ①情绪/退款意图检测(P0) → ②获取订单数据(失败ESCALATE)
 * → ③数据完整性检查(置信度扣减) → ④欺诈检测(P1)
 * → ⑤金额检查(P1) → ⑥未收货检查(P2) → ⑦食品拆封检查(P3)
 * → ⑧超7天检查(P3) → ⑨默认APPROVE(P4)
 *
 * 同优先级取最严格结果。置信度从 1.0 开始扣减。
 * Phase 1: executionAllowed 硬编码 false
 */

import type {
  JudgmentInput,
  JudgmentOutput,
  TriggeredRule,
  AciDecision,
  RiskLevel,
  OrderSnapshot,
} from './types.js';

const DISCLAIMER = '此判断仅供参考，最终决定请以人工审核为准。';

// ─── 理由生成 ──────────────────────────────────────────

const REASON_MAP: Record<string, { reason: string; customerReason: string }> = {
  GATE_DATA_MISSING: {
    reason: '无法获取订单数据，无法进行退货判断',
    customerReason: '系统暂时无法查询到您的订单信息，已转交人工客服处理。',
  },
  GATE_REFUND_REQUEST: {
    reason: '检测到退款/赔偿意图，需人工处理',
    customerReason: '已为您转接专属客服，将为您处理退款事宜。',
  },
  GATE_EMOTION: {
    reason: '检测到用户情绪激动，需优先人工安抚',
    customerReason: '非常抱歉给您带来不好的体验，已为您安排专人处理。',
  },
  GATE_FRAUD: {
    reason: '退货行为异常，疑似欺诈，需人工审核',
    customerReason: '您的退货申请需要进一步审核，已转交人工客服。',
  },
  GATE_LOW_CONFIDENCE: {
    reason: '订单数据不完整，AI判断置信度不足',
    customerReason: '由于信息不够完整，已转交人工客服为您处理。',
  },
  RULE_05: {
    reason: '订单金额超过500元，需人工审批',
    customerReason: '大额订单的退货需要主管审批，已为您转交处理。',
  },
  RULE_01: {
    reason: '订单尚未发货或运输中，建议直接取消订单',
    customerReason: '您的订单尚未收货，建议直接取消订单更快捷，如需帮助请告知。',
  },
  RULE_03: {
    reason: '食品/生鲜类商品已拆封，按规定不支持退货',
    customerReason: '很抱歉，食品类商品拆封后暂不支持退货，感谢您的理解。',
  },
  RULE_02: {
    reason: '收货已超过7天，超出标准退货时效',
    customerReason: '您的订单已超过7天退货期限，如有特殊情况可提交申诉。',
  },
  DEFAULT_APPROVE: {
    reason: '订单符合退货条件，建议批准',
    customerReason: '您的退货申请初步审核通过，后续将由工作人员确认处理。',
  },
};

function getReasons(code: string): { reason: string; customerReason: string } {
  return REASON_MAP[code] ?? { reason: '退货审核判断完成', customerReason: '您的退货申请已受理，请等待处理。' };
}

// ─── 辅助函数 ──────────────────────────────────────────

function calcDaysSince(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return null;
  const now = new Date();
  return Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
}

function calcHoursSince(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return null;
  const now = new Date();
  return Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));
}

function buildOutput(
  decision: AciDecision,
  riskLevel: RiskLevel,
  confidence: number,
  triggeredRules: TriggeredRule[],
  context: OrderSnapshot | Record<string, never>,
  startTime: number,
  primaryCode: string,
): JudgmentOutput {
  const { reason, customerReason } = getReasons(primaryCode);
  return {
    decision,
    reason,
    reasonForCustomer: customerReason,
    riskLevel,
    confidence: Math.max(0, Math.min(1, confidence)),
    triggeredRules,
    context,
    executionAllowed: false,
    disclaimer: DISCLAIMER,
    processingTimeMs: Date.now() - startTime,
  };
}

// 食品类关键词
const FOOD_KEYWORDS = [
  '食品', '生鲜', '零食', '饮料', '水果', '蔬菜', '肉',
  '奶', '酒', '茶', '咖啡', '保健品', '营养', '代餐',
  '生酮', '蛋白', '坚果',
];

export function isFoodCategory(category: string | null): boolean {
  if (!category) return false;
  const lower = category.toLowerCase();
  return FOOD_KEYWORDS.some((kw) => lower.includes(kw));
}

// ─── 决策树主函数 ─────────────────────────────────────

export function evaluateReturnRequest(input: JudgmentInput): JudgmentOutput {
  const startTime = Date.now();
  const triggeredRules: TriggeredRule[] = [];
  let confidence = 1.0;

  const context: OrderSnapshot | Record<string, never> = input.order ?? {};

  // ═══ 阶段 1: 订单数据缺失 → fail-secure ESCALATE ═══
  if (!input.order) {
    triggeredRules.push({
      code: 'GATE_DATA_MISSING',
      priority: 'P0',
      description: '无法获取订单数据',
      evidence: '订单查询失败或订单不存在',
    });
    return buildOutput('ESCALATE', 'CRITICAL', 0, triggeredRules, context, startTime, 'GATE_DATA_MISSING');
  }

  // ═══ 阶段 2: 数据完整性检查（扣减置信度）═══
  if (!input.order.payDate) confidence -= 0.15;
  if (input.order.processNode === undefined || input.order.processNode === null) confidence -= 0.2;
  if (!input.order.totalAmount && input.order.totalAmount !== 0) confidence -= 0.1;
  if (!input.order.shipmentsDate && input.order.processNode >= 3) confidence -= 0.1;

  // ═══ 阶段 3: P0 安全闸门 ═══

  // P0-a: 退款/补偿意图
  if (input.refundIntent.detected) {
    triggeredRules.push({
      code: 'GATE_REFUND_REQUEST',
      priority: 'P0',
      description: '检测到退款/赔偿意图关键词',
      evidence: `匹配关键词: ${input.refundIntent.matchedKeywords.join(', ')}`,
    });
    return buildOutput('ESCALATE', 'HIGH', confidence, triggeredRules, context, startTime, 'GATE_REFUND_REQUEST');
  }

  // P0-b: 情绪激动
  if (input.emotion.level === 'high') {
    triggeredRules.push({
      code: 'GATE_EMOTION',
      priority: 'P0',
      description: '用户情绪激动',
      evidence: `匹配关键词: ${input.emotion.matchedKeywords.join(', ')} (高:${input.emotion.highCount} 中:${input.emotion.mediumCount})`,
    });
    return buildOutput('ESCALATE', 'CRITICAL', confidence, triggeredRules, context, startTime, 'GATE_EMOTION');
  }

  // P0-c: 欺诈嫌疑
  if (input.recentReturnCount >= 3) {
    triggeredRules.push({
      code: 'GATE_FRAUD',
      priority: 'P0',
      description: '30天内退货频次异常(>=3次)',
      evidence: `近30天退货: ${input.recentReturnCount}次`,
    });
    return buildOutput('ESCALATE', 'CRITICAL', confidence, triggeredRules, context, startTime, 'GATE_FRAUD');
  }

  // P0-c 补充: 收货<2小时退货
  if (input.order.processNode >= 4) {
    const hoursSinceReceived = calcHoursSince(input.order.receivedDate ?? input.order.shipmentsDate);
    if (hoursSinceReceived !== null && hoursSinceReceived < 2) {
      triggeredRules.push({
        code: 'GATE_FRAUD',
        priority: 'P0',
        description: '收货不足2小时即申请退货',
        evidence: `收货距今: ${hoursSinceReceived}小时`,
      });
      return buildOutput('ESCALATE', 'CRITICAL', confidence, triggeredRules, context, startTime, 'GATE_FRAUD');
    }
  }

  // P0-d: 低置信度
  if (confidence < 0.7) {
    triggeredRules.push({
      code: 'GATE_LOW_CONFIDENCE',
      priority: 'P0',
      description: 'AI判断置信度不足',
      evidence: `当前置信度: ${confidence.toFixed(2)}`,
    });
    return buildOutput('ESCALATE', 'MEDIUM', confidence, triggeredRules, context, startTime, 'GATE_LOW_CONFIDENCE');
  }

  // ═══ 阶段 4: P1 合规拦截 ═══

  // P1: 金额>500
  if (input.order.totalAmount > 500) {
    triggeredRules.push({
      code: 'RULE_05',
      priority: 'P1',
      description: '订单金额超过500元',
      evidence: `订单金额: ¥${input.order.totalAmount}`,
    });
    return buildOutput('ESCALATE', 'HIGH', confidence, triggeredRules, context, startTime, 'RULE_05');
  }

  // ═══ 阶段 5: P2 业务规则 ═══

  // P2: 未收货 (ProcessNode < 3) → 建议取消订单
  if (input.order.processNode < 3) {
    triggeredRules.push({
      code: 'RULE_01',
      priority: 'P2',
      description: '订单尚未发货/运输中',
      evidence: `ProcessNode: ${input.order.processNode}`,
    });
    return buildOutput('APPROVE', 'LOW', confidence, triggeredRules, context, startTime, 'RULE_01');
  }

  // ═══ 阶段 6: P3 品类时效 ═══

  // P3-a: 食品已拆封 → REJECT（不可退）
  if (input.isFoodCategory && input.isOpened === true) {
    triggeredRules.push({
      code: 'RULE_03',
      priority: 'P3',
      description: '食品/生鲜已拆封不支持退货',
      evidence: `商品类别: ${input.order.itemCategory ?? '食品类'}, 已拆封`,
    });
    return buildOutput('REJECT', 'LOW', confidence, triggeredRules, context, startTime, 'RULE_03');
  }

  // P3-b: 收货>7天 → REJECT_WITH_APPEAL
  const daysSinceReceived = calcDaysSince(input.order.receivedDate ?? input.order.shipmentsDate);
  if (daysSinceReceived !== null && daysSinceReceived > 7) {
    triggeredRules.push({
      code: 'RULE_02',
      priority: 'P3',
      description: '收货超过7天',
      evidence: `收货距今: ${daysSinceReceived}天`,
    });
    return buildOutput('REJECT_WITH_APPEAL', 'LOW', confidence, triggeredRules, context, startTime, 'RULE_02');
  }

  // ═══ 阶段 7: P4 默认 APPROVE ═══
  return buildOutput('APPROVE', 'LOW', confidence, triggeredRules, context, startTime, 'DEFAULT_APPROVE');
}
