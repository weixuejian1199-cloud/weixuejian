import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const { mockVerifyAccessToken, mockIsTokenBlacklisted } = vi.hoisted(() => ({
  mockVerifyAccessToken: vi.fn(),
  mockIsTokenBlacklisted: vi.fn(),
}));

vi.mock('jsonwebtoken', () => {
  const TokenExpiredError = class TokenExpiredError extends Error {
    expiredAt: Date;
    constructor(message: string, expiredAt: Date) {
      super(message);
      this.name = 'TokenExpiredError';
      this.expiredAt = expiredAt;
    }
  };
  return {
    default: { TokenExpiredError },
    TokenExpiredError,
  };
});

vi.mock('../../services/auth/jwt-service.js', () => ({
  verifyAccessToken: mockVerifyAccessToken,
  isTokenBlacklisted: mockIsTokenBlacklisted,
}));

vi.mock('../../utils/logger.js', () => ({
  childLogger: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  }),
}));

import { requireAuth, optionalAuth } from '../../middleware/auth.js';
import jwt from 'jsonwebtoken';

function createMockContext(authHeader?: string, requestId = 'test-req-id') {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const req = {
    requestId,
    headers: authHeader ? { authorization: authHeader } : {},
  } as unknown as Request;
  const res = {
    status,
    req,
  } as unknown as Response;
  const next = vi.fn();
  return { req, res, next, status, json };
}

const validPayload = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  role: 'admin',
  jti: 'jti-123',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

describe('requireAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('有效token应该注入req.user并调用next', async () => {
    mockVerifyAccessToken.mockReturnValue(validPayload);
    mockIsTokenBlacklisted.mockResolvedValue(false);

    const { req, res, next } = createMockContext('Bearer valid-token');
    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toEqual({
      userId: 'user-1',
      tenantId: 'tenant-1',
      role: 'admin',
    });
  });

  it('无Authorization header应该返回401', async () => {
    const { req, res, next, status, json } = createMockContext();
    await requireAuth(req, res, next);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'AUTH_INVALID_TOKEN' }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('非Bearer格式应该返回401', async () => {
    const { req, res, next, status } = createMockContext('Basic abc123');
    await requireAuth(req, res, next);

    expect(status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('无效token应该返回401', async () => {
    mockVerifyAccessToken.mockImplementation(() => {
      throw new Error('invalid signature');
    });

    const { req, res, next, status, json } = createMockContext('Bearer invalid-token');
    await requireAuth(req, res, next);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'AUTH_INVALID_TOKEN' }),
      }),
    );
  });

  it('过期token应该返回401并使用特定错误码', async () => {
    mockVerifyAccessToken.mockImplementation(() => {
      throw new jwt.TokenExpiredError('jwt expired', new Date());
    });

    const { req, res, next, status, json } = createMockContext('Bearer expired-token');
    await requireAuth(req, res, next);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'AUTH_TOKEN_EXPIRED' }),
      }),
    );
  });

  it('黑名单token应该返回401', async () => {
    mockVerifyAccessToken.mockReturnValue(validPayload);
    mockIsTokenBlacklisted.mockResolvedValue(true);

    const { req, res, next, status, json } = createMockContext('Bearer blacklisted-token');
    await requireAuth(req, res, next);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'AUTH_TOKEN_BLACKLISTED' }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('Redis不可用时应该返回503（fail-secure）', async () => {
    mockVerifyAccessToken.mockReturnValue(validPayload);
    mockIsTokenBlacklisted.mockRejectedValue(new Error('Redis down'));

    const { req, res, next, status, json } = createMockContext('Bearer valid-token');
    await requireAuth(req, res, next);

    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'SERVICE_UNAVAILABLE' }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });
});

describe('optionalAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('无token时应该直接放行', async () => {
    const { req, res, next } = createMockContext();
    await optionalAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toBeUndefined();
  });

  it('有有效token时应该注入req.user', async () => {
    mockVerifyAccessToken.mockReturnValue(validPayload);
    mockIsTokenBlacklisted.mockResolvedValue(false);

    const { req, res, next } = createMockContext('Bearer valid-token');
    await optionalAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toEqual({
      userId: 'user-1',
      tenantId: 'tenant-1',
      role: 'admin',
    });
  });

  it('有无效token时应该返回401', async () => {
    mockVerifyAccessToken.mockImplementation(() => {
      throw new Error('invalid');
    });

    const { req, res, next, status } = createMockContext('Bearer bad-token');
    await optionalAuth(req, res, next);

    expect(status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
