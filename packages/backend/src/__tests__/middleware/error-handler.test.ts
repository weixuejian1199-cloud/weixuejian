import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { ZodError, ZodIssueCode } from 'zod';

vi.mock('../../lib/env.js', () => ({
  env: { NODE_ENV: 'test' },
}));

// Mock logger
vi.mock('../../utils/logger.js', () => ({
  childLogger: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  }),
}));

import { globalErrorHandler, notFoundHandler } from '../../middleware/error-handler.js';

function createMockContext(requestId = 'test-req-id') {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const req = {
    requestId,
    method: 'GET',
    path: '/test',
  } as unknown as Request;
  const res = {
    status,
    req,
  } as unknown as Response;
  const next = vi.fn();
  return { req, res, next, status, json };
}

describe('globalErrorHandler', () => {
  it('ZodError应该返回400和字段级错误详情', () => {
    const { req, res, next, status, json } = createMockContext();
    const zodError = new ZodError([
      {
        code: ZodIssueCode.invalid_type,
        expected: 'string',
        received: 'number',
        path: ['email'],
        message: '必须是字符串',
      },
    ]);

    globalErrorHandler(zodError, req, res, next);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: [
            {
              path: 'email',
              message: '必须是字符串',
              code: 'invalid_type',
            },
          ],
        }),
      }),
    );
  });

  it('普通Error应该返回500且不暴露内部细节', () => {
    const { req, res, next, status, json } = createMockContext();
    const error = new Error('数据库连接失败 - password: secret123');

    globalErrorHandler(error, req, res, next);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'INTERNAL_ERROR',
          message: 'An internal server error occurred',
        }),
      }),
    );
    // 不应该暴露内部错误信息
    const body = json.mock.calls[0]![0] as { error: { message: string } };
    expect(body.error.message).not.toContain('secret123');
    expect(body.error.message).not.toContain('数据库连接失败');
  });

  it('未知错误类型应该返回500', () => {
    const { req, res, next, status, json } = createMockContext();

    globalErrorHandler('some string error', req, res, next);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'INTERNAL_ERROR',
        }),
      }),
    );
  });
});

describe('notFoundHandler', () => {
  it('应该返回404和路由信息', () => {
    const { req, res, next, status, json } = createMockContext();

    notFoundHandler(req, res, next);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'RESOURCE_NOT_FOUND',
          message: 'Route GET /test not found',
        }),
      }),
    );
  });
});
