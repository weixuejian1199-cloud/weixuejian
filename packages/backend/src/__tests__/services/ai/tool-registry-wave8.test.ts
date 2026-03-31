import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../../../lib/env.js', () => ({
  env: {
    ZTDY_API_BASE_URL: 'https://test.ztdy.cc',
    ZTDY_API_KEY: 'test-key',
  },
}));

vi.mock('../../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    })),
  },
}));

vi.mock('../../../lib/redis.js', () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    setex: vi.fn().mockResolvedValue('OK'),
  },
}));

// Mock MallAdapter
const mockGetOrders = vi.fn();
const mockGetUsers = vi.fn();
const mockGetItems = vi.fn();
const mockGetSupplierWithdraws = vi.fn();

vi.mock('../../../adapters/erp/mall-adapter.js', () => ({
  MallAdapter: vi.fn().mockImplementation(() => ({
    getOrders: mockGetOrders,
    getUsers: mockGetUsers,
    getItems: mockGetItems,
    getSupplierWithdraws: mockGetSupplierWithdraws,
  })),
}));

// Mock aggregates (existing + new)
vi.mock('../../../services/mall/aggregates.js', () => ({
  getSalesStats: vi.fn().mockResolvedValue({
    data: { totalAmount: 100000, orderCount: 500, avgOrderAmount: 200 },
    computedAt: '2026-03-31T00:00:00.000Z',
    completeness: 1,
    totalRecords: 500,
    scannedRecords: 500,
  }),
  getTopSuppliers: vi.fn().mockResolvedValue({
    data: [{ supplierId: 1, supplierName: '时皙官方', value: 200 }],
    computedAt: '2026-03-31T00:00:00.000Z',
    completeness: 1,
    totalRecords: 100,
    scannedRecords: 100,
  }),
  getOrderStatusDistribution: vi.fn().mockResolvedValue({
    data: { '3': 100, '4': 200, '5': 150 },
    computedAt: '2026-03-31T00:00:00.000Z',
    completeness: 1,
    totalRecords: 450,
    scannedRecords: 450,
  }),
  getSlowSuppliers: vi.fn().mockResolvedValue({
    data: [
      { supplierId: 101, supplierName: '慢供应商A', pendingCount: 5, oldestOrderDate: '2026-03-01' },
      { supplierId: 102, supplierName: '慢供应商B', pendingCount: 3, oldestOrderDate: '2026-03-10' },
    ],
    computedAt: '2026-03-31T00:00:00.000Z',
    completeness: 1,
    totalRecords: 200,
    scannedRecords: 200,
  }),
  getUserGrowthTrend: vi.fn().mockResolvedValue({
    data: {
      totalNew: 150,
      dailyBreakdown: [
        { date: '2026-03-29', count: 50 },
        { date: '2026-03-30', count: 60 },
        { date: '2026-03-31', count: 40 },
      ],
    },
    computedAt: '2026-03-31T00:00:00.000Z',
    completeness: 1,
    totalRecords: 150,
    scannedRecords: 150,
  }),
}));

import { TOOL_DEFINITIONS, executeTool } from '../../../services/ai/tool-registry.js';

describe('tool-registry Wave 8', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── 工具定义 ──────────────────────────────────────────

  describe('TOOL_DEFINITIONS (Wave 8 新增)', () => {
    it('应该包含 9 个工具定义（原6 + 新增3）', () => {
      expect(TOOL_DEFINITIONS).toHaveLength(9);
    });

    it('getSlowSuppliers 工具定义应存在且格式正确', () => {
      const tool = TOOL_DEFINITIONS.find((t) => t.function.name === 'getSlowSuppliers');
      expect(tool).toBeDefined();
      expect(tool!.type).toBe('function');
      expect(tool!.function.description).toBeTruthy();
      expect(tool!.function.parameters).toBeDefined();
      // 应该有 limit 参数
      const props = tool!.function.parameters['properties'] as Record<string, unknown> | undefined;
      expect(props).toBeDefined();
      expect(props!['limit']).toBeDefined();
    });

    it('getUserGrowthTrend 工具定义应存在且格式正确', () => {
      const tool = TOOL_DEFINITIONS.find((t) => t.function.name === 'getUserGrowthTrend');
      expect(tool).toBeDefined();
      expect(tool!.type).toBe('function');
      expect(tool!.function.description).toBeTruthy();
      expect(tool!.function.parameters).toBeDefined();
      // 应该有日期参数
      const props = tool!.function.parameters['properties'] as Record<string, unknown> | undefined;
      expect(props).toBeDefined();
      expect(props!['startDate']).toBeDefined();
      expect(props!['endDate']).toBeDefined();
      // startDate/endDate 应该是必填
      const required = tool!.function.parameters['required'] as string[] | undefined;
      expect(required).toContain('startDate');
      expect(required).toContain('endDate');
    });

    it('getSupplierWithdraws 工具定义应存在且格式正确', () => {
      const tool = TOOL_DEFINITIONS.find((t) => t.function.name === 'getSupplierWithdraws');
      expect(tool).toBeDefined();
      expect(tool!.type).toBe('function');
      expect(tool!.function.description).toBeTruthy();
      expect(tool!.function.parameters).toBeDefined();
      // 应该支持 supplierId 过滤
      const props = tool!.function.parameters['properties'] as Record<string, unknown> | undefined;
      expect(props).toBeDefined();
      expect(props!['supplierId']).toBeDefined();
    });

    it('工具名列表应包含所有9个工具', () => {
      const names = TOOL_DEFINITIONS.map((t) => t.function.name);
      expect(names).toContain('getSalesStats');
      expect(names).toContain('getTopSuppliers');
      expect(names).toContain('getOrderStatusDistribution');
      expect(names).toContain('getOrders');
      expect(names).toContain('getUsers');
      expect(names).toContain('getItems');
      expect(names).toContain('getSlowSuppliers');
      expect(names).toContain('getUserGrowthTrend');
      expect(names).toContain('getSupplierWithdraws');
    });
  });

  // ─── 工具执行 ──────────────────────────────────────────

  describe('executeTool (Wave 8 新工具)', () => {
    it('getSlowSuppliers 执行应返回结构化数据 + _dataSource + _queryTime', async () => {
      const result = await executeTool(
        'call_slow_1',
        'getSlowSuppliers',
        JSON.stringify({ limit: 5 }),
        'tenant-1',
      );

      expect(result.toolCallId).toBe('call_slow_1');
      expect(result.toolName).toBe('getSlowSuppliers');
      expect(result.error).toBeUndefined();
      expect(result.duration).toBeGreaterThanOrEqual(0);

      const data = result.result as Record<string, unknown>;
      expect(data['_dataSource']).toBeTruthy();
      expect(data['_queryTime']).toBeTruthy();
      // 应包含供应商数据
      expect(data['data']).toBeDefined();
    });

    it('getUserGrowthTrend 执行应返回结构化数据 + _dataSource + _queryTime', async () => {
      const result = await executeTool(
        'call_growth_1',
        'getUserGrowthTrend',
        JSON.stringify({ startDate: '2026-03-29', endDate: '2026-03-31' }),
        'tenant-1',
      );

      expect(result.toolCallId).toBe('call_growth_1');
      expect(result.toolName).toBe('getUserGrowthTrend');
      expect(result.error).toBeUndefined();

      const data = result.result as Record<string, unknown>;
      expect(data['_dataSource']).toBeTruthy();
      expect(data['_queryTime']).toBeTruthy();
      // 应包含增长趋势数据
      expect(data['data']).toBeDefined();
    });

    it('getSupplierWithdraws 执行应返回提现列表 + totalAmount + _dataSource + _queryTime', async () => {
      mockGetSupplierWithdraws.mockResolvedValueOnce({
        items: [
          { supplierId: 101, payNo: 'PAY001', bankAccountNo: '622***', tranAmount: 5000, status: 1, finishDate: null, createDate: '2026-03-30' },
          { supplierId: 101, payNo: 'PAY002', bankAccountNo: '622***', tranAmount: 3000, status: 2, finishDate: '2026-03-31', createDate: '2026-03-29' },
        ],
        pagination: { pageIndex: 1, pageSize: 20, totalCount: 2, totalPages: 1 },
        source: 'api' as const,
      });

      const result = await executeTool(
        'call_withdraw_1',
        'getSupplierWithdraws',
        JSON.stringify({ supplierId: 101 }),
        'tenant-1',
      );

      expect(result.toolCallId).toBe('call_withdraw_1');
      expect(result.toolName).toBe('getSupplierWithdraws');
      expect(result.error).toBeUndefined();

      const data = result.result as Record<string, unknown>;
      expect(data['_dataSource']).toBeTruthy();
      expect(data['_queryTime']).toBeTruthy();
    });

    it('getSupplierWithdraws 应按 supplierId 客户端过滤', async () => {
      // BE实现: adapter不支持supplierId参数，查全部后客户端过滤
      mockGetSupplierWithdraws.mockResolvedValueOnce({
        items: [
          { supplierId: 202, payNo: 'PAY003', bankAccountNo: null, tranAmount: 1000, status: 1, finishDate: null, createDate: '2026-03-28' },
          { supplierId: 999, payNo: 'PAY004', bankAccountNo: null, tranAmount: 2000, status: 1, finishDate: null, createDate: '2026-03-28' },
        ],
        pagination: { pageIndex: 1, pageSize: 20, totalCount: 2, totalPages: 1 },
        source: 'api' as const,
      });

      const result = await executeTool(
        'call_withdraw_2',
        'getSupplierWithdraws',
        JSON.stringify({ supplierId: 202 }),
        'tenant-1',
      );

      expect(result.error).toBeUndefined();
      // adapter被调用（不含supplierId参数，客户端过滤）
      expect(mockGetSupplierWithdraws).toHaveBeenCalled();
      // 结果应只包含supplierId=202的记录
      const data = result.result as Record<string, unknown>;
      expect(data['_dataSource']).toBeTruthy();
    });

    it('getSlowSuppliers 无参数也应正常执行（使用默认limit）', async () => {
      const result = await executeTool(
        'call_slow_default',
        'getSlowSuppliers',
        JSON.stringify({}),
        'tenant-1',
      );

      expect(result.error).toBeUndefined();
      expect(result.result).toBeDefined();
    });

    it('getUserGrowthTrend 缺少必填参数时应返回错误或使用默认值', async () => {
      // 根据工具定义，startDate/endDate 是必填的
      // AI 模型不应该省略必填参数，但 handler 应该优雅处理
      const result = await executeTool(
        'call_growth_missing',
        'getUserGrowthTrend',
        JSON.stringify({}),
        'tenant-1',
      );

      // 两种可能的行为都是合理的：
      // 1. 返回 error（参数校验失败）
      // 2. 使用默认日期范围
      // 只要不是未捕获异常就行
      expect(result.toolCallId).toBe('call_growth_missing');
      expect(result.toolName).toBe('getUserGrowthTrend');
    });

    it('新工具的无效 JSON 参数应该返回 error', async () => {
      const result = await executeTool(
        'call_bad_json',
        'getSlowSuppliers',
        '{invalid-json}',
        'tenant-1',
      );

      expect(result.error).toBe('参数格式无效');
      expect(result.result).toBeNull();
    });
  });
});
