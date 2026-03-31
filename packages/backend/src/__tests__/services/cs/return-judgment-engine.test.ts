import { describe, it, expect } from 'vitest';
import { evaluateReturnRequest, isFoodCategory } from '../../../services/cs/return-judgment-engine.js';
import type { JudgmentInput, OrderSnapshot, EmotionAnalysis, RefundIntentAnalysis } from '../../../services/cs/types.js';

// ─── 测试工具函数 ─────────────────────────────────────

function makeEmotion(overrides: Partial<EmotionAnalysis> = {}): EmotionAnalysis {
  return { level: 'none', matchedKeywords: [], highCount: 0, mediumCount: 0, ...overrides };
}

function makeRefundIntent(overrides: Partial<RefundIntentAnalysis> = {}): RefundIntentAnalysis {
  return { detected: false, matchedKeywords: [], ...overrides };
}

function makeOrder(overrides: Partial<OrderSnapshot> = {}): OrderSnapshot {
  return {
    orderId: 'ORD-001',
    processNode: 4,
    totalAmount: 100,
    payDate: '2026-03-20',
    shipmentsDate: '2026-03-22',
    receivedDate: '2026-03-25',
    itemCategory: '护肤品',
    buyerName: '测试用户',
    ...overrides,
  };
}

function makeInput(overrides: Partial<JudgmentInput> = {}): JudgmentInput {
  return {
    messageContent: '我想退货',
    order: makeOrder(),
    emotion: makeEmotion(),
    refundIntent: makeRefundIntent(),
    recentReturnCount: 0,
    isOpened: false,
    isFoodCategory: false,
    ...overrides,
  };
}

// ─── 通用属性测试 ────────────────────────────────────

describe('evaluateReturnRequest — common properties', () => {
  it('should always have executionAllowed=false', () => {
    const result = evaluateReturnRequest(makeInput());
    expect(result.executionAllowed).toBe(false);
  });

  it('should always include disclaimer', () => {
    const result = evaluateReturnRequest(makeInput());
    expect(result.disclaimer).toContain('仅供参考');
  });

  it('should have processingTimeMs >= 0', () => {
    const result = evaluateReturnRequest(makeInput());
    expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('should have confidence between 0 and 1', () => {
    const result = evaluateReturnRequest(makeInput());
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('should have non-empty reason and reasonForCustomer', () => {
    const result = evaluateReturnRequest(makeInput());
    expect(result.reason.length).toBeGreaterThan(0);
    expect(result.reasonForCustomer.length).toBeGreaterThan(0);
  });
});

// ─── GATE_DATA_MISSING (订单缺失) ────────────────────

describe('evaluateReturnRequest — GATE_DATA_MISSING', () => {
  it('should ESCALATE when order is null', () => {
    const result = evaluateReturnRequest(makeInput({ order: null }));
    expect(result.decision).toBe('ESCALATE');
    expect(result.riskLevel).toBe('CRITICAL');
    expect(result.confidence).toBe(0);
    expect(result.triggeredRules[0].code).toBe('GATE_DATA_MISSING');
  });
});

// ─── GATE_REFUND_REQUEST (P0 退款意图) ──────────────

describe('evaluateReturnRequest — GATE_REFUND_REQUEST', () => {
  it('should ESCALATE when refund intent detected', () => {
    const result = evaluateReturnRequest(makeInput({
      refundIntent: makeRefundIntent({ detected: true, matchedKeywords: ['退款'] }),
    }));
    expect(result.decision).toBe('ESCALATE');
    expect(result.triggeredRules[0].code).toBe('GATE_REFUND_REQUEST');
    expect(result.riskLevel).toBe('HIGH');
  });
});

// ─── GATE_EMOTION (P0 情绪激动) ─────────────────────

describe('evaluateReturnRequest — GATE_EMOTION', () => {
  it('should ESCALATE when emotion is high', () => {
    const result = evaluateReturnRequest(makeInput({
      emotion: makeEmotion({ level: 'high', matchedKeywords: ['投诉'], highCount: 1 }),
    }));
    expect(result.decision).toBe('ESCALATE');
    expect(result.triggeredRules[0].code).toBe('GATE_EMOTION');
    expect(result.riskLevel).toBe('CRITICAL');
  });

  it('should NOT escalate when emotion is medium', () => {
    const result = evaluateReturnRequest(makeInput({
      emotion: makeEmotion({ level: 'medium', matchedKeywords: ['失望'], mediumCount: 1 }),
    }));
    expect(result.decision).not.toBe('ESCALATE');
  });
});

// ─── GATE_FRAUD (P0 欺诈嫌疑) ──────────────────────

describe('evaluateReturnRequest — GATE_FRAUD', () => {
  it('should ESCALATE when recentReturnCount >= 3', () => {
    const result = evaluateReturnRequest(makeInput({ recentReturnCount: 3 }));
    expect(result.decision).toBe('ESCALATE');
    expect(result.triggeredRules[0].code).toBe('GATE_FRAUD');
    expect(result.riskLevel).toBe('CRITICAL');
  });

  it('should NOT trigger fraud for recentReturnCount < 3', () => {
    const result = evaluateReturnRequest(makeInput({ recentReturnCount: 2 }));
    expect(result.triggeredRules.every((r) => r.code !== 'GATE_FRAUD')).toBe(true);
  });

  it('should ESCALATE when received < 2 hours ago', () => {
    const twoHoursAgo = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
    const result = evaluateReturnRequest(makeInput({
      order: makeOrder({ processNode: 4, receivedDate: twoHoursAgo }),
    }));
    expect(result.decision).toBe('ESCALATE');
    expect(result.triggeredRules[0].code).toBe('GATE_FRAUD');
  });
});

// ─── GATE_LOW_CONFIDENCE (P0 低置信度) ─────────────

describe('evaluateReturnRequest — GATE_LOW_CONFIDENCE', () => {
  it('should ESCALATE when multiple fields missing drop confidence below 0.7', () => {
    // payDate=null(-0.15) + processNode=undefined(-0.2) + totalAmount=undefined(-0.1) = 0.55 < 0.7
    const result = evaluateReturnRequest(makeInput({
      order: {
        orderId: 'ORD-INCOMPLETE',
        processNode: undefined as unknown as number,
        totalAmount: undefined as unknown as number,
        payDate: null,
        shipmentsDate: null,
        receivedDate: null,
        itemCategory: null,
        buyerName: null,
      },
    }));
    expect(result.decision).toBe('ESCALATE');
    expect(result.triggeredRules.some((r) => r.code === 'GATE_LOW_CONFIDENCE')).toBe(true);
  });
});

// ─── RULE_05 (P1 金额>500) ─────────────────────────

describe('evaluateReturnRequest — RULE_05 (金额>500)', () => {
  it('should ESCALATE when totalAmount > 500', () => {
    const result = evaluateReturnRequest(makeInput({
      order: makeOrder({ totalAmount: 501 }),
    }));
    expect(result.decision).toBe('ESCALATE');
    expect(result.triggeredRules[0].code).toBe('RULE_05');
    expect(result.riskLevel).toBe('HIGH');
  });

  it('should NOT trigger for totalAmount = 500 (boundary)', () => {
    const result = evaluateReturnRequest(makeInput({
      order: makeOrder({ totalAmount: 500 }),
    }));
    expect(result.triggeredRules.every((r) => r.code !== 'RULE_05')).toBe(true);
  });

  it('should NOT trigger for totalAmount = 499', () => {
    const result = evaluateReturnRequest(makeInput({
      order: makeOrder({ totalAmount: 499 }),
    }));
    expect(result.triggeredRules.every((r) => r.code !== 'RULE_05')).toBe(true);
  });
});

// ─── RULE_01 (P2 未收货) ───────────────────────────

describe('evaluateReturnRequest — RULE_01 (未收货)', () => {
  it('should APPROVE when processNode < 3 (未发货)', () => {
    const result = evaluateReturnRequest(makeInput({
      order: makeOrder({ processNode: 2 }),
    }));
    expect(result.decision).toBe('APPROVE');
    expect(result.triggeredRules[0].code).toBe('RULE_01');
  });

  it('should APPROVE for processNode = 0 (待付款)', () => {
    const result = evaluateReturnRequest(makeInput({
      order: makeOrder({ processNode: 0 }),
    }));
    expect(result.decision).toBe('APPROVE');
    expect(result.triggeredRules[0].code).toBe('RULE_01');
  });

  it('should NOT trigger for processNode = 3 (已发货)', () => {
    const result = evaluateReturnRequest(makeInput({
      order: makeOrder({ processNode: 3 }),
    }));
    expect(result.triggeredRules.every((r) => r.code !== 'RULE_01')).toBe(true);
  });
});

// ─── RULE_03 (P3 食品已拆封) ───────────────────────

describe('evaluateReturnRequest — RULE_03 (食品已拆封)', () => {
  it('should REJECT when food category and opened', () => {
    const result = evaluateReturnRequest(makeInput({
      isFoodCategory: true,
      isOpened: true,
      order: makeOrder({ processNode: 4 }),
    }));
    expect(result.decision).toBe('REJECT');
    expect(result.triggeredRules[0].code).toBe('RULE_03');
  });

  it('should NOT reject when food category but not opened', () => {
    const result = evaluateReturnRequest(makeInput({
      isFoodCategory: true,
      isOpened: false,
      order: makeOrder({ processNode: 4 }),
    }));
    expect(result.decision).not.toBe('REJECT');
  });

  it('should NOT reject when non-food category and opened', () => {
    const result = evaluateReturnRequest(makeInput({
      isFoodCategory: false,
      isOpened: true,
      order: makeOrder({ processNode: 4 }),
    }));
    expect(result.triggeredRules.every((r) => r.code !== 'RULE_03')).toBe(true);
  });
});

// ─── RULE_02 (P3 收货>7天) ─────────────────────────

describe('evaluateReturnRequest — RULE_02 (收货>7天)', () => {
  it('should REJECT_WITH_APPEAL when received > 7 days ago', () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const result = evaluateReturnRequest(makeInput({
      order: makeOrder({ processNode: 4, receivedDate: eightDaysAgo }),
    }));
    expect(result.decision).toBe('REJECT_WITH_APPEAL');
    expect(result.triggeredRules[0].code).toBe('RULE_02');
  });

  it('should NOT trigger for exactly 7 days (boundary)', () => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const result = evaluateReturnRequest(makeInput({
      order: makeOrder({ processNode: 4, receivedDate: sevenDaysAgo }),
    }));
    expect(result.triggeredRules.every((r) => r.code !== 'RULE_02')).toBe(true);
  });

  it('should NOT trigger for recent received date', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const result = evaluateReturnRequest(makeInput({
      order: makeOrder({ processNode: 4, receivedDate: twoDaysAgo }),
    }));
    expect(result.triggeredRules.every((r) => r.code !== 'RULE_02')).toBe(true);
  });
});

// ─── P4 默认 APPROVE ──────────────────────────────

describe('evaluateReturnRequest — P4 default APPROVE', () => {
  it('should APPROVE when no rules trigger', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const result = evaluateReturnRequest(makeInput({
      order: makeOrder({ processNode: 4, totalAmount: 100, receivedDate: threeDaysAgo }),
    }));
    expect(result.decision).toBe('APPROVE');
    expect(result.riskLevel).toBe('LOW');
    expect(result.triggeredRules).toHaveLength(0);
  });
});

// ─── 优先级覆盖测试 ──────────────────────────────────

describe('evaluateReturnRequest — priority override', () => {
  it('P0 should override P2 (emotion + 未收货)', () => {
    const result = evaluateReturnRequest(makeInput({
      emotion: makeEmotion({ level: 'high', matchedKeywords: ['投诉'], highCount: 1 }),
      order: makeOrder({ processNode: 2 }),
    }));
    expect(result.decision).toBe('ESCALATE');
    expect(result.triggeredRules[0].code).toBe('GATE_EMOTION');
  });

  it('P0 refund intent should override P1 amount', () => {
    const result = evaluateReturnRequest(makeInput({
      refundIntent: makeRefundIntent({ detected: true, matchedKeywords: ['退款'] }),
      order: makeOrder({ totalAmount: 600 }),
    }));
    expect(result.decision).toBe('ESCALATE');
    expect(result.triggeredRules[0].code).toBe('GATE_REFUND_REQUEST');
  });

  it('P1 amount should override P3 time', () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const result = evaluateReturnRequest(makeInput({
      order: makeOrder({ totalAmount: 600, processNode: 4, receivedDate: eightDaysAgo }),
    }));
    expect(result.decision).toBe('ESCALATE');
    expect(result.triggeredRules[0].code).toBe('RULE_05');
  });
});

// ─── isFoodCategory 辅助函数测试 ─────────────────────

describe('isFoodCategory', () => {
  it('should return true for 食品', () => {
    expect(isFoodCategory('食品')).toBe(true);
  });

  it('should return true for 生鲜水果', () => {
    expect(isFoodCategory('生鲜水果')).toBe(true);
  });

  it('should return true for 生酮产品', () => {
    expect(isFoodCategory('生酮零食')).toBe(true);
  });

  it('should return false for 护肤品', () => {
    expect(isFoodCategory('护肤品')).toBe(false);
  });

  it('should return false for null', () => {
    expect(isFoodCategory(null)).toBe(false);
  });
});
