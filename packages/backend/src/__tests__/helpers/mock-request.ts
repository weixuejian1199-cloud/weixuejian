/**
 * 共享测试工具 — Mock Request/Response 构造器
 */
import type { Request, Response, NextFunction } from 'express';

export interface MockRequestOptions {
  requestId?: string;
  tenantId?: string;
  userId?: string;
  role?: string;
  headers?: Record<string, string>;
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
  ip?: string;
}

export function createMockRequest(opts: MockRequestOptions = {}): Request {
  return {
    requestId: opts.requestId ?? 'test-req-id',
    tenantId: opts.tenantId,
    userId: opts.userId,
    role: opts.role,
    headers: opts.headers ?? {},
    params: opts.params ?? {},
    query: opts.query ?? {},
    body: opts.body ?? {},
    ip: opts.ip ?? '127.0.0.1',
    path: '/test',
    method: 'GET',
  } as unknown as Request;
}

export function createMockResponse(): Response & {
  _status: number;
  _json: unknown;
  _headers: Record<string, string>;
} {
  const res = {
    _status: 200,
    _json: null as unknown,
    _headers: {} as Record<string, string>,
    status(code: number) {
      res._status = code;
      return res;
    },
    json(data: unknown) {
      res._json = data;
      return res;
    },
    setHeader(name: string, value: string) {
      res._headers[name] = value;
      return res;
    },
    end() {
      return res;
    },
  };
  return res as unknown as Response & typeof res;
}

export function createMockNext(): NextFunction & { calls: unknown[] } {
  const calls: unknown[] = [];
  const next = ((err?: unknown) => {
    calls.push(err ?? 'called');
  }) as NextFunction & { calls: unknown[] };
  next.calls = calls;
  return next;
}
