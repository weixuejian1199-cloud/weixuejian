/**
 * Auth 路由 — 公开路由（不经过 requireAuth）
 *
 * Phase 1b: US-P1b-001 AC-05~10
 * POST /api/v1/auth/wechat-login   — 微信小程序登录
 * POST /api/v1/auth/bind-phone     — 绑定手机号（需认证）
 * POST /api/v1/auth/refresh         — 刷新 Access Token
 * POST /api/v1/auth/logout          — 登出（需认证）
 */
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { code2Session, findOrCreateByWechat, bindPhone, WechatAuthError } from '../../services/auth/wechat-auth.js';
import { issueTokenPair, rotateTokenPair, revokeTokens, TokenRotationError } from '../../services/auth/jwt-service.js';
import { requireAuth } from '../../middleware/auth.js';
import { createRateLimit } from '../../middleware/rate-limit.js';
import { sendSuccess, sendError } from '../../utils/response.js';
import { childLogger } from '../../utils/logger.js';
import { prisma } from '../../lib/prisma.js';

const authRouter = Router();

// ─── 辅助 ─────────────────────────────────────────────────

function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

// ─── 登录限流（5次/分钟/IP）────────────────────────────────

const loginRateLimit = createRateLimit({
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator: (req) => `auth:${req.ip}`,
  message: '登录尝试过于频繁，请稍后再试',
});

// ─── 请求校验 Schema ──────────────────────────────────────

const wechatLoginSchema = z.object({
  code: z.string().min(1, 'code不能为空'),
  tenantId: z.string().uuid('tenantId格式不正确'),
  deviceId: z.string().optional(),
});

const bindPhoneSchema = z.object({
  phone: z.string().regex(/^1[3-9]\d{9}$/, '手机号格式不正确'),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken不能为空'),
  deviceId: z.string().optional(),
});

// ─── POST /wechat-login ────────────────────────────────────

authRouter.post('/wechat-login', loginRateLimit, asyncHandler(async (req, res) => {
  const log = childLogger(req.requestId);
  const parsed = wechatLoginSchema.safeParse(req.body);

  if (!parsed.success) {
    sendError(res, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? '参数校验失败', 400);
    return;
  }

  const { code, tenantId, deviceId } = parsed.data;

  // 验证租户存在
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, status: true },
  });

  if (!tenant || tenant.status !== 'active') {
    sendError(res, 'TENANT_NOT_FOUND', '租户不存在或已停用', 403);
    return;
  }

  try {
    // 1. 微信code换openid
    const { openid } = await code2Session(code);

    // 2. 查找或创建用户
    const loginResult = await findOrCreateByWechat(openid, tenantId);

    // 3. 签发token pair
    const tokenPair = await issueTokenPair(
      loginResult.userId,
      loginResult.tenantId,
      loginResult.role,
      deviceId,
    );

    // 4. 写审计日志
    await prisma.auditLog.create({
      data: {
        tenantId,
        userId: loginResult.userId,
        action: loginResult.isNewUser ? 'USER_REGISTER' : 'USER_LOGIN',
        resourceType: 'user',
        resourceId: loginResult.userId,
        afterData: { method: 'wechat', isNewUser: loginResult.isNewUser },
      },
    });

    log.info({ userId: loginResult.userId, isNewUser: loginResult.isNewUser }, 'WeChat login success');

    sendSuccess(res, {
      ...tokenPair,
      userId: loginResult.userId,
      isNewUser: loginResult.isNewUser,
      needsPhone: loginResult.needsPhone,
    });
  } catch (err) {
    if (err instanceof WechatAuthError) {
      if (err.code === 'CODE_INVALID') {
        sendError(res, 'AUTH_WECHAT_CODE_INVALID', err.message, 400);
        return;
      }
      log.error({ code: err.code, message: err.message }, 'WeChat auth error');
      sendError(res, 'SERVICE_UNAVAILABLE', err.message, 503);
      return;
    }
    throw err;
  }
}));

// ─── POST /bind-phone ──────────────────────────────────────

authRouter.post('/bind-phone', requireAuth, asyncHandler(async (req, res) => {
  const log = childLogger(req.requestId);
  const parsed = bindPhoneSchema.safeParse(req.body);

  if (!parsed.success) {
    sendError(res, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? '参数校验失败', 400);
    return;
  }

  const userId = req.user!.userId;
  const tenantId = req.user!.tenantId;

  const result = await bindPhone(userId, tenantId, parsed.data.phone);

  // 如果合并了账号，需要重新签发token（用合并后的userId）
  if (result.merged) {
    const mergedUser = await prisma.user.findUnique({
      where: { id: result.finalUserId },
      include: { role: { select: { name: true } } },
    });

    if (!mergedUser) {
      sendError(res, 'INTERNAL_ERROR', '账号合并异常', 500);
      return;
    }

    const tokenPair = await issueTokenPair(
      mergedUser.id,
      mergedUser.tenantId,
      mergedUser.role.name,
    );

    await prisma.auditLog.create({
      data: {
        tenantId,
        userId: result.finalUserId,
        action: 'USER_MERGE',
        resourceType: 'user',
        resourceId: result.finalUserId,
        afterData: { phone: parsed.data.phone, mergedFrom: userId },
      },
    });

    log.info({ mergedFrom: userId, mergedTo: result.finalUserId }, 'Phone bound with merge');

    sendSuccess(res, {
      ...tokenPair,
      userId: result.finalUserId,
      merged: true,
    });
    return;
  }

  await prisma.auditLog.create({
    data: {
      tenantId,
      userId,
      action: 'USER_BIND_PHONE',
      resourceType: 'user',
      resourceId: userId,
      afterData: { phone: parsed.data.phone },
    },
  });

  log.info({ userId }, 'Phone bound');
  sendSuccess(res, { userId, merged: false });
}));

// ─── POST /refresh ─────────────────────────────────────────

authRouter.post('/refresh', loginRateLimit, asyncHandler(async (req, res) => {
  const parsed = refreshSchema.safeParse(req.body);

  if (!parsed.success) {
    sendError(res, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? '参数校验失败', 400);
    return;
  }

  try {
    const tokenPair = await rotateTokenPair(parsed.data.refreshToken, parsed.data.deviceId);
    sendSuccess(res, tokenPair);
  } catch (err) {
    if (err instanceof TokenRotationError) {
      sendError(res, 'AUTH_REFRESH_INVALID', err.message, 401);
      return;
    }
    throw err;
  }
}));

// ─── POST /logout ──────────────────────────────────────────

authRouter.post('/logout', requireAuth, asyncHandler(async (req, res) => {
  const log = childLogger(req.requestId);
  const userId = req.user!.userId;
  const tenantId = req.user!.tenantId;
  const authHeader = req.headers['authorization']!;
  const accessToken = authHeader.slice(7);

  await revokeTokens(accessToken, userId);

  await prisma.auditLog.create({
    data: {
      tenantId,
      userId,
      action: 'USER_LOGOUT',
      resourceType: 'session',
      resourceId: userId,
    },
  });

  log.info({ userId }, 'User logged out');
  sendSuccess(res, { message: '已登出' });
}));

export { authRouter };
