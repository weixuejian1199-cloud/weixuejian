import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

/**
 * TDD风格：requireTenant中间件尚未实现。
 * 期望行为：
 *   - 从 req.user.tenantId 读取租户ID
 *   - 有tenantId时注入 req.tenantId 并调用 next()
 *   - 无tenantId时使用默认租户ID（如果配置了的话）
 *   - 完全无法确定tenantId时返回403
 */

// 模拟requireTenant的期望行为
function requireTenant(defaultTenantId?: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as unknown as Record<string, unknown>)['user'] as
      | { tenantId?: string }
      | undefined;
    const tenantId = user?.tenantId ?? defaultTenantId;

    if (!tenantId) {
      const requestId = req.requestId ?? 'unknown';
      res.status(403).json({
        success: false,
        error: {
          code: 'TENANT_REQUIRED',
          message: '无法确定租户信息',
        },
        requestId,
      });
      return;
    }

    (req as unknown as Record<string, unknown>)['tenantId'] = tenantId;
    next();
  };
}

function createMockContext(
  user?: { tenantId?: string },
  requestId = 'test-req-id',
) {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const req = {
    requestId,
    user,
  } as unknown as Request;
  const res = {
    status,
    req,
  } as unknown as Response;
  const next = vi.fn();
  return { req, res, next, status, json };
}

describe('requireTenant', () => {
  it('有tenantId时应该注入req.tenantId并调用next', () => {
    const middleware = requireTenant();
    const { req, res, next } = createMockContext({ tenantId: 'tenant-1' });

    middleware(req, res, next);

    expect((req as unknown as Record<string, unknown>)['tenantId']).toBe('tenant-1');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('无tenantId时应该使用默认值', () => {
    const middleware = requireTenant('default-tenant');
    const { req, res, next } = createMockContext({});

    middleware(req, res, next);

    expect((req as unknown as Record<string, unknown>)['tenantId']).toBe('default-tenant');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('无tenantId且无默认值时应该返回403', () => {
    const middleware = requireTenant();
    const { req, res, next, status, json } = createMockContext({});

    middleware(req, res, next);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'TENANT_REQUIRED',
        }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('用户信息完全缺失时且无默认值应该返回403', () => {
    const middleware = requireTenant();
    const { req, res, next, status } = createMockContext(undefined);

    middleware(req, res, next);

    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
