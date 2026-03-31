import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock env before importing
vi.mock('../../../lib/env.js', () => ({
  env: {
    DASHSCOPE_API_KEY: 'test-api-key',
    DASHSCOPE_BASE_URL: 'https://test.dashscope.com/v1',
    DASHSCOPE_MODEL: 'qwen-test',
  },
}));

vi.mock('../../../utils/logger.js', () => ({
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
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import {
  chatCompletion,
  chatStream,
  AiClientError,
  MAX_TOOL_CALL_ROUNDS,
  MAX_TOKENS_PER_TURN,
} from '../../../services/ai/ai-client.js';
import type { ChatMessage } from '../../../services/ai/types.js';

describe('ai-client', () => {
  const sampleMessages: ChatMessage[] = [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: '你好' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('chatCompletion', () => {
    it('应该正确调用百炼 API 并返回结果', async () => {
      const mockResponse = {
        id: 'test-id',
        choices: [{ message: { role: 'assistant', content: '你好！' }, finish_reason: 'stop' }],
        model: 'qwen-test',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await chatCompletion(sampleMessages);

      expect(result.choices[0]!.message.content).toBe('你好！');
      expect(result.usage.total_tokens).toBe(15);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.dashscope.com/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-api-key',
          },
        }),
      );
    });

    it('应该传递 tools 参数', async () => {
      const tools = [
        {
          type: 'function' as const,
          function: { name: 'test', description: 'test tool', parameters: {} },
        },
      ];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: { role: 'assistant', content: null, tool_calls: [] },
              finish_reason: 'tool_calls',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      await chatCompletion(sampleMessages, { tools });

      const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string);
      expect(body.tools).toEqual(tools);
      expect(body.tool_choice).toBe('auto');
    });

    it('API 429 应该抛出 AI_RATE_LIMITED', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => 'Rate limited',
      });

      try {
        await chatCompletion(sampleMessages);
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AiClientError);
        expect((err as AiClientError).code).toBe('AI_RATE_LIMITED');
      }
    });

    it('API 500 应该抛出 AI_SERVICE_UNAVAILABLE', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal error',
      });

      await expect(chatCompletion(sampleMessages)).rejects.toThrow(AiClientError);
    });

    it('网络错误应该抛出 AI_SERVICE_UNAVAILABLE', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      await expect(chatCompletion(sampleMessages)).rejects.toThrow(AiClientError);
    });

    it('应该使用自定义模型和温度', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
        }),
      });

      await chatCompletion(sampleMessages, { model: 'qwen3-max', temperature: 0.3 });

      const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string);
      expect(body.model).toBe('qwen3-max');
      expect(body.temperature).toBe(0.3);
    });
  });

  describe('chatStream', () => {
    function createSSEStream(chunks: string[]): ReadableStream<Uint8Array> {
      const encoder = new TextEncoder();
      return new ReadableStream({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      });
    }

    it('应该解析流式文本内容', async () => {
      const sseData = [
        'data: {"id":"1","choices":[{"delta":{"content":"你"},"finish_reason":null}],"model":"qwen-test"}\n\n',
        'data: {"id":"1","choices":[{"delta":{"content":"好"},"finish_reason":null}],"model":"qwen-test"}\n\n',
        'data: {"id":"1","choices":[{"delta":{},"finish_reason":"stop"}],"model":"qwen-test","usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}\n\n',
        'data: [DONE]\n\n',
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: createSSEStream(sseData),
      });

      const chunks: unknown[] = [];
      for await (const chunk of chatStream(sampleMessages)) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBe(3); // 2 content + 1 done
      expect(chunks[0]).toEqual(expect.objectContaining({ type: 'content', content: '你' }));
      expect(chunks[1]).toEqual(expect.objectContaining({ type: 'content', content: '好' }));
      expect(chunks[2]).toEqual(expect.objectContaining({ type: 'done', finishReason: 'stop' }));
    });

    it('应该解析流式 tool_calls', async () => {
      const sseData = [
        'data: {"id":"1","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"getSalesStats","arguments":"{\\"start"}}]},"finish_reason":null}],"model":"qwen-test"}\n\n',
        'data: {"id":"1","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"Date\\":\\"2026-03-01\\"}"}}]},"finish_reason":null}],"model":"qwen-test"}\n\n',
        'data: {"id":"1","choices":[{"delta":{},"finish_reason":"tool_calls"}],"model":"qwen-test","usage":{"prompt_tokens":50,"completion_tokens":20,"total_tokens":70}}\n\n',
        'data: [DONE]\n\n',
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: createSSEStream(sseData),
      });

      const chunks: unknown[] = [];
      for await (const chunk of chatStream(sampleMessages)) {
        chunks.push(chunk);
      }

      expect(chunks[0]).toEqual(expect.objectContaining({ type: 'tool_calls' }));
    });

    it('无 response body 应该抛出错误', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: null,
      });

      await expect(async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _ of chatStream(sampleMessages)) {
          // consume
        }
      }).rejects.toThrow('No response body');
    });
  });

  describe('AiClientError', () => {
    it('应该包含 code 属性', () => {
      const err = new AiClientError('test error', 'AI_RATE_LIMITED');
      expect(err.name).toBe('AiClientError');
      expect(err.code).toBe('AI_RATE_LIMITED');
      expect(err.message).toBe('test error');
    });
  });

  describe('constants', () => {
    it('MAX_TOOL_CALL_ROUNDS 应该为 3', () => {
      expect(MAX_TOOL_CALL_ROUNDS).toBe(3);
    });

    it('MAX_TOKENS_PER_TURN 应该为 2048', () => {
      expect(MAX_TOKENS_PER_TURN).toBe(2048);
    });
  });
});
