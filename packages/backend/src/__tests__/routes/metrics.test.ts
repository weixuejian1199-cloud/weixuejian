import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma + redis
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}));

vi.mock('../../lib/redis.js', () => ({
  redis: {
    ping: vi.fn(),
  },
}));

import { recordHttpRequest, recordRateLimitRejection, recordAiRequest, recordAiTokens, recordAiQuotaBlocked, recordAiModelDowngrade } from '../../routes/metrics.js';

describe('metrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('recordHttpRequest', () => {
    it('应该正常记录请求（不抛异常）', () => {
      expect(() => recordHttpRequest(200, 50)).not.toThrow();
    });

    it('应该能记录5xx错误请求', () => {
      expect(() => recordHttpRequest(500, 100)).not.toThrow();
    });

    it('应该能记录多次调用', () => {
      for (let i = 0; i < 10; i++) {
        expect(() => recordHttpRequest(200, i * 10)).not.toThrow();
      }
    });
  });

  describe('recordRateLimitRejection', () => {
    it('应该正常记录限流拒绝', () => {
      expect(() => recordRateLimitRejection()).not.toThrow();
    });
  });

  describe('recordAiRequest', () => {
    it('应该记录成功的AI请求', () => {
      expect(() => recordAiRequest(true)).not.toThrow();
    });

    it('应该记录失败的AI请求', () => {
      expect(() => recordAiRequest(false)).not.toThrow();
    });
  });

  // BL-022 成本指标
  describe('recordAiTokens', () => {
    it('应该记录token消耗和成本', () => {
      expect(() => recordAiTokens(1500, 0.0018)).not.toThrow();
    });

    it('应该累积多次调用', () => {
      expect(() => {
        recordAiTokens(1000, 0.001);
        recordAiTokens(2000, 0.002);
      }).not.toThrow();
    });
  });

  describe('recordAiQuotaBlocked', () => {
    it('应该记录配额拦截', () => {
      expect(() => recordAiQuotaBlocked()).not.toThrow();
    });
  });

  describe('recordAiModelDowngrade', () => {
    it('应该记录模型降级', () => {
      expect(() => recordAiModelDowngrade()).not.toThrow();
    });
  });
});
