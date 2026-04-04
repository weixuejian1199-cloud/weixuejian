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
export function requireTenant(req: Request, res: Response, next: NextFunction): void {
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
  tenantStorage.run({ tenantId: req.user.tenantId, userId: req.user.userId }, () => next());
}

// 租户隔离 Prisma 扩展已提取到 lib/prisma-tenant-extension.ts（打破循环依赖）
// 保留重新导出以兼容已有的外部引用
export { createTenantPrismaExtension } from '../lib/prisma-tenant-extension.js';
