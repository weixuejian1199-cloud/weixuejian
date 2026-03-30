/**
 * AI Client — 百炼 DashScope API 封装
 *
 * OpenAI 兼容格式，原生 fetch + ReadableStream 解析 SSE。
 * 零新依赖，与 MallAdapter 风格一致。
 */
import { env } from '../../lib/env.js';
import { logger } from '../../utils/logger.js';
import type {
  ChatMessage,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ToolDefinition,
  TokenUsage,
} from './types.js';

/** 单次 API 调用超时 30 秒 */
const REQUEST_TIMEOUT_MS = 30_000;

/** tool_call 最多循环 3 轮（防无限循环）*/
export const MAX_TOOL_CALL_ROUNDS = 3;

/** 单次对话最大 token */
export const MAX_TOKENS_PER_TURN = 2048;

export interface AiClientOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  tools?: ToolDefinition[];
}

export interface StreamChunk {
  type: 'content' | 'tool_calls' | 'done';
  content?: string;
  toolCalls?: Array<{
    index: number;
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>;
  finishReason?: string;
  usage?: TokenUsage;
}

/**
 * 调用百炼 Qwen API（非流式，用于 tool_call 循环中间步骤）
 */
export async function chatCompletion(
  messages: ChatMessage[],
  options: AiClientOptions = {},
): Promise<ChatCompletionResponse> {
  const apiKey = env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    throw new AiClientError('DASHSCOPE_API_KEY not configured', 'AI_SERVICE_UNAVAILABLE');
  }

  const baseUrl = env.DASHSCOPE_BASE_URL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  const model = options.model ?? env.DASHSCOPE_MODEL ?? 'qwen-plus';

  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: options.maxTokens ?? MAX_TOKENS_PER_TURN,
    temperature: options.temperature ?? 0.7,
    stream: false,
  };

  if (options.tools && options.tools.length > 0) {
    body['tools'] = options.tools;
    body['tool_choice'] = 'auto';
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown');
      throw new AiClientError(
        `DashScope API error: ${response.status} ${errorText}`,
        response.status === 429 ? 'AI_RATE_LIMITED' : 'AI_SERVICE_UNAVAILABLE',
      );
    }

    return (await response.json()) as ChatCompletionResponse;
  } catch (err) {
    if (err instanceof AiClientError) throw err;
    if ((err as Error).name === 'AbortError') {
      throw new AiClientError('DashScope API timeout', 'AI_SERVICE_UNAVAILABLE');
    }
    throw new AiClientError(
      `DashScope API network error: ${(err as Error).message}`,
      'AI_SERVICE_UNAVAILABLE',
    );
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 调用百炼 Qwen API（流式，返回 AsyncGenerator）
 */
export async function* chatStream(
  messages: ChatMessage[],
  options: AiClientOptions = {},
): AsyncGenerator<StreamChunk> {
  const apiKey = env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    throw new AiClientError('DASHSCOPE_API_KEY not configured', 'AI_SERVICE_UNAVAILABLE');
  }

  const baseUrl = env.DASHSCOPE_BASE_URL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  const model = options.model ?? env.DASHSCOPE_MODEL ?? 'qwen-plus';

  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: options.maxTokens ?? MAX_TOKENS_PER_TURN,
    temperature: options.temperature ?? 0.7,
    stream: true,
    stream_options: { include_usage: true },
  };

  if (options.tools && options.tools.length > 0) {
    body['tools'] = options.tools;
    body['tool_choice'] = 'auto';
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown');
      throw new AiClientError(
        `DashScope API error: ${response.status} ${errorText}`,
        response.status === 429 ? 'AI_RATE_LIMITED' : 'AI_SERVICE_UNAVAILABLE',
      );
    }

    if (!response.body) {
      throw new AiClientError('No response body for streaming', 'AI_SERVICE_UNAVAILABLE');
    }

    yield* parseSSEStream(response.body);
  } catch (err) {
    if (err instanceof AiClientError) throw err;
    if ((err as Error).name === 'AbortError') {
      throw new AiClientError('DashScope API timeout', 'AI_SERVICE_UNAVAILABLE');
    }
    throw new AiClientError(
      `DashScope API network error: ${(err as Error).message}`,
      'AI_SERVICE_UNAVAILABLE',
    );
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 解析 SSE 流为 StreamChunk
 */
async function* parseSSEStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // 保留最后一行（可能不完整）
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;

        if (trimmed.startsWith('data: ')) {
          const data = trimmed.slice(6);
          if (data === '[DONE]') {
            return;
          }

          let chunk: ChatCompletionChunk;
          try {
            chunk = JSON.parse(data) as ChatCompletionChunk;
          } catch {
            logger.warn({ data }, 'Failed to parse SSE chunk');
            continue;
          }

          const choice = chunk.choices[0];
          if (!choice) continue;

          const delta = choice.delta;

          if (delta.tool_calls && delta.tool_calls.length > 0) {
            yield {
              type: 'tool_calls',
              toolCalls: delta.tool_calls,
              finishReason: choice.finish_reason ?? undefined,
              usage: chunk.usage,
            };
          } else if (delta.content) {
            yield {
              type: 'content',
              content: delta.content,
              finishReason: choice.finish_reason ?? undefined,
              usage: chunk.usage,
            };
          }

          if (choice.finish_reason) {
            yield {
              type: 'done',
              finishReason: choice.finish_reason,
              usage: chunk.usage,
            };
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** AI 相关错误码子集 */
export type AiErrorCode = 'AI_SERVICE_UNAVAILABLE' | 'AI_RATE_LIMITED' | 'AI_CONTEXT_TOO_LONG';

/**
 * AI Client 错误
 */
export class AiClientError extends Error {
  readonly code: AiErrorCode;

  constructor(message: string, code: AiErrorCode) {
    super(message);
    this.name = 'AiClientError';
    this.code = code;
  }
}
