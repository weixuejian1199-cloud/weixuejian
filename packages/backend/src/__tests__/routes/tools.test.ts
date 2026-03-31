import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────

const {
  mockListToolDefs,
  mockGetToolDefById,
  mockActivateTool,
  mockDeactivateTool,
  mockListActiveInstances,
  mockGetInstanceById,
} = vi.hoisted(() => ({
  mockListToolDefs: vi.fn(),
  mockGetToolDefById: vi.fn(),
  mockActivateTool: vi.fn(),
  mockDeactivateTool: vi.fn(),
  mockListActiveInstances: vi.fn(),
  mockGetInstanceById: vi.fn(),
}));

vi.mock('../../services/tool-market/tool-definition-service.js', () => ({
  listToolDefinitions: mockListToolDefs,
  getToolDefinitionById: mockGetToolDefById,
}));

vi.mock('../../services/tool-market/tool-instance-service.js', () => ({
  activateTool: mockActivateTool,
  deactivateTool: mockDeactivateTool,
  listActiveInstances: mockListActiveInstances,
  getInstanceById: mockGetInstanceById,
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import express from 'express';
import request from 'supertest';
import { toolsRouter } from '../../routes/tools/index.js';

// ─── Test App ───────────────────────────────────────────

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.tenantId = 'tenant-001';
    req.user = { userId: 'user-001', tenantId: 'tenant-001', role: 'admin' };
    next();
  });
  app.use('/tools', toolsRouter);
  return app;
}

// ─── Constants ──────────────────────────────────────────

const TOOL_DEF = {
  id: 'def-001',
  tenantId: 'tenant-001',
  name: 'getSalesStats',
  displayName: '销售统计查询',
  category: 'analytics',
  version: '1.0.0',
  isBuiltin: true,
};

const TOOL_INSTANCE = {
  id: 'inst-001',
  tenantId: 'tenant-001',
  toolDefinitionId: 'def-001',
  status: 'active',
  toolDefinition: TOOL_DEF,
};

// ─── Tests ──────────────────────────────────────────────

beforeEach(() => vi.clearAllMocks());

describe('GET /tools', () => {
  it('should return paginated tool definitions', async () => {
    mockListToolDefs.mockResolvedValue({ items: [TOOL_DEF], total: 1, page: 1, pageSize: 20 });
    const app = createApp();

    const res = await request(app).get('/tools');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.total).toBe(1);
  });

  it('should filter by category', async () => {
    mockListToolDefs.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    const app = createApp();

    await request(app).get('/tools?category=finance');

    expect(mockListToolDefs).toHaveBeenCalledWith('tenant-001', expect.objectContaining({ category: 'finance' }));
  });

  it('should reject invalid category', async () => {
    const app = createApp();

    const res = await request(app).get('/tools?category=invalid');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /tools/:id', () => {
  it('should return tool definition by id', async () => {
    mockGetToolDefById.mockResolvedValue(TOOL_DEF);
    const app = createApp();

    const res = await request(app).get('/tools/def-001');

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('getSalesStats');
  });

  it('should return 404 for non-existent tool', async () => {
    mockGetToolDefById.mockResolvedValue(null);
    const app = createApp();

    const res = await request(app).get('/tools/nonexistent');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TOOL_NOT_FOUND');
  });
});

describe('POST /tools/:id/activate', () => {
  it('should activate tool and return instance', async () => {
    mockActivateTool.mockResolvedValue(TOOL_INSTANCE);
    const app = createApp();

    const res = await request(app).post('/tools/def-001/activate').send({});

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('active');
  });

  it('should return 404 when tool definition not found', async () => {
    mockActivateTool.mockResolvedValue(null);
    const app = createApp();

    const res = await request(app).post('/tools/nonexistent/activate').send({});

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TOOL_NOT_FOUND');
  });
});

describe('POST /tools/:id/deactivate', () => {
  it('should deactivate tool', async () => {
    mockDeactivateTool.mockResolvedValue(true);
    const app = createApp();

    const res = await request(app).post('/tools/def-001/deactivate');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /tools/instances', () => {
  it('should return active instances', async () => {
    mockListActiveInstances.mockResolvedValue([TOOL_INSTANCE]);
    const app = createApp();

    const res = await request(app).get('/tools/instances');

    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.total).toBe(1);
  });
});

describe('GET /tools/instances/:id', () => {
  it('should return instance by id', async () => {
    mockGetInstanceById.mockResolvedValue(TOOL_INSTANCE);
    const app = createApp();

    const res = await request(app).get('/tools/instances/inst-001');

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe('inst-001');
  });

  it('should return 404 for non-existent instance', async () => {
    mockGetInstanceById.mockResolvedValue(null);
    const app = createApp();

    const res = await request(app).get('/tools/instances/nonexistent');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TOOL_INSTANCE_NOT_FOUND');
  });
});
