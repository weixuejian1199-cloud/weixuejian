import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// ─── Mocks ──────────────────────────────────────────────

const {
  mockCode2Session,
  mockFindOrCreateByWechat,
  mockBindPhone,
  mockIssueTokenPair,
  mockRotateTokenPair,
  mockRevokeTokens,
  mockPrismaTenantFindUnique,
  mockPrismaUserFindUnique,
  mockPrismaAuditLogCreate,
  mockRequireAuth,
  mockRateLimit,
} = vi.hoisted(() => ({
  mockCode2Session: vi.fn(),
  mockFindOrCreateByWechat: vi.fn(),
  mockBindPhone: vi.fn(),
  mockIssueTokenPair: vi.fn(),
  mockRotateTokenPair: vi.fn(),
  mockRevokeTokens: vi.fn(),
  mockPrismaTenantFindUnique: vi.fn(),
  mockPrismaUserFindUnique: vi.fn(),
  mockPrismaAuditLogCreate: vi.fn(),
  mockRequireAuth: vi.fn(),
  mockRateLimit: vi.fn(),
}));

vi.mock('../../services/auth/wechat-auth.js', () => ({
  code2Session: mockCode2Session,
  findOrCreateByWechat: mockFindOrCreateByWechat,
  bindPhone: mockBindPhone,
  WechatAuthError: class WechatAuthError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = 'WechatAuthError';
    }
  },
}));

vi.mock('../../services/auth/jwt-service.js', () => ({
  issueTokenPair: mockIssueTokenPair,
  rotateTokenPair: mockRotateTokenPair,
  revokeTokens: mockRevokeTokens,
  TokenRotationError: class TokenRotationError extends Error {
    code: string;
    constructor(code: string) {
      super(code === 'INVALID_REFRESH_TOKEN' ? '刷新令牌无效' : '用户已停用');
      this.code = code;
      this.name = 'TokenRotationError';
    }
  },
}));

vi.mock('../../middleware/auth.js', () => ({
  requireAuth: (req: Request, _res: Response, next: () => void) => {
    mockRequireAuth(req);
    req.user = { userId: 'u1', tenantId: 't1', role: 'admin' };
    next();
  },
}));

vi.mock('../../middleware/rate-limit.js', () => ({
  createRateLimit: () => (_req: Request, _res: Response, next: () => void) => {
    mockRateLimit();
    next();
  },
}));

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    tenant: { findUnique: mockPrismaTenantFindUnique },
    user: { findUnique: mockPrismaUserFindUnique },
    auditLog: { create: mockPrismaAuditLogCreate },
  },
}));

vi.mock('../../utils/logger.js', () => ({
  childLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ─── Import after mocks ────────────────────────────────

import express from 'express';
import request from 'supertest';
import { authRouter } from '../../routes/auth/index.js';

function createApp() {
  const app = express();
  app.use(express.json());
  // Inject requestId for tests
  app.use((req, _res, next) => {
    req.requestId = 'test-req';
    next();
  });
  app.use('/auth', authRouter);
  return app;
}

// ─── Tests ──────────────────────────────────────────────

describe('Auth Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrismaAuditLogCreate.mockResolvedValue({ id: 1n });
  });

  describe('POST /auth/wechat-login', () => {
    it('有效code应该返回token pair', async () => {
      const tid = '00000000-0000-0000-0000-000000000001';
      mockPrismaTenantFindUnique.mockResolvedValue({ id: tid, status: 'active' });
      mockCode2Session.mockResolvedValue({ openid: 'wx-openid-1' });
      mockFindOrCreateByWechat.mockResolvedValue({
        userId: 'u1',
        tenantId: tid,
        role: 'buyer',
        isNewUser: false,
        needsPhone: false,
      });
      mockIssueTokenPair.mockResolvedValue({
        accessToken: 'at-1',
        refreshToken: 'rt-1',
        expiresIn: 900,
      });

      const app = createApp();
      const res = await request(app)
        .post('/auth/wechat-login')
        .send({ code: 'wx-code', tenantId: '00000000-0000-0000-0000-000000000001' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.accessToken).toBe('at-1');
      expect(res.body.data.refreshToken).toBe('rt-1');
      expect(res.body.data.userId).toBe('u1');
      expect(res.body.data.needsPhone).toBe(false);
    });

    it('缺少code应该返回400', async () => {
      const app = createApp();
      const res = await request(app).post('/auth/wechat-login').send({ tenantId: 't1' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('无效tenantId应该返回403', async () => {
      mockPrismaTenantFindUnique.mockResolvedValue(null);

      const app = createApp();
      const res = await request(app)
        .post('/auth/wechat-login')
        .send({ code: 'wx-code', tenantId: '00000000-0000-0000-0000-000000000000' });

      expect(res.status).toBe(403);
    });

    it('新用户应该标记isNewUser+needsPhone', async () => {
      const tid = '00000000-0000-0000-0000-000000000001';
      mockPrismaTenantFindUnique.mockResolvedValue({ id: tid, status: 'active' });
      mockCode2Session.mockResolvedValue({ openid: 'wx-new' });
      mockFindOrCreateByWechat.mockResolvedValue({
        userId: 'u-new',
        tenantId: tid,
        role: 'buyer',
        isNewUser: true,
        needsPhone: true,
      });
      mockIssueTokenPair.mockResolvedValue({
        accessToken: 'at-new',
        refreshToken: 'rt-new',
        expiresIn: 900,
      });

      const app = createApp();
      const res = await request(app)
        .post('/auth/wechat-login')
        .send({ code: 'wx-code-new', tenantId: tid });

      expect(res.body.data.isNewUser).toBe(true);
      expect(res.body.data.needsPhone).toBe(true);
    });
  });

  describe('POST /auth/refresh', () => {
    it('有效refreshToken应该返回新token pair', async () => {
      mockRotateTokenPair.mockResolvedValue({
        accessToken: 'at-2',
        refreshToken: 'rt-2',
        expiresIn: 900,
      });

      const app = createApp();
      const res = await request(app).post('/auth/refresh').send({ refreshToken: 'rt-old' });

      expect(res.status).toBe(200);
      expect(res.body.data.accessToken).toBe('at-2');
      expect(res.body.data.refreshToken).toBe('rt-2');
    });

    it('无效refreshToken应该返回401', async () => {
      const { TokenRotationError } = await import('../../services/auth/jwt-service.js');
      mockRotateTokenPair.mockRejectedValue(new TokenRotationError('INVALID_REFRESH_TOKEN'));

      const app = createApp();
      const res = await request(app).post('/auth/refresh').send({ refreshToken: 'rt-invalid' });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_REFRESH_INVALID');
    });

    it('缺少refreshToken应该返回400', async () => {
      const app = createApp();
      const res = await request(app).post('/auth/refresh').send({});

      expect(res.status).toBe(400);
    });
  });

  describe('POST /auth/logout', () => {
    it('有效token应该成功登出', async () => {
      mockRevokeTokens.mockResolvedValue(undefined);

      const app = createApp();
      const res = await request(app)
        .post('/auth/logout')
        .set('Authorization', 'Bearer test-access-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockRevokeTokens).toHaveBeenCalledWith('test-access-token', 'u1');
    });
  });

  describe('POST /auth/bind-phone', () => {
    it('有效手机号应该绑定成功', async () => {
      mockBindPhone.mockResolvedValue({ merged: false, finalUserId: 'u1' });

      const app = createApp();
      const res = await request(app)
        .post('/auth/bind-phone')
        .set('Authorization', 'Bearer test-token')
        .send({ phone: '13800138000' });

      expect(res.status).toBe(200);
      expect(res.body.data.merged).toBe(false);
    });

    it('无效手机号格式应该返回400', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/auth/bind-phone')
        .set('Authorization', 'Bearer test-token')
        .send({ phone: '1234' });

      expect(res.status).toBe(400);
    });

    it('账号合并应该返回新token', async () => {
      mockBindPhone.mockResolvedValue({ merged: true, finalUserId: 'u-merged' });
      mockPrismaUserFindUnique.mockResolvedValue({
        id: 'u-merged',
        tenantId: 't1',
        role: { name: 'buyer' },
      });
      mockIssueTokenPair.mockResolvedValue({
        accessToken: 'at-merged',
        refreshToken: 'rt-merged',
        expiresIn: 900,
      });

      const app = createApp();
      const res = await request(app)
        .post('/auth/bind-phone')
        .set('Authorization', 'Bearer test-token')
        .send({ phone: '13800138001' });

      expect(res.status).toBe(200);
      expect(res.body.data.merged).toBe(true);
      expect(res.body.data.accessToken).toBe('at-merged');
    });
  });
});
