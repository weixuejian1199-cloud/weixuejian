import type { Request, Response, NextFunction } from 'express';
import { sendError } from '../utils/response.js';

const DEFAULT_TENANT_ID = 'default';

/**
 * 租户隔离中间件 — 从 req.user.tenantId 提取租户 ID 并注入 req.tenantId
 * 必须在 requireAuth 之后使用
 * Phase 1 简化：如果 tenantId 为空，使用默认租户 'default'
 */
export function requireTenant(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user) {
    sendError(res, 'AUTH_INVALID_TOKEN', '无效的访问令牌', 401);
    return;
  }

  req.tenantId = req.user.tenantId || DEFAULT_TENANT_ID;
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
