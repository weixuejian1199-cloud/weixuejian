/**
 * ACI 客服中枢路由
 *
 * POST /api/v1/cs/message/incoming   — 第三方推送买家消息 (AC-01)
 * POST /api/v1/cs/message/:id/confirm — 人工确认AI草稿 (AC-08)
 * GET  /api/v1/cs/sessions            — 会话列表 (AC-09)
 * GET  /api/v1/cs/sessions/:id        — 会话详情 (AC-09)
 * GET  /api/v1/cs/sessions/:id/messages — 会话消息列表 (AC-09)
 * GET  /api/v1/cs/tickets             — 工单列表 (AC-09)
 */
import { Router } from 'express';
import { z } from 'zod';
import { handleIncomingMessage } from '../../services/cs/cs-orchestrator.js';
import * as sessionService from '../../services/cs/cs-session-service.js';
import * as messageService from '../../services/cs/cs-message-service.js';
import * as ticketService from '../../services/cs/cs-ticket-service.js';
import { sendSuccess, sendError } from '../../utils/response.js';
import { logger } from '../../utils/logger.js';
import type { CSSessionStatus, CSTicketStatus } from '@prisma/client';

export const csRouter = Router();

// ─── 请求校验 ────────────────────────────────────────────

const incomingMessageSchema = z.object({
  channelType: z.string().min(1),
  channelId: z.string().min(1),
  externalUserId: z.string().min(1),
  buyerName: z.string().optional(),
  orderId: z.string().optional(),
  content: z.string().min(1, '消息内容不能为空').max(5000),
  msgType: z.enum(['text', 'image']).default('text'),
});

const confirmSchema = z.object({
  action: z.enum(['send', 'edit_and_send', 'discard']),
  editedContent: z.string().max(5000).optional(),
});

const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

const sessionListSchema = paginationSchema.extend({
  status: z.string().optional(),
});

const ticketListSchema = paginationSchema.extend({
  status: z.string().optional(),
});

// ─── POST /message/incoming — 接收买家消息 ───────────────

csRouter.post('/message/incoming', async (req, res) => {
  const parsed = incomingMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 'VALIDATION_ERROR', '请求参数校验失败', 400, parsed.error.issues);
    return;
  }

  const tenantId = req.tenantId;
  const userId = req.user?.userId;
  if (!tenantId || !userId) {
    sendError(res, 'AUTH_INVALID_TOKEN', '认证信息不完整', 401);
    return;
  }

  // Phase 1: 不支持图片消息
  if (parsed.data.msgType === 'image') {
    sendError(res, 'CS_IMAGE_NOT_SUPPORTED');
    return;
  }

  try {
    const result = await handleIncomingMessage(tenantId, userId, parsed.data);
    sendSuccess(res, result);
  } catch (err) {
    logger.error({ err }, 'CS incoming message handler failed');
    sendError(res, 'INTERNAL_ERROR');
  }
});

// ─── POST /message/:id/confirm — 人工确认草稿 ───────────

csRouter.post('/message/:id/confirm', async (req, res) => {
  const parsed = confirmSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 'VALIDATION_ERROR', '请求参数校验失败', 400, parsed.error.issues);
    return;
  }

  const tenantId = req.tenantId;
  const userId = req.user?.userId;
  if (!tenantId || !userId) {
    sendError(res, 'AUTH_INVALID_TOKEN', '认证信息不完整', 401);
    return;
  }

  try {
    const result = await messageService.confirmDraft(
      req.params.id,
      tenantId,
      userId,
      parsed.data.action,
      parsed.data.editedContent,
    );
    sendSuccess(res, { messageId: req.params.id, ...result });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : '';
    if (errMsg === 'CS_MESSAGE_NOT_FOUND') {
      sendError(res, 'CS_MESSAGE_NOT_FOUND');
    } else if (errMsg === 'CS_MESSAGE_NOT_DRAFT') {
      sendError(res, 'CS_MESSAGE_NOT_DRAFT');
    } else {
      logger.error({ err }, 'CS confirm draft failed');
      sendError(res, 'INTERNAL_ERROR');
    }
  }
});

// ─── GET /sessions — 会话列表 ───────────────────────────

csRouter.get('/sessions', async (req, res) => {
  const parsed = sessionListSchema.safeParse(req.query);
  if (!parsed.success) {
    sendError(res, 'VALIDATION_ERROR', '请求参数校验失败', 400, parsed.error.issues);
    return;
  }

  const tenantId = req.tenantId;
  if (!tenantId) {
    sendError(res, 'AUTH_INVALID_TOKEN', '认证信息不完整', 401);
    return;
  }

  try {
    const result = await sessionService.listSessions(
      tenantId,
      parsed.data.page,
      parsed.data.pageSize,
      parsed.data.status as CSSessionStatus | undefined,
    );
    sendSuccess(res, result.items, {
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
      total: result.total,
    });
  } catch (err) {
    logger.error({ err }, 'CS list sessions failed');
    sendError(res, 'INTERNAL_ERROR');
  }
});

// ─── GET /sessions/:id — 会话详情 ──────────────────────

csRouter.get('/sessions/:id', async (req, res) => {
  const tenantId = req.tenantId;
  if (!tenantId) {
    sendError(res, 'AUTH_INVALID_TOKEN', '认证信息不完整', 401);
    return;
  }

  try {
    const session = await sessionService.getSessionById(req.params.id, tenantId);
    if (!session) {
      sendError(res, 'CS_SESSION_NOT_FOUND');
      return;
    }
    sendSuccess(res, session);
  } catch (err) {
    logger.error({ err }, 'CS get session failed');
    sendError(res, 'INTERNAL_ERROR');
  }
});

// ─── GET /sessions/:id/messages — 会话消息列表 ─────────

csRouter.get('/sessions/:id/messages', async (req, res) => {
  const parsed = paginationSchema.safeParse(req.query);
  if (!parsed.success) {
    sendError(res, 'VALIDATION_ERROR', '请求参数校验失败', 400, parsed.error.issues);
    return;
  }

  const tenantId = req.tenantId;
  if (!tenantId) {
    sendError(res, 'AUTH_INVALID_TOKEN', '认证信息不完整', 401);
    return;
  }

  try {
    const result = await messageService.listMessagesBySession(
      req.params.id,
      tenantId,
      parsed.data.page,
      parsed.data.pageSize,
    );
    sendSuccess(res, result.items, {
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
      total: result.total,
    });
  } catch (err) {
    logger.error({ err }, 'CS list messages failed');
    sendError(res, 'INTERNAL_ERROR');
  }
});

// ─── GET /tickets — 工单列表 ───────────────────────────

csRouter.get('/tickets', async (req, res) => {
  const parsed = ticketListSchema.safeParse(req.query);
  if (!parsed.success) {
    sendError(res, 'VALIDATION_ERROR', '请求参数校验失败', 400, parsed.error.issues);
    return;
  }

  const tenantId = req.tenantId;
  if (!tenantId) {
    sendError(res, 'AUTH_INVALID_TOKEN', '认证信息不完整', 401);
    return;
  }

  try {
    const result = await ticketService.listTickets(
      tenantId,
      parsed.data.page,
      parsed.data.pageSize,
      parsed.data.status as CSTicketStatus | undefined,
    );
    sendSuccess(res, result.items, {
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
      total: result.total,
    });
  } catch (err) {
    logger.error({ err }, 'CS list tickets failed');
    sendError(res, 'INTERNAL_ERROR');
  }
});
