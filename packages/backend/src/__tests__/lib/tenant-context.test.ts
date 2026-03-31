import { describe, it, expect, vi } from 'vitest';

vi.mock('../../lib/env.js', () => ({
  env: { NODE_ENV: 'test' },
}));

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    $extends: vi.fn().mockReturnValue({ _extended: true }),
  },
}));

import {
  tenantStorage,
  getTenantId,
  getUserId,
  getTenantPrisma,
} from '../../lib/tenant-context.js';

describe('TenantContext', () => {
  describe('getTenantId', () => {
    it('在 AsyncLocalStorage 上下文中应该返回 tenantId', () => {
      tenantStorage.run({ tenantId: 't-1', userId: 'u-1' }, () => {
        expect(getTenantId()).toBe('t-1');
      });
    });

    it('不在上下文中应该抛出错误（fail-secure）', () => {
      expect(() => getTenantId()).toThrow('Tenant context not initialized');
    });
  });

  describe('getUserId', () => {
    it('在上下文中应该返回 userId', () => {
      tenantStorage.run({ tenantId: 't-1', userId: 'u-1' }, () => {
        expect(getUserId()).toBe('u-1');
      });
    });

    it('不在上下文中应该抛出错误', () => {
      expect(() => getUserId()).toThrow('Tenant context not initialized');
    });
  });

  describe('getTenantPrisma', () => {
    it('在上下文中应该返回扩展的 Prisma 客户端', () => {
      tenantStorage.run({ tenantId: 't-1', userId: 'u-1' }, () => {
        const db = getTenantPrisma();
        expect(db).toBeDefined();
      });
    });

    it('不在上下文中应该抛出错误', () => {
      expect(() => getTenantPrisma()).toThrow('Tenant context not initialized');
    });
  });

  describe('上下文隔离', () => {
    it('嵌套的 run 应该隔离上下文', async () => {
      const results: string[] = [];

      await Promise.all([
        new Promise<void>((resolve) => {
          tenantStorage.run({ tenantId: 't-A', userId: 'u-A' }, () => {
            results.push(getTenantId());
            resolve();
          });
        }),
        new Promise<void>((resolve) => {
          tenantStorage.run({ tenantId: 't-B', userId: 'u-B' }, () => {
            results.push(getTenantId());
            resolve();
          });
        }),
      ]);

      expect(results).toContain('t-A');
      expect(results).toContain('t-B');
      expect(results.length).toBe(2);
    });
  });
});
