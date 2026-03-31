import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────

const mockTenantFindMany = vi.fn();
const mockUserFindMany = vi.fn();
const mockNotificationCreate = vi.fn();
const mockGetMonthlyReport = vi.fn();

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    tenant: {
      findMany: (...args: unknown[]) => mockTenantFindMany(...args),
    },
    user: {
      findMany: (...args: unknown[]) => mockUserFindMany(...args),
    },
    notification: {
      create: (...args: unknown[]) => mockNotificationCreate(...args),
    },
  },
}));

vi.mock('../../services/ai/cost-service.js', () => ({
  getMonthlyReport: (...args: unknown[]) => mockGetMonthlyReport(...args),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { generateMonthlyCostReport, getPreviousMonth, formatReportSummary } from '../../jobs/monthly-cost-report.js';

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── getPreviousMonth ─────────────────────────────────────

describe('getPreviousMonth', () => {
  it('should return a YYYY-MM formatted string', () => {
    const result = getPreviousMonth();
    expect(result).toMatch(/^\d{4}-\d{2}$/);
  });

  it('should return a month before current', () => {
    const result = getPreviousMonth();
    const [year, month] = result.split('-').map(Number);
    const now = new Date();
    const expected = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    expect(year).toBe(expected.getFullYear());
    expect(month).toBe(expected.getMonth() + 1);
  });
});

// ─── formatReportSummary ──────────────────────────────────

describe('formatReportSummary', () => {
  it('should format summary with all fields', () => {
    const result = formatReportSummary({
      month: '2026-03',
      summary: { totalTokens: 50000, totalCostYuan: 15.5, requestCount: 100, usagePercent: 15.5 },
    });

    expect(result).toContain('2026-03');
    expect(result).toContain('100次');
    expect(result).toContain('50,000');
    expect(result).toContain('¥15.50');
    expect(result).toContain('15.5%');
  });

  it('should handle zero values', () => {
    const result = formatReportSummary({
      month: '2026-01',
      summary: { totalTokens: 0, totalCostYuan: 0, requestCount: 0, usagePercent: 0 },
    });

    expect(result).toContain('0次');
    expect(result).toContain('¥0.00');
  });
});

// ─── generateMonthlyCostReport ────────────────────────────

describe('generateMonthlyCostReport', () => {
  const mockReport = {
    month: '2026-02',
    summary: { totalTokens: 50000, totalCostYuan: 15.5, requestCount: 100, usagePercent: 15.5 },
    byUser: [{ key: 'u1', label: '管理员', totalTokens: 50000, totalCostYuan: 15.5, requestCount: 100 }],
    byAgent: [{ key: 'master', label: 'master', totalTokens: 50000, totalCostYuan: 15.5, requestCount: 100 }],
    dailyTrend: [],
    modelBreakdown: [{ key: 'qwen-plus', label: 'qwen-plus', totalTokens: 50000, totalCostYuan: 15.5, requestCount: 100 }],
  };

  it('should generate report for active tenants', async () => {
    mockTenantFindMany.mockResolvedValue([{ id: 'tenant-1', name: '测试企业' }]);
    mockGetMonthlyReport.mockResolvedValue(mockReport);
    mockUserFindMany.mockResolvedValue([{ id: 'admin-1' }]);
    mockNotificationCreate.mockResolvedValue({});

    await generateMonthlyCostReport();

    expect(mockGetMonthlyReport).toHaveBeenCalledWith('tenant-1', expect.any(String));
    expect(mockNotificationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-1',
        userId: 'admin-1',
        type: 'ai_cost_report',
      }),
    });
  });

  it('should skip tenants with no usage', async () => {
    mockTenantFindMany.mockResolvedValue([{ id: 'tenant-1', name: '测试企业' }]);
    mockGetMonthlyReport.mockResolvedValue({
      ...mockReport,
      summary: { ...mockReport.summary, requestCount: 0 },
    });

    await generateMonthlyCostReport();

    expect(mockNotificationCreate).not.toHaveBeenCalled();
  });

  it('should handle multiple tenants', async () => {
    mockTenantFindMany.mockResolvedValue([
      { id: 'tenant-1', name: '企业A' },
      { id: 'tenant-2', name: '企业B' },
    ]);
    mockGetMonthlyReport.mockResolvedValue(mockReport);
    mockUserFindMany.mockResolvedValue([{ id: 'admin-1' }]);
    mockNotificationCreate.mockResolvedValue({});

    await generateMonthlyCostReport();

    expect(mockGetMonthlyReport).toHaveBeenCalledTimes(2);
  });

  it('should not crash when a single tenant fails', async () => {
    mockTenantFindMany.mockResolvedValue([
      { id: 'tenant-1', name: '企业A' },
      { id: 'tenant-2', name: '企业B' },
    ]);
    mockGetMonthlyReport
      .mockRejectedValueOnce(new Error('DB timeout'))
      .mockResolvedValueOnce(mockReport);
    mockUserFindMany.mockResolvedValue([{ id: 'admin-1' }]);
    mockNotificationCreate.mockResolvedValue({});

    await expect(generateMonthlyCostReport()).resolves.not.toThrow();
    expect(mockGetMonthlyReport).toHaveBeenCalledTimes(2);
  });

  it('should handle no active tenants', async () => {
    mockTenantFindMany.mockResolvedValue([]);

    await expect(generateMonthlyCostReport()).resolves.not.toThrow();
    expect(mockGetMonthlyReport).not.toHaveBeenCalled();
  });
});
