/**
 * 微信小程序登录服务
 *
 * Phase 1b: US-P1b-001 AC-05~06
 * - 微信 code 换取 openid + session_key
 * - findOrCreate 用户（基于 openid）
 * - session_key 不下发客户端（安全原则）
 */
import { z } from 'zod';
import { env } from '../../lib/env.js';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';

// ─── 类型定义 ─────────────────────────────────────────────

export interface WechatLoginResult {
  userId: string;
  tenantId: string;
  role: string;
  isNewUser: boolean;
  needsPhone: boolean; // 新用户需要绑定手机号
}

const wechatCodeResponseSchema = z.object({
  openid: z.string().min(1),
  session_key: z.string().min(1),
  unionid: z.string().optional(),
  errcode: z.number().optional(),
  errmsg: z.string().optional(),
});

// ─── 微信 code 换 openid ──────────────────────────────────

/**
 * 调用微信 code2Session 接口，获取 openid
 * 文档: https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/user-login/code2Session.html
 */
export async function code2Session(code: string): Promise<{ openid: string; unionid?: string }> {
  const appId = env.WECHAT_APP_ID;
  const appSecret = env.WECHAT_APP_SECRET;

  if (!appId || !appSecret) {
    throw new WechatAuthError('CONFIG_MISSING', '微信登录未配置');
  }

  const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
  url.searchParams.set('appid', appId);
  url.searchParams.set('secret', appSecret);
  url.searchParams.set('js_code', code);
  url.searchParams.set('grant_type', 'authorization_code');

  const response = await fetch(url.toString(), {
    method: 'GET',
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    logger.error({ status: response.status }, 'WeChat API HTTP error');
    throw new WechatAuthError('API_ERROR', '微信服务暂不可用');
  }

  const data = wechatCodeResponseSchema.parse(await response.json());

  if (data.errcode && data.errcode !== 0) {
    logger.warn({ errcode: data.errcode, errmsg: data.errmsg }, 'WeChat code2Session error');
    throw new WechatAuthError('CODE_INVALID', data.errmsg ?? '微信登录code无效');
  }

  // session_key 不返回（安全原则：不下发客户端）
  return { openid: data.openid, unionid: data.unionid };
}

// ─── 查找或创建用户 ────────────────────────────────────────

/**
 * 根据微信 openid 查找或创建用户
 * - 已存在: 返回用户信息
 * - 不存在: 创建新用户（需要后续绑定手机号）
 */
export async function findOrCreateByWechat(
  openid: string,
  tenantId: string,
): Promise<WechatLoginResult> {
  // 查找已有用户
  const existing = await prisma.user.findFirst({
    where: {
      tenantId,
      wechatOpenid: openid,
      deletedAt: null,
    },
    include: {
      role: { select: { name: true } },
    },
  });

  if (existing) {
    // 更新最后登录时间
    await prisma.user.update({
      where: { id: existing.id },
      data: { lastLoginAt: new Date() },
    });

    return {
      userId: existing.id,
      tenantId: existing.tenantId,
      role: existing.role.name,
      isNewUser: false,
      needsPhone: !existing.phone,
    };
  }

  // 创建新用户（默认角色: buyer）
  const buyerRole = await prisma.role.findFirst({
    where: { tenantId, code: 'buyer' },
  });

  if (!buyerRole) {
    logger.error({ tenantId }, 'Buyer role not found for tenant');
    throw new WechatAuthError('ROLE_MISSING', '系统角色配置异常');
  }

  const newUser = await prisma.user.create({
    data: {
      tenantId,
      phone: '', // 空字符串表示未绑定，后续必须绑定
      name: '微信用户',
      wechatOpenid: openid,
      roleId: buyerRole.id,
      status: 'active',
      lastLoginAt: new Date(),
    },
  });

  logger.info({ userId: newUser.id, tenantId }, 'New WeChat user created');

  return {
    userId: newUser.id,
    tenantId,
    role: buyerRole.name,
    isNewUser: true,
    needsPhone: true,
  };
}

// ─── 手机号绑定 ─────────────────────────────────────────────

/**
 * 为已有用户绑定手机号
 * - 手机号在同一租户内唯一
 * - 如果手机号已被其他用户占用，合并账号（将openid转移到手机号用户）
 */
export async function bindPhone(
  userId: string,
  tenantId: string,
  phone: string,
): Promise<{ merged: boolean; finalUserId: string }> {
  // 事务保护：账号合并涉及多步DB操作，需原子性防止并发脏读
  return prisma.$transaction(async (tx) => {
    // 检查手机号是否已被其他用户使用
    const existingByPhone = await tx.user.findFirst({
      where: {
        tenantId,
        phone,
        deletedAt: null,
        id: { not: userId },
      },
    });

    if (existingByPhone) {
      // 手机号已存在：将当前用户的 openid 转移到手机号用户
      const currentUser = await tx.user.findUnique({
        where: { id: userId },
        select: { wechatOpenid: true },
      });

      if (currentUser?.wechatOpenid) {
        await tx.user.update({
          where: { id: existingByPhone.id },
          data: {
            wechatOpenid: currentUser.wechatOpenid,
            lastLoginAt: new Date(),
          },
        });
      }

      // 软删除临时用户
      await tx.user.update({
        where: { id: userId },
        data: { deletedAt: new Date(), wechatOpenid: null },
      });

      logger.info(
        { mergedFrom: userId, mergedTo: existingByPhone.id, tenantId },
        'User accounts merged',
      );

      return { merged: true, finalUserId: existingByPhone.id };
    }

    // 手机号未被使用：直接绑定
    await tx.user.update({
      where: { id: userId },
      data: { phone },
    });

    return { merged: false, finalUserId: userId };
  }, { timeout: 10000 });
}

// ─── 错误类 ─────────────────────────────────────────────────

export class WechatAuthError extends Error {
  code: 'CONFIG_MISSING' | 'API_ERROR' | 'CODE_INVALID' | 'ROLE_MISSING';

  constructor(code: WechatAuthError['code'], message: string) {
    super(message);
    this.code = code;
    this.name = 'WechatAuthError';
  }
}
