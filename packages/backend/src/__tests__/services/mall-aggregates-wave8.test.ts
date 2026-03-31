import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRedis = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
}));

vi.mock('../../lib/redis.js', () => ({
  redis: mockRedis,
}));

vi.mock('../../utils/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => ({
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    })),
  },
}));

vi.mock('../../lib/env.js', () => ({
  env: {
    ZTDY_API_BASE_URL: 'https://admin.ztdy.cc',
    ZTDY_API_KEY: 'test-key',
  },
}));

import {
  getSlowSuppliers,
  getUserGrowthTrend,
} from '../../services/mall/aggregates.js';
import { MallAdapter } from '../../adapters/erp/mall-adapter.js';
import type { PaginatedResult, MallOrder, MallUser } from '../../adapters/erp/types.js';

// ─── Test helpers ────────────────────────────────────────

function makeOrder(overrides: Partial<MallOrder> = {}): MallOrder {
  return {
    orderItemId: Math.floor(Math.random() * 100000),
    orderItemNo: `ORD-${Math.random().toString(36).slice(2, 8)}`,
    userId: 1001,
    supplierId: 201,
    supplierName: '供应商A',
    status: 2,
    processNode: 3,
    payDate: '2026-03-15',
    totalAmount: 100,
    itemName: '商品',
    quantity: 1,
    createDate: '2026-03-15',
    ...overrides,
  };
}

function makeUser(overrides: Partial<MallUser> = {}): MallUser {
  return {
    userId: Math.floor(Math.random() * 100000),
    loginId: null,
    userName: '测试用户',
    avatar: null,
    levelId: 1,
    createDate: '2026-03-15',
    phone: '13800138000',
    ...overrides,
  };
}

function makePageResult<T>(items: T[], totalCount?: number): PaginatedResult<T> {
  return {
    items,
    pagination: {
      pageIndex: 1,
      pageSize: 1000,
      totalCount: totalCount ?? items.length,
      totalPages: Math.ceil((totalCount ?? items.length) / 1000),
    },
    source: 'api',
  };
}

describe('Wave 8 Aggregate queries', () => {
  let adapter: MallAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis.get.mockResolvedValue(null); // no cache
    mockRedis.set.mockResolvedValue('OK');
    adapter = new MallAdapter('test-tenant');
  });

  // ─── getSlowSuppliers ──────────────────────────────────

  describe('getSlowSuppliers', () => {
    it('应该返回有待发货订单(processNode=2)的供应商，按oldestOrderDate排序', async () => {
      const orders = [
        makeOrder({ supplierId: 1, supplierName: '供应商A', processNode: 2, createDate: '2026-03-10' }),
        makeOrder({ supplierId: 2, supplierName: '供应商B', processNode: 2, createDate: '2026-03-05' }),
        makeOrder({ supplierId: 1, supplierName: '供应商A', processNode: 2, createDate: '2026-03-08' }),
        makeOrder({ supplierId: 3, supplierName: '供应商C', processNode: 3, createDate: '2026-03-01' }), // 已发货，不算
      ];
      vi.spyOn(adapter, 'getOrders').mockResolvedValue(makePageResult(orders));

      const result = await getSlowSuppliers(adapter, 'tenant-1');

      // 只包含 processNode=2 的供应商
      expect(result.data.length).toBeGreaterThanOrEqual(2);
      // 供应商B最早(03-05)应该排第一
      expect(result.data[0]?.supplierId).toBe(2);
      expect(result.data[0]?.supplierName).toBe('供应商B');
      expect(result.data[0]?.pendingCount).toBe(1);
      // 供应商A有2个待发货
      expect(result.data[1]?.supplierId).toBe(1);
      expect(result.data[1]?.pendingCount).toBe(2);
    });

    it('应该通过limit参数限制返回数量', async () => {
      const orders = [
        makeOrder({ supplierId: 1, supplierName: 'A', processNode: 2, createDate: '2026-03-10' }),
        makeOrder({ supplierId: 2, supplierName: 'B', processNode: 2, createDate: '2026-03-05' }),
        makeOrder({ supplierId: 3, supplierName: 'C', processNode: 2, createDate: '2026-03-01' }),
      ];
      vi.spyOn(adapter, 'getOrders').mockResolvedValue(makePageResult(orders));

      const result = await getSlowSuppliers(adapter, 'tenant-1', 2);

      expect(result.data).toHaveLength(2);
    });

    it('无待发货订单时应返回空数组', async () => {
      const orders = [
        makeOrder({ processNode: 3 }), // 已发货
        makeOrder({ processNode: 4 }), // 已收货
        makeOrder({ processNode: 5 }), // 已完成
      ];
      vi.spyOn(adapter, 'getOrders').mockResolvedValue(makePageResult(orders));

      const result = await getSlowSuppliers(adapter, 'tenant-1');

      expect(result.data).toEqual([]);
      expect(result.completeness).toBeDefined();
    });

    it('多个供应商应按最早待发货日期排序（最早的排第一）', async () => {
      const orders = [
        makeOrder({ supplierId: 10, supplierName: 'X', processNode: 2, createDate: '2026-03-20' }),
        makeOrder({ supplierId: 20, supplierName: 'Y', processNode: 2, createDate: '2026-03-01' }),
        makeOrder({ supplierId: 30, supplierName: 'Z', processNode: 2, createDate: '2026-03-10' }),
      ];
      vi.spyOn(adapter, 'getOrders').mockResolvedValue(makePageResult(orders));

      const result = await getSlowSuppliers(adapter, 'tenant-1');

      expect(result.data[0]?.supplierId).toBe(20); // 03-01 最早
      expect(result.data[1]?.supplierId).toBe(30); // 03-10
      expect(result.data[2]?.supplierId).toBe(10); // 03-20 最晚
    });

    it('缓存命中时应直接返回，不调用adapter', async () => {
      const cachedResult = {
        data: {
          data: [
            { supplierId: 1, supplierName: '缓存供应商', pendingCount: 3, oldestOrderDate: '2026-03-01' },
          ],
          computedAt: '2026-03-30T10:00:00Z',
          completeness: 1,
          totalRecords: 100,
          scannedRecords: 100,
        },
        cachedAt: '2026-03-30T10:00:00Z',
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(cachedResult));
      const spy = vi.spyOn(adapter, 'getOrders');

      const result = await getSlowSuppliers(adapter, 'tenant-1');

      expect(result.data[0]?.supplierName).toBe('缓存供应商');
      expect(spy).not.toHaveBeenCalled();
    });

    it('应返回包含completeness的AggregateResult结构', async () => {
      vi.spyOn(adapter, 'getOrders').mockResolvedValue(makePageResult([]));

      const result = await getSlowSuppliers(adapter, 'tenant-1');

      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('computedAt');
      expect(result).toHaveProperty('completeness');
      expect(result).toHaveProperty('totalRecords');
      expect(result).toHaveProperty('scannedRecords');
    });
  });

  // ─── getUserGrowthTrend ────────────────────────────────

  describe('getUserGrowthTrend', () => {
    it('应该按天分组统计新用户数量', async () => {
      const users = [
        makeUser({ createDate: '2026-03-15 10:00:00' }),
        makeUser({ createDate: '2026-03-15 14:00:00' }),
        makeUser({ createDate: '2026-03-16 09:00:00' }),
        makeUser({ createDate: '2026-03-17 11:00:00' }),
        makeUser({ createDate: '2026-03-17 15:00:00' }),
        makeUser({ createDate: '2026-03-17 18:00:00' }),
      ];
      vi.spyOn(adapter, 'getUsers').mockResolvedValue(makePageResult(users));

      const result = await getUserGrowthTrend(adapter, 'tenant-1', {
        start: '2026-03-15',
        end: '2026-03-17',
      });

      expect(result.data.totalNew).toBe(6);
      expect(result.data.dailyBreakdown).toHaveLength(3);
      // 03-15: 2人, 03-16: 1人, 03-17: 3人
      const day15 = result.data.dailyBreakdown.find((d) => d.date === '2026-03-15');
      expect(day15?.count).toBe(2);
      const day17 = result.data.dailyBreakdown.find((d) => d.date === '2026-03-17');
      expect(day17?.count).toBe(3);
    });

    it('日期范围过滤应该有效', async () => {
      // ztdy API 返回时间倒序（最新在前）
      const users = [
        makeUser({ createDate: '2026-03-25 10:00:00' }), // 范围外(>endDate)，跳过
        makeUser({ createDate: '2026-03-20 10:00:00' }), // 范围内
        makeUser({ createDate: '2026-03-15 10:00:00' }), // 范围内
        makeUser({ createDate: '2026-03-10 10:00:00' }), // 范围外(<startDate)，触发early-stop
      ];
      vi.spyOn(adapter, 'getUsers').mockResolvedValue(makePageResult(users));

      const result = await getUserGrowthTrend(adapter, 'tenant-1', {
        start: '2026-03-14',
        end: '2026-03-21',
      });

      // 只统计范围内的用户
      expect(result.data.totalNew).toBe(2);
    });

    it('无符合条件用户时应返回totalNew=0', async () => {
      vi.spyOn(adapter, 'getUsers').mockResolvedValue(makePageResult([]));

      const result = await getUserGrowthTrend(adapter, 'tenant-1', {
        start: '2099-01-01',
        end: '2099-12-31',
      });

      expect(result.data.totalNew).toBe(0);
      expect(result.data.dailyBreakdown).toEqual([]);
    });

    it('dailyBreakdown应按日期升序排列', async () => {
      const users = [
        makeUser({ createDate: '2026-03-20 10:00:00' }),
        makeUser({ createDate: '2026-03-15 10:00:00' }),
        makeUser({ createDate: '2026-03-18 10:00:00' }),
      ];
      vi.spyOn(adapter, 'getUsers').mockResolvedValue(makePageResult(users));

      const result = await getUserGrowthTrend(adapter, 'tenant-1', {
        start: '2026-03-14',
        end: '2026-03-21',
      });

      const dates = result.data.dailyBreakdown.map((d) => d.date);
      expect(dates).toEqual([...dates].sort());
    });

    it('缓存命中时应直接返回，不调用adapter', async () => {
      const cachedResult = {
        data: {
          data: { totalNew: 42, dailyBreakdown: [{ date: '2026-03-15', count: 42 }] },
          computedAt: '2026-03-30T10:00:00Z',
          completeness: 1,
          totalRecords: 42,
          scannedRecords: 42,
        },
        cachedAt: '2026-03-30T10:00:00Z',
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(cachedResult));
      const spy = vi.spyOn(adapter, 'getUsers');

      const result = await getUserGrowthTrend(adapter, 'tenant-1', {
        start: '2026-03-15',
        end: '2026-03-15',
      });

      expect(result.data.totalNew).toBe(42);
      expect(spy).not.toHaveBeenCalled();
    });

    it('应返回包含completeness的AggregateResult结构', async () => {
      vi.spyOn(adapter, 'getUsers').mockResolvedValue(makePageResult([]));

      const result = await getUserGrowthTrend(adapter, 'tenant-1', {
        start: '2026-03-01',
        end: '2026-03-31',
      });

      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('computedAt');
      expect(result).toHaveProperty('completeness');
      expect(result).toHaveProperty('totalRecords');
      expect(result).toHaveProperty('scannedRecords');
    });
  });
});
