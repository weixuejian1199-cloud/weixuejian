/**
 * AI 对话路由
 *
 * POST /api/v1/ai/chat — SSE 流式对话
 * GET  /api/v1/ai/conversations — 会话列表
 */
import { Router } from 'express';
import { z } from 'zod';
import { orchestrateChat } from '../../services/ai/chat-orchestrator.js';
import { listConversations } from '../../services/ai/conversation-service.js';
import { sendSuccess, sendError } from '../../utils/response.js';
import { logger } from '../../utils/logger.js';
import type { SSEEvent } from '../../services/ai/types.js';

export const aiRouter = Router();

// ─── 请求校验 ────────────────────────────────────────────

const chatBodySchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().min(1, '消息不能为空').max(2000, '消息不能超过2000字'),
  agentType: z.enum([
    'master', 'operation', 'finance', 'customer_service', 'report', 'system',
  ]).default('master'),
});

const conversationsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
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

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const sendSSE = (event: SSEEvent): boolean => {
    if (res.writableEnded) return false;
    try {
      res.write(`event: message\ndata: ${JSON.stringify(event)}\n\n`);
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
      userName: req.user?.userId ?? '用户',
      role: req.user?.role ?? 'employee',
      tenantName: '时皙',
    });

    for await (const event of chatGen) {
      if (!sendSSE(event)) break;
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
