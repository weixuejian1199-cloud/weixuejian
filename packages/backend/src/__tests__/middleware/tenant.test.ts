import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../../utils/logger.js', () => ({
  childLogger: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  }),
}));

import { requireTenant } from '../../middleware/tenant.js';

function createMockContext(
  user?: { userId: string; tenantId: string; role: string } | null,
  requestId = 'test-req-id',
) {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const req = {
    requestId,
    user: user === null ? undefined : user,
  } as unknown as Request;
  const res = {
    status,
    req,
  } as unknown as Response;
  const next = vi.fn();
  return { req, res, next, status, json };
}

describe('requireTenant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('有tenantId时应该注入req.tenantId并调用next', () => {
    const { req, res, next } = createMockContext({
      userId: 'user-1',
      tenantId: 'tenant-1',
      role: 'admin',
    });

    requireTenant(req, res, next);

    expect(req.tenantId).toBe('tenant-1');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('tenantId为空字符串时应该返回403（fail-secure）', () => {
    const { req, res, next, status, json } = createMockContext({
      userId: 'user-1',
      tenantId: '',
      role: 'admin',
    });

    requireTenant(req, res, next);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'TENANT_NOT_FOUND' }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('用户信息缺失时应该返回401', () => {
    const { req, res, next, status, json } = createMockContext(null);

    requireTenant(req, res, next);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'AUTH_INVALID_TOKEN' }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('不同租户ID应该正确注入', () => {
    const { req, res, next } = createMockContext({
      userId: 'user-2',
      tenantId: 'tenant-shishi',
      role: 'employee',
    });

    requireTenant(req, res, next);

    expect(req.tenantId).toBe('tenant-shishi');
    expect(next).toHaveBeenCalledTimes(1);
  });
});
