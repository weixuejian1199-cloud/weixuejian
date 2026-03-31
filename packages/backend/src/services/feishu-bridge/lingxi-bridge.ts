/**
 * 飞书灵犀 Bridge — Wave 7.5
 *
 * 飞书号2「灵犀」→ AI对话引擎（orchestrateChat 直调）
 *
 * 架构：内嵌于 backend 进程，共享 Prisma/Redis 连接。
 * 功能开关：FEISHU_LINGXI_APP_ID 不设则不启动。
 */
import * as lark from '@larksuiteoapi/node-sdk';
import { env } from '../../lib/env.js';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { orchestrateChat } from '../ai/chat-orchestrator.js';

// ─── 飞书事件消息结构 ───────────────────────────────────────

/** 飞书 im.message.receive_v1 事件中的 message 字段 */
interface FeishuEventMessage {
  message_id?: string;
  chat_id?: string;
  message_type?: string;
  content?: string;
}

/** 飞书 im.message.receive_v1 事件中的 sender 字段 */
interface FeishuEventSender {
  sender_id?: {
    open_id?: string;
  };
}

/** 飞书 im.message.receive_v1 事件 payload */
interface FeishuMessageEvent {
  message?: FeishuEventMessage;
  sender?: FeishuEventSender;
}

/** 安全地将 unknown 转为飞书事件结构 */
function asFeishuEvent(data: unknown): FeishuMessageEvent {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return data as FeishuMessageEvent;
  }
  return {};
}

// ─── 配置常量 ────────────────────────────────────────────

const SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4小时
const DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5分钟去重
const MAX_INPUT_LENGTH = 10_000; // 10KB
const MAX_RESPONSE_LEN = 4000; // 飞书文本消息上限
const RATE_LIMIT_PER_MIN = 10;
const MAX_QUEUE_SIZE = 20;
const CLEANUP_INTERVAL_MS = 30 * 60 * 1000; // 30分钟清理

// ─── 运行时状态 ──────────────────────────────────────────

let feishuClient: lark.Client | null = null;
let wsClient: lark.WSClient | null = null;
let cleanupTimer: NodeJS.Timeout | null = null;

/** 服务账户上下文（启动时从数据库查询） */
let serviceCtx: {
  tenantId: string;
  userId: string;
  userName: string;
  tenantName: string;
} | null = null;

// ─── 会话管理（feishuChatId → conversationId）──────────

const sessions = new Map<string, { conversationId: string; updatedAt: number }>();

function getConversationId(chatId: string): string | undefined {
  const entry = sessions.get(chatId);
  if (!entry) return undefined;
  if (Date.now() - entry.updatedAt > SESSION_TTL_MS) {
    sessions.delete(chatId);
    logger.info({ chatId }, '[lingxi] Session expired (TTL)');
    return undefined;
  }
  return entry.conversationId;
}

function saveConversationId(chatId: string, conversationId: string): void {
  sessions.set(chatId, { conversationId, updatedAt: Date.now() });
}

function clearSession(chatId: string): void {
  sessions.delete(chatId);
  logger.info({ chatId }, '[lingxi] Session cleared');
}

// ─── 去重（5分钟窗口）──────────────────────────────────

const processedMessages = new Map<string, number>();

function isDuplicate(messageId: string): boolean {
  if (processedMessages.has(messageId)) return true;
  processedMessages.set(messageId, Date.now());
  // 清理过期条目
  const now = Date.now();
  for (const [id, time] of processedMessages) {
    if (now - time > DEDUP_WINDOW_MS) processedMessages.delete(id);
  }
  return false;
}

// ─── 限流（per-chatId，每分钟 N 条）────────────────────

const rateCounts = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(chatId: string): boolean {
  const now = Date.now();
  const entry = rateCounts.get(chatId);
  if (!entry || now > entry.resetAt) {
    rateCounts.set(chatId, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_PER_MIN;
}

// ─── 输入校验 ────────────────────────────────────────────

function isValidUtf8Text(str: string): boolean {
  if (typeof str !== 'string') return false;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    // 拒绝控制字符（除了 \t=9, \n=10, \r=13）
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) return false;
  }
  return true;
}

// ─── 并发队列（per-chatId 串行）─────────────────────────

const chatLocks = new Map<string, { processing: boolean; queue: Array<() => Promise<void>> }>();

async function enqueueTask(chatId: string, fn: () => Promise<void>): Promise<void> {
  if (!chatLocks.has(chatId)) {
    chatLocks.set(chatId, { processing: false, queue: [] });
  }
  const lock = chatLocks.get(chatId)!;

  if (!lock.processing) {
    lock.processing = true;
    try {
      await fn();
    } finally {
      lock.processing = false;
      if (lock.queue.length > 0) {
        const next = lock.queue.shift()!;
        enqueueTask(chatId, next).catch((err: unknown) => {
          logger.error({ chatId, err: (err as Error).message }, '[lingxi] Queued task failed');
        });
      } else {
        chatLocks.delete(chatId);
      }
    }
  } else {
    if (lock.queue.length >= MAX_QUEUE_SIZE) {
      logger.warn({ chatId, queueSize: lock.queue.length }, '[lingxi] Queue full, dropping');
      return;
    }
    lock.queue.push(fn);
  }
}

// ─── AI 引擎调用（核心）──────────────────────────────────

export async function callAiEngine(
  message: string,
  conversationId?: string,
): Promise<{ text: string; conversationId?: string }> {
  if (!serviceCtx) throw new Error('Lingxi bridge not initialized');

  const chatGen = orchestrateChat({
    conversationId,
    message,
    agentType: 'master',
    tenantId: serviceCtx.tenantId,
    userId: serviceCtx.userId,
    userName: serviceCtx.userName,
    role: 'owner',
    tenantName: serviceCtx.tenantName,
  });

  let fullText = '';
  let resultConversationId = conversationId;

  for await (const event of chatGen) {
    switch (event.type) {
      case 'text_chunk':
        fullText += event.content;
        break;
      case 'stream_end':
        resultConversationId = event.conversationId;
        break;
      case 'error':
        throw new Error(event.message);
    }
  }

  return {
    text: fullText || '(无返回内容)',
    conversationId: resultConversationId,
  };
}

// ─── 发送飞书消息（带重试）──────────────────────────────

async function sendText(chatId: string, text: string, retries = 2): Promise<boolean> {
  if (!feishuClient) return false;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await feishuClient.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          msg_type: 'text',
          content: JSON.stringify({ text }),
        },
      });
      return true;
    } catch (err) {
      if (attempt === retries) {
        logger.error(
          { chatId, err: (err as Error).message, attempts: attempt + 1 },
          '[lingxi] Send failed (all retries exhausted)',
        );
        return false;
      }
      logger.warn(
        { chatId, err: (err as Error).message, attempt: attempt + 1 },
        '[lingxi] Send failed, retrying...',
      );
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  return false;
}

// ─── 消息处理 ────────────────────────────────────────────

async function handleMessage(event: FeishuMessageEvent): Promise<void> {
  const message = event.message;
  const sender = event.sender;

  if (!message?.message_id) return;
  const messageId = String(message.message_id);
  if (isDuplicate(messageId)) return;

  const chatId = String(message.chat_id);
  const senderId = sender?.sender_id?.open_id ?? 'unknown';

  if (message.message_type !== 'text') {
    await sendText(chatId, '目前只支持文本消息。');
    return;
  }

  let text: string;
  try {
    const content = JSON.parse(String(message.content)) as { text?: string };
    text = content.text ?? '';
  } catch {
    logger.warn({ content: message.content, chatId }, '[lingxi] Failed to parse message content JSON');
    return;
  }

  if (!text || text.trim() === '') return;

  if (!isValidUtf8Text(text)) {
    logger.warn({ senderId, chatId }, '[lingxi] Invalid message content rejected');
    await sendText(chatId, '消息包含无效字符，请重新输入');
    return;
  }

  if (text.length > MAX_INPUT_LENGTH) {
    await sendText(
      chatId,
      `消息太长了（${text.length}字），最多支持${MAX_INPUT_LENGTH}字。请精简后重发。`,
    );
    return;
  }

  logger.info({ senderId, chatId, text: text.slice(0, 100) }, '[lingxi] Message received');

  if (isRateLimited(chatId)) {
    await sendText(chatId, '消息太频繁了，稍等一下再发。');
    return;
  }

  // 特殊指令
  const trimmed = text.trim();

  if (trimmed === '新对话' || trimmed === '重置') {
    clearSession(chatId);
    await sendText(chatId, '新对话已开始。');
    return;
  }

  if (trimmed === '状态') {
    const conversationId = getConversationId(chatId);
    const info = [
      '灵犀AI助手',
      `会话: ${conversationId ? conversationId.slice(0, 8) : '无'}`,
      `活跃会话: ${sessions.size}`,
      `运行时间: ${(process.uptime() / 3600).toFixed(1)}h`,
      `内存: ${(process.memoryUsage.rss() / 1024 / 1024).toFixed(0)}MB`,
    ].join('\n');
    await sendText(chatId, info);
    return;
  }

  // 入队处理
  enqueueTask(chatId, async () => {
    try {
      const startTime = Date.now();
      const conversationId = getConversationId(chatId);
      const result = await callAiEngine(text, conversationId);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      if (result.conversationId) {
        saveConversationId(chatId, result.conversationId);
      }

      const answer = result.text;
      if (answer.length > MAX_RESPONSE_LEN) {
        await sendText(chatId, answer.slice(0, MAX_RESPONSE_LEN) + '\n...(消息过长，已截断)');
      } else {
        await sendText(chatId, answer);
      }

      logger.info(
        { chatId, elapsed: `${elapsed}s`, conversationId: result.conversationId?.slice(0, 8) },
        '[lingxi] Response sent',
      );
    } catch (err) {
      logger.error({ chatId, err: (err as Error).message }, '[lingxi] AI engine call failed');
      await sendText(chatId, `出了点问题：${(err as Error).message}`);
    }
  });
}

// ─── 启动 / 停止 ────────────────────────────────────────

export async function startLingxiBridge(): Promise<void> {
  const appId = env.FEISHU_LINGXI_APP_ID;
  const appSecret = env.FEISHU_LINGXI_APP_SECRET;
  const tenantId = env.FEISHU_LINGXI_SERVICE_TENANT_ID;
  const userId = env.FEISHU_LINGXI_SERVICE_USER_ID;

  if (!appId || !appSecret || !tenantId || !userId) {
    throw new Error(
      '[lingxi] Missing required env: FEISHU_LINGXI_APP_ID, APP_SECRET, SERVICE_TENANT_ID, SERVICE_USER_ID',
    );
  }

  // fail-secure: 验证服务账户存在
  const [user, tenant] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, tenantId: true } }),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
  ]);

  if (!user) throw new Error(`[lingxi] Service user not found: ${userId}`);
  if (!tenant) throw new Error(`[lingxi] Service tenant not found: ${tenantId}`);
  if (user.tenantId !== tenantId) {
    throw new Error(`[lingxi] Service user tenantId mismatch: ${user.tenantId} !== ${tenantId}`);
  }

  serviceCtx = {
    tenantId,
    userId,
    userName: user.name,
    tenantName: tenant.name,
  };

  // 飞书客户端
  feishuClient = new lark.Client({
    appId,
    appSecret,
    appType: lark.AppType.SelfBuild,
    domain: lark.Domain.Feishu,
  });

  // WebSocket 长连接
  wsClient = new lark.WSClient({
    appId,
    appSecret,
    loggerLevel: lark.LoggerLevel.info,
    domain: lark.Domain.Feishu,
  });

  wsClient.start({
    eventDispatcher: new lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data: unknown) => {
        try {
          await handleMessage(asFeishuEvent(data));
        } catch (err) {
          logger.error({ err: err instanceof Error ? err.message : String(err) }, '[lingxi] Unhandled error in handler');
        }
        return {};
      },
    }),
  });

  // 定期清理过期 session
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [chatId, entry] of sessions) {
      if (now - entry.updatedAt > SESSION_TTL_MS) {
        sessions.delete(chatId);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      logger.info({ cleaned, remaining: sessions.size }, '[lingxi] Session cleanup');
    }
  }, CLEANUP_INTERVAL_MS);

  logger.info({ appId, tenantId, userName: user.name }, '[lingxi] Bridge started');
}

export function stopLingxiBridge(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
  sessions.clear();
  processedMessages.clear();
  rateCounts.clear();
  chatLocks.clear();
  feishuClient = null;
  wsClient = null;
  serviceCtx = null;
  logger.info('[lingxi] Bridge stopped');
}

// ─── 测试辅助（仅测试环境导出）─────────────────────────

export const _testHelpers = {
  isDuplicate,
  isRateLimited,
  isValidUtf8Text,
  getConversationId,
  saveConversationId,
  clearSession,
  handleMessage,
  get sessions() {
    return sessions;
  },
  get processedMessages() {
    return processedMessages;
  },
  get rateCounts() {
    return rateCounts;
  },
  setServiceCtx(ctx: typeof serviceCtx) {
    serviceCtx = ctx;
  },
  setFeishuClient(client: lark.Client | null) {
    feishuClient = client;
  },
};
