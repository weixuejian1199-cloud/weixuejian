import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────

const {
  mockDefFindFirst,
  mockInstFindUnique,
  mockInstCreate,
  mockInstUpdate,
  mockInstFindMany,
  mockInstFindFirst,
} = vi.hoisted(() => ({
  mockDefFindFirst: vi.fn(),
  mockInstFindUnique: vi.fn(),
  mockInstCreate: vi.fn(),
  mockInstUpdate: vi.fn(),
  mockInstFindMany: vi.fn(),
  mockInstFindFirst: vi.fn(),
}));

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    toolDefinition: {
      findFirst: mockDefFindFirst,
    },
    toolInstance: {
      findUnique: mockInstFindUnique,
      create: mockInstCreate,
      update: mockInstUpdate,
      findMany: mockInstFindMany,
      findFirst: mockInstFindFirst,
    },
  },
}));

import {
  activateTool,
  deactivateTool,
  listActiveInstances,
  getInstanceById,
} from '../../../services/tool-market/tool-instance-service.js';

// ─── Constants ──────────────────────────────────────────

const TENANT = 'tenant-001';
const DEF_ID = 'def-001';

const TOOL_DEF = {
  id: DEF_ID,
  tenantId: TENANT,
  name: 'getSalesStats',
  displayName: '销售统计查询',
  category: 'analytics',
  deletedAt: null,
};

const ACTIVE_INSTANCE = {
  id: 'inst-001',
  tenantId: TENANT,
  toolDefinitionId: DEF_ID,
  config: null,
  status: 'active',
  deletedAt: null,
  toolDefinition: TOOL_DEF,
};

// ─── Tests ──────────────────────────────────────────────

beforeEach(() => vi.clearAllMocks());

describe('activateTool', () => {
  it('should return null when tool definition not found', async () => {
    mockDefFindFirst.mockResolvedValue(null);

    const result = await activateTool(TENANT, DEF_ID);

    expect(result).toBeNull();
  });

  it('should return existing instance when already active (idempotent)', async () => {
    mockDefFindFirst.mockResolvedValue(TOOL_DEF);
    mockInstFindUnique.mockResolvedValue(ACTIVE_INSTANCE);

    const result = await activateTool(TENANT, DEF_ID);

    expect(result).toEqual(ACTIVE_INSTANCE);
    expect(mockInstCreate).not.toHaveBeenCalled();
    expect(mockInstUpdate).not.toHaveBeenCalled();
  });

  it('should reactivate a deactivated instance', async () => {
    const inactive = { ...ACTIVE_INSTANCE, status: 'inactive', deletedAt: new Date() };
    mockDefFindFirst.mockResolvedValue(TOOL_DEF);
    mockInstFindUnique.mockResolvedValue(inactive);
    mockInstUpdate.mockResolvedValue({ ...ACTIVE_INSTANCE });

    const result = await activateTool(TENANT, DEF_ID);

    expect(result!.status).toBe('active');
    expect(mockInstUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: inactive.id },
        data: expect.objectContaining({ status: 'active', deletedAt: null }),
      }),
    );
  });

  it('should create new instance when none exists', async () => {
    mockDefFindFirst.mockResolvedValue(TOOL_DEF);
    mockInstFindUnique.mockResolvedValue(null);
    mockInstCreate.mockResolvedValue(ACTIVE_INSTANCE);

    const result = await activateTool(TENANT, DEF_ID);

    expect(result).toEqual(ACTIVE_INSTANCE);
    expect(mockInstCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: TENANT,
          toolDefinitionId: DEF_ID,
          status: 'active',
        }),
      }),
    );
  });
});

describe('deactivateTool', () => {
  it('should return true when instance not found (idempotent)', async () => {
    mockInstFindUnique.mockResolvedValue(null);

    const result = await deactivateTool(TENANT, DEF_ID);

    expect(result).toBe(true);
  });

  it('should return true when already inactive (idempotent)', async () => {
    mockInstFindUnique.mockResolvedValue({ ...ACTIVE_INSTANCE, status: 'inactive' });

    const result = await deactivateTool(TENANT, DEF_ID);

    expect(result).toBe(true);
    expect(mockInstUpdate).not.toHaveBeenCalled();
  });

  it('should deactivate an active instance', async () => {
    mockInstFindUnique.mockResolvedValue(ACTIVE_INSTANCE);
    mockInstUpdate.mockResolvedValue({});

    const result = await deactivateTool(TENANT, DEF_ID);

    expect(result).toBe(true);
    expect(mockInstUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ACTIVE_INSTANCE.id },
        data: expect.objectContaining({ status: 'inactive' }),
      }),
    );
  });
});

describe('listActiveInstances', () => {
  it('should return only active instances with non-deleted definitions', async () => {
    mockInstFindMany.mockResolvedValue([ACTIVE_INSTANCE]);

    const result = await listActiveInstances(TENANT);

    expect(result).toHaveLength(1);
    expect(mockInstFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: TENANT,
          status: 'active',
          deletedAt: null,
          toolDefinition: { deletedAt: null },
        },
        include: { toolDefinition: true },
      }),
    );
  });
});

describe('getInstanceById', () => {
  it('should return instance for matching tenant', async () => {
    mockInstFindFirst.mockResolvedValue(ACTIVE_INSTANCE);

    const result = await getInstanceById('inst-001', TENANT);

    expect(result).toEqual(ACTIVE_INSTANCE);
    expect(mockInstFindFirst).toHaveBeenCalledWith({
      where: { id: 'inst-001', tenantId: TENANT, deletedAt: null },
      include: { toolDefinition: true },
    });
  });

  it('should return null for wrong tenant', async () => {
    mockInstFindFirst.mockResolvedValue(null);

    const result = await getInstanceById('inst-001', 'other-tenant');

    expect(result).toBeNull();
  });
});
