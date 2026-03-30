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

import { getSalesStats, getTopSuppliers, getOrderStatusDistribution } from '../../services/mall/aggregates.js';
import { MallAdapter } from '../../adapters/erp/mall-adapter.js';
import type { PaginatedResult, MallOrder } from '../../adapters/erp/types.js';

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

function makePageResult(orders: MallOrder[], totalCount?: number): PaginatedResult<MallOrder> {
  return {
    items: orders,
    pagination: {
      pageIndex: 1,
      pageSize: 1000,
      totalCount: totalCount ?? orders.length,
      totalPages: Math.ceil((totalCount ?? orders.length) / 1000),
    },
    source: 'api',
  };
}

describe('Aggregate queries', () => {
  let adapter: MallAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis.get.mockResolvedValue(null); // no cache
    mockRedis.set.mockResolvedValue('OK');
    adapter = new MallAdapter('test-tenant');
  });

  // ─── getSalesStats ────────────────────────────────────

  describe('getSalesStats', () => {
    it('should aggregate total amount and order count', async () => {
      const orders = [
        makeOrder({ totalAmount: 100 }),
        makeOrder({ totalAmount: 250.5 }),
        makeOrder({ totalAmount: 49.5 }),
      ];
      vi.spyOn(adapter, 'getOrders').mockResolvedValue(makePageResult(orders));

      const result = await getSalesStats(adapter, 'tenant-1', {
        start: '2026-03-01',
        end: '2026-03-31',
      });

      expect(result.data.totalAmount).toBe(400);
      expect(result.data.orderCount).toBe(3);
      expect(result.data.avgOrderAmount).toBeCloseTo(133.33, 1);
      expect(result.completeness).toBe(1);
    });

    it('should return completeness < 1 when data exceeds page limit', async () => {
      const orders = [makeOrder({ totalAmount: 100 })];
      vi.spyOn(adapter, 'getOrders').mockResolvedValue({
        ...makePageResult(orders, 200000),
        pagination: { pageIndex: 1, pageSize: 1000, totalCount: 200000, totalPages: 200 },
      });

      const result = await getSalesStats(adapter, 'tenant-1', {
        start: '2026-01-01',
        end: '2026-12-31',
      });

      expect(result.completeness).toBeLessThan(1);
      expect(result.totalRecords).toBe(200000);
    });

    it('should handle empty results', async () => {
      vi.spyOn(adapter, 'getOrders').mockResolvedValue(makePageResult([]));

      const result = await getSalesStats(adapter, 'tenant-1', {
        start: '2099-01-01',
        end: '2099-12-31',
      });

      expect(result.data.totalAmount).toBe(0);
      expect(result.data.orderCount).toBe(0);
      expect(result.data.avgOrderAmount).toBe(0);
      expect(result.completeness).toBe(1);
    });

    it('should use cached result when available', async () => {
      const cachedResult = {
        data: {
          data: { totalAmount: 999, orderCount: 10, avgOrderAmount: 99.9 },
          computedAt: '2026-03-30T10:00:00Z',
          completeness: 1,
          totalRecords: 10,
          scannedRecords: 10,
        },
        cachedAt: '2026-03-30T10:00:00Z',
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(cachedResult));
      const spy = vi.spyOn(adapter, 'getOrders');

      const result = await getSalesStats(adapter, 'tenant-1', {
        start: '2026-03-01',
        end: '2026-03-31',
      });

      expect(result.data.totalAmount).toBe(999);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  // ─── getTopSuppliers ──────────────────────────────────

  describe('getTopSuppliers', () => {
    it('should rank suppliers by order count', async () => {
      const orders = [
        makeOrder({ supplierId: 1, supplierName: 'A', totalAmount: 100 }),
        makeOrder({ supplierId: 1, supplierName: 'A', totalAmount: 200 }),
        makeOrder({ supplierId: 2, supplierName: 'B', totalAmount: 500 }),
        makeOrder({ supplierId: 1, supplierName: 'A', totalAmount: 150 }),
      ];
      vi.spyOn(adapter, 'getOrders').mockResolvedValue(makePageResult(orders));

      const result = await getTopSuppliers(adapter, 'tenant-1', 'orderCount', 10);

      expect(result.data[0]?.supplierId).toBe(1);
      expect(result.data[0]?.value).toBe(3); // 3 orders
      expect(result.data[1]?.supplierId).toBe(2);
      expect(result.data[1]?.value).toBe(1); // 1 order
    });

    it('should rank suppliers by amount', async () => {
      const orders = [
        makeOrder({ supplierId: 1, supplierName: 'A', totalAmount: 100 }),
        makeOrder({ supplierId: 2, supplierName: 'B', totalAmount: 500 }),
      ];
      vi.spyOn(adapter, 'getOrders').mockResolvedValue(makePageResult(orders));

      const result = await getTopSuppliers(adapter, 'tenant-1', 'amount', 10);

      expect(result.data[0]?.supplierId).toBe(2);
      expect(result.data[0]?.value).toBe(500);
    });

    it('should respect limit parameter', async () => {
      const orders = [
        makeOrder({ supplierId: 1, supplierName: 'A' }),
        makeOrder({ supplierId: 2, supplierName: 'B' }),
        makeOrder({ supplierId: 3, supplierName: 'C' }),
      ];
      vi.spyOn(adapter, 'getOrders').mockResolvedValue(makePageResult(orders));

      const result = await getTopSuppliers(adapter, 'tenant-1', 'orderCount', 2);

      expect(result.data).toHaveLength(2);
    });
  });

  // ─── getOrderStatusDistribution ───────────────────────

  describe('getOrderStatusDistribution', () => {
    it('should count orders by processNode', async () => {
      const orders = [
        makeOrder({ processNode: 0 }),
        makeOrder({ processNode: 2 }),
        makeOrder({ processNode: 2 }),
        makeOrder({ processNode: 3 }),
        makeOrder({ processNode: 4 }),
        makeOrder({ processNode: 4 }),
        makeOrder({ processNode: 4 }),
      ];
      vi.spyOn(adapter, 'getOrders').mockResolvedValue(makePageResult(orders));

      const result = await getOrderStatusDistribution(adapter, 'tenant-1');

      expect(result.data['0']).toBe(1);
      expect(result.data['2']).toBe(2);
      expect(result.data['3']).toBe(1);
      expect(result.data['4']).toBe(3);
      expect(result.completeness).toBe(1);
    });

    it('should support optional date range filter', async () => {
      const spy = vi.spyOn(adapter, 'getOrders').mockResolvedValue(makePageResult([]));

      await getOrderStatusDistribution(adapter, 'tenant-1', {
        start: '2026-03-01',
        end: '2026-03-31',
      });

      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          startDate: '2026-03-01',
          endDate: '2026-03-31',
        }),
      );
    });
  });
});
