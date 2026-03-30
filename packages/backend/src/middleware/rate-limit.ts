import type { Request, Response, NextFunction } from 'express';
import { redis } from '../lib/redis.js';
import { sendError } from '../utils/response.js';
import { childLogger } from '../utils/logger.js';

export interface RateLimitOptions {
  /** 时间窗口（毫秒） */
  windowMs: number;
  /** 窗口内最大请求数 */
  max: number;
  /** 自定义 key 生成器，默认: ip + path */
  keyGenerator?: (req: Request) => string;
  /** 超限时的错误消息 */
  message?: string;
}

/**
 * 基于 Redis 滑动窗口的速率限制中间件工厂
 *
 * 使用 Redis Sorted Set 实现滑动窗口：
 * - 每个请求记录时间戳作为 score
 * - 移除窗口外的旧记录
 * - 统计窗口内的请求数
 */
export function createRateLimit(options: RateLimitOptions) {
  const {
    windowMs,
    max,
    keyGenerator = (req: Request) => `${req.ip}:${req.path}`,
    message = '请求过于频繁，请稍后再试',
  } = options;

  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const log = childLogger(req.requestId ?? 'unknown');
    const key = `ratelimit:${keyGenerator(req)}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    try {
      // 使用 Redis pipeline 减少网络往返
      const pipeline = redis.pipeline();
      // 1. 移除窗口外的旧记录
      pipeline.zremrangebyscore(key, 0, windowStart);
      // 2. 添加当前请求
      pipeline.zadd(key, now, `${now}:${Math.random().toString(36).slice(2, 8)}`);
      // 3. 统计窗口内请求数
      pipeline.zcard(key);
      // 4. 设置 key 过期时间（窗口大小的 2 倍，防止内存泄漏）
      pipeline.pexpire(key, windowMs * 2);

      const results = await pipeline.exec();
      if (!results) {
        // Redis pipeline 返回 null，降级放行
        next();
        return;
      }

      const count = results[2]?.[1] as number;
      const remaining = Math.max(0, max - count);
      const resetTime = Math.ceil((now + windowMs) / 1000);

      // 设置速率限制响应头
      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', remaining);
      res.setHeader('X-RateLimit-Reset', resetTime);

      if (count > max) {
        res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
        sendError(res, 'RATE_LIMITED', message, 429);
        return;
      }

      next();
    } catch (err) {
      // Redis 不可用时降级放行（可用性优先）
      log.warn({ err }, 'Rate limit check failed, allowing request');
      next();
    }
  };
}
