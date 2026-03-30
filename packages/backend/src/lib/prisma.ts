import { PrismaClient } from '@prisma/client';

const isProduction = process.env['NODE_ENV'] === 'production';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isProduction ? ['error', 'warn'] : ['query', 'info', 'warn', 'error'],
  });

if (!isProduction) {
  globalForPrisma.prisma = prisma;
}
