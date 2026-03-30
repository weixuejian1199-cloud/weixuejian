import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// Use vi.hoisted to create mocks that can be referenced in vi.mock factories
const { mockQueryRaw, mockPing } = vi.hoisted(() => ({
  mockQueryRaw: vi.fn(),
  mockPing: vi.fn(),
}));

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    $queryRaw: mockQueryRaw,
  },
}));

vi.mock('../../lib/redis.js', () => ({
  redis: {
    ping: mockPing,
    on: vi.fn(),
  },
}));

vi.mock('../../utils/logger.js', () => ({
  childLogger: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(() => JSON.stringify({ version: '0.1.0' })),
}));

// Import after mocks
import { basicHealthRouter, detailHealthRouter } from '../../routes/health.js';
import express, { type Router } from 'express';

function createTestApp(router: Router, path = '/') {
  const app = express();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.requestId = 'test-req-id';
    next();
  });
  app.use(path, router);
  return app;
}

// Lightweight request simulation using Express app.handle
async function makeRequest(
  app: ReturnType<typeof express>,
  path: string,
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  return new Promise((resolve) => {
    const req = {
      method: 'GET',
      url: path,
      path,
      headers: {},
      requestId: 'test-req-id',
      get: vi.fn(),
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as Request;

    let statusCode = 200;
    const res = {
      status: vi.fn((code: number) => {
        statusCode = code;
        return res;
      }),
      json: vi.fn((body: Record<string, unknown>) => {
        resolve({ statusCode, body });
      }),
      setHeader: vi.fn(),
      getHeader: vi.fn(),
      req,
    } as unknown as Response;

    const next = vi.fn();
    (app as unknown as { handle: (req: Request, res: Response, next: NextFunction) => void }).handle(req, res, next);
  });
}

describe('GET /health (基本健康检查)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('所有组件正常时应该返回healthy', async () => {
    mockQueryRaw.mockResolvedValue([{ '?column?': 1 }]);
    mockPing.mockResolvedValue('PONG');

    const app = createTestApp(basicHealthRouter);
    const { statusCode, body } = await makeRequest(app, '/');

    expect(statusCode).toBe(200);
    expect(body['success']).toBe(true);
    const data = body['data'] as { status: string; components: Record<string, unknown> };
    expect(data.status).toBe('healthy');
    expect(data.components).toHaveProperty('postgresql');
    expect(data.components).toHaveProperty('redis');
  });

  it('数据库不可用时应该返回degraded', async () => {
    mockQueryRaw.mockRejectedValue(new Error('Connection refused'));
    mockPing.mockResolvedValue('PONG');

    const app = createTestApp(basicHealthRouter);
    const { statusCode, body } = await makeRequest(app, '/');

    expect(statusCode).toBe(200);
    const data = body['data'] as { status: string; components: Record<string, { status: string }> };
    expect(data.status).toBe('degraded');
    expect(data.components['postgresql']?.status).toBe('error');
    expect(data.components['redis']?.status).toBe('ok');
  });

  it('Redis不可用时应该返回degraded', async () => {
    mockQueryRaw.mockResolvedValue([{ '?column?': 1 }]);
    mockPing.mockRejectedValue(new Error('Redis timeout'));

    const app = createTestApp(basicHealthRouter);
    const { statusCode, body } = await makeRequest(app, '/');

    expect(statusCode).toBe(200);
    const data = body['data'] as { status: string; components: Record<string, { status: string }> };
    expect(data.status).toBe('degraded');
    expect(data.components['postgresql']?.status).toBe('ok');
    expect(data.components['redis']?.status).toBe('error');
  });
});

describe('GET /api/v1/health (详细健康检查)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('应该返回版本信息和运行时间', async () => {
    mockQueryRaw.mockResolvedValue([{ '?column?': 1 }]);
    mockPing.mockResolvedValue('PONG');

    const app = createTestApp(detailHealthRouter);
    const { statusCode, body } = await makeRequest(app, '/');

    expect(statusCode).toBe(200);
    expect(body['success']).toBe(true);
    const data = body['data'] as {
      version: string;
      uptime: number;
      environment: string;
      status: string;
    };
    expect(data.version).toBeDefined();
    expect(data.uptime).toBeTypeOf('number');
    expect(data.environment).toBeDefined();
    expect(data.status).toBe('healthy');
  });
});
