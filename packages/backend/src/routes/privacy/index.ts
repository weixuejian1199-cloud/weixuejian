import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { sendSuccess, sendError } from '../../utils/response.js';
import { exportUserData, deleteUserData } from '../../services/privacy/privacy-service.js';
import { logger } from '../../utils/logger.js';

export const privacyRouter = Router();

/**
 * GET /api/v1/privacy/export
 * PIPL第45条 — 用户数据导出（查阅/复制权）
 * 返回脱敏后的个人数据包
 */
privacyRouter.get('/export', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const userId = req.user?.userId;
    if (!tenantId || !userId) {
      return sendError(res, 'AUTH_INVALID_TOKEN');
    }

    const exportData = await exportUserData(prisma, tenantId, userId);

    await prisma.auditLog.create({
      data: {
        tenantId,
        userId,
        action: 'privacy.export',
        resourceType: 'User',
        resourceId: userId,
        ipAddress: req.ip ?? null,
      },
    });

    logger.info({ userId, tenantId }, 'User data exported (PIPL Art.45)');
    sendSuccess(res, exportData);
  } catch (err) {
    if (err instanceof Error && err.message === 'USER_NOT_FOUND') {
      return sendError(res, 'RESOURCE_NOT_FOUND', '用户不存在');
    }
    logger.error({ err }, 'Privacy export failed');
    sendError(res, 'INTERNAL_ERROR');
  }
});

/**
 * POST /api/v1/privacy/deletion-request
 * PIPL第47条 — 用户数据删除权
 * 需要用户确认（传入确认码）
 */
const deletionSchema = z.object({
  confirmation: z.literal('DELETE_MY_DATA'),
});

privacyRouter.post('/deletion-request', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const userId = req.user?.userId;
    if (!tenantId || !userId) {
      return sendError(res, 'AUTH_INVALID_TOKEN');
    }

    const parsed = deletionSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(
        res,
        'VALIDATION_ERROR',
        '请在请求体中传入 {"confirmation": "DELETE_MY_DATA"} 确认删除',
      );
    }

    // 审计记录（删除前先记录）
    await prisma.auditLog.create({
      data: {
        tenantId,
        userId,
        action: 'privacy.deletion_request',
        resourceType: 'User',
        resourceId: userId,
        ipAddress: req.ip ?? null,
      },
    });

    const result = await deleteUserData(prisma, tenantId, userId);

    logger.warn({ userId, tenantId, result }, 'User data deleted (PIPL Art.47)');
    sendSuccess(res, result);
  } catch (err) {
    if (err instanceof Error && err.message === 'USER_NOT_FOUND') {
      return sendError(res, 'RESOURCE_NOT_FOUND', '用户不存在');
    }
    logger.error({ err }, 'Privacy deletion failed');
    sendError(res, 'INTERNAL_ERROR');
  }
});
