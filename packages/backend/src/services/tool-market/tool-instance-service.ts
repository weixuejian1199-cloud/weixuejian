/**
 * ToolInstance 服务 — 激活/停用/查询
 *
 * Phase 2a: BL-009 工具市场 MVP
 */
import { prisma } from '../../lib/prisma.js';
import type { Prisma } from '@prisma/client';

/**
 * 为租户激活工具（幂等：已激活则返回现有实例）
 */
export async function activateTool(
  tenantId: string,
  toolDefinitionId: string,
  config?: Prisma.InputJsonValue,
) {
  // 验证工具定义存在且属于该租户
  const def = await prisma.toolDefinition.findFirst({
    where: { id: toolDefinitionId, tenantId, deletedAt: null },
  });
  if (!def) return null;

  // 检查是否已有实例（含软删除的）
  const existing = await prisma.toolInstance.findUnique({
    where: { tenantId_toolDefinitionId: { tenantId, toolDefinitionId } },
    include: { toolDefinition: true },
  });

  if (existing) {
    // 如果已激活，直接返回（幂等）
    if (existing.status === 'active' && !existing.deletedAt) {
      return existing;
    }
    // 如果已停用，重新激活
    return prisma.toolInstance.update({
      where: { id: existing.id },
      data: {
        status: 'active',
        deletedAt: null,
        activatedAt: new Date(),
        config: config ?? existing.config ?? undefined,
      },
      include: { toolDefinition: true },
    });
  }

  // 创建新实例
  return prisma.toolInstance.create({
    data: {
      tenantId,
      toolDefinitionId,
      config: config ?? undefined,
      status: 'active',
    },
    include: { toolDefinition: true },
  });
}

/**
 * 停用工具（幂等：已停用则直接返回成功）
 */
export async function deactivateTool(tenantId: string, toolDefinitionId: string) {
  const instance = await prisma.toolInstance.findUnique({
    where: { tenantId_toolDefinitionId: { tenantId, toolDefinitionId } },
  });

  if (!instance || instance.status === 'inactive' || instance.deletedAt) {
    return true; // 幂等：已停用或不存在
  }

  await prisma.toolInstance.update({
    where: { id: instance.id },
    data: { status: 'inactive', deletedAt: new Date() },
  });

  return true;
}

/**
 * 列出租户已激活的工具实例
 */
export async function listActiveInstances(tenantId: string) {
  return prisma.toolInstance.findMany({
    where: {
      tenantId,
      status: 'active',
      deletedAt: null,
      toolDefinition: { deletedAt: null },
    },
    include: { toolDefinition: true },
    orderBy: { activatedAt: 'asc' },
  });
}

/**
 * 获取单个实例详情
 */
export async function getInstanceById(id: string, tenantId: string) {
  return prisma.toolInstance.findFirst({
    where: { id, tenantId, deletedAt: null },
    include: { toolDefinition: true },
  });
}
