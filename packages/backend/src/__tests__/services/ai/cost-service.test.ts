import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────

const mockAiUsageRecordCreate = vi.fn();
const mockAiUsageRecordAggregate = vi.fn();
const mockAiUsageRecordCount = vi.fn();
const mockAiUsageRecordGroupBy = vi.fn();
const mockAiUsageRecordFindMany = vi.fn();
const mockTenantFindUnique = vi.fn();
const mockUserFindMany = vi.fn();

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    aiUsageRecord: {
      create: (...args: unknown[]) => mockAiUsageRecordCreate(...args),
      aggregate: (...args: unknown[]) => mockAiUsageRecordAggregate(...args),
      count: (...args: unknown[]) => mockAiUsageRecordCount(...args),
      groupBy: (...args: unknown[]) => mockAiUsageRecordGroupBy(...args),
      findMany: (...args: unknown[]) => mockAiUsageRecordFindMany(...args),
    },
    tenant: {
      findUnique: (...args: unknown[]) => mockTenantFindUnique(...args),
    },
    user: {
      findMany: (...args: unknown[]) => mockUserFindMany(...args),
    },
  },
}));

vi.mock('../../../lib/env.js', () => ({
  env: {
    AI_DAILY_TOKEN_LIMIT: undefined,
    AI_MONTHLY_BUDGET_YUAN: undefined,
    AI_DOWNGRADE_MODEL: undefined,
  },
}));

vi.mock('../../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  calculateCost,
  recordUsage,
  checkQuota,
  getUsageSummary,
  getUsageBreakdown,
  getDailyTrend,
  getMonthlyReport,
  MODEL_PRICING,
  DOWNGRADE_CHAIN,
} from '../../../services/ai/cost-service.js';

// ─── Helper ───────────────────────────────────────────────

const TENANT_ID = 'tenant-001';
const USER_ID = 'user-001';

function mockTenant(overrides: Record<string, unknown> = {}) {
  return {
    aiQuotaDaily: 100000,
    aiQuotaMonthly: 1000000,
    aiBudgetMonthly: 100,
    aiAlertThreshold: 0.80,
    aiDowngradeThreshold: 0.90,
    ...overrides,
  };
}

function mockAggResult(totalTokens: number | null, costYuan: number | null = null) {
  return {
    _sum: {
      totalTokens,
      promptTokens: totalTokens ? Math.floor(totalTokens * 0.6) : null,
      completionTokens: totalTokens ? Math.floor(totalTokens * 0.4) : null,
      costYuan,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── calculateCost ────────────────────────────────────────

describe('calculateCost', () => {
  it('should calculate cost for qwen-plus', () => {
    const cost = calculateCost('qwen-plus', 1000, 500);
    // 百炼套餐统一费率: 1000/1000 * 0.0008 + 500/1000 * 0.002 = 0.0008 + 0.001 = 0.0018
    expect(cost).toBeCloseTo(0.0018, 6);
  });

  it('should calculate cost for qwen-turbo (same rate as plus in bundle)', () => {
    const cost = calculateCost('qwen-turbo', 1000, 500);
    // 百炼套餐统一费率，与 qwen-plus 相同
    expect(cost).toBeCloseTo(0.0018, 6);
  });

  it('should calculate cost for qwen-max (same rate in bundle)', () => {
    const cost = calculateCost('qwen-max', 1000, 1000);
    // 1000/1000 * 0.0008 + 1000/1000 * 0.002 = 0.0028
    expect(cost).toBeCloseTo(0.0028, 6);
  });

  it('should use fallback pricing for unknown model', () => {
    const cost = calculateCost('unknown-model', 1000, 1000);
    // Fallback = 套餐统一价: 0.0008 + 0.002 = 0.0028
    expect(cost).toBeCloseTo(0.0028, 6);
  });

  it('should return 0 for zero tokens', () => {
    expect(calculateCost('qwen-plus', 0, 0)).toBe(0);
  });

  it('should handle prompt-only tokens', () => {
    const cost = calculateCost('qwen-plus', 1000, 0);
    expect(cost).toBeCloseTo(0.0008, 6);
  });

  it('should handle completion-only tokens', () => {
    const cost = calculateCost('qwen-plus', 0, 1000);
    expect(cost).toBeCloseTo(0.002, 6);
  });
});

// ─── MODEL_PRICING / DOWNGRADE_CHAIN ─────────────────────

describe('pricing config', () => {
  it('should have pricing for all models in downgrade chain', () => {
    for (const model of Object.keys(DOWNGRADE_CHAIN)) {
      expect(MODEL_PRICING[model]).toBeDefined();
    }
    for (const target of Object.values(DOWNGRADE_CHAIN)) {
      expect(MODEL_PRICING[target]).toBeDefined();
    }
  });

  it('should have all downgrade targets in pricing table', () => {
    // 百炼套餐费率统一，降级目的是省token（小模型回复更简短）
    for (const [from, to] of Object.entries(DOWNGRADE_CHAIN)) {
      expect(MODEL_PRICING[from]).toBeDefined();
      expect(MODEL_PRICING[to]).toBeDefined();
    }
  });
});

// ─── recordUsage ──────────────────────────────────────────

describe('recordUsage', () => {
  it('should create a usage record with calculated cost', async () => {
    mockAiUsageRecordCreate.mockResolvedValue({});

    await recordUsage({
      tenantId: TENANT_ID,
      userId: USER_ID,
      conversationId: 'conv-001',
      agentType: 'master',
      model: 'qwen-plus',
      promptTokens: 1000,
      completionTokens: 500,
      wasDowngraded: false,
    });

    expect(mockAiUsageRecordCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: TENANT_ID,
        userId: USER_ID,
        conversationId: 'conv-001',
        agentType: 'master',
        model: 'qwen-plus',
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
        costYuan: expect.closeTo(0.0018, 6),
        wasDowngraded: false,
        originalModel: undefined,
      }),
    });
  });

  it('should record downgrade info', async () => {
    mockAiUsageRecordCreate.mockResolvedValue({});

    await recordUsage({
      tenantId: TENANT_ID,
      userId: USER_ID,
      agentType: 'finance',
      model: 'qwen-turbo',
      promptTokens: 500,
      completionTokens: 200,
      wasDowngraded: true,
      originalModel: 'qwen-plus',
    });

    expect(mockAiUsageRecordCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        wasDowngraded: true,
        originalModel: 'qwen-plus',
        model: 'qwen-turbo',
      }),
    });
  });
});

// ─── checkQuota ───────────────────────────────────────────

describe('checkQuota', () => {
  it('should allow when well within limits', async () => {
    mockAiUsageRecordAggregate
      .mockResolvedValueOnce(mockAggResult(5000))       // daily
      .mockResolvedValueOnce(mockAggResult(50000, 5));   // monthly
    mockTenantFindUnique.mockResolvedValue(mockTenant());

    const result = await checkQuota(TENANT_ID, 'qwen-plus');

    expect(result.allowed).toBe(true);
    expect(result.downgradeTo).toBeUndefined();
  });

  it('should block when daily token limit exceeded', async () => {
    mockAiUsageRecordAggregate
      .mockResolvedValueOnce(mockAggResult(100000))       // daily = at limit
      .mockResolvedValueOnce(mockAggResult(200000, 10));
    mockTenantFindUnique.mockResolvedValue(mockTenant());

    const result = await checkQuota(TENANT_ID, 'qwen-plus');

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('今日');
  });

  it('should block when monthly token limit exceeded', async () => {
    mockAiUsageRecordAggregate
      .mockResolvedValueOnce(mockAggResult(50000))           // daily OK
      .mockResolvedValueOnce(mockAggResult(1000000, 50));    // monthly at limit
    mockTenantFindUnique.mockResolvedValue(mockTenant());

    const result = await checkQuota(TENANT_ID, 'qwen-plus');

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('配额');
  });

  it('should block when monthly budget exceeded', async () => {
    mockAiUsageRecordAggregate
      .mockResolvedValueOnce(mockAggResult(50000))
      .mockResolvedValueOnce(mockAggResult(500000, 100));    // cost = budget
    mockTenantFindUnique.mockResolvedValue(mockTenant());

    const result = await checkQuota(TENANT_ID, 'qwen-plus');

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('预算');
  });

  it('should downgrade model when at downgrade threshold (90%)', async () => {
    mockAiUsageRecordAggregate
      .mockResolvedValueOnce(mockAggResult(50000))
      .mockResolvedValueOnce(mockAggResult(500000, 91));     // 91% of 100 budget
    mockTenantFindUnique.mockResolvedValue(mockTenant());

    const result = await checkQuota(TENANT_ID, 'qwen-plus');

    expect(result.allowed).toBe(true);
    expect(result.downgradeTo).toBe('qwen-turbo');
  });

  it('should not downgrade if already on cheapest model', async () => {
    mockAiUsageRecordAggregate
      .mockResolvedValueOnce(mockAggResult(50000))
      .mockResolvedValueOnce(mockAggResult(500000, 91));
    mockTenantFindUnique.mockResolvedValue(mockTenant());

    const result = await checkQuota(TENANT_ID, 'qwen-turbo');

    expect(result.allowed).toBe(true);
    expect(result.downgradeTo).toBeUndefined();
  });

  it('should allow with alert at alert threshold (80%)', async () => {
    mockAiUsageRecordAggregate
      .mockResolvedValueOnce(mockAggResult(50000))
      .mockResolvedValueOnce(mockAggResult(500000, 85));     // 85% of 100 budget
    mockTenantFindUnique.mockResolvedValue(mockTenant());

    const result = await checkQuota(TENANT_ID, 'qwen-plus');

    expect(result.allowed).toBe(true);
    // Below downgrade threshold, no downgrade
    expect(result.downgradeTo).toBeUndefined();
  });

  it('should block on DB error (fail-secure)', async () => {
    mockAiUsageRecordAggregate.mockRejectedValueOnce(new Error('DB connection lost'));

    const result = await checkQuota(TENANT_ID, 'qwen-plus');

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('不可用');
  });

  it('should block when tenant not found', async () => {
    mockAiUsageRecordAggregate
      .mockResolvedValueOnce(mockAggResult(0))
      .mockResolvedValueOnce(mockAggResult(0, 0));
    mockTenantFindUnique.mockResolvedValue(null);

    const result = await checkQuota(TENANT_ID, 'qwen-plus');

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('租户');
  });
});

// ─── getUsageSummary ──────────────────────────────────────

describe('getUsageSummary', () => {
  it('should return summary for day period', async () => {
    mockAiUsageRecordAggregate.mockResolvedValue({
      _sum: { totalTokens: 5000, promptTokens: 3000, completionTokens: 2000, costYuan: 1.5 },
    });
    mockAiUsageRecordCount.mockResolvedValue(10);
    mockTenantFindUnique.mockResolvedValue({ aiQuotaMonthly: 100000, aiBudgetMonthly: 50 });

    const result = await getUsageSummary(TENANT_ID, 'day');

    expect(result.period).toBe('day');
    expect(result.totalTokens).toBe(5000);
    expect(result.promptTokens).toBe(3000);
    expect(result.completionTokens).toBe(2000);
    expect(result.requestCount).toBe(10);
    expect(result.quotaTokensLimit).toBe(100000);
  });

  it('should return summary for month period', async () => {
    mockAiUsageRecordAggregate.mockResolvedValue({
      _sum: { totalTokens: 50000, promptTokens: 30000, completionTokens: 20000, costYuan: 15 },
    });
    mockAiUsageRecordCount.mockResolvedValue(100);
    mockTenantFindUnique.mockResolvedValue({ aiQuotaMonthly: 1000000, aiBudgetMonthly: 100 });

    const result = await getUsageSummary(TENANT_ID, 'month');

    expect(result.period).toBe('month');
    expect(result.totalTokens).toBe(50000);
    expect(result.requestCount).toBe(100);
    expect(result.usagePercent).toBeGreaterThan(0);
  });

  it('should handle zero usage', async () => {
    mockAiUsageRecordAggregate.mockResolvedValue({
      _sum: { totalTokens: null, promptTokens: null, completionTokens: null, costYuan: null },
    });
    mockAiUsageRecordCount.mockResolvedValue(0);
    mockTenantFindUnique.mockResolvedValue({ aiQuotaMonthly: 100000, aiBudgetMonthly: 100 });

    const result = await getUsageSummary(TENANT_ID, 'day');

    expect(result.totalTokens).toBe(0);
    expect(result.totalCostYuan).toBe(0);
    expect(result.requestCount).toBe(0);
    expect(result.usagePercent).toBe(0);
  });
});

// ─── getUsageBreakdown ────────────────────────────────────

describe('getUsageBreakdown', () => {
  it('should return breakdown by agent type', async () => {
    mockAiUsageRecordGroupBy.mockResolvedValue([
      { agentType: 'master', _sum: { totalTokens: 3000, promptTokens: 1800, completionTokens: 1200, costYuan: 1.0 }, _count: 5 },
      { agentType: 'finance', _sum: { totalTokens: 2000, promptTokens: 1200, completionTokens: 800, costYuan: 0.5 }, _count: 3 },
    ]);

    const result = await getUsageBreakdown(TENANT_ID, 'agent', 'month');

    expect(result).toHaveLength(2);
    expect(result[0]!.key).toBe('master');
    expect(result[0]!.totalTokens).toBe(3000);
    expect(result[1]!.key).toBe('finance');
  });

  it('should return breakdown by user with names', async () => {
    mockAiUsageRecordGroupBy.mockResolvedValue([
      { userId: 'u1', _sum: { totalTokens: 5000, promptTokens: 3000, completionTokens: 2000, costYuan: 2.0 }, _count: 10 },
    ]);
    mockUserFindMany.mockResolvedValue([{ id: 'u1', name: '张三' }]);

    const result = await getUsageBreakdown(TENANT_ID, 'user', 'day');

    expect(result[0]!.label).toBe('张三');
    expect(result[0]!.requestCount).toBe(10);
  });
});

// ─── getDailyTrend ────────────────────────────────────────

describe('getDailyTrend', () => {
  it('should aggregate records by day', async () => {
    mockAiUsageRecordFindMany.mockResolvedValue([
      { createdAt: new Date('2026-03-15T10:00:00Z'), totalTokens: 1000, costYuan: 0.5 },
      { createdAt: new Date('2026-03-15T14:00:00Z'), totalTokens: 2000, costYuan: 1.0 },
      { createdAt: new Date('2026-03-16T09:00:00Z'), totalTokens: 500, costYuan: 0.2 },
    ]);

    const result = await getDailyTrend(TENANT_ID, '2026-03');

    expect(result).toHaveLength(2);
    expect(result[0]!.date).toBe('2026-03-15');
    expect(result[0]!.totalTokens).toBe(3000);
    expect(result[0]!.requestCount).toBe(2);
    expect(result[1]!.date).toBe('2026-03-16');
    expect(result[1]!.totalTokens).toBe(500);
  });

  it('should return empty array when no records', async () => {
    mockAiUsageRecordFindMany.mockResolvedValue([]);

    const result = await getDailyTrend(TENANT_ID, '2026-01');

    expect(result).toEqual([]);
  });
});

// ─── getMonthlyReport ─────────────────────────────────────

describe('getMonthlyReport', () => {
  it('should return full monthly report structure', async () => {
    mockAiUsageRecordAggregate.mockResolvedValue({
      _sum: { totalTokens: 100000, promptTokens: 60000, completionTokens: 40000, costYuan: 30 },
    });
    mockAiUsageRecordCount.mockResolvedValue(200);
    mockTenantFindUnique.mockResolvedValue({ aiQuotaMonthly: 1000000, aiBudgetMonthly: 100 });
    mockAiUsageRecordGroupBy
      .mockResolvedValueOnce([{ userId: 'u1', _sum: { totalTokens: 100000, promptTokens: 60000, completionTokens: 40000, costYuan: 30 }, _count: 200 }])
      .mockResolvedValueOnce([{ agentType: 'master', _sum: { totalTokens: 100000, promptTokens: 60000, completionTokens: 40000, costYuan: 30 }, _count: 200 }])
      .mockResolvedValueOnce([{ model: 'qwen-plus', _sum: { totalTokens: 100000, promptTokens: 60000, completionTokens: 40000, costYuan: 30 }, _count: 200 }]);
    mockAiUsageRecordFindMany.mockResolvedValue([
      { createdAt: new Date('2026-03-15T10:00:00Z'), totalTokens: 100000, costYuan: 30 },
    ]);
    mockUserFindMany.mockResolvedValue([{ id: 'u1', name: '管理员' }]);

    const report = await getMonthlyReport(TENANT_ID, '2026-03');

    expect(report.month).toBe('2026-03');
    expect(report.summary.totalTokens).toBe(100000);
    expect(report.summary.requestCount).toBe(200);
    expect(report.byUser).toHaveLength(1);
    expect(report.byUser[0]!.label).toBe('管理员');
    expect(report.byAgent).toHaveLength(1);
    expect(report.modelBreakdown).toHaveLength(1);
    expect(report.dailyTrend).toHaveLength(1);
  });
});
