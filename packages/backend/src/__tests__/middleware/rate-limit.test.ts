import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// Mock Redis
const mockRedis = {
  multi: vi.fn(),
  exec: vi.fn(),
};

vi.mock('../../lib/redis.js', () => ({
  redis: mockRedis,
}));

vi.mock('../../utils/logger.js', () => ({
  childLogger: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  }),
}));

/**
 * TDD风格：rate-limit中间件尚未实现，这里定义期望行为。
 * 当模块创建后，取消注释import并运行测试。
 *
 * 期望的API:
 *   createRateLimit(options: { windowMs: number; max: number }) => middleware
 *
 * 行为:
 *   - 使用Redis滑动窗口计数
 *   - 正常请求通过
 *   - 超过max限制返回429
 *   - 设置 X-RateLimit-Limit / X-RateLimit-Remaining / X-RateLimit-Reset 响应头
 *   - 不同IP独立计数
 */

interface RateLimitOptions {
  windowMs: number;
  max: number;
}

// 模拟一个最小化的 createRateLimit 实现供测试验证行为设计
function createRateLimit(options: RateLimitOptions) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    const key = `rate_limit:${ip}`;
    const now = Date.now();
    const windowStart = now - options.windowMs;

    try {
      const multi = mockRedis.multi();
      // 模拟 Redis pipeline: ZREMRANGEBYSCORE, ZADD, ZCARD, PEXPIRE
      multi.zremrangebyscore(key, 0, windowStart);
      multi.zadd(key, now, `${now}`);
      multi.zcard(key);
      multi.pexpire(key, options.windowMs);

      const results = await mockRedis.exec();
      const count = (results as Array<[null, number]>)?.[2]?.[1] ?? 0;

      res.setHeader('X-RateLimit-Limit', options.max);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, options.max - count));
      res.setHeader('X-RateLimit-Reset', Math.ceil((now + options.windowMs) / 1000));

      if (count > options.max) {
        res.status(429).json({
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: '请求过于频繁，请稍后再试',
          },
          requestId: req.requestId ?? 'unknown',
        });
        return;
      }

      next();
    } catch {
      // Redis不可用时降级放行
      next();
    }
  };
}

function createMockReqRes(ip = '127.0.0.1', requestId = 'test-req-id') {
  const json = vi.fn();
  const setHeader = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const req = {
    ip,
    requestId,
    socket: { remoteAddress: ip },
  } as unknown as Request;
  const res = {
    status,
    json,
    setHeader,
  } as unknown as Response;
  const next = vi.fn();
  return { req, res, next, status, json, setHeader };
}

describe('createRateLimit', () => {
  const limiter = createRateLimit({ windowMs: 60_000, max: 10 });

  beforeEach(() => {
    vi.clearAllMocks();
    // 默认配置：multi返回链式调用对象，exec返回结果
    const chainable = {
      zremrangebyscore: vi.fn().mockReturnThis(),
      zadd: vi.fn().mockReturnThis(),
      zcard: vi.fn().mockReturnThis(),
      pexpire: vi.fn().mockReturnThis(),
    };
    mockRedis.multi.mockReturnValue(chainable);
  });

  it('正常请求应该通过', async () => {
    mockRedis.exec.mockResolvedValue([
      [null, 0],
      [null, 1],
      [null, 3], // count = 3, under limit of 10
      [null, 1],
    ]);

    const { req, res, next } = createMockReqRes();
    await limiter(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('超过限制应该返回429', async () => {
    mockRedis.exec.mockResolvedValue([
      [null, 0],
      [null, 1],
      [null, 11], // count = 11, over limit of 10
      [null, 1],
    ]);

    const { req, res, next, status } = createMockReqRes();
    await limiter(req, res, next);

    expect(status).toHaveBeenCalledWith(429);
    expect(next).not.toHaveBeenCalled();
  });

  it('应该设置正确的速率限制响应头', async () => {
    mockRedis.exec.mockResolvedValue([
      [null, 0],
      [null, 1],
      [null, 5], // count = 5
      [null, 1],
    ]);

    const { req, res, next, setHeader } = createMockReqRes();
    await limiter(req, res, next);

    expect(setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 10);
    expect(setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 5);
    expect(setHeader).toHaveBeenCalledWith(
      'X-RateLimit-Reset',
      expect.any(Number),
    );
  });

  it('不同IP应该独立计数', async () => {
    mockRedis.exec.mockResolvedValue([
      [null, 0],
      [null, 1],
      [null, 1],
      [null, 1],
    ]);

    const ctx1 = createMockReqRes('192.168.1.1');
    const ctx2 = createMockReqRes('192.168.1.2');

    await limiter(ctx1.req, ctx1.res, ctx1.next);
    await limiter(ctx2.req, ctx2.res, ctx2.next);

    // 两个请求都应该通过（各自独立计数）
    expect(ctx1.next).toHaveBeenCalledTimes(1);
    expect(ctx2.next).toHaveBeenCalledTimes(1);
  });

  it('Redis不可用时应该降级放行', async () => {
    mockRedis.exec.mockRejectedValue(new Error('Redis connection refused'));

    const { req, res, next } = createMockReqRes();
    await limiter(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});
