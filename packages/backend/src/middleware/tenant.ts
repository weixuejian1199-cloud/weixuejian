import type { Request, Response, NextFunction } from 'express';
import { sendError } from '../utils/response.js';
import { childLogger } from '../utils/logger.js';
import { tenantStorage } from '../lib/tenant-context.js';

/**
 * 租户隔离中间件 — 从 req.user.tenantId 提取租户 ID 并注入：
 * 1. req.tenantId（Express 请求级别）
 * 2. AsyncLocalStorage（服务层可通过 getTenantId() 访问）
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

  // 设置 AsyncLocalStorage 上下文 — 后续服务层可通过 getTenantId() 获取
  tenantStorage.run(
    { tenantId: req.user.tenantId, userId: req.user.userId },
    () => next(),
  );
}

/**
 * 创建带租户隔离的 Prisma 扩展
 *
 * 所有查询自动注入 tenantId WHERE 条件。
 * 所有创建自动注入 tenantId 数据。
 *
 * 使用方式：
 *   import { getTenantPrisma } from '../lib/tenant-context.js';
 *   const db = getTenantPrisma(); // 自动带 tenantId
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
        async updateMany({ args, query }: { args: Record<string, unknown>; query: (args: Record<string, unknown>) => Promise<unknown> }) {
          args['where'] = { ...(args['where'] as object ?? {}), tenantId };
          return query(args);
        },
        async delete({ args, query }: { args: Record<string, unknown>; query: (args: Record<string, unknown>) => Promise<unknown> }) {
          args['where'] = { ...(args['where'] as object ?? {}), tenantId };
          return query(args);
        },
        async deleteMany({ args, query }: { args: Record<string, unknown>; query: (args: Record<string, unknown>) => Promise<unknown> }) {
          args['where'] = { ...(args['where'] as object ?? {}), tenantId };
          return query(args);
        },
        async count({ args, query }: { args: Record<string, unknown>; query: (args: Record<string, unknown>) => Promise<unknown> }) {
          args['where'] = { ...(args['where'] as object ?? {}), tenantId };
          return query(args);
        },
        async aggregate({ args, query }: { args: Record<string, unknown>; query: (args: Record<string, unknown>) => Promise<unknown> }) {
          args['where'] = { ...(args['where'] as object ?? {}), tenantId };
          return query(args);
        },
      },
    },
  };
}
