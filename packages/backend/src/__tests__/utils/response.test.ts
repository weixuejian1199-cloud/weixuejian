import { describe, it, expect, vi } from 'vitest';
import type { Response } from 'express';
import { sendSuccess, sendError } from '../../utils/response.js';

function createMockRes(requestId = 'test-req-id') {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const res = {
    status,
    req: { requestId },
  } as unknown as Response;
  return { res, status, json };
}

describe('sendSuccess', () => {
  it('应该返回正确的成功响应格式', () => {
    const { res, status, json } = createMockRes();
    sendSuccess(res, { name: 'test' });

    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({
      success: true,
      data: { name: 'test' },
      requestId: 'test-req-id',
    });
  });

  it('应该支持meta参数', () => {
    const { res, json } = createMockRes();
    sendSuccess(res, { id: 1 }, { total: 100, page: 1 });

    expect(json).toHaveBeenCalledWith({
      success: true,
      data: { id: 1 },
      meta: { total: 100, page: 1 },
      requestId: 'test-req-id',
    });
  });

  it('应该支持自定义HTTP状态码', () => {
    const { res, status } = createMockRes();
    sendSuccess(res, null, undefined, 201);

    expect(status).toHaveBeenCalledWith(201);
  });

  it('当requestId不存在时应该使用unknown', () => {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const res = {
      status,
      req: {},
    } as unknown as Response;

    sendSuccess(res, {});
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'unknown' }));
  });
});

describe('sendError', () => {
  it('应该返回正确的错误响应格式', () => {
    const { res, status, json } = createMockRes();
    sendError(res, 'RESOURCE_NOT_FOUND', '资源不存在', 404);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'RESOURCE_NOT_FOUND', message: '资源不存在' },
      requestId: 'test-req-id',
    });
  });

  it('应该使用默认500状态码', () => {
    const { res, status } = createMockRes();
    sendError(res, 'INTERNAL_ERROR', '服务器错误');

    expect(status).toHaveBeenCalledWith(500);
  });

  it('应该支持details字段', () => {
    const { res, json } = createMockRes();
    const details = [{ field: 'email', message: '格式错误' }];
    sendError(res, 'VALIDATION_ERROR', '验证失败', 400, details);

    expect(json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: '验证失败',
        details,
      },
      requestId: 'test-req-id',
    });
  });

  it('应该正确处理401未授权', () => {
    const { res, status } = createMockRes();
    sendError(res, 'AUTH_INVALID_TOKEN', '未授权', 401);

    expect(status).toHaveBeenCalledWith(401);
  });
});
