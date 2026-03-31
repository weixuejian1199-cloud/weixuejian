/**
 * ToolDefinition 服务 — CRUD + 种子
 *
 * Phase 2a: BL-009 工具市场 MVP
 */
import { prisma } from '../../lib/prisma.js';
import type { Prisma } from '@prisma/client';
import { BUILTIN_TOOL_SEEDS } from './builtin-tools.js';

export interface ListToolDefOptions {
  category?: string;
  page?: number;
  pageSize?: number;
}

export async function listToolDefinitions(tenantId: string, opts: ListToolDefOptions = {}) {
  const { category, page = 1, pageSize = 20 } = opts;
  const where = {
    tenantId,
    deletedAt: null,
    ...(category ? { category: category as never } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.toolDefinition.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.toolDefinition.count({ where }),
  ]);

  return { items, total, page, pageSize };
}

export async function getToolDefinitionById(id: string, tenantId: string) {
  return prisma.toolDefinition.findFirst({
    where: { id, tenantId, deletedAt: null },
  });
}

export async function getToolDefinitionByName(name: string, version: string, tenantId: string) {
  return prisma.toolDefinition.findFirst({
    where: { tenantId, name, version, deletedAt: null },
  });
}

/**
 * 为租户种子所有内置工具（幂等）
 */
export async function seedBuiltinTools(tenantId: string) {
  const results = [];

  for (const seed of BUILTIN_TOOL_SEEDS) {
    const record = await prisma.toolDefinition.upsert({
      where: {
        tenantId_name_version: {
          tenantId,
          name: seed.name,
          version: seed.version,
        },
      },
      update: {
        displayName: seed.displayName,
        description: seed.description,
        category: seed.category,
        permissions: seed.permissions,
        configSchema: seed.parameters as Prisma.InputJsonValue,
        isBuiltin: true,
        deletedAt: null,
      },
      create: {
        tenantId,
        name: seed.name,
        displayName: seed.displayName,
        description: seed.description,
        category: seed.category,
        version: seed.version,
        configSchema: seed.parameters as Prisma.InputJsonValue,
        permissions: seed.permissions,
        isBuiltin: true,
      },
    });
    results.push(record);
  }

  return results;
}
