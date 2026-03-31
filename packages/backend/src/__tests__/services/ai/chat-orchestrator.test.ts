import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── hoisted mocks ─────────────────────────────────────────
const mocks = vi.hoisted(() => {
  class MockAiClientError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = 'AiClientError';
      this.code = code;
    }
  }

  return {
    chatStream: vi.fn(),
    chatCompletion: vi.fn(),
    AiClientError: MockAiClientError,
    TOOL_DEFINITIONS: [
      {
        type: 'function' as const,
        function: { name: 'getSalesStats', description: 'test', parameters: {} },
      },
    ],
    executeTool: vi.fn(),
    buildSystemPrompt: vi.fn().mockReturnValue('mock-system-prompt'),
    getOrCreateConversation: vi.fn(),
    getContextMessages: vi.fn().mockResolvedValue([]),
    saveUserMessage: vi.fn().mockResolvedValue('msg-id'),
    saveAssistantMessage: vi.fn().mockResolvedValue('ast-id'),
    updateConversationMeta: vi.fn().mockResolvedValue(undefined),
    MAX_CONVERSATION_TOKENS: 10_000,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn(() => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      })),
    },
  };
});

vi.mock('../../../services/ai/ai-client.js', () => ({
  chatStream: mocks.chatStream,
  chatCompletion: mocks.chatCompletion,
  AiClientError: mocks.AiClientError,
}));

vi.mock('../../../services/ai/tool-registry.js', () => ({
  TOOL_DEFINITIONS: mocks.TOOL_DEFINITIONS,
  executeTool: mocks.executeTool,
}));

vi.mock('../../../services/ai/system-prompt.js', () => ({
  buildSystemPrompt: mocks.buildSystemPrompt,
}));

vi.mock('../../../services/ai/conversation-service.js', () => ({
  getOrCreateConversation: mocks.getOrCreateConversation,
  getContextMessages: mocks.getContextMessages,
  saveUserMessage: mocks.saveUserMessage,
  saveAssistantMessage: mocks.saveAssistantMessage,
  updateConversationMeta: mocks.updateConversationMeta,
  MAX_CONVERSATION_TOKENS: mocks.MAX_CONVERSATION_TOKENS,
}));

vi.mock('../../../utils/logger.js', () => ({
  logger: mocks.logger,
}));

import { orchestrateChat, type ChatRequest } from '../../../services/ai/chat-orchestrator.js';
import type { SSEEvent } from '../../../services/ai/types.js';

// ─── helpers ────────────────────────────────────────────────

function baseRequest(overrides?: Partial<ChatRequest>): ChatRequest {
  return {
    message: '你好',
    tenantId: 'tenant-1',
    userId: 'user-1',
    userName: '测试用户',
    role: 'admin',
    tenantName: '测试企业',
    ...overrides,
  };
}

async function collectEvents(gen: AsyncGenerator<SSEEvent>): Promise<SSEEvent[]> {
  const events: SSEEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

async function* mockStream(
  chunks: Array<{ type: string; content?: string; toolCalls?: unknown[]; usage?: unknown }>,
) {
  for (const chunk of chunks) yield chunk;
}

// ─── default setup ──────────────────────────────────────────

function setupDefaults() {
  mocks.getOrCreateConversation.mockResolvedValue({
    id: 'conv-1',
    isNew: true,
    tokenUsed: 0,
  });
  mocks.getContextMessages.mockResolvedValue([]);
  mocks.saveUserMessage.mockResolvedValue('msg-id');
  mocks.saveAssistantMessage.mockResolvedValue('ast-id');
  mocks.updateConversationMeta.mockResolvedValue(undefined);
  mocks.buildSystemPrompt.mockReturnValue('mock-system-prompt');
}

// ─── tests ──────────────────────────────────────────────────

describe('chat-orchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaults();
  });

  describe('token 上限检查', () => {
    it('tokenUsed >= MAX_CONVERSATION_TOKENS 时应 yield error 事件', async () => {
      mocks.getOrCreateConversation.mockResolvedValue({
        id: 'conv-1',
        isNew: false,
        tokenUsed: 10_000,
      });

      const events = await collectEvents(orchestrateChat(baseRequest()));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'error',
        code: 'AI_CONTEXT_TOO_LONG',
        recoverable: false,
      });
      // 不应该调用 saveUserMessage
      expect(mocks.saveUserMessage).not.toHaveBeenCalled();
    });
  });

  describe('纯文本流式对话', () => {
    it('无 tool_call 时应产生 thinking -> text_chunk -> text_complete -> stream_end 事件序列', async () => {
      mocks.chatStream.mockReturnValue(
        mockStream([
          { type: 'content', content: '你好' },
          { type: 'content', content: '世界' },
          { type: 'done', usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
        ]),
      );

      const events = await collectEvents(orchestrateChat(baseRequest()));

      const types = events.map((e) => e.type);
      expect(types).toEqual([
        'thinking',
        'text_chunk',
        'text_chunk',
        'text_complete',
        'stream_end',
      ]);

      // text_chunk 内容
      const chunks = events.filter((e) => e.type === 'text_chunk');
      expect(chunks[0]).toMatchObject({ content: '你好', index: 0 });
      expect(chunks[1]).toMatchObject({ content: '世界', index: 1 });

      // text_complete
      const complete = events.find((e) => e.type === 'text_complete')!;
      expect(complete).toMatchObject({ content: '你好世界' });

      // stream_end
      const end = events.find((e) => e.type === 'stream_end')!;
      expect(end).toMatchObject({ conversationId: 'conv-1' });
    });
  });

  describe('带 tool_call 的完整循环', () => {
    it('stream 返回 tool_calls -> executeTool -> chatCompletion -> 最终回复', async () => {
      // 流式返回一个 tool_call
      mocks.chatStream.mockReturnValue(
        mockStream([
          {
            type: 'tool_calls',
            toolCalls: [
              {
                index: 0,
                id: 'call-1',
                function: {
                  name: 'getSalesStats',
                  arguments: '{"startDate":"2026-03-01","endDate":"2026-03-31"}',
                },
              },
            ],
          },
          { type: 'done', usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 } },
        ]),
      );

      mocks.executeTool.mockResolvedValue({
        toolCallId: 'call-1',
        toolName: 'getSalesStats',
        result: { totalAmount: 100000 },
        duration: 200,
        cached: false,
      });

      mocks.chatCompletion.mockResolvedValue({
        choices: [
          {
            message: { role: 'assistant', content: '本月销售额为 100,000 元' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 80, completion_tokens: 30, total_tokens: 110 },
      });

      const events = await collectEvents(orchestrateChat(baseRequest()));
      const types = events.map((e) => e.type);

      expect(types).toContain('thinking');
      expect(types).toContain('tool_call_start');
      expect(types).toContain('tool_call_result');
      expect(types).toContain('text_chunk');
      expect(types).toContain('text_complete');
      expect(types).toContain('stream_end');

      // 验证 executeTool 被调用
      expect(mocks.executeTool).toHaveBeenCalledWith(
        'call-1',
        'getSalesStats',
        '{"startDate":"2026-03-01","endDate":"2026-03-31"}',
        'tenant-1',
      );
    });
  });

  describe('tool_call 参数解析失败', () => {
    it('JSON.parse 失败时应降级处理并继续', async () => {
      mocks.chatStream.mockReturnValue(
        mockStream([
          {
            type: 'tool_calls',
            toolCalls: [
              {
                index: 0,
                id: 'call-bad',
                function: { name: 'getSalesStats', arguments: '{invalid-json' },
              },
            ],
          },
          { type: 'done', usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
        ]),
      );

      mocks.chatCompletion.mockResolvedValue({
        choices: [
          {
            message: { role: 'assistant', content: '参数有误' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
      });

      const events = await collectEvents(orchestrateChat(baseRequest()));

      // 不应有 tool_call_start（因为 JSON 解析失败跳过了）
      const toolStartEvents = events.filter((e) => e.type === 'tool_call_start');
      expect(toolStartEvents).toHaveLength(0);

      // executeTool 不应被调用
      expect(mocks.executeTool).not.toHaveBeenCalled();

      // 仍然应该有最终回复
      expect(events.some((e) => e.type === 'text_complete')).toBe(true);
    });
  });

  describe('AiClientError 错误映射', () => {
    it('AI_RATE_LIMITED 应映射到正确的错误消息（recoverable=true）', async () => {
      mocks.chatStream.mockImplementation(() => {
        throw new mocks.AiClientError('rate limited', 'AI_RATE_LIMITED');
      });

      const events = await collectEvents(orchestrateChat(baseRequest()));

      const errorEvent = events.find((e) => e.type === 'error')!;
      expect(errorEvent).toMatchObject({
        type: 'error',
        code: 'AI_RATE_LIMITED',
        message: 'AI 调用频率限制，请稍后再试。',
        recoverable: true,
      });
    });

    it('AI_CONTEXT_TOO_LONG 应映射到 recoverable=false', async () => {
      mocks.chatStream.mockImplementation(() => {
        throw new mocks.AiClientError('context too long', 'AI_CONTEXT_TOO_LONG');
      });

      const events = await collectEvents(orchestrateChat(baseRequest()));

      const errorEvent = events.find((e) => e.type === 'error')!;
      expect(errorEvent).toMatchObject({
        type: 'error',
        code: 'AI_CONTEXT_TOO_LONG',
        message: '对话上下文已超出限制，请开始新会话。',
        recoverable: false,
      });
    });
  });

  describe('通用错误捕获', () => {
    it('非 AiClientError 应映射到 AI_SERVICE_UNAVAILABLE（recoverable=true）', async () => {
      mocks.chatStream.mockImplementation(() => {
        throw new Error('unexpected');
      });

      const events = await collectEvents(orchestrateChat(baseRequest()));

      const errorEvent = events.find((e) => e.type === 'error')!;
      expect(errorEvent).toMatchObject({
        type: 'error',
        code: 'AI_SERVICE_UNAVAILABLE',
        message: 'AI 服务暂时不可用，请稍后重试。',
        recoverable: true,
      });

      expect(mocks.logger.error).toHaveBeenCalled();
    });
  });

  describe('stripInternalFields', () => {
    it('应正确剥离 _dataSource 和 _queryTime 字段', async () => {
      mocks.chatStream.mockReturnValue(
        mockStream([
          {
            type: 'tool_calls',
            toolCalls: [
              {
                index: 0,
                id: 'call-strip',
                function: {
                  name: 'getSalesStats',
                  arguments: '{"startDate":"2026-03-01","endDate":"2026-03-31"}',
                },
              },
            ],
          },
          { type: 'done', usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
        ]),
      );

      mocks.executeTool.mockResolvedValue({
        toolCallId: 'call-strip',
        toolName: 'getSalesStats',
        result: {
          totalAmount: 500,
          _dataSource: 'ztdy-open API',
          _queryTime: '2026-03-31T10:00:00Z',
        },
        duration: 100,
        cached: false,
      });

      mocks.chatCompletion.mockResolvedValue({
        choices: [
          {
            message: { role: 'assistant', content: '结果' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
      });

      const events = await collectEvents(orchestrateChat(baseRequest()));

      const resultEvent = events.find((e) => e.type === 'tool_call_result') as
        | { type: 'tool_call_result'; result: Record<string, unknown> }
        | undefined;
      expect(resultEvent).toBeDefined();
      expect(resultEvent!.result).toEqual({ totalAmount: 500 });
      expect(resultEvent!.result).not.toHaveProperty('_dataSource');
      expect(resultEvent!.result).not.toHaveProperty('_queryTime');
    });
  });

  describe('generateTitle 截断逻辑', () => {
    it('消息 >30 字符时应截断并加 ...', async () => {
      const longMessage = '这是一条超过三十个字符的非常长的消息内容用于测试截断逻辑是否正确工作';
      mocks.chatStream.mockReturnValue(
        mockStream([
          { type: 'content', content: '回复' },
          { type: 'done', usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
        ]),
      );

      await collectEvents(orchestrateChat(baseRequest({ message: longMessage })));

      expect(mocks.updateConversationMeta).toHaveBeenCalledWith(
        'conv-1',
        15,
        longMessage.slice(0, 30) + '...',
      );
    });

    it('消息 <=30 字符时不截断', async () => {
      const shortMessage = '短消息';
      mocks.chatStream.mockReturnValue(
        mockStream([
          { type: 'content', content: '回复' },
          { type: 'done', usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
        ]),
      );

      await collectEvents(orchestrateChat(baseRequest({ message: shortMessage })));

      expect(mocks.updateConversationMeta).toHaveBeenCalledWith('conv-1', 15, shortMessage);
    });
  });

  describe('新会话 vs 已有会话标题生成', () => {
    it('conversationId 为 undefined 时应自动生成标题', async () => {
      mocks.chatStream.mockReturnValue(
        mockStream([
          { type: 'content', content: '回复' },
          { type: 'done', usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
        ]),
      );

      await collectEvents(orchestrateChat(baseRequest({ conversationId: undefined })));

      // updateConversationMeta 第三个参数应有 title
      const call = mocks.updateConversationMeta.mock.calls[0]!;
      expect(call[2]).toBe('你好');
    });

    it('conversationId 有值时不生成标题', async () => {
      mocks.getOrCreateConversation.mockResolvedValue({
        id: 'conv-existing',
        isNew: false,
        tokenUsed: 100,
      });

      mocks.chatStream.mockReturnValue(
        mockStream([
          { type: 'content', content: '回复' },
          { type: 'done', usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
        ]),
      );

      await collectEvents(orchestrateChat(baseRequest({ conversationId: 'conv-existing' })));

      // updateConversationMeta 第三个参数应为 undefined
      const call = mocks.updateConversationMeta.mock.calls[0]!;
      expect(call[2]).toBeUndefined();
    });
  });

  describe('saveAssistantMessage 调用验证', () => {
    it('含 toolCalls/toolResults 时 saveAssistantMessage 参数正确', async () => {
      mocks.chatStream.mockReturnValue(
        mockStream([
          {
            type: 'tool_calls',
            toolCalls: [
              {
                index: 0,
                id: 'call-save',
                function: {
                  name: 'getSalesStats',
                  arguments: '{"startDate":"2026-03-01","endDate":"2026-03-31"}',
                },
              },
            ],
          },
          { type: 'done', usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 } },
        ]),
      );

      const toolResult = {
        toolCallId: 'call-save',
        toolName: 'getSalesStats',
        result: { totalAmount: 999 },
        duration: 150,
        cached: false,
      };
      mocks.executeTool.mockResolvedValue(toolResult);

      mocks.chatCompletion.mockResolvedValue({
        choices: [
          {
            message: { role: 'assistant', content: '结果如下' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 80, completion_tokens: 30, total_tokens: 110 },
      });

      await collectEvents(orchestrateChat(baseRequest()));

      expect(mocks.saveAssistantMessage).toHaveBeenCalledWith(
        'conv-1',
        'tenant-1',
        'user-1',
        '结果如下',
        expect.arrayContaining([
          expect.objectContaining({ id: 'call-save', name: 'getSalesStats' }),
        ]),
        [toolResult],
      );
    });

    it('无 tool_call 时 saveAssistantMessage 不传 toolCalls/toolResults', async () => {
      mocks.chatStream.mockReturnValue(
        mockStream([
          { type: 'content', content: '简单回复' },
          { type: 'done', usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
        ]),
      );

      await collectEvents(orchestrateChat(baseRequest()));

      expect(mocks.saveAssistantMessage).toHaveBeenCalledWith(
        'conv-1',
        'tenant-1',
        'user-1',
        '简单回复',
        undefined,
        undefined,
      );
    });
  });
});
