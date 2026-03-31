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

vi.mock('../../../adapters/erp/mall-adapter.js', () => ({
  MallAdapter: vi.fn().mockImplementation(() => ({
    getOrders: mockGetOrders,
    getUsers: mockGetUsers,
    getItems: mockGetItems,
  })),
}));

// Mock aggregates
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
}));

import { TOOL_DEFINITIONS, executeTool } from '../../../services/ai/tool-registry.js';

describe('tool-registry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('TOOL_DEFINITIONS', () => {
    it('应该包含 9 个工具定义', () => {
      expect(TOOL_DEFINITIONS).toHaveLength(9);
    });

    it('每个工具应该有 name 和 description', () => {
      for (const tool of TOOL_DEFINITIONS) {
        expect(tool.type).toBe('function');
        expect(tool.function.name).toBeTruthy();
        expect(tool.function.description).toBeTruthy();
        expect(tool.function.parameters).toBeDefined();
      }
    });

    it('应该包含正确的工具名列表', () => {
      const names = TOOL_DEFINITIONS.map((t) => t.function.name);
      expect(names).toEqual([
        'getSalesStats',
        'getTopSuppliers',
        'getOrderStatusDistribution',
        'getOrders',
        'getUsers',
        'getItems',
        'getSlowSuppliers',
        'getUserGrowthTrend',
        'getSupplierWithdraws',
      ]);
    });
  });

  describe('executeTool', () => {
    it('未知工具应该返回 error', async () => {
      const result = await executeTool('call_1', 'unknownTool', '{}', 'tenant-1');

      expect(result.error).toBe('Unknown tool: unknownTool');
      expect(result.result).toBeNull();
    });

    it('无效 JSON 参数应该返回 error', async () => {
      const result = await executeTool('call_2', 'getSalesStats', 'not-json', 'tenant-1');

      expect(result.error).toBe('参数格式无效');
    });

    it('executeTool 应该返回 duration 和 toolCallId', async () => {
      const result = await executeTool(
        'call_3',
        'getSalesStats',
        JSON.stringify({ startDate: '2026-03-01', endDate: '2026-03-31' }),
        'tenant-1',
      );

      expect(result.toolCallId).toBe('call_3');
      expect(result.toolName).toBe('getSalesStats');
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
    });

    it('幻觉防护：结果应该包含 _dataSource 和 _queryTime', async () => {
      const result = await executeTool(
        'call_4',
        'getSalesStats',
        JSON.stringify({ startDate: '2026-03-01', endDate: '2026-03-31' }),
        'tenant-1',
      );

      const data = result.result as Record<string, unknown>;
      expect(data['_dataSource']).toBeTruthy();
      expect(data['_queryTime']).toBeTruthy();
    });

    it('getOrders 应该拒绝 pageSize 超过 50', async () => {
      const result = await executeTool('call_5', 'getOrders', JSON.stringify({ pageSize: 200 }), 'tenant-1');

      expect(result.error).toContain('参数校验失败');
      expect(result.result).toBeNull();
    });
  });
});
