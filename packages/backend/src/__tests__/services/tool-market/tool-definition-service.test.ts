import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────

const {
  mockFindMany,
  mockCount,
  mockFindFirst,
  mockUpsert,
} = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockCount: vi.fn(),
  mockFindFirst: vi.fn(),
  mockUpsert: vi.fn(),
}));

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    toolDefinition: {
      findMany: mockFindMany,
      count: mockCount,
      findFirst: mockFindFirst,
      upsert: mockUpsert,
    },
  },
}));

// Mock builtin-tools to avoid importing tool-registry → mall-adapter → env.ts
vi.mock('../../../services/tool-market/builtin-tools.js', () => ({
  BUILTIN_TOOL_SEEDS: Array.from({ length: 9 }, (_, i) => ({
    name: `tool${i}`,
    displayName: `Tool ${i}`,
    description: `Description ${i}`,
    category: 'analytics',
    version: '1.0.0',
    parameters: { type: 'object', properties: {} },
    permissions: ['data:read'],
  })),
  // Override first tool name for specific test assertions
  get default() { return undefined; },
}));

// Patch first seed to match test expectations
import { BUILTIN_TOOL_SEEDS } from '../../../services/tool-market/builtin-tools.js';
(BUILTIN_TOOL_SEEDS as Array<{ name: string }>)[0]!.name = 'getSalesStats';

import {
  listToolDefinitions,
  getToolDefinitionById,
  getToolDefinitionByName,
  seedBuiltinTools,
} from '../../../services/tool-market/tool-definition-service.js';

// ─── Constants ──────────────────────────────────────────

const TENANT = 'tenant-001';

const TOOL_DEF = {
  id: 'td-001',
  tenantId: TENANT,
  name: 'getSalesStats',
  displayName: '销售统计查询',
  description: '查询销售统计',
  category: 'analytics',
  version: '1.0.0',
  configSchema: null,
  permissions: ['data:read'],
  modelConfig: null,
  isBuiltin: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

// ─── Tests ──────────────────────────────────────────────

beforeEach(() => vi.clearAllMocks());

describe('listToolDefinitions', () => {
  it('should return paginated results filtered by tenantId', async () => {
    mockFindMany.mockResolvedValue([TOOL_DEF]);
    mockCount.mockResolvedValue(1);

    const result = await listToolDefinitions(TENANT);

    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: TENANT, deletedAt: null },
        skip: 0,
        take: 20,
      }),
    );
  });

  it('should filter by category when provided', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    await listToolDefinitions(TENANT, { category: 'finance', page: 2, pageSize: 5 });

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: TENANT, deletedAt: null, category: 'finance' },
        skip: 5,
        take: 5,
      }),
    );
  });
});

describe('getToolDefinitionById', () => {
  it('should return tool definition for matching tenantId', async () => {
    mockFindFirst.mockResolvedValue(TOOL_DEF);

    const result = await getToolDefinitionById('td-001', TENANT);

    expect(result).toEqual(TOOL_DEF);
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { id: 'td-001', tenantId: TENANT, deletedAt: null },
    });
  });

  it('should return null for wrong tenantId', async () => {
    mockFindFirst.mockResolvedValue(null);

    const result = await getToolDefinitionById('td-001', 'other-tenant');

    expect(result).toBeNull();
  });
});

describe('getToolDefinitionByName', () => {
  it('should find by name + version + tenantId', async () => {
    mockFindFirst.mockResolvedValue(TOOL_DEF);

    const result = await getToolDefinitionByName('getSalesStats', '1.0.0', TENANT);

    expect(result).toEqual(TOOL_DEF);
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { tenantId: TENANT, name: 'getSalesStats', version: '1.0.0', deletedAt: null },
    });
  });
});

describe('seedBuiltinTools', () => {
  it('should upsert all 9 built-in tools', async () => {
    mockUpsert.mockResolvedValue(TOOL_DEF);

    const results = await seedBuiltinTools(TENANT);

    expect(results).toHaveLength(9);
    expect(mockUpsert).toHaveBeenCalledTimes(9);
  });

  it('should be idempotent (upsert with correct where clause)', async () => {
    mockUpsert.mockResolvedValue(TOOL_DEF);

    await seedBuiltinTools(TENANT);

    // 验证第一个调用使用正确的 unique key
    const firstCall = mockUpsert.mock.calls[0]![0];
    expect(firstCall.where.tenantId_name_version).toEqual({
      tenantId: TENANT,
      name: 'getSalesStats',
      version: '1.0.0',
    });
    expect(firstCall.create.isBuiltin).toBe(true);
    expect(firstCall.update.isBuiltin).toBe(true);
  });
});
