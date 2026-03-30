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

import { createRateLimit } from '../../middleware/rate-limit.js';

function createMockReqRes(ip = '127.0.0.1', requestId = 'test-req-id') {
  const json = vi.fn();
  const setHeader = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const req = {
    ip,
    path: '/api/test',
    requestId,
    socket: { remoteAddress: ip },
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

describe('createRateLimit', () => {
  const limiter = createRateLimit({ windowMs: 60_000, max: 10 });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('正常请求应该通过', async () => {
    mockPipeline.exec.mockResolvedValue([
      [null, 0],
      [null, 1],
      [null, 3],
      [null, 1],
    ]);

    const { req, res, next } = createMockReqRes();
    await limiter(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('超过限制应该返回429', async () => {
    mockPipeline.exec.mockResolvedValue([
      [null, 0],
      [null, 1],
      [null, 11],
      [null, 1],
    ]);

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
    mockPipeline.exec.mockResolvedValue([
      [null, 0],
      [null, 1],
      [null, 5],
      [null, 1],
    ]);

    const { req, res, next, setHeader } = createMockReqRes();
    await limiter(req, res, next);

    expect(setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 10);
    expect(setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 5);
    expect(setHeader).toHaveBeenCalledWith('X-RateLimit-Reset', expect.any(Number));
  });

  it('不同IP应该独立计数', async () => {
    mockPipeline.exec.mockResolvedValue([
      [null, 0],
      [null, 1],
      [null, 1],
      [null, 1],
    ]);

    const ctx1 = createMockReqRes('192.168.1.1');
    const ctx2 = createMockReqRes('192.168.1.2');

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
});
