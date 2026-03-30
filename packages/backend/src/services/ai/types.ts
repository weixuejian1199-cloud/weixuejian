/**
 * AI 对话引擎类型定义
 */

// ─── 百炼 API 请求/响应（OpenAI 兼容格式）──────────────────

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCallRequest[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCallRequest {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatCompletionChunk {
  id: string;
  choices: Array<{
    delta: {
      role?: string;
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason: string | null;
  }>;
  model: string;
  usage?: TokenUsage;
}

export interface ChatCompletionResponse {
  id: string;
  choices: Array<{
    message: ChatMessage;
    finish_reason: string;
  }>;
  model: string;
  usage: TokenUsage;
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ─── 工具定义 ──────────────────────────────────────────────

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolExecutionResult {
  toolCallId: string;
  toolName: string;
  result: unknown;
  duration: number;
  cached: boolean;
  error?: string;
}

// ─── SSE 事件类型 ──────────────────────────────────────────

export type SSEEvent =
  | SSEThinking
  | SSETextChunk
  | SSETextComplete
  | SSEToolCallStart
  | SSEToolCallResult
  | SSEError
  | SSEStreamEnd;

export interface SSEThinking {
  type: 'thinking';
  content: string;
  messageId: string;
}

export interface SSETextChunk {
  type: 'text_chunk';
  content: string;
  messageId: string;
  index: number;
}

export interface SSETextComplete {
  type: 'text_complete';
  content: string;
  messageId: string;
  tokenUsage: TokenUsage;
}

export interface SSEToolCallStart {
  type: 'tool_call_start';
  toolName: string;
  toolCallId: string;
  parameters: Record<string, unknown>;
  messageId: string;
}

export interface SSEToolCallResult {
  type: 'tool_call_result';
  toolName: string;
  toolCallId: string;
  result: unknown;
  duration: number;
  cached: boolean;
  messageId: string;
}

export interface SSEError {
  type: 'error';
  code: string;
  message: string;
  recoverable: boolean;
  messageId: string;
}

export interface SSEStreamEnd {
  type: 'stream_end';
  conversationId: string;
  messageId: string;
  totalDuration: number;
  totalTokens: number;
}
