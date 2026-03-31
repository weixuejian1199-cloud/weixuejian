import { Prisma, PrismaClient } from '@prisma/client';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

const isProduction = env.NODE_ENV === 'production';

// ─── 租户隔离中间件（开发/测试环境） ─────────────────────────

const TENANT_SCOPED_MODELS: ReadonlySet<string> = new Set([
  'Conversation', 'Message', 'RefreshToken', 'User',
  'CustomerServiceSession', 'CustomerServiceMessage', 'CustomerServiceTicket',
  'AuditLog',
]);

const WRITE_ACTIONS: ReadonlySet<string> = new Set([
  'update', 'updateMany', 'delete', 'deleteMany',
]);

const tenantGuardExtension = Prisma.defineExtension({
  query: {
    $allOperations({ model, operation, args, query }) {
      if (
        model &&
        TENANT_SCOPED_MODELS.has(model) &&
        WRITE_ACTIONS.has(operation)
      ) {
        const where = (args as Record<string, unknown>)['where'] as Record<string, unknown> | undefined;
        if (where && !where['tenantId']) {
          const msg = `[TENANT-GUARD] ${model}.${operation}() missing tenantId in where clause`;
          logger.warn(msg);
          if (env.NODE_ENV === 'test') {
            throw new Error(msg);
          }
        }
      }
      return query(args);
    },
  },
});

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const basePrisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isProduction ? ['error', 'warn'] : ['query', 'info', 'warn', 'error'],
  });

export const prisma = isProduction ? basePrisma : basePrisma.$extends(tenantGuardExtension) as unknown as PrismaClient;

if (!isProduction) {
  globalForPrisma.prisma = basePrisma;
}
