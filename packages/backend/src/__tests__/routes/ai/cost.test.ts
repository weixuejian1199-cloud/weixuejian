import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ─── Mocks ────────────────────────────────────────────────

const mockGetUsageSummary = vi.fn();
const mockGetUsageBreakdown = vi.fn();
const mockGetDailyTrend = vi.fn();
const mockGetMonthlyReport = vi.fn();

vi.mock('../../../services/ai/cost-service.js', () => ({
  getUsageSummary: (...args: unknown[]) => mockGetUsageSummary(...args),
  getUsageBreakdown: (...args: unknown[]) => mockGetUsageBreakdown(...args),
  getDailyTrend: (...args: unknown[]) => mockGetDailyTrend(...args),
  getMonthlyReport: (...args: unknown[]) => mockGetMonthlyReport(...args),
}));

vi.mock('../../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { costRouter } from '../../../routes/ai/cost.js';

// ─── Test App ─────────────────────────────────────────────

function createApp() {
  const app = express();
  app.use(express.json());
  // 模拟认证中间件
  app.use((req, _res, next) => {
    req.tenantId = 'tenant-001';
    req.user = { userId: 'user-001', role: 'admin', tenantId: 'tenant-001' };
    next();
  });
  app.use('/cost', costRouter);
  return app;
}

const SUMMARY_MOCK = {
  period: 'month' as const,
  totalTokens: 50000,
  promptTokens: 30000,
  completionTokens: 20000,
  totalCostYuan: 15.5,
  requestCount: 100,
  quotaTokensLimit: 1000000,
  quotaTokensUsed: 50000,
  budgetYuanLimit: 100,
  budgetYuanUsed: 15.5,
  usagePercent: 15.5,
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── GET /cost/summary ───────────────────────────────────

describe('GET /cost/summary', () => {
  it('should return monthly summary by default', async () => {
    mockGetUsageSummary.mockResolvedValue(SUMMARY_MOCK);
    const app = createApp();

    const res = await request(app).get('/cost/summary');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.totalTokens).toBe(50000);
    expect(mockGetUsageSummary).toHaveBeenCalledWith('tenant-001', 'month');
  });

  it('should accept period=day', async () => {
    mockGetUsageSummary.mockResolvedValue({ ...SUMMARY_MOCK, period: 'day' });
    const app = createApp();

    const res = await request(app).get('/cost/summary?period=day');

    expect(res.status).toBe(200);
    expect(mockGetUsageSummary).toHaveBeenCalledWith('tenant-001', 'day');
  });

  it('should reject invalid period', async () => {
    const app = createApp();

    const res = await request(app).get('/cost/summary?period=year');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('should handle service error', async () => {
    mockGetUsageSummary.mockRejectedValue(new Error('DB error'));
    const app = createApp();

    const res = await request(app).get('/cost/summary');

    expect(res.status).toBe(500);
  });
});

// ─── GET /cost/breakdown ─────────────────────────────────

describe('GET /cost/breakdown', () => {
  it('should return agent breakdown by default', async () => {
    const breakdownMock = [
      { key: 'master', label: 'master', totalTokens: 30000, promptTokens: 18000, completionTokens: 12000, totalCostYuan: 10, requestCount: 60 },
    ];
    mockGetUsageBreakdown.mockResolvedValue(breakdownMock);
    const app = createApp();

    const res = await request(app).get('/cost/breakdown');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].key).toBe('master');
    expect(mockGetUsageBreakdown).toHaveBeenCalledWith('tenant-001', 'agent', 'month');
  });

  it('should accept groupBy=user', async () => {
    mockGetUsageBreakdown.mockResolvedValue([]);
    const app = createApp();

    const res = await request(app).get('/cost/breakdown?groupBy=user&period=day');

    expect(res.status).toBe(200);
    expect(mockGetUsageBreakdown).toHaveBeenCalledWith('tenant-001', 'user', 'day');
  });

  it('should reject invalid groupBy', async () => {
    const app = createApp();

    const res = await request(app).get('/cost/breakdown?groupBy=model');

    expect(res.status).toBe(400);
  });
});

// ─── GET /cost/trend ─────────────────────────────────────

describe('GET /cost/trend', () => {
  it('should return trend for current month when no param', async () => {
    const trendMock = [
      { date: '2026-03-15', totalTokens: 3000, totalCostYuan: 1.5, requestCount: 10 },
    ];
    mockGetDailyTrend.mockResolvedValue(trendMock);
    const app = createApp();

    const res = await request(app).get('/cost/trend');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(mockGetDailyTrend).toHaveBeenCalledWith('tenant-001', undefined);
  });

  it('should accept month parameter', async () => {
    mockGetDailyTrend.mockResolvedValue([]);
    const app = createApp();

    const res = await request(app).get('/cost/trend?month=2026-02');

    expect(res.status).toBe(200);
    expect(mockGetDailyTrend).toHaveBeenCalledWith('tenant-001', '2026-02');
  });

  it('should reject invalid month format', async () => {
    const app = createApp();

    const res = await request(app).get('/cost/trend?month=2026-3');

    expect(res.status).toBe(400);
  });
});

// ─── GET /cost/report ────────────────────────────────────

describe('GET /cost/report', () => {
  it('should return monthly report', async () => {
    const reportMock = {
      month: '2026-03',
      summary: SUMMARY_MOCK,
      byUser: [],
      byAgent: [],
      dailyTrend: [],
      modelBreakdown: [],
    };
    mockGetMonthlyReport.mockResolvedValue(reportMock);
    const app = createApp();

    const res = await request(app).get('/cost/report?month=2026-03');

    expect(res.status).toBe(200);
    expect(res.body.data.month).toBe('2026-03');
    expect(mockGetMonthlyReport).toHaveBeenCalledWith('tenant-001', '2026-03');
  });

  it('should require month parameter', async () => {
    const app = createApp();

    const res = await request(app).get('/cost/report');

    expect(res.status).toBe(400);
  });

  it('should reject invalid month format', async () => {
    const app = createApp();

    const res = await request(app).get('/cost/report?month=March2026');

    expect(res.status).toBe(400);
  });

  it('should handle service error', async () => {
    mockGetMonthlyReport.mockRejectedValue(new Error('query timeout'));
    const app = createApp();

    const res = await request(app).get('/cost/report?month=2026-03');

    expect(res.status).toBe(500);
  });
});

// ─── 认证保护 ─────────────────────────────────────────────

describe('authentication', () => {
  it('should reject unauthenticated requests', async () => {
    const app = express();
    app.use(express.json());
    // 不注入 tenantId
    app.use('/cost', costRouter);

    const res = await request(app).get('/cost/summary');

    expect(res.status).toBe(401);
  });
});
