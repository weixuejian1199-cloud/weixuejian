/**
 * AI 对话编排器
 *
 * 串联 ai-client + tool-registry + conversation-service，
 * 实现完整的对话流程：SSE 流式输出 + tool_call 循环。
 */
import { randomUUID } from 'crypto';
import { chatStream, chatCompletion, AiClientError } from './ai-client.js';
import { TOOL_DEFINITIONS, executeTool } from './tool-registry.js';
import { buildSystemPrompt, type PromptContext } from './system-prompt.js';
import {
  getOrCreateConversation,
  getContextMessages,
  saveUserMessage,
  saveAssistantMessage,
  updateConversationMeta,
  MAX_CONVERSATION_TOKENS,
} from './conversation-service.js';
import { logger } from '../../utils/logger.js';
import { recordAiRequest } from '../../routes/metrics.js';
import type { ChatMessage, SSEEvent, ToolExecutionResult, TokenUsage } from './types.js';
import type { AgentType } from '@prisma/client';

export interface ChatRequest {
  conversationId?: string;
  message: string;
  agentType?: AgentType;
  tenantId: string;
  userId: string;
  userName: string;
  role: string;
  tenantName: string;
}

/**
 * 执行对话，返回 SSE 事件流
 */
export async function* orchestrateChat(req: ChatRequest): AsyncGenerator<SSEEvent> {
  const startTime = Date.now();
  const messageId = randomUUID();

  // 1. 会话管理
  const { id: conversationId, tokenUsed } = await getOrCreateConversation(
    req.conversationId,
    req.tenantId,
    req.userId,
    req.agentType ?? 'master',
  );

  // token 上限检查
  if (tokenUsed >= MAX_CONVERSATION_TOKENS) {
    yield {
      type: 'error',
      code: 'AI_CONTEXT_TOO_LONG',
      message: '对话上下文已超出限制，请开始新会话。',
      recoverable: false,
      messageId,
    };
    return;
  }

  // 2. 保存用户消息
  await saveUserMessage(conversationId, req.tenantId, req.userId, req.message);

  // 3. 构建上下文
  const promptCtx: PromptContext = {
    userName: req.userName,
    role: req.role,
    tenantName: req.tenantName,
  };
  const systemPrompt = buildSystemPrompt(promptCtx);
  const contextMessages = await getContextMessages(conversationId, req.tenantId);

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...contextMessages,
    { role: 'user', content: req.message },
  ];

  // 4. thinking
  yield { type: 'thinking', content: '正在理解您的问题...', messageId };

  // 5. 流式调用 + tool_call 循环
  let fullContent: string;
  let totalUsage: TokenUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let allToolCalls: unknown[] = [];
  let allToolResults: ToolExecutionResult[] = [];
  let chunkIndex = 0;

  try {
    const pendingToolCalls: Array<{ id: string; name: string; arguments: string }> = [];
    let streamContent = '';

    for await (const chunk of chatStream(messages, { tools: TOOL_DEFINITIONS })) {
      if (chunk.type === 'content' && chunk.content) {
        streamContent += chunk.content;
        yield {
          type: 'text_chunk',
          content: chunk.content,
          messageId,
          index: chunkIndex++,
        };
      } else if (chunk.type === 'tool_calls' && chunk.toolCalls) {
        for (const tc of chunk.toolCalls) {
          // 累积 tool_call（流式中可能分多个 chunk）
          if (!pendingToolCalls[tc.index]) {
            pendingToolCalls[tc.index] = {
              id: tc.id ?? '',
              name: tc.function?.name ?? '',
              arguments: tc.function?.arguments ?? '',
            };
          } else {
            const existing = pendingToolCalls[tc.index]!;
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name += tc.function.name;
            if (tc.function?.arguments) existing.arguments += tc.function.arguments;
          }
        }
      } else if (chunk.type === 'done') {
        if (chunk.usage) {
          totalUsage = addUsage(totalUsage, chunk.usage);
        }
      }
    }

    fullContent = streamContent;

    // 6. 处理 tool_calls（如果有）
    if (pendingToolCalls.length > 0) {
      const toolCallResults = await handleToolCalls(
        pendingToolCalls,
        messages,
        messageId,
        req.tenantId,
        totalUsage,
      );

      // yield tool events
      for (const event of toolCallResults.events) {
        yield event;
      }

      allToolCalls = pendingToolCalls;
      allToolResults = toolCallResults.results;

      // tool_call 后 AI 继续生成最终回复
      if (toolCallResults.finalContent) {
        fullContent = toolCallResults.finalContent;
        for (const event of toolCallResults.textEvents) {
          yield event;
        }
      }
      totalUsage = addUsage(totalUsage, toolCallResults.usage);
    }

    // 7. text_complete
    if (fullContent) {
      yield {
        type: 'text_complete',
        content: fullContent,
        messageId,
        tokenUsage: totalUsage,
      };
    }

    // 8. 保存 AI 回复
    await saveAssistantMessage(
      conversationId,
      req.tenantId,
      req.userId,
      fullContent,
      allToolCalls.length > 0 ? allToolCalls : undefined,
      allToolResults.length > 0 ? allToolResults : undefined,
    );

    // 9. 更新会话 meta
    const title = !req.conversationId ? generateTitle(req.message) : undefined;
    await updateConversationMeta(conversationId, totalUsage.total_tokens, title);

    // 10. stream_end
    recordAiRequest(true);
    yield {
      type: 'stream_end',
      conversationId,
      messageId,
      totalDuration: Date.now() - startTime,
      totalTokens: totalUsage.total_tokens,
    };
  } catch (err) {
    recordAiRequest(false);
    if (err instanceof AiClientError) {
      yield {
        type: 'error',
        code: err.code,
        message: getErrorMessage(err.code),
        recoverable: err.code !== 'AI_CONTEXT_TOO_LONG',
        messageId,
      };
    } else {
      logger.error({ err }, 'Chat orchestration error');
      yield {
        type: 'error',
        code: 'AI_SERVICE_UNAVAILABLE',
        message: 'AI 服务暂时不可用，请稍后重试。',
        recoverable: true,
        messageId,
      };
    }
  }
}

/**
 * 处理 tool_calls：执行工具 → 回传结果 → AI 继续生成
 */
async function handleToolCalls(
  toolCalls: Array<{ id: string; name: string; arguments: string }>,
  messages: ChatMessage[],
  messageId: string,
  tenantId: string,
  _existingUsage: TokenUsage,
): Promise<{
  events: SSEEvent[];
  textEvents: SSEEvent[];
  results: ToolExecutionResult[];
  finalContent: string;
  usage: TokenUsage;
}> {
  const events: SSEEvent[] = [];
  const textEvents: SSEEvent[] = [];
  const results: ToolExecutionResult[] = [];
  let usage: TokenUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  // 构建 assistant 消息（含 tool_calls）
  const assistantMsg: ChatMessage = {
    role: 'assistant',
    content: null,
    tool_calls: toolCalls.map((tc) => ({
      id: tc.id,
      type: 'function' as const,
      function: { name: tc.name, arguments: tc.arguments },
    })),
  };

  const updatedMessages = [...messages, assistantMsg];

  // 执行每个工具
  for (const tc of toolCalls) {
    let parsedArgs: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(tc.arguments);
      if (!isPlainObject(parsed)) throw new Error('not an object');
      parsedArgs = parsed;
    } catch {
      // fail-secure: 参数解析失败，记录错误，跳过此工具
      const errorResult: ToolExecutionResult = {
        toolCallId: tc.id,
        toolName: tc.name,
        result: null,
        duration: 0,
        cached: false,
        error: `参数解析失败: ${tc.arguments}`,
      };
      results.push(errorResult);
      updatedMessages.push({
        role: 'tool',
        content: JSON.stringify({ error: errorResult.error }),
        tool_call_id: tc.id,
        name: tc.name,
      });
      continue;
    }

    events.push({
      type: 'tool_call_start',
      toolName: tc.name,
      toolCallId: tc.id,
      parameters: parsedArgs,
      messageId,
    });

    const result = await executeTool(tc.id, tc.name, tc.arguments, tenantId);
    results.push(result);

    // P0-1: 剥离内部字段后再发送给客户端
    events.push({
      type: 'tool_call_result',
      toolName: tc.name,
      toolCallId: tc.id,
      result: stripInternalFields(result.result),
      duration: result.duration,
      cached: result.cached,
      messageId,
    });

    // 把工具结果加入消息
    updatedMessages.push({
      role: 'tool',
      content: result.error
        ? JSON.stringify({ error: result.error })
        : JSON.stringify(result.result),
      tool_call_id: tc.id,
      name: tc.name,
    });
  }

  // AI 根据工具结果继续生成（非流式，因为 tool_call 后的回复通常不长）
  let finalContent = '';
  try {
    const response = await chatCompletion(updatedMessages, { tools: TOOL_DEFINITIONS });
    const choice = response.choices[0];
    if (choice?.message.content) {
      finalContent = choice.message.content;
      // 拆分为 text_chunk events
      textEvents.push({
        type: 'text_chunk',
        content: finalContent,
        messageId,
        index: 0,
      });
    }
    if (response.usage) {
      usage = response.usage;
    }

    // 如果 AI 又要调工具（嵌套），限制轮次
    if (choice?.message.tool_calls && choice.message.tool_calls.length > 0) {
      logger.warn({ round: 2 }, 'Nested tool_call detected, using non-streaming fallback');
      // Phase 1 不支持嵌套 tool_call，直接用当前结果
    }
  } catch (err) {
    logger.error({ err }, 'Failed to generate final response after tool_call');
    finalContent = '工具查询完成，但生成回复时遇到问题。请查看上方的数据结果。';
    textEvents.push({
      type: 'text_chunk',
      content: finalContent,
      messageId,
      index: 0,
    });
  }

  return { events, textEvents, results, finalContent, usage };
}

function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    prompt_tokens: a.prompt_tokens + b.prompt_tokens,
    completion_tokens: a.completion_tokens + b.completion_tokens,
    total_tokens: a.total_tokens + b.total_tokens,
  };
}

function generateTitle(message: string): string {
  return message.length > 30 ? message.slice(0, 30) + '...' : message;
}

function getErrorMessage(code: string): string {
  switch (code) {
    case 'AI_RATE_LIMITED':
      return 'AI 调用频率限制，请稍后再试。';
    case 'AI_CONTEXT_TOO_LONG':
      return '对话上下文已超出限制，请开始新会话。';
    default:
      return 'AI 服务暂时不可用，请稍后重试。';
  }
}

/** P0-1: 剥离内部标记字段，防止泄露给客户端 */
function stripInternalFields(data: unknown): unknown {
  if (isPlainObject(data)) {
    const copy = { ...data };
    delete copy['_dataSource'];
    delete copy['_queryTime'];
    return copy;
  }
  return data;
}

/** 类型守卫：判断是否为普通对象 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
