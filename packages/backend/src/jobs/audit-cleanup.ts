/**
 * 审计日志清理定时任务
 *
 * 策略：保留365天审计数据，超期硬删除（审计日志不使用软删除）。
 * 每日凌晨4点执行，避开业务高峰和cache-refresh（3点）。
 */
import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';

const RETENTION_DAYS = 365;

export async function cleanupOldAuditLogs(): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

  const result = await prisma.auditLog.deleteMany({
    where: {
      createdAt: { lt: cutoffDate },
    },
  });

  if (result.count > 0) {
    logger.info({ deleted: result.count, cutoffDate: cutoffDate.toISOString() }, 'Audit logs cleaned up');
  }

  return result.count;
}

export function startAuditCleanupJob(): void {
  const scheduleCleanup = (): void => {
    const now = new Date();
    const next4am = new Date(now);
    next4am.setHours(4, 0, 0, 0);
    if (next4am <= now) {
      next4am.setDate(next4am.getDate() + 1);
    }
    const delay = next4am.getTime() - now.getTime();

    setTimeout(() => {
      void cleanupOldAuditLogs();
      setInterval(() => void cleanupOldAuditLogs(), 24 * 60 * 60 * 1000);
    }, delay);
  };

  scheduleCleanup();
  logger.info({ retentionDays: RETENTION_DAYS }, 'Audit cleanup job scheduled (daily@4am)');
}
