/**
 * 操作确认记录路由 — BL-023
 *
 * POST   /api/v1/confirmations          — AI创建确认请求
 * POST   /api/v1/confirmations/:id/respond — 用户确认/拒绝
 * GET    /api/v1/confirmations          — 确认记录列表
 * GET    /api/v1/confirmations/:id/replay — 决策回放
 */
import { Router } from 'express';
import { z } from 'zod';
import {
  createConfirmation,
  createConfirmationSchema,
  respondToConfirmation,
  respondConfirmationSchema,
  listConfirmations,
  getDecisionReplay,
} from '../../services/confirmation/confirmation-service.js';
import { sendSuccess, sendError } from '../../utils/response.js';
import { logger } from '../../utils/logger.js';

export const confirmationRouter = Router();

// ─── POST / — 创建确认请求 ──────────────────────────────

confirmationRouter.post('/', async (req, res) => {
  const tenantId = req.tenantId;
  const userId = req.user?.userId;
  if (!tenantId || !userId) {
    return sendError(res, 'AUTH_INVALID_TOKEN');
  }

  const parsed = createConfirmationSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 'VALIDATION_ERROR', '请求参数校验失败', 400, parsed.error.issues);
  }

  try {
    const record = await createConfirmation(tenantId, userId, parsed.data);
    sendSuccess(res, record, undefined, 201);
  } catch (err) {
    logger.error({ err, tenantId }, 'Create confirmation failed');
    sendError(res, 'INTERNAL_ERROR');
  }
});

// ─── POST /:id/respond — 用户确认/拒绝 ─────────────────

const idParamSchema = z.object({
  id: z.string().uuid('确认记录ID必须是有效UUID'),
});

confirmationRouter.post('/:id/respond', async (req, res) => {
  const tenantId = req.tenantId;
  const userId = req.user?.userId;
  if (!tenantId || !userId) {
    return sendError(res, 'AUTH_INVALID_TOKEN');
  }

  const paramsParsed = idParamSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    return sendError(res, 'VALIDATION_ERROR', '确认记录ID格式无效', 400);
  }

  const bodyParsed = respondConfirmationSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    return sendError(res, 'VALIDATION_ERROR', '请求参数校验失败', 400, bodyParsed.error.issues);
  }

  try {
    const result = await respondToConfirmation(
      tenantId,
      userId,
      paramsParsed.data.id,
      bodyParsed.data,
    );

    if ('error' in result && result.error) {
      return sendError(res, result.error);
    }

    sendSuccess(res, result.data);
  } catch (err) {
    logger.error({ err, tenantId }, 'Respond to confirmation failed');
    sendError(res, 'INTERNAL_ERROR');
  }
});

// ─── GET / — 确认记录列表 ───────────────────────────────

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum(['pending', 'confirmed', 'rejected', 'expired', 'cancelled']).optional(),
  operationType: z.string().max(100).optional(),
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
});

confirmationRouter.get('/', async (req, res) => {
  const tenantId = req.tenantId;
  const userId = req.user?.userId;
  if (!tenantId || !userId) {
    return sendError(res, 'AUTH_INVALID_TOKEN');
  }

  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return sendError(res, 'VALIDATION_ERROR', '请求参数校验失败', 400, parsed.error.issues);
  }

  try {
    const { items, total } = await listConfirmations(tenantId, userId, parsed.data);

    sendSuccess(res, items, {
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
      total,
      totalPages: Math.ceil(total / parsed.data.pageSize),
    });
  } catch (err) {
    logger.error({ err, tenantId }, 'List confirmations failed');
    sendError(res, 'INTERNAL_ERROR');
  }
});

// ─── GET /:id/replay — 决策回放 ─────────────────────────

confirmationRouter.get('/:id/replay', async (req, res) => {
  const tenantId = req.tenantId;
  const userId = req.user?.userId;
  if (!tenantId || !userId) {
    return sendError(res, 'AUTH_INVALID_TOKEN');
  }

  const paramsParsed = idParamSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    return sendError(res, 'VALIDATION_ERROR', '确认记录ID格式无效', 400);
  }

  try {
    const replay = await getDecisionReplay(tenantId, paramsParsed.data.id);

    if (!replay) {
      return sendError(res, 'CONFIRMATION_NOT_FOUND');
    }

    sendSuccess(res, replay);
  } catch (err) {
    logger.error({ err, tenantId }, 'Decision replay failed');
    sendError(res, 'INTERNAL_ERROR');
  }
});
