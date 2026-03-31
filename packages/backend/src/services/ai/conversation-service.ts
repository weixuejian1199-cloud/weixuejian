/**
 * 会话管理服务
 *
 * AC-04: Conversation/Message 落库
 * AC-05: 最近 10 条消息作为上下文窗口
 */
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import type { Prisma, AgentType, MessageRole } from '@prisma/client';
import type { ChatMessage, ToolCallRequest } from './types.js';

/** Prisma JSON 字段中存储的 tool_call 结构 */
interface StoredToolCall {
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

/** Prisma JSON 字段中存储的 tool_result 结构 */
interface StoredToolResult {
  toolCallId?: string;
  toolName?: string;
  result?: unknown;
}

/** 类型安全地解析 Prisma JsonValue 为数组 */
function parseJsonArray<T>(value: Prisma.JsonValue | null): T[] {
  if (Array.isArray(value)) return value as T[];
  return [];
}

/** 上下文窗口大小 */
const CONTEXT_WINDOW_SIZE = 10;

/** 单次对话累计 token 上限 */
export const MAX_CONVERSATION_TOKENS = 10_000;

/**
 * 获取或创建会话
 */
export async function getOrCreateConversation(
  conversationId: string | undefined,
  tenantId: string,
  userId: string,
  agentType: AgentType = 'master',
): Promise<{ id: string; isNew: boolean; tokenUsed: number }> {
  if (conversationId) {
    const existing = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        tenantId,
        userId,
        deletedAt: null,
      },
      select: { id: true, tokenUsed: true },
    });

    if (existing) {
      return { id: existing.id, isNew: false, tokenUsed: existing.tokenUsed };
    }
    logger.warn({ conversationId, tenantId }, 'Conversation not found, creating new');
  }

  const conversation = await prisma.conversation.create({
    data: {
      tenantId,
      userId,
      agentType,
    },
    select: { id: true, tokenUsed: true },
  });

  return { id: conversation.id, isNew: true, tokenUsed: conversation.tokenUsed };
}

/**
 * 获取上下文消息（最近 N 条）
 */
export async function getContextMessages(
  conversationId: string,
  tenantId: string,
): Promise<ChatMessage[]> {
  const messages = await prisma.message.findMany({
    where: {
      conversationId,
      tenantId,
    },
    orderBy: { createdAt: 'desc' },
    take: CONTEXT_WINDOW_SIZE,
    select: {
      role: true,
      content: true,
      toolCalls: true,
      toolResults: true,
    },
  });

  // 倒序取回的消息需要反转为正序
  return messages.reverse().flatMap((msg) => {
    const result: ChatMessage[] = [];

    if (msg.role === 'user' || msg.role === 'system') {
      result.push({ role: msg.role, content: msg.content });
    } else if (msg.role === 'assistant') {
      const chatMsg: ChatMessage = { role: 'assistant', content: msg.content };
      if (msg.toolCalls && Array.isArray(msg.toolCalls)) {
        const storedCalls = parseJsonArray<StoredToolCall>(msg.toolCalls);
        chatMsg.tool_calls = storedCalls.map((tc): ToolCallRequest => ({
          id: String(tc.id ?? ''),
          type: 'function',
          function: {
            name: String(tc.function?.name ?? ''),
            arguments: String(tc.function?.arguments ?? ''),
          },
        }));
      }
      result.push(chatMsg);

      // 如果 assistant 消息有 tool_calls，对应的 tool results 也要加入
      if (msg.toolResults && Array.isArray(msg.toolResults)) {
        const storedResults = parseJsonArray<StoredToolResult>(msg.toolResults);
        for (const tr of storedResults) {
          result.push({
            role: 'tool',
            content: JSON.stringify(tr.result),
            tool_call_id: String(tr.toolCallId ?? ''),
            name: String(tr.toolName ?? ''),
          });
        }
      }
    }

    return result;
  });
}

/**
 * 保存用户消息
 */
export async function saveUserMessage(
  conversationId: string,
  tenantId: string,
  userId: string,
  content: string,
): Promise<string> {
  const msg = await prisma.message.create({
    data: {
      conversationId,
      tenantId,
      userId,
      role: 'user' as MessageRole,
      content,
    },
    select: { id: true },
  });
  return msg.id;
}

/**
 * 保存 AI 回复消息
 */
export async function saveAssistantMessage(
  conversationId: string,
  tenantId: string,
  userId: string,
  content: string,
  toolCalls?: unknown,
  toolResults?: unknown,
): Promise<string> {
  const msg = await prisma.message.create({
    data: {
      conversationId,
      tenantId,
      userId,
      role: 'assistant' as MessageRole,
      content,
      toolCalls: toolCalls ?? undefined,
      toolResults: toolResults ?? undefined,
    },
    select: { id: true },
  });
  return msg.id;
}

/**
 * 更新会话 token 消耗 + 标题
 */
export async function updateConversationMeta(
  conversationId: string,
  tenantId: string,
  tokenDelta: number,
  title?: string,
): Promise<void> {
  await prisma.conversation.updateMany({
    where: { id: conversationId, tenantId },
    data: {
      tokenUsed: { increment: tokenDelta },
      ...(title ? { title } : {}),
    },
  });
}

/**
 * 获取会话列表（分页）
 */
export async function listConversations(
  tenantId: string,
  userId: string,
  page: number,
  pageSize: number,
): Promise<{
  items: Array<{
    id: string;
    title: string | null;
    agentType: AgentType;
    tokenUsed: number;
    createdAt: Date;
    updatedAt: Date;
  }>;
  total: number;
}> {
  const [items, total] = await Promise.all([
    prisma.conversation.findMany({
      where: { tenantId, userId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        title: true,
        agentType: true,
        tokenUsed: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.conversation.count({
      where: { tenantId, userId, deletedAt: null },
    }),
  ]);

  return { items, total };
}
