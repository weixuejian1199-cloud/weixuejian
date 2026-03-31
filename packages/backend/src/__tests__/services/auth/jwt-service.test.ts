import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────

const {
  mockRedisExists,
  mockRedisSetex,
  mockPrismaCreate,
  mockPrismaFindFirst,
  mockPrismaUpdate,
  mockPrismaUpdateMany,
} = vi.hoisted(() => ({
  mockRedisExists: vi.fn(),
  mockRedisSetex: vi.fn(),
  mockPrismaCreate: vi.fn(),
  mockPrismaFindFirst: vi.fn(),
  mockPrismaUpdate: vi.fn(),
  mockPrismaUpdateMany: vi.fn(),
}));

vi.mock('../../../lib/env.js', () => ({
  env: {
    JWT_SECRET: 'test-secret-that-is-at-least-32-chars-long',
    JWT_PRIVATE_KEY: undefined, // HS256 mode for tests
    JWT_PUBLIC_KEY: undefined,
    JWT_ACCESS_EXPIRES_IN: '15m',
    JWT_REFRESH_EXPIRES_IN: '7d',
  },
}));

vi.mock('../../../lib/redis.js', () => ({
  redis: {
    exists: mockRedisExists,
    setex: mockRedisSetex,
  },
}));

vi.mock('../../../lib/prisma.js', () => {
  const txProxy = {
    refreshToken: {
      create: mockPrismaCreate,
      findFirst: mockPrismaFindFirst,
      update: mockPrismaUpdate,
      updateMany: mockPrismaUpdateMany,
    },
  };
  return {
    prisma: {
      ...txProxy,
      $transaction: vi.fn(async (fn: (tx: typeof txProxy) => Promise<unknown>) => fn(txProxy)),
    },
  };
});

vi.mock('../../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

import {
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  issueTokenPair,
  rotateTokenPair,
  revokeTokens,
  isTokenBlacklisted,
  TokenRotationError,
} from '../../../services/auth/jwt-service.js';

// ─── Tests ──────────────────────────────────────────────

describe('JWT Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('signAccessToken + verifyAccessToken', () => {
    it('应该签发并验证HS256 token', () => {
      const payload = { userId: 'u1', tenantId: 't1', role: 'admin', jti: 'jti-1' };
      const token = signAccessToken(payload);
      const decoded = verifyAccessToken(token);

      expect(decoded.userId).toBe('u1');
      expect(decoded.tenantId).toBe('t1');
      expect(decoded.role).toBe('admin');
      expect(decoded.jti).toBe('jti-1');
      expect(decoded.iat).toBeDefined();
      expect(decoded.exp).toBeDefined();
    });

    it('篡改的token应该验证失败', () => {
      const token = signAccessToken({ userId: 'u1', tenantId: 't1', role: 'admin', jti: 'jti-1' });
      expect(() => verifyAccessToken(token + 'tampered')).toThrow();
    });
  });

  describe('generateRefreshToken', () => {
    it('应该生成64字符的base64url字符串', () => {
      const token = generateRefreshToken();
      expect(token.length).toBe(64);
      expect(/^[A-Za-z0-9_-]+$/.test(token)).toBe(true);
    });

    it('两次生成应该不同', () => {
      const t1 = generateRefreshToken();
      const t2 = generateRefreshToken();
      expect(t1).not.toBe(t2);
    });
  });

  describe('hashRefreshToken', () => {
    it('应该返回64字符的hex字符串(SHA256)', () => {
      const hash = hashRefreshToken('test-token');
      expect(hash.length).toBe(64);
      expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
    });

    it('相同输入应该产生相同哈希', () => {
      const h1 = hashRefreshToken('same');
      const h2 = hashRefreshToken('same');
      expect(h1).toBe(h2);
    });
  });

  describe('issueTokenPair', () => {
    it('应该签发access+refresh token并存储到数据库', async () => {
      mockPrismaCreate.mockResolvedValue({ id: 'rt-1' });

      const pair = await issueTokenPair('u1', 't1', 'admin', 'device-1');

      expect(pair.accessToken).toBeDefined();
      expect(pair.refreshToken).toBeDefined();
      expect(pair.expiresIn).toBe(900); // 15m = 900s

      // 验证access token内容
      const decoded = verifyAccessToken(pair.accessToken);
      expect(decoded.userId).toBe('u1');
      expect(decoded.tenantId).toBe('t1');

      // 验证数据库存储调用
      expect(mockPrismaCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 't1',
          userId: 'u1',
          deviceId: 'device-1',
        }),
      });
    });
  });

  describe('rotateTokenPair', () => {
    it('有效refresh token应该旧作废+签发新pair', async () => {
      mockPrismaFindFirst.mockResolvedValue({
        id: 'rt-1',
        userId: 'u1',
        tenantId: 't1',
        user: { id: 'u1', tenantId: 't1', roleId: 'r1', status: 'active', role: { name: 'admin' } },
      });
      mockPrismaUpdate.mockResolvedValue({ id: 'rt-1' });
      mockPrismaCreate.mockResolvedValue({ id: 'rt-2' });

      const pair = await rotateTokenPair('valid-refresh-token');

      expect(pair.accessToken).toBeDefined();
      expect(pair.refreshToken).toBeDefined();

      // 旧token应该被revoke
      expect(mockPrismaUpdate).toHaveBeenCalledWith({
        where: { id: 'rt-1' },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('无效refresh token应该抛出TokenRotationError', async () => {
      mockPrismaFindFirst.mockResolvedValue(null);

      await expect(rotateTokenPair('invalid-token')).rejects.toThrow(TokenRotationError);
    });

    it('停用用户应该吊销所有token并抛出错误', async () => {
      mockPrismaFindFirst.mockResolvedValue({
        id: 'rt-1',
        userId: 'u1',
        tenantId: 't1',
        user: {
          id: 'u1',
          tenantId: 't1',
          roleId: 'r1',
          status: 'suspended',
          role: { name: 'admin' },
        },
      });
      mockPrismaUpdateMany.mockResolvedValue({ count: 3 });

      await expect(rotateTokenPair('token-for-suspended-user')).rejects.toThrow(TokenRotationError);

      // 应该吊销该用户所有refresh token
      expect(mockPrismaUpdateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });

  describe('revokeTokens', () => {
    it('应该将access token加入黑名单并吊销所有refresh token', async () => {
      // 签发一个token用于测试
      const token = signAccessToken({
        userId: 'u1',
        tenantId: 't1',
        role: 'admin',
        jti: 'jti-revoke',
      });
      mockRedisSetex.mockResolvedValue('OK');
      mockPrismaUpdateMany.mockResolvedValue({ count: 2 });

      await revokeTokens(token, 'u1', 't1');

      // Redis黑名单
      expect(mockRedisSetex).toHaveBeenCalledWith(
        'token:blacklist:jti-revoke',
        expect.any(Number),
        '1',
      );

      // 数据库吊销 — 包含 tenantId 隔离
      expect(mockPrismaUpdateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', tenantId: 't1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });

  describe('isTokenBlacklisted', () => {
    it('黑名单中的jti应该返回true', async () => {
      mockRedisExists.mockResolvedValue(1);
      expect(await isTokenBlacklisted('jti-bad')).toBe(true);
    });

    it('不在黑名单的jti应该返回false', async () => {
      mockRedisExists.mockResolvedValue(0);
      expect(await isTokenBlacklisted('jti-good')).toBe(false);
    });

    it('Redis不可用时应该抛出错误（fail-secure）', async () => {
      mockRedisExists.mockRejectedValue(new Error('Redis down'));
      await expect(isTokenBlacklisted('jti-any')).rejects.toThrow('Redis down');
    });
  });
});
