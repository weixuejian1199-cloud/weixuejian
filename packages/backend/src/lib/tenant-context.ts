/**
 * 多租户上下文 — AsyncLocalStorage 实现
 *
 * Phase 1b: US-P1b-002
 * - 请求级别的 tenantId 上下文传播
 * - 无需手动传递 tenantId 到每个服务函数
 * - 通过 getTenantPrisma() 获取自动注入 tenantId 的 Prisma 客户端
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { prisma } from './prisma.js';
import { createTenantPrismaExtension } from './prisma-tenant-extension.js';

// ─── 上下文存储 ───────────────────────────────────────────

interface TenantStore {
  tenantId: string;
  userId: string;
}

export const tenantStorage = new AsyncLocalStorage<TenantStore>();

// ─── 上下文获取 ───────────────────────────────────────────

/** 获取当前请求的 tenantId（fail-secure: 无上下文时抛出错误） */
export function getTenantId(): string {
  const store = tenantStorage.getStore();
  if (!store) {
    throw new Error('Tenant context not initialized — this code must run within a request handler');
  }
  return store.tenantId;
}

/** 获取当前请求的 userId */
export function getUserId(): string {
  const store = tenantStorage.getStore();
  if (!store) {
    throw new Error('Tenant context not initialized');
  }
  return store.userId;
}

// ─── 租户隔离的 Prisma 客户端 ─────────────────────────────

/**
 * 获取自动注入 tenantId 的 Prisma 客户端
 *
 * 所有业务查询应使用此函数代替直接使用 prisma：
 *   const db = getTenantPrisma();
 *   const users = await db.user.findMany(); // 自动 WHERE tenantId = ?
 *
 * 注意：仅在 requireTenant 中间件之后的路由中可用。
 * 系统级查询（如健康检查）仍使用原始 prisma。
 */
export function getTenantPrisma() {
  const tenantId = getTenantId();
  return prisma.$extends(createTenantPrismaExtension(tenantId));
}
