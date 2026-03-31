/**
 * AI 对话路由
 *
 * POST /api/v1/ai/chat — SSE 流式对话
 * GET  /api/v1/ai/conversations — 会话列表
 * GET  /api/v1/ai/conversations/:id/messages — 会话消息列表
 */
import { Router } from 'express';
import { z } from 'zod';
import { orchestrateChat } from '../../services/ai/chat-orchestrator.js';
import { listConversations } from '../../services/ai/conversation-service.js';
import { sendSuccess, sendError } from '../../utils/response.js';
import { logger } from '../../utils/logger.js';
import { prisma } from '../../lib/prisma.js';
import type { SSEEvent } from '../../services/ai/types.js';

export const aiRouter = Router();

// ─── 请求校验 ────────────────────────────────────────────

const chatBodySchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().min(1, '消息不能为空').max(2000, '消息不能超过2000字'),
  agentType: z
    .enum(['master', 'operation', 'finance', 'settlement', 'customer_service', 'report', 'system', 'tool'])
    .default('master'),
});

const conversationsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

const messagesParamsSchema = z.object({
  id: z.string().uuid('会话ID必须是有效UUID'),
});

const messagesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

// ─── POST /chat — SSE 流式对话 ──────────────────────────

aiRouter.post('/chat', async (req, res) => {
  // 校验请求体
  const parsed = chatBodySchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 'VALIDATION_ERROR', '请求参数校验失败', 400, parsed.error.issues);
    return;
  }

  const { conversationId, message, agentType } = parsed.data;
  const tenantId = req.tenantId;
  const userId = req.user?.userId;

  if (!tenantId || !userId) {
    sendError(res, 'AUTH_INVALID_TOKEN', '认证信息不完整', 401);
    return;
  }

  // 查询用户名和租户名（多租户安全）
  let userName = '用户';
  let tenantName = '企业';
  try {
    const [user, tenant] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
      prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
    ]);
    if (user?.name) userName = user.name;
    if (tenant?.name) tenantName = tenant.name;
  } catch (err) {
    logger.warn({ err, userId, tenantId }, 'Failed to query user/tenant name, using defaults');
  }

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const sendSSE = async (event: SSEEvent): Promise<boolean> => {
    if (res.writableEnded) return false;
    try {
      const ok = res.write(`event: message\ndata: ${JSON.stringify(event)}\n\n`);
      if (!ok) {
        // 缓冲区满，等待drain事件（背压处理）
        await new Promise<void>((resolve) => res.once('drain', resolve));
      }
      return true;
    } catch (err) {
      logger.warn({ err }, 'SSE write failed, client likely disconnected');
      return false;
    }
  };

  try {
    const chatGen = orchestrateChat({
      conversationId,
      message,
      agentType,
      tenantId,
      userId,
      userName,
      role: req.user?.role ?? 'employee',
      tenantName,
    });

    for await (const event of chatGen) {
      if (!(await sendSSE(event))) break;
    }
  } catch (err) {
    logger.error({ err, tenantId, userId }, 'SSE chat error');
    sendSSE({
      type: 'error',
      code: 'INTERNAL_ERROR',
      message: '服务器内部错误，请稍后重试。',
      recoverable: true,
      messageId: 'error',
    });
  } finally {
    if (!res.writableEnded) {
      res.end();
    }
  }
});

// ─── GET /conversations — 会话列表 ──────────────────────

aiRouter.get('/conversations', async (req, res) => {
  const tenantId = req.tenantId;
  const userId = req.user?.userId;

  if (!tenantId || !userId) {
    sendError(res, 'AUTH_INVALID_TOKEN', '认证信息不完整', 401);
    return;
  }

  const parsed = conversationsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    sendError(res, 'VALIDATION_ERROR', '请求参数校验失败', 400, parsed.error.issues);
    return;
  }

  const { page, pageSize } = parsed.data;

  try {
    const { items, total } = await listConversations(tenantId, userId, page, pageSize);

    sendSuccess(res, items, {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (err) {
    logger.error({ err, tenantId, userId }, 'List conversations error');
    sendError(res, 'INTERNAL_ERROR', '获取会话列表失败', 500);
  }
});

// ─── GET /conversations/:id/messages — 会话消息列表 ────

aiRouter.get('/conversations/:id/messages', async (req, res) => {
  const tenantId = req.tenantId;
  const userId = req.user?.userId;

  if (!tenantId || !userId) {
    sendError(res, 'AUTH_INVALID_TOKEN', '认证信息不完整', 401);
    return;
  }

  // 校验路径参数
  const paramsParsed = messagesParamsSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    sendError(res, 'VALIDATION_ERROR', '会话ID格式无效', 400, paramsParsed.error.issues);
    return;
  }

  // 校验查询参数
  const queryParsed = messagesQuerySchema.safeParse(req.query);
  if (!queryParsed.success) {
    sendError(res, 'VALIDATION_ERROR', '请求参数校验失败', 400, queryParsed.error.issues);
    return;
  }

  const { id: conversationId } = paramsParsed.data;
  const { page, pageSize } = queryParsed.data;

  try {
    // 验证会话存在且属于当前用户和租户
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        tenantId,
        userId,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (!conversation) {
      sendError(res, 'RESOURCE_NOT_FOUND', '会话不存在');
      return;
    }

    // 分页查询消息
    const [items, total] = await Promise.all([
      prisma.message.findMany({
        where: {
          conversationId,
          tenantId,
        },
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          role: true,
          content: true,
          toolCalls: true,
          toolResults: true,
          createdAt: true,
        },
      }),
      prisma.message.count({
        where: {
          conversationId,
          tenantId,
        },
      }),
    ]);

    sendSuccess(res, { items, total }, {
      page,
      pageSize,
    });
  } catch (err) {
    logger.error({ err, tenantId, userId, conversationId }, 'List messages error');
    sendError(res, 'INTERNAL_ERROR', '获取消息列表失败', 500);
  }
});
