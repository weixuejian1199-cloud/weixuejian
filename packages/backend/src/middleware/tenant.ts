import type { Request, Response, NextFunction } from 'express';
import { sendError } from '../utils/response.js';
import { childLogger } from '../utils/logger.js';

/**
 * 租户隔离中间件 — 从 req.user.tenantId 提取租户 ID 并注入 req.tenantId
 *
 * fail-secure 原则：tenantId 缺失时拒绝请求，不使用默认值。
 * 必须在 requireAuth 之后使用。
 */
export function requireTenant(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const log = childLogger(req.requestId ?? 'unknown');

  if (!req.user) {
    sendError(res, 'AUTH_INVALID_TOKEN', '无效的访问令牌', 401);
    return;
  }

  if (!req.user.tenantId) {
    log.error({ userId: req.user.userId }, 'JWT payload missing tenantId, rejecting request');
    sendError(res, 'TENANT_NOT_FOUND', '租户信息缺失', 403);
    return;
  }

  req.tenantId = req.user.tenantId;
  next();
}

/**
 * 创建带租户隔离的 Prisma 扩展
 *
 * 使用方式（Phase 2 启用）：
 *   const xprisma = prisma.$extends(createTenantPrismaExtension(tenantId))
 *
 * Phase 1 简化：业务代码手动在查询中传入 tenantId
 * Phase 2：通过 AsyncLocalStorage + Prisma extension 自动注入
 */
export function createTenantPrismaExtension(tenantId: string) {
  return {
    name: 'tenant-isolation',
    query: {
      $allModels: {
        async findMany({ args, query }: { args: Record<string, unknown>; query: (args: Record<string, unknown>) => Promise<unknown> }) {
          args['where'] = { ...(args['where'] as object ?? {}), tenantId };
          return query(args);
        },
        async findFirst({ args, query }: { args: Record<string, unknown>; query: (args: Record<string, unknown>) => Promise<unknown> }) {
          args['where'] = { ...(args['where'] as object ?? {}), tenantId };
          return query(args);
        },
        async findUnique({ args, query }: { args: Record<string, unknown>; query: (args: Record<string, unknown>) => Promise<unknown> }) {
          args['where'] = { ...(args['where'] as object ?? {}), tenantId };
          return query(args);
        },
        async create({ args, query }: { args: Record<string, unknown>; query: (args: Record<string, unknown>) => Promise<unknown> }) {
          args['data'] = { ...(args['data'] as object ?? {}), tenantId };
          return query(args);
        },
        async update({ args, query }: { args: Record<string, unknown>; query: (args: Record<string, unknown>) => Promise<unknown> }) {
          args['where'] = { ...(args['where'] as object ?? {}), tenantId };
          return query(args);
        },
        async delete({ args, query }: { args: Record<string, unknown>; query: (args: Record<string, unknown>) => Promise<unknown> }) {
          args['where'] = { ...(args['where'] as object ?? {}), tenantId };
          return query(args);
        },
      },
    },
  };
}
