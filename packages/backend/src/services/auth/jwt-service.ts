/**
 * JWT RS256 签发/验证服务
 *
 * Phase 1b: US-P1b-001 AC-01~04
 * - RS256 非对称签名（私钥签发、公钥验证）
 * - Access Token 15min + Refresh Token 7d
 * - Refresh Token Rotation（刷新时旧token作废）
 * - 登出黑名单（Redis TTL = token剩余有效期）
 */
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { env } from '../../lib/env.js';
import { redis } from '../../lib/redis.js';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';

// ─── 类型定义 ─────────────────────────────────────────────

export interface AccessTokenPayload {
  userId: string;
  tenantId: string;
  role: string;
  jti: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // access token有效期（秒）
}

interface DecodedAccessToken extends AccessTokenPayload {
  iat: number;
  exp: number;
}

// ─── 密钥获取 ─────────────────────────────────────────────

function getSigningKey(): { key: string | Buffer; algorithm: jwt.Algorithm } {
  // RS256模式：使用PEM私钥签发
  if (env.JWT_PRIVATE_KEY) {
    return { key: env.JWT_PRIVATE_KEY, algorithm: 'RS256' };
  }
  // 降级HS256：兼容Phase 1a（开发环境）
  return { key: env.JWT_SECRET, algorithm: 'HS256' };
}

function getVerifyKey(): { key: string | Buffer; algorithms: jwt.Algorithm[] } {
  // RS256模式：使用PEM公钥验证
  if (env.JWT_PUBLIC_KEY) {
    return { key: env.JWT_PUBLIC_KEY, algorithms: ['RS256'] };
  }
  // 降级HS256
  return { key: env.JWT_SECRET, algorithms: ['HS256'] };
}

// ─── Access Token ─────────────────────────────────────────

/** 签发 Access Token (短期，15min默认) */
export function signAccessToken(payload: AccessTokenPayload): string {
  const { key, algorithm } = getSigningKey();
  const expiresInSeconds = parseExpiry(env.JWT_ACCESS_EXPIRES_IN);
  // jti已在payload中，不需要再通过options.jwtid设置
  return jwt.sign(payload, key, {
    algorithm,
    expiresIn: expiresInSeconds,
  });
}

/** 验证 Access Token，返回解码后的payload */
export function verifyAccessToken(token: string): DecodedAccessToken {
  const { key, algorithms } = getVerifyKey();
  return jwt.verify(token, key, { algorithms }) as DecodedAccessToken;
}

// ─── Refresh Token ─────────────────────────────────────────

/** 生成 Refresh Token（随机字节，不是JWT） */
export function generateRefreshToken(): string {
  return crypto.randomBytes(48).toString('base64url');
}

/** 计算 Refresh Token 的 SHA256 哈希（存储用） */
export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * 签发完整的 Token Pair
 * - 创建 Access Token (JWT RS256)
 * - 创建 Refresh Token (随机字节)
 * - 将 Refresh Token 哈希存入数据库
 */
export async function issueTokenPair(
  userId: string,
  tenantId: string,
  role: string,
  deviceId?: string,
): Promise<TokenPair> {
  const jti = crypto.randomUUID();
  const refreshToken = generateRefreshToken();
  const tokenHash = hashRefreshToken(refreshToken);

  // 计算refresh token过期时间
  const refreshExpiresIn = parseExpiry(env.JWT_REFRESH_EXPIRES_IN);
  const expiresAt = new Date(Date.now() + refreshExpiresIn * 1000);

  // 存储refresh token哈希到数据库
  await prisma.refreshToken.create({
    data: {
      tenantId,
      userId,
      tokenHash,
      deviceId: deviceId ?? null,
      expiresAt,
    },
  });

  const accessToken = signAccessToken({ userId, tenantId, role, jti });

  // access token有效期（秒）
  const accessExpiresIn = parseExpiry(env.JWT_ACCESS_EXPIRES_IN);

  return {
    accessToken,
    refreshToken,
    expiresIn: accessExpiresIn,
  };
}

/**
 * Refresh Token Rotation — 刷新时旧token作废，签发新pair
 * 安全原则：一个refresh token只能用一次
 */
export async function rotateTokenPair(
  rawRefreshToken: string,
  deviceId?: string,
): Promise<TokenPair> {
  const tokenHash = hashRefreshToken(rawRefreshToken);

  // 查找数据库中的refresh token
  const stored = await prisma.refreshToken.findFirst({
    where: {
      tokenHash,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: {
      user: {
        select: { id: true, tenantId: true, roleId: true, status: true, role: true },
      },
    },
  });

  if (!stored) {
    throw new TokenRotationError('INVALID_REFRESH_TOKEN');
  }

  // 用户状态检查
  if (stored.user.status !== 'active') {
    // 吊销该用户所有refresh token
    await prisma.refreshToken.updateMany({
      where: { userId: stored.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw new TokenRotationError('USER_INACTIVE');
  }

  // 作废旧的refresh token（Rotation核心）
  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  });

  // 签发新的token pair
  return issueTokenPair(
    stored.userId,
    stored.tenantId,
    stored.user.role.name,
    deviceId,
  );
}

// ─── 登出（黑名单）─────────────────────────────────────────

/**
 * 将 Access Token 加入黑名单（Redis），TTL = token剩余有效期
 * 同时吊销对应用户的所有 Refresh Token
 */
export async function revokeTokens(
  accessToken: string,
  userId: string,
): Promise<void> {
  // 1. 解码access token获取jti和exp（不验证签名，因为可能已过期）
  const decoded = jwt.decode(accessToken) as DecodedAccessToken | null;
  if (decoded?.jti && decoded?.exp) {
    const ttl = decoded.exp - Math.floor(Date.now() / 1000);
    if (ttl > 0) {
      const blacklistKey = `token:blacklist:${decoded.jti}`;
      await redis.setex(blacklistKey, ttl, '1');
    }
  }

  // 2. 吊销该用户所有refresh token
  const result = await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  logger.info({ userId, revokedCount: result.count }, 'Tokens revoked');
}

/**
 * 检查 Access Token 的 jti 是否在黑名单中
 * fail-secure: Redis不可用时抛出错误（由调用方处理）
 */
export async function isTokenBlacklisted(jti: string): Promise<boolean> {
  const exists = await redis.exists(`token:blacklist:${jti}`);
  return exists === 1;
}

// ─── 辅助函数 ──────────────────────────────────────────────

/** 解析过期时间字符串(如 "15m", "7d")为秒数 */
function parseExpiry(expiry: string): number {
  const match = expiry.match(/^(\d+)([smhd])$/);
  if (!match) return 900; // 默认15分钟

  const value = parseInt(match[1]!, 10);
  const unit = match[2]!;

  switch (unit) {
    case 's': return value;
    case 'm': return value * 60;
    case 'h': return value * 3600;
    case 'd': return value * 86400;
    default: return 900;
  }
}

/** Token Rotation 专用错误 */
export class TokenRotationError extends Error {
  code: 'INVALID_REFRESH_TOKEN' | 'USER_INACTIVE';

  constructor(code: 'INVALID_REFRESH_TOKEN' | 'USER_INACTIVE') {
    super(code === 'INVALID_REFRESH_TOKEN'
      ? '刷新令牌无效或已过期'
      : '用户账号已停用');
    this.code = code;
    this.name = 'TokenRotationError';
  }
}
