import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────

const { mockListActiveInstances, mockExecuteTool } = vi.hoisted(() => ({
  mockListActiveInstances: vi.fn(),
  mockExecuteTool: vi.fn(),
}));

vi.mock('../../../services/tool-market/tool-instance-service.js', () => ({
  listActiveInstances: mockListActiveInstances,
}));

vi.mock('../../../services/tool-market/builtin-tools.js', () => ({
  BUILTIN_TOOL_HANDLERS: {
    getSalesStats: vi.fn(),
    getOrders: vi.fn(),
    getSupplierWithdraws: vi.fn(),
  },
  TOOL_META_CATEGORIES: {
    getSalesStats: 'analytics',
    getOrders: 'operation',
    getSupplierWithdraws: 'finance',
  },
}));

vi.mock('../../../services/ai/tool-registry.js', () => ({
  TOOL_DEFINITIONS: [
    {
      type: 'function',
      function: {
        name: 'getSalesStats',
        description: 'Hardcoded fallback - analytics',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'getOrders',
        description: 'Hardcoded fallback - operation',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'getSupplierWithdraws',
        description: 'Hardcoded fallback - finance',
        parameters: { type: 'object', properties: {} },
      },
    },
  ],
  executeTool: mockExecuteTool,
}));

vi.mock('../../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

// persona-registry: use real implementation (pure code, no side effects)

import {
  getActiveToolDefinitions,
  resolveAndExecuteTool,
} from '../../../services/tool-market/tool-resolver.js';

// ─── Constants ──────────────────────────────────────────

const TENANT = 'tenant-001';

const DB_INSTANCE = {
  id: 'inst-001',
  tenantId: TENANT,
  toolDefinitionId: 'def-001',
  status: 'active',
  toolDefinition: {
    id: 'def-001',
    name: 'getSalesStats',
    displayName: '销售统计查询',
    description: '查询销售统计',
    category: 'analytics',
    configSchema: { type: 'object', properties: { startDate: { type: 'string' } } },
  },
};

// ─── Tests ──────────────────────────────────────────────

beforeEach(() => vi.clearAllMocks());

describe('getActiveToolDefinitions', () => {
  it('should return DB-driven tools when instances exist', async () => {
    mockListActiveInstances.mockResolvedValue([DB_INSTANCE]);

    const tools = await getActiveToolDefinitions(TENANT);

    expect(tools).toHaveLength(1);
    expect(tools[0]!.type).toBe('function');
    expect(tools[0]!.function.name).toBe('getSalesStats');
    expect(tools[0]!.function.description).toBe('查询销售统计');
    expect(tools[0]!.function.parameters).toEqual(DB_INSTANCE.toolDefinition.configSchema);
  });

  it('should fallback to hardcoded TOOL_DEFINITIONS when DB is empty', async () => {
    mockListActiveInstances.mockResolvedValue([]);

    const tools = await getActiveToolDefinitions(TENANT);

    expect(tools).toHaveLength(3);
    expect(tools[0]!.function.name).toBe('getSalesStats');
  });

  it('should fallback to hardcoded TOOL_DEFINITIONS on DB error', async () => {
    mockListActiveInstances.mockRejectedValue(new Error('DB connection failed'));

    const tools = await getActiveToolDefinitions(TENANT);

    expect(tools).toHaveLength(3);
  });

  it('should handle definitions with null description', async () => {
    const instanceNullDesc = {
      ...DB_INSTANCE,
      toolDefinition: { ...DB_INSTANCE.toolDefinition, description: null, configSchema: null },
    };
    mockListActiveInstances.mockResolvedValue([instanceNullDesc]);

    const tools = await getActiveToolDefinitions(TENANT);

    expect(tools[0]!.function.description).toBe('');
    expect(tools[0]!.function.parameters).toEqual({ type: 'object', properties: {} });
  });
});

describe('getActiveToolDefinitions — persona filtering', () => {
  it('should return all tools for master agentType', async () => {
    mockListActiveInstances.mockResolvedValue([]);

    const tools = await getActiveToolDefinitions(TENANT, 'master');

    expect(tools).toHaveLength(3);
  });

  it('should return all tools when agentType is undefined', async () => {
    mockListActiveInstances.mockResolvedValue([]);

    const tools = await getActiveToolDefinitions(TENANT);

    expect(tools).toHaveLength(3);
  });

  it('should filter tools for finance persona (finance+analytics)', async () => {
    mockListActiveInstances.mockResolvedValue([]);

    const tools = await getActiveToolDefinitions(TENANT, 'finance');
    const names = tools.map(t => t.function.name);

    expect(names).toContain('getSalesStats');       // analytics ✓
    expect(names).toContain('getSupplierWithdraws'); // finance ✓
    expect(names).not.toContain('getOrders');         // operation ✗
  });

  it('should filter tools for report persona (analytics only)', async () => {
    mockListActiveInstances.mockResolvedValue([]);

    const tools = await getActiveToolDefinitions(TENANT, 'report');
    const names = tools.map(t => t.function.name);

    expect(names).toContain('getSalesStats');           // analytics ✓
    expect(names).not.toContain('getOrders');            // operation ✗
    expect(names).not.toContain('getSupplierWithdraws'); // finance ✗
  });

  it('should filter tools for customer_service persona (operation only)', async () => {
    mockListActiveInstances.mockResolvedValue([]);

    const tools = await getActiveToolDefinitions(TENANT, 'customer_service');
    const names = tools.map(t => t.function.name);

    expect(names).toContain('getOrders');               // operation ✓
    expect(names).not.toContain('getSalesStats');        // analytics ✗
    expect(names).not.toContain('getSupplierWithdraws'); // finance ✗
  });

  it('should return all tools for tool agentType (empty categories)', async () => {
    mockListActiveInstances.mockResolvedValue([]);

    const tools = await getActiveToolDefinitions(TENANT, 'tool');

    expect(tools).toHaveLength(3);
  });

  it('should pass unknown tool names through (safe degradation)', async () => {
    mockListActiveInstances.mockResolvedValue([{
      ...DB_INSTANCE,
      toolDefinition: {
        ...DB_INSTANCE.toolDefinition,
        name: 'customPlugin',
      },
    }]);

    // finance persona but unknown tool name → should pass through
    const tools = await getActiveToolDefinitions(TENANT, 'finance');

    expect(tools).toHaveLength(1);
    expect(tools[0]!.function.name).toBe('customPlugin');
  });
});

describe('resolveAndExecuteTool', () => {
  it('should delegate built-in tools to executeTool', async () => {
    const expectedResult = {
      toolCallId: 'tc-1',
      toolName: 'getSalesStats',
      result: { totalAmount: 1000 },
      duration: 50,
      cached: false,
    };
    mockExecuteTool.mockResolvedValue(expectedResult);

    const result = await resolveAndExecuteTool('tc-1', 'getSalesStats', '{"startDate":"2026-01-01","endDate":"2026-01-31"}', TENANT);

    expect(result).toEqual(expectedResult);
    expect(mockExecuteTool).toHaveBeenCalledWith('tc-1', 'getSalesStats', '{"startDate":"2026-01-01","endDate":"2026-01-31"}', TENANT);
  });

  it('should return error for unknown tools', async () => {
    const result = await resolveAndExecuteTool('tc-2', 'unknownTool', '{}', TENANT);

    expect(result.error).toBe('未知工具: unknownTool');
    expect(result.result).toBeNull();
    expect(mockExecuteTool).not.toHaveBeenCalled();
  });
});
