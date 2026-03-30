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
 * 验证签名 → 检查黑名单 → 注入 req.user
 */
export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const log = childLogger(req.requestId ?? 'unknown');
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    sendError(res, 'AUTH_INVALID_TOKEN', '无效的访问令牌', 401);
    return;
  }

  const token = authHeader.slice(7);

  // 验证 JWT 签名和过期时间
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

  // 检查 Redis 黑名单（异步，不阻塞签名验证）
  const blacklistKey = `token:blacklist:${payload.jti}`;
  redis
    .exists(blacklistKey)
    .then((exists) => {
      if (exists) {
        sendError(res, 'AUTH_TOKEN_BLACKLISTED', '令牌已被吊销', 401);
        return;
      }

      // 注入用户信息
      req.user = {
        userId: payload.userId,
        tenantId: payload.tenantId,
        role: payload.role,
      };

      next();
    })
    .catch((err: unknown) => {
      // Redis 不可用时降级：允许通过（避免单点故障）
      log.warn({ err }, 'Redis blacklist check failed, allowing request');
      req.user = {
        userId: payload.userId,
        tenantId: payload.tenantId,
        role: payload.role,
      };
      next();
    });
}

/**
 * 可选认证中间件 — 有 token 则验证并注入 req.user，无 token 则放行
 */
export function optionalAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    next();
    return;
  }

  // 有 token 则走完整验证流程
  requireAuth(req, res, next);
}
