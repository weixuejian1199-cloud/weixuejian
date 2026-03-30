import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const { mockPipeline } = vi.hoisted(() => {
  const pipelineMethods = {
    zremrangebyscore: vi.fn().mockReturnThis(),
    zadd: vi.fn().mockReturnThis(),
    zcard: vi.fn().mockReturnThis(),
    pexpire: vi.fn().mockReturnThis(),
    exec: vi.fn(),
  };
  return { mockPipeline: pipelineMethods };
});

vi.mock('../../lib/redis.js', () => ({
  redis: {
    pipeline: () => mockPipeline,
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

import { createRateLimit, createTenantRateLimit, createUserRateLimit, createAiRateLimit } from '../../middleware/rate-limit.js';

function createMockReqRes(overrides: Partial<Record<string, unknown>> = {}) {
  const json = vi.fn();
  const setHeader = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const req = {
    ip: '127.0.0.1',
    path: '/api/test',
    requestId: 'test-req-id',
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  } as unknown as Request;
  const res = {
    status,
    json,
    setHeader,
    req,
  } as unknown as Response;
  const next = vi.fn();
  return { req, res, next, status, json, setHeader };
}

/** 模拟 pipeline 返回正常结果 */
function mockNormalResult(count: number) {
  mockPipeline.exec.mockResolvedValue([
    [null, 0],
    [null, 1],
    [null, count],
    [null, 1],
  ]);
}

describe('createRateLimit', () => {
  const limiter = createRateLimit({ windowMs: 60_000, max: 10 });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('正常请求应该通过', async () => {
    mockNormalResult(3);

    const { req, res, next } = createMockReqRes();
    await limiter(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('超过限制应该返回429', async () => {
    mockNormalResult(11);

    const { req, res, next, status, json } = createMockReqRes();
    await limiter(req, res, next);

    expect(status).toHaveBeenCalledWith(429);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'RATE_LIMITED' }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('应该设置正确的速率限制响应头', async () => {
    mockNormalResult(5);

    const { req, res, next, setHeader } = createMockReqRes();
    await limiter(req, res, next);

    expect(setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 10);
    expect(setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 5);
    expect(setHeader).toHaveBeenCalledWith('X-RateLimit-Reset', expect.any(Number));
  });

  it('不同IP应该独立计数', async () => {
    mockNormalResult(1);

    const ctx1 = createMockReqRes({ ip: '192.168.1.1' });
    const ctx2 = createMockReqRes({ ip: '192.168.1.2' });

    await limiter(ctx1.req, ctx1.res, ctx1.next);
    await limiter(ctx2.req, ctx2.res, ctx2.next);

    expect(ctx1.next).toHaveBeenCalledTimes(1);
    expect(ctx2.next).toHaveBeenCalledTimes(1);
  });

  it('Redis不可用时应该返回503（fail-secure）', async () => {
    mockPipeline.exec.mockRejectedValue(new Error('Redis connection refused'));

    const { req, res, next, status, json } = createMockReqRes();
    await limiter(req, res, next);

    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'SERVICE_UNAVAILABLE' }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('pipeline返回null时应该返回503（fail-secure）', async () => {
    mockPipeline.exec.mockResolvedValue(null);

    const { req, res, next, status } = createMockReqRes();
    await limiter(req, res, next);

    expect(status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });

  it('zcard结果类型异常时应该返回503（fail-secure）', async () => {
    mockPipeline.exec.mockResolvedValue([
      [null, 0],
      [null, 1],
      [new Error('zcard failed'), null],
      [null, 1],
    ]);

    const { req, res, next, status } = createMockReqRes();
    await limiter(req, res, next);

    expect(status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });

  it('超限时应该返回 Retry-After header', async () => {
    mockNormalResult(11);

    const { req, res, next, setHeader } = createMockReqRes();
    await limiter(req, res, next);

    expect(setHeader).toHaveBeenCalledWith('Retry-After', 60);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('createTenantRateLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('应该基于 tenantId 生成 key', async () => {
    mockNormalResult(1);

    const limiter = createTenantRateLimit();
    const { req, res, next } = createMockReqRes({ tenantId: 'tenant-abc' });
    await limiter(req, res, next);

    // 验证 pipeline 的 zremrangebyscore 被调用时 key 包含 tenant:tenant-abc
    const zremCall = mockPipeline.zremrangebyscore.mock.calls[0]!;
    expect(zremCall[0]).toBe('ratelimit:tenant:tenant-abc');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('同一租户超过配额应该返回429', async () => {
    mockNormalResult(101);

    const limiter = createTenantRateLimit();
    const { req, res, next, status } = createMockReqRes({ tenantId: 'tenant-abc' });
    await limiter(req, res, next);

    expect(status).toHaveBeenCalledWith(429);
    expect(next).not.toHaveBeenCalled();
  });

  it('没有 tenantId 时应该用 IP 兜底', async () => {
    mockNormalResult(1);

    const limiter = createTenantRateLimit();
    const { req, res, next } = createMockReqRes({ ip: '10.0.0.1' });
    await limiter(req, res, next);

    const zremCall = mockPipeline.zremrangebyscore.mock.calls[0]!;
    expect(zremCall[0]).toBe('ratelimit:tenant:10.0.0.1');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('应该支持环境变量配置限额', async () => {
    mockNormalResult(51);
    process.env['RATE_LIMIT_TENANT_MAX'] = '50';

    const limiter = createTenantRateLimit();
    const { req, res, next, status } = createMockReqRes({ tenantId: 'tenant-xyz' });
    await limiter(req, res, next);

    expect(status).toHaveBeenCalledWith(429);
    expect(next).not.toHaveBeenCalled();

    delete process.env['RATE_LIMIT_TENANT_MAX'];
  });
});

describe('createUserRateLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('应该基于 userId 生成 key', async () => {
    mockNormalResult(1);

    const limiter = createUserRateLimit();
    const { req, res, next } = createMockReqRes({ userId: 'user-123' });
    await limiter(req, res, next);

    const zremCall = mockPipeline.zremrangebyscore.mock.calls[0]!;
    expect(zremCall[0]).toBe('ratelimit:user:user-123');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('用户超过30次/分钟应该返回429', async () => {
    mockNormalResult(31);

    const limiter = createUserRateLimit();
    const { req, res, next, status } = createMockReqRes({ userId: 'user-123' });
    await limiter(req, res, next);

    expect(status).toHaveBeenCalledWith(429);
    expect(next).not.toHaveBeenCalled();
  });

  it('应该支持环境变量配置限额', async () => {
    mockNormalResult(21);
    process.env['RATE_LIMIT_USER_MAX'] = '20';

    const limiter = createUserRateLimit();
    const { req, res, next, status } = createMockReqRes({ userId: 'user-xyz' });
    await limiter(req, res, next);

    expect(status).toHaveBeenCalledWith(429);
    expect(next).not.toHaveBeenCalled();

    delete process.env['RATE_LIMIT_USER_MAX'];
  });
});

describe('createAiRateLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('应该基于 userId 生成 ai: 前缀的 key', async () => {
    mockNormalResult(1);

    const limiter = createAiRateLimit();
    const { req, res, next } = createMockReqRes({ userId: 'user-456', path: '/api/v1/ai/chat' });
    await limiter(req, res, next);

    const zremCall = mockPipeline.zremrangebyscore.mock.calls[0]!;
    expect(zremCall[0]).toBe('ratelimit:ai:user-456');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('AI接口超过10次/分钟应该返回429', async () => {
    mockNormalResult(11);

    const limiter = createAiRateLimit();
    const { req, res, next, status, json } = createMockReqRes({ userId: 'user-456', path: '/api/v1/ai/chat' });
    await limiter(req, res, next);

    expect(status).toHaveBeenCalledWith(429);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'RATE_LIMITED' }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('AI限流超限时应该返回 Retry-After header', async () => {
    mockNormalResult(11);

    const limiter = createAiRateLimit();
    const { req, res, next, setHeader } = createMockReqRes({ userId: 'user-456' });
    await limiter(req, res, next);

    expect(setHeader).toHaveBeenCalledWith('Retry-After', 60);
    expect(next).not.toHaveBeenCalled();
  });

  it('Redis不可用时应该返回503（fail-secure）', async () => {
    mockPipeline.exec.mockRejectedValue(new Error('ECONNREFUSED'));

    const limiter = createAiRateLimit();
    const { req, res, next, status } = createMockReqRes({ userId: 'user-456' });
    await limiter(req, res, next);

    expect(status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });

  it('应该支持环境变量配置限额', async () => {
    mockNormalResult(6);
    process.env['RATE_LIMIT_AI_MAX'] = '5';

    const limiter = createAiRateLimit();
    const { req, res, next, status } = createMockReqRes({ userId: 'user-ai' });
    await limiter(req, res, next);

    expect(status).toHaveBeenCalledWith(429);
    expect(next).not.toHaveBeenCalled();

    delete process.env['RATE_LIMIT_AI_MAX'];
  });
});
