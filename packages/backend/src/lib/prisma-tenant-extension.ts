/**
 * Prisma 租户隔离扩展
 *
 * 从 middleware/tenant.ts 提取到独立文件，打破循环依赖：
 *   tenant-context.ts → middleware/tenant.ts → tenant-context.ts（旧）
 *   tenant-context.ts → prisma-tenant-extension.ts（新，无循环）
 */

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
        async findMany({
          args,
          query,
        }: {
          args: Record<string, unknown>;
          query: (args: Record<string, unknown>) => Promise<unknown>;
        }) {
          args['where'] = { ...((args['where'] as object) ?? {}), tenantId };
          return query(args);
        },
        async findFirst({
          args,
          query,
        }: {
          args: Record<string, unknown>;
          query: (args: Record<string, unknown>) => Promise<unknown>;
        }) {
          args['where'] = { ...((args['where'] as object) ?? {}), tenantId };
          return query(args);
        },
        async findUnique({
          args,
          query,
        }: {
          args: Record<string, unknown>;
          query: (args: Record<string, unknown>) => Promise<unknown>;
        }) {
          args['where'] = { ...((args['where'] as object) ?? {}), tenantId };
          return query(args);
        },
        async create({
          args,
          query,
        }: {
          args: Record<string, unknown>;
          query: (args: Record<string, unknown>) => Promise<unknown>;
        }) {
          args['data'] = { ...((args['data'] as object) ?? {}), tenantId };
          return query(args);
        },
        async update({
          args,
          query,
        }: {
          args: Record<string, unknown>;
          query: (args: Record<string, unknown>) => Promise<unknown>;
        }) {
          args['where'] = { ...((args['where'] as object) ?? {}), tenantId };
          return query(args);
        },
        async updateMany({
          args,
          query,
        }: {
          args: Record<string, unknown>;
          query: (args: Record<string, unknown>) => Promise<unknown>;
        }) {
          args['where'] = { ...((args['where'] as object) ?? {}), tenantId };
          return query(args);
        },
        async delete({
          args,
          query,
        }: {
          args: Record<string, unknown>;
          query: (args: Record<string, unknown>) => Promise<unknown>;
        }) {
          args['where'] = { ...((args['where'] as object) ?? {}), tenantId };
          return query(args);
        },
        async deleteMany({
          args,
          query,
        }: {
          args: Record<string, unknown>;
          query: (args: Record<string, unknown>) => Promise<unknown>;
        }) {
          args['where'] = { ...((args['where'] as object) ?? {}), tenantId };
          return query(args);
        },
        async count({
          args,
          query,
        }: {
          args: Record<string, unknown>;
          query: (args: Record<string, unknown>) => Promise<unknown>;
        }) {
          args['where'] = { ...((args['where'] as object) ?? {}), tenantId };
          return query(args);
        },
        async aggregate({
          args,
          query,
        }: {
          args: Record<string, unknown>;
          query: (args: Record<string, unknown>) => Promise<unknown>;
        }) {
          args['where'] = { ...((args['where'] as object) ?? {}), tenantId };
          return query(args);
        },
      },
    },
  };
}
