/**
 * RPA 统一 Schema 测试
 */
import { describe, it, expect } from 'vitest';
import {
  unifiedTransactionSchema,
  unifiedSettlementSchema,
  unifiedAdSpendSchema,
  unifiedDailyMetricsSchema,
  mockUnifiedTransaction,
  mockUnifiedSettlement,
  mockUnifiedAdSpend,
  mockUnifiedDailyMetrics,
} from '../schemas.js';

describe('UnifiedTransaction Schema', () => {
  it('should validate a valid transaction', () => {
    const tx = mockUnifiedTransaction();
    const result = unifiedTransactionSchema.safeParse(tx);
    expect(result.success).toBe(true);
  });

  it('should accept inflow direction', () => {
    const tx = mockUnifiedTransaction({ direction: 'inflow', amount: 1500 });
    const result = unifiedTransactionSchema.safeParse(tx);
    expect(result.success).toBe(true);
  });

  it('should accept outflow direction', () => {
    const tx = mockUnifiedTransaction({ direction: 'outflow', amount: -800 });
    const result = unifiedTransactionSchema.safeParse(tx);
    expect(result.success).toBe(true);
  });

  it('should reject empty sourceAccountId', () => {
    const tx = mockUnifiedTransaction({ sourceAccountId: '' });
    const result = unifiedTransactionSchema.safeParse(tx);
    expect(result.success).toBe(false);
  });

  it('should reject invalid sourceType', () => {
    const tx = { ...mockUnifiedTransaction(), sourceType: 'invalid' };
    const result = unifiedTransactionSchema.safeParse(tx);
    expect(result.success).toBe(false);
  });

  it('should coerce string dates to Date objects', () => {
    const tx = {
      ...mockUnifiedTransaction(),
      transactionDate: '2026-04-01',
      syncedAt: '2026-04-01T10:00:00Z',
    };
    const result = unifiedTransactionSchema.safeParse(tx);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.transactionDate).toBeInstanceOf(Date);
      expect(result.data.syncedAt).toBeInstanceOf(Date);
    }
  });

  it('should allow optional fields to be undefined', () => {
    const tx = mockUnifiedTransaction();
    delete (tx as Record<string, unknown>).category;
    delete (tx as Record<string, unknown>).matchedSettlementId;
    delete (tx as Record<string, unknown>).matchedPurchaseId;
    const result = unifiedTransactionSchema.safeParse(tx);
    expect(result.success).toBe(true);
  });
});

describe('UnifiedSettlement Schema', () => {
  it('should validate a valid settlement', () => {
    const s = mockUnifiedSettlement();
    const result = unifiedSettlementSchema.safeParse(s);
    expect(result.success).toBe(true);
  });

  it('should reject invalid platform', () => {
    const s = { ...mockUnifiedSettlement(), platform: 'unknown' };
    const result = unifiedSettlementSchema.safeParse(s);
    expect(result.success).toBe(false);
  });

  it('should validate all platform types', () => {
    const platforms = ['douyin', 'weixin_video', 'meituan', 'eleme', 'jddj', 'miniapp'] as const;
    for (const platform of platforms) {
      const s = mockUnifiedSettlement({ platform });
      const result = unifiedSettlementSchema.safeParse(s);
      expect(result.success).toBe(true);
    }
  });

  it('should validate payment status', () => {
    const statuses = ['pending', 'paid', 'matched'] as const;
    for (const status of statuses) {
      const s = mockUnifiedSettlement({ paymentStatus: status });
      const result = unifiedSettlementSchema.safeParse(s);
      expect(result.success).toBe(true);
    }
  });
});

describe('UnifiedAdSpend Schema', () => {
  it('should validate a valid ad spend', () => {
    const ad = mockUnifiedAdSpend();
    const result = unifiedAdSpendSchema.safeParse(ad);
    expect(result.success).toBe(true);
  });

  it('should reject negative spend', () => {
    const ad = mockUnifiedAdSpend({ spend: -100 });
    const result = unifiedAdSpendSchema.safeParse(ad);
    expect(result.success).toBe(false);
  });

  it('should reject negative impressions', () => {
    const ad = mockUnifiedAdSpend({ impressions: -1 });
    const result = unifiedAdSpendSchema.safeParse(ad);
    expect(result.success).toBe(false);
  });
});

describe('UnifiedDailyMetrics Schema', () => {
  it('should validate a valid metrics record', () => {
    const m = mockUnifiedDailyMetrics();
    const result = unifiedDailyMetricsSchema.safeParse(m);
    expect(result.success).toBe(true);
  });

  it('should reject conversionRate > 1', () => {
    const m = mockUnifiedDailyMetrics({ conversionRate: 1.5 });
    const result = unifiedDailyMetricsSchema.safeParse(m);
    expect(result.success).toBe(false);
  });

  it('should reject refundRate > 1', () => {
    const m = mockUnifiedDailyMetrics({ refundRate: 1.1 });
    const result = unifiedDailyMetricsSchema.safeParse(m);
    expect(result.success).toBe(false);
  });

  it('should reject empty platform', () => {
    const m = mockUnifiedDailyMetrics({ platform: '' });
    const result = unifiedDailyMetricsSchema.safeParse(m);
    expect(result.success).toBe(false);
  });
});

describe('Mock factories', () => {
  it('should allow overriding any field', () => {
    const tx = mockUnifiedTransaction({
      amount: 99999,
      counterparty: '测试对手方',
    });
    expect(tx.amount).toBe(99999);
    expect(tx.counterparty).toBe('测试对手方');
  });

  it('should produce unique mock data for each call', () => {
    const tx1 = mockUnifiedTransaction();
    const tx2 = mockUnifiedTransaction();
    // syncedAt should be different (called at different ms)
    expect(tx1.syncedAt.getTime()).toBeLessThanOrEqual(tx2.syncedAt.getTime());
  });
});
