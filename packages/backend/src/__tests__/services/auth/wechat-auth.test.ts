import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────

const { mockUserFindFirst, mockUserFindUnique, mockUserCreate, mockUserUpdate, mockRoleFindFirst } =
  vi.hoisted(() => ({
    mockUserFindFirst: vi.fn(),
    mockUserFindUnique: vi.fn(),
    mockUserCreate: vi.fn(),
    mockUserUpdate: vi.fn(),
    mockRoleFindFirst: vi.fn(),
  }));

vi.mock('../../../lib/env.js', () => ({
  env: {
    WECHAT_APP_ID: 'wx-test-app-id',
    WECHAT_APP_SECRET: 'wx-test-app-secret',
  },
}));

vi.mock('../../../lib/prisma.js', () => {
  const txProxy = {
    user: {
      findFirst: mockUserFindFirst,
      findUnique: mockUserFindUnique,
      create: mockUserCreate,
      update: mockUserUpdate,
    },
    role: {
      findFirst: mockRoleFindFirst,
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
    debug: vi.fn(),
  },
}));

// ─── Import after mocks ────────────────────────────────

import {
  code2Session,
  findOrCreateByWechat,
  bindPhone,
  WechatAuthError,
} from '../../../services/auth/wechat-auth.js';

// ─── Helper ────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function createFetchResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  };
}

// ─── Tests ──────────────────────────────────────────────

describe('WechatAuth Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── code2Session ───────────────────────────────────

  describe('code2Session', () => {
    it('微信 API 返回 errcode 时应抛出 WechatAuthError(CODE_INVALID)', async () => {
      mockFetch.mockResolvedValue(
        createFetchResponse({
          openid: 'xxx',
          session_key: 'sk',
          errcode: 40029,
          errmsg: 'invalid code',
        }),
      );

      await expect(code2Session('bad-code')).rejects.toThrow(WechatAuthError);
      await expect(code2Session('bad-code')).rejects.toMatchObject({
        code: 'CODE_INVALID',
      });
    });

    it('微信 API HTTP 非 200 时应抛出 WechatAuthError(API_ERROR)', async () => {
      mockFetch.mockResolvedValue(createFetchResponse({}, false, 500));

      await expect(code2Session('any-code')).rejects.toThrow(WechatAuthError);
      await expect(code2Session('any-code')).rejects.toMatchObject({
        code: 'API_ERROR',
      });
    });

    it('成功时应返回 openid 和 unionid', async () => {
      mockFetch.mockResolvedValue(
        createFetchResponse({
          openid: 'oXXX_test_openid',
          session_key: 'super-secret-session-key',
          unionid: 'union-123',
        }),
      );

      const result = await code2Session('valid-code');

      expect(result.openid).toBe('oXXX_test_openid');
      expect(result.unionid).toBe('union-123');
    });

    it('返回结果中不应包含 session_key', async () => {
      mockFetch.mockResolvedValue(
        createFetchResponse({
          openid: 'oXXX_test_openid',
          session_key: 'super-secret-session-key',
        }),
      );

      const result = await code2Session('valid-code');

      expect(result).not.toHaveProperty('session_key');
      expect(Object.keys(result)).not.toContain('session_key');
    });

    it('appId 或 appSecret 未配置时应抛出 CONFIG_MISSING', async () => {
      // 需要临时覆盖 env mock
      const envModule = await import('../../../lib/env.js');
      const originalAppId = envModule.env['WECHAT_APP_ID'];
      (envModule.env as Record<string, unknown>)['WECHAT_APP_ID'] = '';

      await expect(code2Session('any')).rejects.toMatchObject({
        code: 'CONFIG_MISSING',
      });

      // 恢复
      (envModule.env as Record<string, unknown>)['WECHAT_APP_ID'] = originalAppId;
    });
  });

  // ─── findOrCreateByWechat ───────────────────────────

  describe('findOrCreateByWechat', () => {
    it('已有用户应更新 lastLoginAt 并返回用户信息', async () => {
      const existingUser = {
        id: 'u-existing',
        tenantId: 't1',
        phone: '13800138000',
        wechatOpenid: 'wx-openid-1',
        role: { name: 'buyer' },
      };
      mockUserFindFirst.mockResolvedValue(existingUser);
      mockUserUpdate.mockResolvedValue({ ...existingUser, lastLoginAt: new Date() });

      const result = await findOrCreateByWechat('wx-openid-1', 't1');

      expect(result.userId).toBe('u-existing');
      expect(result.isNewUser).toBe(false);
      expect(result.needsPhone).toBe(false);
      expect(result.role).toBe('buyer');
      expect(mockUserUpdate).toHaveBeenCalledWith({
        where: { id: 'u-existing' },
        data: { lastLoginAt: expect.any(Date) },
      });
    });

    it('新用户应创建用户并关联 buyer 角色', async () => {
      mockUserFindFirst.mockResolvedValue(null);
      mockRoleFindFirst.mockResolvedValue({ id: 'role-buyer', name: 'buyer' });
      mockUserCreate.mockResolvedValue({
        id: 'u-new',
        tenantId: 't1',
        wechatOpenid: 'wx-new-openid',
      });

      const result = await findOrCreateByWechat('wx-new-openid', 't1');

      expect(result.userId).toBe('u-new');
      expect(result.isNewUser).toBe(true);
      expect(result.needsPhone).toBe(true);
      expect(result.role).toBe('buyer');
      expect(mockUserCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 't1',
          wechatOpenid: 'wx-new-openid',
          roleId: 'role-buyer',
          name: '微信用户',
          status: 'active',
        }),
      });
    });

    it('新用户创建时 buyer 角色不存在应抛出 ROLE_MISSING', async () => {
      mockUserFindFirst.mockResolvedValue(null);
      mockRoleFindFirst.mockResolvedValue(null);

      await expect(findOrCreateByWechat('wx-openid', 't1')).rejects.toThrow(WechatAuthError);
      await expect(findOrCreateByWechat('wx-openid', 't1')).rejects.toMatchObject({
        code: 'ROLE_MISSING',
      });
    });

    it('已有用户未绑定手机号时 needsPhone 应为 true', async () => {
      mockUserFindFirst.mockResolvedValue({
        id: 'u-no-phone',
        tenantId: 't1',
        phone: '',
        wechatOpenid: 'wx-openid-2',
        role: { name: 'buyer' },
      });
      mockUserUpdate.mockResolvedValue({});

      const result = await findOrCreateByWechat('wx-openid-2', 't1');

      expect(result.needsPhone).toBe(true);
    });
  });

  // ─── bindPhone ──────────────────────────────────────

  describe('bindPhone', () => {
    it('正常绑定手机号应返回 merged=false', async () => {
      mockUserFindFirst.mockResolvedValue(null); // 手机号无冲突
      mockUserUpdate.mockResolvedValue({ id: 'u1', phone: '13800138000' });

      const result = await bindPhone('u1', 't1', '13800138000');

      expect(result.merged).toBe(false);
      expect(result.finalUserId).toBe('u1');
      expect(mockUserUpdate).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { phone: '13800138000' },
      });
    });

    it('手机号冲突时应合并账号（openid 转移 + 旧用户软删除）', async () => {
      // 手机号已被 u-phone-owner 使用
      mockUserFindFirst.mockResolvedValue({
        id: 'u-phone-owner',
        tenantId: 't1',
        phone: '13800138000',
      });
      // 当前用户有 openid
      mockUserFindUnique.mockResolvedValue({
        id: 'u-wechat',
        wechatOpenid: 'wx-openid-merge',
      });
      mockUserUpdate.mockResolvedValue({});

      const result = await bindPhone('u-wechat', 't1', '13800138000');

      expect(result.merged).toBe(true);
      expect(result.finalUserId).toBe('u-phone-owner');

      // 验证 openid 转移到手机号用户
      expect(mockUserUpdate).toHaveBeenCalledWith({
        where: { id: 'u-phone-owner' },
        data: {
          wechatOpenid: 'wx-openid-merge',
          lastLoginAt: expect.any(Date),
        },
      });

      // 验证临时用户被软删除
      expect(mockUserUpdate).toHaveBeenCalledWith({
        where: { id: 'u-wechat' },
        data: { deletedAt: expect.any(Date), wechatOpenid: null },
      });
    });

    it('已绑定相同手机号时应幂等处理（无冲突用户）', async () => {
      // findFirst 查找"其他用户"使用该手机号，排除了当前用户自己，所以返回 null
      mockUserFindFirst.mockResolvedValue(null);
      mockUserUpdate.mockResolvedValue({ id: 'u1', phone: '13800138000' });

      const result = await bindPhone('u1', 't1', '13800138000');

      expect(result.merged).toBe(false);
      expect(result.finalUserId).toBe('u1');
      // 即使已绑定同一手机号，update 也会执行（幂等）
      expect(mockUserUpdate).toHaveBeenCalledTimes(1);
    });
  });
});
