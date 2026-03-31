import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── hoisted mocks ─────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  orchestrateChat: vi.fn(),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  prisma: {
    user: { findUnique: vi.fn() },
    tenant: { findUnique: vi.fn() },
  },
  env: {
    FEISHU_LINGXI_APP_ID: undefined as string | undefined,
    FEISHU_LINGXI_APP_SECRET: undefined as string | undefined,
    FEISHU_LINGXI_SERVICE_TENANT_ID: undefined as string | undefined,
    FEISHU_LINGXI_SERVICE_USER_ID: undefined as string | undefined,
  },
}));

vi.mock('../../../services/ai/chat-orchestrator.js', () => ({
  orchestrateChat: mocks.orchestrateChat,
}));

vi.mock('../../../utils/logger.js', () => ({
  logger: mocks.logger,
}));

vi.mock('../../../lib/prisma.js', () => ({
  prisma: mocks.prisma,
}));

vi.mock('../../../lib/env.js', () => ({
  env: mocks.env,
}));

// Mock @larksuiteoapi/node-sdk
vi.mock('@larksuiteoapi/node-sdk', () => ({
  Client: vi.fn().mockImplementation(() => ({
    im: {
      message: {
        create: vi.fn().mockResolvedValue({}),
      },
    },
  })),
  WSClient: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
  })),
  EventDispatcher: vi.fn().mockImplementation(() => ({
    register: vi.fn().mockReturnThis(),
  })),
  AppType: { SelfBuild: 0 },
  Domain: { Feishu: 'feishu' },
  LoggerLevel: { info: 'info' },
}));

import { callAiEngine, _testHelpers } from '../../../services/feishu-bridge/lingxi-bridge.js';

describe('Lingxi Bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 清理运行时状态
    _testHelpers.sessions.clear();
    _testHelpers.processedMessages.clear();
    _testHelpers.rateCounts.clear();
  });

  afterEach(() => {
    _testHelpers.setServiceCtx(null);
  });

  // ─── callAiEngine ─────────────────────────────────────

  describe('callAiEngine', () => {
    it('should collect text_chunk events into full response', async () => {
      _testHelpers.setServiceCtx({
        tenantId: 'tenant-1',
        userId: 'user-1',
        userName: '测试用户',
        tenantName: '测试企业',
      });

      async function* mockStream() {
        yield { type: 'thinking', content: '思考中...', messageId: 'msg-1' };
        yield { type: 'text_chunk', content: '你好', messageId: 'msg-1', index: 0 };
        yield { type: 'text_chunk', content: '世界', messageId: 'msg-1', index: 1 };
        yield {
          type: 'text_complete',
          content: '你好世界',
          messageId: 'msg-1',
          tokenUsage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        };
        yield {
          type: 'stream_end',
          conversationId: 'conv-123',
          messageId: 'msg-1',
          totalDuration: 500,
          totalTokens: 15,
        };
      }

      mocks.orchestrateChat.mockReturnValue(mockStream());

      const result = await callAiEngine('你好');
      expect(result.text).toBe('你好世界');
      expect(result.conversationId).toBe('conv-123');
    });

    it('should throw on error event', async () => {
      _testHelpers.setServiceCtx({
        tenantId: 'tenant-1',
        userId: 'user-1',
        userName: '测试用户',
        tenantName: '测试企业',
      });

      async function* mockErrorStream() {
        yield {
          type: 'error',
          code: 'AI_SERVICE_UNAVAILABLE',
          message: 'AI 服务不可用',
          recoverable: true,
          messageId: 'msg-1',
        };
      }

      mocks.orchestrateChat.mockReturnValue(mockErrorStream());

      await expect(callAiEngine('测试')).rejects.toThrow('AI 服务不可用');
    });

    it('should return default text when no content', async () => {
      _testHelpers.setServiceCtx({
        tenantId: 'tenant-1',
        userId: 'user-1',
        userName: '测试用户',
        tenantName: '测试企业',
      });

      async function* emptyStream() {
        yield {
          type: 'stream_end',
          conversationId: 'conv-456',
          messageId: 'msg-1',
          totalDuration: 100,
          totalTokens: 0,
        };
      }

      mocks.orchestrateChat.mockReturnValue(emptyStream());

      const result = await callAiEngine('空消息');
      expect(result.text).toBe('(无返回内容)');
    });

    it('should throw if bridge not initialized', async () => {
      _testHelpers.setServiceCtx(null);
      await expect(callAiEngine('测试')).rejects.toThrow('Lingxi bridge not initialized');
    });

    it('should pass conversationId to orchestrateChat', async () => {
      _testHelpers.setServiceCtx({
        tenantId: 'tenant-1',
        userId: 'user-1',
        userName: '测试用户',
        tenantName: '测试企业',
      });

      async function* mockStream() {
        yield {
          type: 'stream_end',
          conversationId: 'conv-existing',
          messageId: 'msg-1',
          totalDuration: 100,
          totalTokens: 5,
        };
      }

      mocks.orchestrateChat.mockReturnValue(mockStream());

      await callAiEngine('继续聊', 'conv-existing');

      expect(mocks.orchestrateChat).toHaveBeenCalledWith(
        expect.objectContaining({ conversationId: 'conv-existing' }),
      );
    });
  });

  // ─── 会话管理 ─────────────────────────────────────────

  describe('session management', () => {
    it('should save and retrieve conversationId', () => {
      _testHelpers.saveConversationId('chat-1', 'conv-abc');
      expect(_testHelpers.getConversationId('chat-1')).toBe('conv-abc');
    });

    it('should return undefined for unknown chatId', () => {
      expect(_testHelpers.getConversationId('unknown')).toBeUndefined();
    });

    it('should clear session', () => {
      _testHelpers.saveConversationId('chat-1', 'conv-abc');
      _testHelpers.clearSession('chat-1');
      expect(_testHelpers.getConversationId('chat-1')).toBeUndefined();
    });
  });

  // ─── 去重 ─────────────────────────────────────────────

  describe('deduplication', () => {
    it('should reject duplicate messages', () => {
      expect(_testHelpers.isDuplicate('msg-1')).toBe(false);
      expect(_testHelpers.isDuplicate('msg-1')).toBe(true);
    });

    it('should allow different messages', () => {
      expect(_testHelpers.isDuplicate('msg-1')).toBe(false);
      expect(_testHelpers.isDuplicate('msg-2')).toBe(false);
    });
  });

  // ─── 限流 ─────────────────────────────────────────────

  describe('rate limiting', () => {
    it('should allow messages within limit', () => {
      for (let i = 0; i < 10; i++) {
        expect(_testHelpers.isRateLimited('chat-1')).toBe(false);
      }
    });

    it('should block messages exceeding limit', () => {
      for (let i = 0; i < 10; i++) {
        _testHelpers.isRateLimited('chat-1');
      }
      expect(_testHelpers.isRateLimited('chat-1')).toBe(true);
    });

    it('should track separate chats independently', () => {
      for (let i = 0; i < 10; i++) {
        _testHelpers.isRateLimited('chat-1');
      }
      expect(_testHelpers.isRateLimited('chat-1')).toBe(true);
      expect(_testHelpers.isRateLimited('chat-2')).toBe(false);
    });
  });

  // ─── 输入校验 ─────────────────────────────────────────

  describe('input validation', () => {
    it('should accept valid UTF-8 text', () => {
      expect(_testHelpers.isValidUtf8Text('你好世界')).toBe(true);
      expect(_testHelpers.isValidUtf8Text('Hello World')).toBe(true);
      expect(_testHelpers.isValidUtf8Text('换行\n制表\t')).toBe(true);
    });

    it('should reject control characters', () => {
      expect(_testHelpers.isValidUtf8Text('\x00malicious')).toBe(false);
      expect(_testHelpers.isValidUtf8Text('bad\x07char')).toBe(false);
    });

    it('should reject non-string input', () => {
      expect(_testHelpers.isValidUtf8Text(null as unknown as string)).toBe(false);
      expect(_testHelpers.isValidUtf8Text(123 as unknown as string)).toBe(false);
    });
  });

  // ─── handleMessage 特殊指令 ───────────────────────────

  describe('handleMessage special commands', () => {
    beforeEach(() => {
      _testHelpers.setServiceCtx({
        tenantId: 'tenant-1',
        userId: 'user-1',
        userName: '测试用户',
        tenantName: '测试企业',
      });
      // 设置 mock feishu client
      const mockClient = {
        im: {
          message: {
            create: vi.fn().mockResolvedValue({}),
          },
        },
      };
      _testHelpers.setFeishuClient(mockClient as unknown as Parameters<typeof _testHelpers.setFeishuClient>[0]);
    });

    it('should clear session on "新对话"', async () => {
      _testHelpers.saveConversationId('chat-test', 'conv-old');

      await _testHelpers.handleMessage({
        message: {
          message_id: 'msg-new-conv',
          chat_id: 'chat-test',
          message_type: 'text',
          content: JSON.stringify({ text: '新对话' }),
        },
        sender: { sender_id: { open_id: 'user-1' } },
      });

      expect(_testHelpers.getConversationId('chat-test')).toBeUndefined();
    });

    it('should reject non-text messages', async () => {
      await _testHelpers.handleMessage({
        message: {
          message_id: 'msg-image',
          chat_id: 'chat-test',
          message_type: 'image',
          content: '{}',
        },
        sender: { sender_id: { open_id: 'user-1' } },
      });

      // 不抛异常即为通过（sendText会被调用告知只支持文本）
    });

    it('should skip empty messages', async () => {
      await _testHelpers.handleMessage({
        message: {
          message_id: 'msg-empty',
          chat_id: 'chat-test',
          message_type: 'text',
          content: JSON.stringify({ text: '' }),
        },
        sender: { sender_id: { open_id: 'user-1' } },
      });

      // 不抛异常，静默跳过
    });

    it('should skip duplicate messages', async () => {
      const data = {
        message: {
          message_id: 'msg-dup-test',
          chat_id: 'chat-test',
          message_type: 'text',
          content: JSON.stringify({ text: '你好' }),
        },
        sender: { sender_id: { open_id: 'user-1' } },
      };

      // Mock orchestrateChat for the first call
      async function* mockStream() {
        yield { type: 'text_chunk', content: '回复', messageId: 'msg-1', index: 0 };
        yield {
          type: 'stream_end',
          conversationId: 'conv-1',
          messageId: 'msg-1',
          totalDuration: 100,
          totalTokens: 5,
        };
      }
      mocks.orchestrateChat.mockReturnValue(mockStream());

      await _testHelpers.handleMessage(data);
      // 等待队列处理完成
      await new Promise((r) => setTimeout(r, 50));

      mocks.orchestrateChat.mockClear();
      await _testHelpers.handleMessage(data);
      await new Promise((r) => setTimeout(r, 50));

      // 第二次调用应被去重拦截，orchestrateChat不应被调用
      expect(mocks.orchestrateChat).not.toHaveBeenCalled();
    });
  });
});
