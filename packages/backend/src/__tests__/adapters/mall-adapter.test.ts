import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ───────────────────────────────────────────────

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
    ZTDY_API_KEY: 'test-api-key',
  },
}));

import { MallAdapter } from '../../adapters/erp/mall-adapter.js';
import { MallApiError } from '../../adapters/erp/errors.js';

// ─── Test fixtures ───────────────────────────────────────

function makeZtdyResponse(pageData: unknown[], totalCount?: number) {
  return {
    Data: {
      PageIndex: 1,
      PageSize: 20,
      TotalCount: totalCount ?? pageData.length,
      PageData: pageData,
    },
    Status: 1,
    Message: null,
    Code: 0,
  };
}

const sampleUser = {
  UserID: 1001,
  LoginID: 'user001',
  UserName: '张三',
  Avatar: 'https://example.com/avatar.jpg',
  LevelID: 2,
  CreateDate: '2026-01-15',
  Phone: '13800138000',
};

const sampleOrder = {
  OrderItemID: 5001,
  OrderItemNo: 'ORD-2026-001',
  UserID: 1001,
  SupplierID: 201,
  SupplierName: '供应商A',
  Status: 2,
  ProcessNode: 3,
  PayDate: '2026-03-01',
  TotalAmount: 299.9,
  ItemName: '生酮巧克力',
  Quantity: 2,
  CreateDate: '2026-03-01',
};

const sampleItem = {
  ItemID: 3001,
  ItemName: '有机燕麦',
  Keywords: '健康,早餐',
  IsShelf: true,
  CreateDate: '2026-01-01',
  SortID: 5,
  Price: 39.9,
};

const sampleSupplier = {
  SupplierID: 201,
  SupplierName: '健康食品公司',
  ContactPerson: '李经理',
  ContactPhone: '021-12345678',
  SettleRuleID: 1,
  CreateDate: '2025-06-01',
};

const sampleSupplierWithdraw = {
  SupplierID: 201,
  PayNo: 'PAY-2026-001',
  BankAccountNo: '6222****1234',
  TranAmount: 5000,
  Status: 1,
  FinishDate: '2026-03-15',
  CreateDate: '2026-03-10',
};

const sampleUserWithdraw = {
  UserID: 1001,
  PayNo: 'UW-2026-001',
  Award: 100.5,
  Status: 1,
  TranType: 1,
  CreateDate: '2026-03-20',
};

// ─── Tests ───────────────────────────────────────────────

describe('MallAdapter', () => {
  let adapter: MallAdapter;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis.get.mockResolvedValue(null); // default: cache miss
    mockRedis.set.mockResolvedValue('OK');

    adapter = new MallAdapter('test-tenant');

    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  function mockFetchSuccess(data: unknown) {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(data),
    });
  }

  // ─── AC-03: getUsers ──────────────────────────────────

  describe('getUsers', () => {
    it('should return transformed users from API', async () => {
      mockFetchSuccess(makeZtdyResponse([sampleUser]));

      const result = await adapter.getUsers({ pageIndex: 1, pageSize: 20 });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual({
        userId: 1001,
        loginId: 'user001',
        userName: '张三',
        avatar: 'https://example.com/avatar.jpg',
        levelId: 2,
        createDate: '2026-01-15',
        phone: '13800138000',
      });
      expect(result.source).toBe('api');
      expect(result.pagination.totalCount).toBe(1);
    });

    it('should pass correct URL params', async () => {
      mockFetchSuccess(makeZtdyResponse([]));

      await adapter.getUsers({ pageIndex: 2, pageSize: 50, keyword: '张' });

      const calledUrl = fetchSpy.mock.calls[0]?.[0] as string;
      expect(calledUrl).toContain('PageIndex=2');
      expect(calledUrl).toContain('PageSize=50');
      expect(calledUrl).toContain('Keyword=');
    });
  });

  // ─── AC-04: getOrders ─────────────────────────────────

  describe('getOrders', () => {
    it('should return transformed orders', async () => {
      mockFetchSuccess(makeZtdyResponse([sampleOrder]));

      const result = await adapter.getOrders({ pageIndex: 1 });

      expect(result.items[0]).toEqual({
        orderItemId: 5001,
        orderItemNo: 'ORD-2026-001',
        userId: 1001,
        supplierId: 201,
        supplierName: '供应商A',
        status: 2,
        processNode: 3,
        payDate: '2026-03-01',
        totalAmount: 299.9,
        itemName: '生酮巧克力',
        quantity: 2,
        createDate: '2026-03-01',
      });
    });

    it('should support date range filters', async () => {
      mockFetchSuccess(makeZtdyResponse([]));

      await adapter.getOrders({ startDate: '2026-03-01', endDate: '2026-03-31' });

      const calledUrl = fetchSpy.mock.calls[0]?.[0] as string;
      expect(calledUrl).toContain('StartDate=2026-03-01');
      expect(calledUrl).toContain('EndDate=2026-03-31');
    });
  });

  // ─── AC-05: getItems ──────────────────────────────────

  describe('getItems', () => {
    it('should return transformed items with boolean isShelf', async () => {
      mockFetchSuccess(makeZtdyResponse([sampleItem]));

      const result = await adapter.getItems();

      expect(result.items[0]?.isShelf).toBe(true);
      expect(result.items[0]?.itemName).toBe('有机燕麦');
    });

    it('should handle numeric IsShelf (1/0)', async () => {
      mockFetchSuccess(makeZtdyResponse([{ ...sampleItem, IsShelf: 1 }]));

      const result = await adapter.getItems();

      expect(result.items[0]?.isShelf).toBe(true);
    });
  });

  // ─── AC-06: getSuppliers ──────────────────────────────

  describe('getSuppliers', () => {
    it('should return transformed suppliers', async () => {
      mockFetchSuccess(makeZtdyResponse([sampleSupplier]));

      const result = await adapter.getSuppliers();

      expect(result.items[0]?.supplierName).toBe('健康食品公司');
      expect(result.items[0]?.supplierId).toBe(201);
    });
  });

  // ─── AC-07: getSupplierWithdraws ──────────────────────

  describe('getSupplierWithdraws', () => {
    it('should return transformed supplier withdrawals', async () => {
      mockFetchSuccess(makeZtdyResponse([sampleSupplierWithdraw]));

      const result = await adapter.getSupplierWithdraws();

      expect(result.items[0]?.tranAmount).toBe(5000);
      expect(result.items[0]?.payNo).toBe('PAY-2026-001');
    });
  });

  // ─── AC-08: getUserWithdraws ──────────────────────────

  describe('getUserWithdraws', () => {
    it('should return transformed user withdrawals', async () => {
      mockFetchSuccess(makeZtdyResponse([sampleUserWithdraw]));

      const result = await adapter.getUserWithdraws();

      expect(result.items[0]?.award).toBe(100.5);
      expect(result.items[0]?.userId).toBe(1001);
    });
  });

  // ─── AC-02: Zod validation ────────────────────────────

  describe('Zod validation', () => {
    it('should reject responses with invalid envelope', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ invalid: 'data' }),
      });

      await expect(adapter.getUsers()).rejects.toThrow(MallApiError);
      await expect(adapter.getUsers()).rejects.toMatchObject({
        code: 'MALL_DATA_INVALID',
      });
    });

    it('should skip individual records that fail validation', async () => {
      const validUser = sampleUser;
      const invalidUser = { NotAUser: true };
      mockFetchSuccess(makeZtdyResponse([validUser, invalidUser], 2));

      const result = await adapter.getUsers();

      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.userId).toBe(1001);
    });

    it('should throw MALL_DATA_INVALID when all records fail validation', async () => {
      mockFetchSuccess(makeZtdyResponse([{ bad: 1 }, { bad: 2 }], 2));

      await expect(adapter.getUsers()).rejects.toMatchObject({
        code: 'MALL_DATA_INVALID',
      });
    });
  });

  // ─── AC-09: Error handling ────────────────────────────

  describe('error handling', () => {
    it('should throw MALL_API_UNAUTHORIZED on 401', async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({}),
      });

      await expect(adapter.getUsers()).rejects.toMatchObject({
        code: 'MALL_API_UNAUTHORIZED',
      });
    });

    it('should throw MALL_API_TIMEOUT on timeout', async () => {
      const timeoutErr = new DOMException('The operation was aborted', 'TimeoutError');
      fetchSpy.mockRejectedValue(timeoutErr);

      await expect(adapter.getUsers()).rejects.toMatchObject({
        code: 'MALL_API_TIMEOUT',
      });
    });

    it('should throw MALL_API_ERROR on network failure after retries', async () => {
      fetchSpy.mockRejectedValue(new Error('Network failed'));

      await expect(adapter.getUsers()).rejects.toMatchObject({
        code: 'MALL_API_ERROR',
      });
      // Should have retried once (2 total calls)
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('should throw MALL_API_ERROR when Status !== 1', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            Data: { PageIndex: 1, PageSize: 20, TotalCount: 0, PageData: [] },
            Status: 0,
            Message: 'API key expired',
            Code: 403,
          }),
      });

      await expect(adapter.getUsers()).rejects.toMatchObject({
        code: 'MALL_API_ERROR',
      });
    });

    it('should not retry on MALL_API_UNAUTHORIZED', async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({}),
      });

      await expect(adapter.getUsers()).rejects.toThrow();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('should not retry on MALL_DATA_INVALID', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ invalid: true }),
      });

      await expect(adapter.getUsers()).rejects.toThrow();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ─── AC-10: Cache behavior ────────────────────────────

  describe('caching', () => {
    it('should return cached data on cache hit', async () => {
      const cachedResult = {
        data: {
          items: [
            {
              userId: 1001,
              loginId: 'u1',
              userName: 'cached',
              avatar: null,
              levelId: 1,
              createDate: null,
              phone: null,
            },
          ],
          pagination: { pageIndex: 1, pageSize: 20, totalCount: 1, totalPages: 1 },
          source: 'api' as const,
        },
        cachedAt: '2026-03-30T10:00:00Z',
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(cachedResult));

      const result = await adapter.getUsers();

      expect(result.source).toBe('cache');
      expect(result.cachedAt).toBe('2026-03-30T10:00:00Z');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('should cache API response on successful call', async () => {
      mockFetchSuccess(makeZtdyResponse([sampleUser]));

      await adapter.getUsers();

      expect(mockRedis.set).toHaveBeenCalled();
    });

    it('should serve stale cache when API fails', async () => {
      // First call succeeds and caches
      mockRedis.get
        .mockResolvedValueOnce(null) // miss on first _callApi cache check
        .mockResolvedValueOnce(
          // hit on stale cache fallback
          JSON.stringify({
            data: {
              items: [
                {
                  userId: 1001,
                  loginId: null,
                  userName: 'stale',
                  avatar: null,
                  levelId: null,
                  createDate: null,
                  phone: null,
                },
              ],
              pagination: { pageIndex: 1, pageSize: 20, totalCount: 1, totalPages: 1 },
              source: 'api' as const,
            },
            cachedAt: '2026-03-30T08:00:00Z',
          }),
        );

      fetchSpy.mockRejectedValue(new Error('API down'));

      const result = await adapter.getUsers();
      expect(result.source).toBe('cache');
      expect(result.items[0]?.userName).toBe('stale');
    });
  });

  // ─── Health check ─────────────────────────────────────

  describe('healthCheck', () => {
    it('should return ok=true when API is healthy', async () => {
      mockFetchSuccess(makeZtdyResponse([sampleUser]));

      const result = await adapter.healthCheck();

      expect(result.ok).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should return ok=false when API fails', async () => {
      fetchSpy.mockRejectedValue(new Error('Connection refused'));
      // also fail stale cache
      mockRedis.get.mockResolvedValue(null);

      const result = await adapter.healthCheck();

      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // ─── Pagination ───────────────────────────────────────

  describe('pagination', () => {
    it('should calculate totalPages correctly', async () => {
      mockFetchSuccess({
        Data: { PageIndex: 1, PageSize: 20, TotalCount: 95, PageData: [sampleUser] },
        Status: 1,
        Message: null,
        Code: 0,
      });

      const result = await adapter.getUsers();

      expect(result.pagination.totalPages).toBe(5); // ceil(95/20)
      expect(result.pagination.totalCount).toBe(95);
    });

    it('should use default filters when none provided', async () => {
      mockFetchSuccess(makeZtdyResponse([]));

      await adapter.getUsers();

      const calledUrl = fetchSpy.mock.calls[0]?.[0] as string;
      expect(calledUrl).toContain('PageIndex=1');
      expect(calledUrl).toContain('PageSize=20');
    });
  });

  // ─── API key ──────────────────────────────────────────

  describe('API key', () => {
    it('should send api-key header', async () => {
      mockFetchSuccess(makeZtdyResponse([]));

      await adapter.getUsers();

      const calledOptions = fetchSpy.mock.calls[0]?.[1] as RequestInit;
      expect(calledOptions.headers).toEqual(expect.objectContaining({ 'api-key': 'test-api-key' }));
    });
  });
});
