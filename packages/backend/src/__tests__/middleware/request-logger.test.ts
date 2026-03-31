import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// Mock dependencies
vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../routes/metrics.js', () => ({
  recordHttpRequest: vi.fn(),
}));

import { requestLogger } from '../../middleware/request-logger.js';
import { logger } from '../../utils/logger.js';
import { recordHttpRequest } from '../../routes/metrics.js';

type FinishHandler = () => void;

function createMockReqRes(overrides?: {
  path?: string;
  method?: string;
  body?: unknown;
  user?: { userId: string; tenantId: string };
  tenantId?: string;
  requestId?: string;
}) {
  let finishHandler: FinishHandler | undefined;
  const req = {
    method: overrides?.method ?? 'GET',
    path: overrides?.path ?? '/api/v1/health',
    ip: '127.0.0.1',
    requestId: overrides?.requestId ?? 'req-001',
    body: overrides?.body,
    user: overrides?.user,
    tenantId: overrides?.tenantId,
  } as unknown as Request;

  const res = {
    statusCode: 200,
    on: vi.fn((event: string, handler: FinishHandler) => {
      if (event === 'finish') finishHandler = handler;
    }),
  } as unknown as Response;

  const next = vi.fn() as NextFunction;

  return {
    req,
    res,
    next,
    triggerFinish(statusCode = 200) {
      (res as { statusCode: number }).statusCode = statusCode;
      finishHandler?.();
    },
  };
}

describe('requestLogger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('应该调用next()不阻塞请求', () => {
    const { req, res, next } = createMockReqRes();
    requestLogger(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('应该在finish事件时记录请求日志', () => {
    const { req, res, next, triggerFinish } = createMockReqRes();
    requestLogger(req, res, next);
    triggerFinish(200);

    expect(recordHttpRequest).toHaveBeenCalledWith(200, expect.any(Number));
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/api/v1/health',
        status: 200,
        ip: '127.0.0.1',
        requestId: 'req-001',
      }),
      'Request completed',
    );
  });

  it('5xx状态码应该用error级别', () => {
    const { req, res, next, triggerFinish } = createMockReqRes();
    requestLogger(req, res, next);
    triggerFinish(500);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ status: 500 }),
      'Request completed with server error',
    );
  });

  it('4xx状态码应该用warn级别', () => {
    const { req, res, next, triggerFinish } = createMockReqRes();
    requestLogger(req, res, next);
    triggerFinish(404);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ status: 404 }),
      'Request completed with client error',
    );
  });

  it('应该在日志中包含已认证用户信息', () => {
    const { req, res, next, triggerFinish } = createMockReqRes({
      user: { userId: 'u-1', tenantId: 't-1' },
    });
    requestLogger(req, res, next);
    triggerFinish(200);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u-1', tenantId: 't-1' }),
      expect.any(String),
    );
  });

  it('应该在日志中包含tenantId（中间件注入）', () => {
    const { req, res, next, triggerFinish } = createMockReqRes({
      tenantId: 't-2',
    });
    requestLogger(req, res, next);
    triggerFinish(200);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't-2' }),
      expect.any(String),
    );
  });

  it('敏感路径（/api/v1/auth）不应记录请求体', () => {
    const { req, res, next, triggerFinish } = createMockReqRes({
      path: '/api/v1/auth/wechat-login',
      method: 'POST',
      body: { code: 'secret-code' },
    });
    requestLogger(req, res, next);
    triggerFinish(200);

    const logData = vi.mocked(logger.info).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(logData['body']).toBeUndefined();
  });

  it('非敏感路径应记录请求体', () => {
    const { req, res, next, triggerFinish } = createMockReqRes({
      path: '/api/v1/chat',
      method: 'POST',
      body: { message: 'hello' },
    });
    requestLogger(req, res, next);
    triggerFinish(200);

    const logData = vi.mocked(logger.info).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(logData['body']).toEqual({ message: 'hello' });
  });

  it('空body不应记录', () => {
    const { req, res, next, triggerFinish } = createMockReqRes({
      path: '/api/v1/chat',
      method: 'POST',
      body: {},
    });
    requestLogger(req, res, next);
    triggerFinish(200);

    const logData = vi.mocked(logger.info).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(logData['body']).toBeUndefined();
  });
});
