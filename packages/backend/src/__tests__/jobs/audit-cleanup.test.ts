import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock prisma
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    auditLog: {
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

import { cleanupOldAuditLogs, startAuditCleanupJob } from '../../jobs/audit-cleanup.js';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';

describe('audit-cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('cleanupOldAuditLogs', () => {
    it('应删除365天前的审计日志', async () => {
      vi.mocked(prisma.auditLog.deleteMany).mockResolvedValue({ count: 42 });

      const deleted = await cleanupOldAuditLogs();

      expect(deleted).toBe(42);
      expect(prisma.auditLog.deleteMany).toHaveBeenCalledWith({
        where: {
          createdAt: { lt: expect.any(Date) },
        },
      });
    });

    it('cutoffDate应为365天前', async () => {
      vi.mocked(prisma.auditLog.deleteMany).mockResolvedValue({ count: 0 });

      const now = new Date();
      await cleanupOldAuditLogs();

      const callArgs = vi.mocked(prisma.auditLog.deleteMany).mock.calls[0]![0]!;
      const cutoff = (callArgs.where!.createdAt as { lt: Date }).lt;
      const diffDays = Math.round((now.getTime() - cutoff.getTime()) / (1000 * 60 * 60 * 24));
      expect(diffDays).toBe(365);
    });

    it('删除数>0时应记录日志', async () => {
      vi.mocked(prisma.auditLog.deleteMany).mockResolvedValue({ count: 10 });

      await cleanupOldAuditLogs();

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ deleted: 10 }),
        'Audit logs cleaned up',
      );
    });

    it('删除数=0时不应记录日志', async () => {
      vi.mocked(prisma.auditLog.deleteMany).mockResolvedValue({ count: 0 });

      await cleanupOldAuditLogs();

      expect(logger.info).not.toHaveBeenCalledWith(
        expect.anything(),
        'Audit logs cleaned up',
      );
    });
  });

  describe('startAuditCleanupJob', () => {
    it('应记录调度日志', () => {
      startAuditCleanupJob();

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ retentionDays: 365 }),
        'Audit cleanup job scheduled (daily@4am)',
      );
    });
  });
});
