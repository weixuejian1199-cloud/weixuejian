import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../lib/env.js';
import { redis } from '../lib/redis.js';
import { sendError } from '../utils/response.js';
import { childLogger } from '../utils/logger.js';

interface JwtPayload {
  userId: string;
  tenantId: string;
  role: string;
  jti: string;
  iat: number;
  exp: number;
}

/**
 * JWT 认证中间件 — 必须携带有效的 Bearer token
 *
 * fail-secure 原则：任何验证环节失败都拒绝请求，不降级放行。
 * 流程：验证签名 → 检查黑名单(await) → 注入 req.user
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const log = childLogger(req.requestId ?? 'unknown');
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    sendError(res, 'AUTH_INVALID_TOKEN', '无效的访问令牌', 401);
    return;
  }

  const token = authHeader.slice(7);

  // 1. 验证 JWT 签名和过期时间
  let payload: JwtPayload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ['HS256'],
    }) as JwtPayload;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      sendError(res, 'AUTH_TOKEN_EXPIRED', '访问令牌已过期', 401);
      return;
    }
    log.debug({ err }, 'JWT verification failed');
    sendError(res, 'AUTH_INVALID_TOKEN', '无效的访问令牌', 401);
    return;
  }

  // 2. 检查 Redis 黑名单（fail-secure：Redis 不可用时拒绝请求）
  const blacklistKey = `token:blacklist:${payload.jti}`;
  try {
    const exists = await redis.exists(blacklistKey);
    if (exists) {
      sendError(res, 'AUTH_TOKEN_BLACKLISTED', '令牌已被吊销', 401);
      return;
    }
  } catch (err) {
    log.error({ err }, 'Redis blacklist check failed, rejecting request (fail-secure)');
    sendError(res, 'SERVICE_UNAVAILABLE', '认证服务暂不可用', 503);
    return;
  }

  // 3. 注入用户信息
  req.user = {
    userId: payload.userId,
    tenantId: payload.tenantId,
    role: payload.role,
  };

  next();
}

/**
 * 可选认证中间件 — 有 token 则验证并注入 req.user，无 token 则放行
 */
export async function optionalAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    next();
    return;
  }

  // 有 token 则走完整验证流程
  await requireAuth(req, res, next);
}
