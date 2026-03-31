import type { PrismaClient } from '@prisma/client';
import { maskSensitiveFields } from '../../lib/data-masking.js';

/**
 * PIPL合规 — 数据主体权利服务
 *
 * 实现《个人信息保护法》第四章要求：
 * - 第45条: 个人信息查阅/复制权（数据导出）
 * - 第47条: 个人信息删除权
 */

/** 用户数据导出包 */
export interface UserDataExport {
  exportedAt: string;
  user: {
    id: string;
    phone: string;
    name: string;
    createdAt: Date;
  };
  conversations: { id: string; agentType: string; title: string | null; createdAt: Date }[];
  conversationCount: number;
  csSessionCount: number;
  auditLogCount: number;
  notificationCount: number;
}

/** 用户数据删除结果 */
export interface UserDataDeletionResult {
  deletedAt: string;
  userId: string;
  deletedRecords: {
    conversations: number;
    messages: number;
    notifications: number;
    refreshTokens: number;
    csMessages: number;
  };
  retainedForCompliance: string[];
}

/**
 * 导出用户个人数据（PIPL第45条）
 * 返回脱敏后的数据包
 */
export async function exportUserData(
  prisma: PrismaClient,
  tenantId: string,
  userId: string,
): Promise<UserDataExport> {
  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId, deletedAt: null },
    select: { id: true, phone: true, name: true, createdAt: true },
  });

  if (!user) {
    throw new Error('USER_NOT_FOUND');
  }

  const conversations = await prisma.conversation.findMany({
    where: { userId, tenantId, deletedAt: null },
    select: { id: true, agentType: true, title: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  const [conversationCount, csSessionCount, auditLogCount, notificationCount] = await Promise.all([
    prisma.conversation.count({ where: { userId, tenantId, deletedAt: null } }),
    prisma.customerServiceSession.count({ where: { tenantId, deletedAt: null } }),
    prisma.auditLog.count({ where: { userId, tenantId } }),
    prisma.notification.count({ where: { userId, tenantId, deletedAt: null } }),
  ]);

  const exportData: UserDataExport = {
    exportedAt: new Date().toISOString(),
    user: maskSensitiveFields(user),
    conversations,
    conversationCount,
    csSessionCount,
    auditLogCount,
    notificationCount,
  };

  return exportData;
}

/**
 * 删除用户个人数据（PIPL第47条）
 *
 * 策略：
 * - 软删除用户记录（保留ID用于审计关联）
 * - 硬删除对话/消息/通知/Token
 * - 保留审计日志（合规要求365天）
 * - 保留AI判断记录（业务合规需要）
 */
export async function deleteUserData(
  prisma: PrismaClient,
  tenantId: string,
  userId: string,
): Promise<UserDataDeletionResult> {
  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId, deletedAt: null },
  });

  if (!user) {
    throw new Error('USER_NOT_FOUND');
  }

  const result = await prisma.$transaction(async (tx) => {
    // 1. 删除消息（硬删除，不可恢复）
    const messages = await tx.message.deleteMany({
      where: { userId, tenantId },
    });

    // 2. 删除对话（硬删除）
    const conversations = await tx.conversation.deleteMany({
      where: { userId, tenantId },
    });

    // 3. 删除通知（硬删除）
    const notifications = await tx.notification.deleteMany({
      where: { userId, tenantId },
    });

    // 4. 删除刷新Token（硬删除）
    const refreshTokens = await tx.refreshToken.deleteMany({
      where: { userId, tenantId },
    });

    // 5. 删除客服消息中的用户内容（硬删除买家消息）
    const csMessages = await tx.customerServiceMessage.deleteMany({
      where: { tenantId, sender: 'buyer', session: { externalUserId: userId } },
    });

    // 6. 软删除用户记录（保留ID用于审计日志关联完整性）
    await tx.user.update({
      where: { id: userId },
      data: {
        deletedAt: new Date(),
        phone: `deleted_${userId.slice(0, 8)}`,
        name: '已注销用户',
        wechatOpenid: null,
        wecomUserid: null,
        avatarUrl: null,
      },
    });

    return {
      conversations: conversations.count,
      messages: messages.count,
      notifications: notifications.count,
      refreshTokens: refreshTokens.count,
      csMessages: csMessages.count,
    };
  });

  return {
    deletedAt: new Date().toISOString(),
    userId,
    deletedRecords: result,
    retainedForCompliance: [
      'AuditLog — 合规要求保留365天',
      'AiJudgmentRecord — 业务决策追溯需要',
      'CustomerServiceTicket — 售后记录合规保留',
    ],
  };
}

/**
 * 数据保留策略 — 定期清理过期数据
 * 建议通过 cron job 定期调用
 */
export async function enforceRetentionPolicy(
  prisma: PrismaClient,
  tenantId: string,
): Promise<{ auditLogsDeleted: number; notificationsDeleted: number }> {
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // 审计日志: 超过1年的可以清理
  const auditLogs = await prisma.auditLog.deleteMany({
    where: { tenantId, createdAt: { lt: oneYearAgo } },
  });

  // 已读通知: 超过30天的可以清理
  const notifications = await prisma.notification.deleteMany({
    where: { tenantId, isRead: true, readAt: { lt: thirtyDaysAgo } },
  });

  return {
    auditLogsDeleted: auditLogs.count,
    notificationsDeleted: notifications.count,
  };
}
