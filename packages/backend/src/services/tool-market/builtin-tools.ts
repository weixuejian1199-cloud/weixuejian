/**
 * 内置工具元数据 — 将 tool-registry.ts 的 9 个硬编码工具映射为 ToolDefinition 种子数据
 *
 * Phase 2a: BL-009 工具市场 MVP
 */
import type { ToolCategory } from '@prisma/client';
import {
  TOOL_DEFINITIONS,
  toolHandlers,
  toolParamSchemas,
  type ToolHandler,
} from '../ai/tool-registry.js';
import type { ToolDefinition as OpenAIToolDef } from '../ai/types.js';

// ─── 种子数据类型 ─────────────────────────────────────────

export interface BuiltinToolSeed {
  name: string;
  displayName: string;
  description: string;
  category: ToolCategory;
  version: string;
  parameters: Record<string, unknown>;
  permissions: string[];
}

// ─── 9 个内置工具的元数据 ─────────────────────────────────

const TOOL_META: Record<string, { displayName: string; category: ToolCategory }> = {
  getSalesStats:              { displayName: '销售统计查询',       category: 'analytics' },
  getTopSuppliers:            { displayName: '供应商排行榜',       category: 'analytics' },
  getOrderStatusDistribution: { displayName: '订单状态分布',       category: 'analytics' },
  getOrders:                  { displayName: '订单列表查询',       category: 'operation' },
  getUsers:                   { displayName: '用户列表查询',       category: 'operation' },
  getItems:                   { displayName: '商品列表查询',       category: 'operation' },
  getSlowSuppliers:           { displayName: '慢发货供应商',       category: 'analytics' },
  getUserGrowthTrend:         { displayName: '用户增长趋势',       category: 'analytics' },
  getSupplierWithdraws:       { displayName: '供应商提现记录',     category: 'finance' },
};

/**
 * 从 TOOL_DEFINITIONS 自动生成种子数据，确保元数据永远和实际工具定义同步
 */
export const BUILTIN_TOOL_SEEDS: BuiltinToolSeed[] = TOOL_DEFINITIONS.map((def: OpenAIToolDef) => {
  const name = def.function.name;
  const meta = TOOL_META[name];
  if (!meta) {
    throw new Error(`Missing TOOL_META for built-in tool: ${name}`);
  }
  return {
    name,
    displayName: meta.displayName,
    description: def.function.description,
    category: meta.category,
    version: '1.0.0',
    parameters: def.function.parameters,
    permissions: ['data:read'],
  };
});

// ─── 工具名 → 类别映射（供 tool-resolver 人格过滤使用）──────

export const TOOL_META_CATEGORIES: Record<string, ToolCategory> = Object.fromEntries(
  Object.entries(TOOL_META).map(([name, meta]) => [name, meta.category]),
);

// ─── 重导出执行器映射（供 tool-resolver 使用）────────────────

export { toolHandlers as BUILTIN_TOOL_HANDLERS };
export { toolParamSchemas as BUILTIN_PARAM_SCHEMAS };
export type { ToolHandler };
