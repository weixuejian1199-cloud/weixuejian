import type { Request, Response, NextFunction } from 'express';
import { redis } from '../lib/redis.js';
import { sendError } from '../utils/response.js';
import { childLogger } from '../utils/logger.js';
import { env } from '../lib/env.js';

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
 * fail-secure 原则：Redis 不可用时拒绝请求，不降级放行。
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

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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

      // fail-secure：pipeline 结果无效时拒绝请求
      if (!results || results.length < 4) {
        log.error('Rate limit pipeline returned invalid results, rejecting request');
        sendError(res, 'SERVICE_UNAVAILABLE', '限流服务暂不可用', 503);
        return;
      }

      // 验证 zcard 结果的类型安全
      const zcardResult = results[2];
      if (!zcardResult || zcardResult[0] !== null || typeof zcardResult[1] !== 'number') {
        log.error({ zcardResult }, 'Rate limit zcard result type error, rejecting request');
        sendError(res, 'SERVICE_UNAVAILABLE', '限流服务暂不可用', 503);
        return;
      }

      const count = zcardResult[1];
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
      // fail-secure：Redis 不可用时拒绝请求
      log.error({ err }, 'Rate limit check failed, rejecting request (fail-secure)');
      sendError(res, 'SERVICE_UNAVAILABLE', '限流服务暂不可用', 503);
    }
  };
}

// ═══════════════════════════════════════════════════════════════
// 多维度限流预设（US-P1b-007）
// ═══════════════════════════════════════════════════════════════

/**
 * 租户级限流：同一租户所有用户共享配额
 * 默认 100 req/min，环境变量 RATE_LIMIT_TENANT_MAX 可调
 */
export function createTenantRateLimit() {
  const max = env.RATE_LIMIT_TENANT_MAX ?? 100;
  const windowMs = env.RATE_LIMIT_TENANT_WINDOW_MS ?? 60_000;

  return createRateLimit({
    windowMs,
    max,
    keyGenerator: (req: Request) => {
      const tenantId = req.tenantId;
      // 没有 tenantId 时用 IP 兜底（未认证路由不会挂此中间件）
      return `tenant:${tenantId ?? req.ip}`;
    },
    message: '租户请求配额已用尽，请稍后再试',
  });
}

/**
 * 用户级限流：单个用户独立配额
 * 默认 30 req/min，环境变量 RATE_LIMIT_USER_MAX 可调
 */
export function createUserRateLimit() {
  const max = env.RATE_LIMIT_USER_MAX ?? 30;
  const windowMs = env.RATE_LIMIT_USER_WINDOW_MS ?? 60_000;

  return createRateLimit({
    windowMs,
    max,
    keyGenerator: (req: Request) => {
      const userId = req.user?.userId;
      return `user:${userId ?? req.ip}`;
    },
    message: '请求过于频繁，请稍后再试',
  });
}

/**
 * AI接口专项限流：/api/v1/ai/* 路径，用户级
 * 默认 10 req/min，环境变量 RATE_LIMIT_AI_MAX 可调
 */
export function createAiRateLimit() {
  const max = env.RATE_LIMIT_AI_MAX ?? 10;
  const windowMs = env.RATE_LIMIT_AI_WINDOW_MS ?? 60_000;

  return createRateLimit({
    windowMs,
    max,
    keyGenerator: (req: Request) => {
      const userId = req.user?.userId;
      return `ai:${userId ?? req.ip}`;
    },
    message: 'AI调用频率限制，请稍后再试',
  });
}
