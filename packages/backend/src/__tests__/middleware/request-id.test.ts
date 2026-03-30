import { describe, it, expect, vi } from 'vitest';
import { requestIdMiddleware } from '../../middleware/request-id.js';

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mocked-uuid-1234'),
}));

function createMockReqRes() {
  const req = {} as Record<string, unknown>;
  const headers: Record<string, string> = {};
  const res = {
    setHeader: vi.fn((key: string, val: string) => {
      headers[key] = val;
    }),
  };
  const next = vi.fn();
  return {
    req: req as unknown as import('express').Request,
    res: res as unknown as import('express').Response,
    next,
    headers,
  };
}

describe('requestIdMiddleware', () => {
  it('应该为每个请求生成唯一的UUID', () => {
    const { req, res, next } = createMockReqRes();
    requestIdMiddleware(req, res, next);

    expect(req.requestId).toBe('mocked-uuid-1234');
  });

  it('应该设置X-Request-ID响应头', () => {
    const { req, res, next } = createMockReqRes();
    requestIdMiddleware(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', 'mocked-uuid-1234');
  });

  it('应该注入req.requestId并调用next', () => {
    const { req, res, next } = createMockReqRes();
    requestIdMiddleware(req, res, next);

    expect(req.requestId).toBeDefined();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
