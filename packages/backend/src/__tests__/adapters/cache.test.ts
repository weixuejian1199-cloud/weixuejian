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
  },
}));

import { buildCacheKey, getCache, setCache, CACHE_TTL } from '../../adapters/erp/cache.js';

describe('cache utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('buildCacheKey', () => {
    it('should produce deterministic keys for same params', () => {
      const key1 = buildCacheKey('t1', 'getUsers', { pageIndex: 1, pageSize: 20 });
      const key2 = buildCacheKey('t1', 'getUsers', { pageIndex: 1, pageSize: 20 });
      expect(key1).toBe(key2);
    });

    it('should produce same key regardless of param order', () => {
      const key1 = buildCacheKey('t1', 'getOrders', { pageIndex: 1, status: 2 });
      const key2 = buildCacheKey('t1', 'getOrders', { status: 2, pageIndex: 1 });
      expect(key1).toBe(key2);
    });

    it('should produce different keys for different params', () => {
      const key1 = buildCacheKey('t1', 'getUsers', { pageIndex: 1 });
      const key2 = buildCacheKey('t1', 'getUsers', { pageIndex: 2 });
      expect(key1).not.toBe(key2);
    });

    it('should produce different keys for different tenants', () => {
      const key1 = buildCacheKey('tenant-a', 'getUsers', { pageIndex: 1 });
      const key2 = buildCacheKey('tenant-b', 'getUsers', { pageIndex: 1 });
      expect(key1).not.toBe(key2);
    });

    it('should produce different keys for different methods', () => {
      const key1 = buildCacheKey('t1', 'getUsers', { pageIndex: 1 });
      const key2 = buildCacheKey('t1', 'getOrders', { pageIndex: 1 });
      expect(key1).not.toBe(key2);
    });

    it('should follow v1:mall:{tenantId}:{method}:{hash} format', () => {
      const key = buildCacheKey('my-tenant', 'getItems', { pageIndex: 1 });
      expect(key).toMatch(/^v1:mall:my-tenant:getItems:[a-f0-9]{16}$/);
    });

    it('should ignore undefined and null params', () => {
      const key1 = buildCacheKey('t1', 'getUsers', { pageIndex: 1, keyword: undefined });
      const key2 = buildCacheKey('t1', 'getUsers', { pageIndex: 1 });
      expect(key1).toBe(key2);
    });
  });

  describe('getCache', () => {
    it('should return parsed data on cache hit', async () => {
      const cached = { data: { items: [1, 2, 3] }, cachedAt: '2026-03-30T10:00:00Z' };
      mockRedis.get.mockResolvedValue(JSON.stringify(cached));

      const result = await getCache<{ items: number[] }>('test-key');
      expect(result).toEqual(cached);
      expect(mockRedis.get).toHaveBeenCalledWith('test-key');
    });

    it('should return null on cache miss', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await getCache('test-key');
      expect(result).toBeNull();
    });

    it('should return null on Redis error (fail-secure)', async () => {
      mockRedis.get.mockRejectedValue(new Error('Redis connection lost'));

      const result = await getCache('test-key');
      expect(result).toBeNull();
    });
  });

  describe('setCache', () => {
    it('should write with correct TTL for orders (5 min)', async () => {
      mockRedis.set.mockResolvedValue('OK');

      await setCache('test-key', { items: [] }, 'orders');
      expect(mockRedis.set).toHaveBeenCalledWith('test-key', expect.any(String), 'EX', 300);
    });

    it('should write with correct TTL for users (60 min)', async () => {
      mockRedis.set.mockResolvedValue('OK');

      await setCache('test-key', { items: [] }, 'users');
      expect(mockRedis.set).toHaveBeenCalledWith('test-key', expect.any(String), 'EX', 3600);
    });

    it('should write with correct TTL for items (30 min)', async () => {
      mockRedis.set.mockResolvedValue('OK');

      await setCache('test-key', { items: [] }, 'items');
      expect(mockRedis.set).toHaveBeenCalledWith('test-key', expect.any(String), 'EX', 1800);
    });

    it('should not throw on Redis error (fail-secure)', async () => {
      mockRedis.set.mockRejectedValue(new Error('Redis write failed'));

      await expect(setCache('test-key', { items: [] }, 'orders')).resolves.toBeUndefined();
    });

    it('should include cachedAt timestamp in stored data', async () => {
      mockRedis.set.mockResolvedValue('OK');

      await setCache('test-key', { count: 42 }, 'items');
      const storedJson = mockRedis.set.mock.calls[0]?.[1] as string;
      const stored = JSON.parse(storedJson);
      expect(stored.data).toEqual({ count: 42 });
      expect(stored.cachedAt).toBeDefined();
      expect(new Date(stored.cachedAt).getTime()).toBeGreaterThan(0);
    });
  });

  describe('CACHE_TTL', () => {
    it('should have differentiated TTLs per data type', () => {
      expect(CACHE_TTL.orders).toBe(300);
      expect(CACHE_TTL.items).toBe(1800);
      expect(CACHE_TTL.users).toBe(3600);
      expect(CACHE_TTL.suppliers).toBe(1800);
      expect(CACHE_TTL.supplierWithdraws).toBe(1800);
      expect(CACHE_TTL.userWithdraws).toBe(300);
    });
  });
});
