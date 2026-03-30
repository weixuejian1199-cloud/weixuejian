import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// Use vi.hoisted to create mocks that can be referenced in vi.mock factories
const { mockRedisExists, mockVerify } = vi.hoisted(() => ({
  mockRedisExists: vi.fn(),
  mockVerify: vi.fn(),
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
    default: {
      verify: mockVerify,
      TokenExpiredError,
    },
    TokenExpiredError,
  };
});

vi.mock('../../lib/redis.js', () => ({
  redis: {
    exists: mockRedisExists,
  },
}));

vi.mock('../../lib/env.js', () => ({
  env: {
    JWT_SECRET: 'test-secret-that-is-at-least-32-chars-long',
  },
}));

vi.mock('../../utils/logger.js', () => ({
  childLogger: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  }),
}));

// Import after mocks
import { requireAuth } from '../../middleware/auth.js';
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
    mockVerify.mockReturnValue(validPayload);
    mockRedisExists.mockResolvedValue(0); // not blacklisted

    const { req, res, next } = createMockContext('Bearer valid-token');
    requireAuth(req, res, next);

    await vi.waitFor(() => {
      expect(next).toHaveBeenCalledTimes(1);
    });

    expect((req as unknown as Record<string, unknown>)['user']).toEqual({
      userId: 'user-1',
      tenantId: 'tenant-1',
      role: 'admin',
    });
  });

  it('无Authorization header应该返回401', () => {
    const { req, res, next, status, json } = createMockContext();
    requireAuth(req, res, next);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'AUTH_INVALID_TOKEN',
        }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('非Bearer格式应该返回401', () => {
    const { req, res, next, status } = createMockContext('Basic abc123');
    requireAuth(req, res, next);

    expect(status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('无效token应该返回401', () => {
    mockVerify.mockImplementation(() => {
      throw new Error('invalid signature');
    });

    const { req, res, next, status, json } = createMockContext('Bearer invalid-token');
    requireAuth(req, res, next);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'AUTH_INVALID_TOKEN',
        }),
      }),
    );
  });

  it('过期token应该返回401并使用特定错误码', () => {
    mockVerify.mockImplementation(() => {
      throw new jwt.TokenExpiredError('jwt expired', new Date());
    });

    const { req, res, next, status, json } = createMockContext('Bearer expired-token');
    requireAuth(req, res, next);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'AUTH_TOKEN_EXPIRED',
        }),
      }),
    );
  });

  it('黑名单token应该返回401', async () => {
    mockVerify.mockReturnValue(validPayload);
    mockRedisExists.mockResolvedValue(1); // blacklisted

    const { req, res, next, status, json } = createMockContext('Bearer blacklisted-token');
    requireAuth(req, res, next);

    await vi.waitFor(() => {
      expect(status).toHaveBeenCalledWith(401);
    });

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'AUTH_TOKEN_BLACKLISTED',
        }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('Redis不可用时应该降级放行', async () => {
    mockVerify.mockReturnValue(validPayload);
    mockRedisExists.mockRejectedValue(new Error('Redis down'));

    const { req, res, next } = createMockContext('Bearer valid-token');
    requireAuth(req, res, next);

    await vi.waitFor(() => {
      expect(next).toHaveBeenCalledTimes(1);
    });

    expect((req as unknown as Record<string, unknown>)['user']).toEqual({
      userId: 'user-1',
      tenantId: 'tenant-1',
      role: 'admin',
    });
  });
});
