import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma
const mockFindFirst = vi.fn();
const mockCreate = vi.fn();
const mockFindMany = vi.fn();
const mockUpdateMany = vi.fn();
const mockCount = vi.fn();

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    conversation: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
      create: (...args: unknown[]) => mockCreate(...args),
      findMany: (...args: unknown[]) => mockFindMany(...args),
      updateMany: (...args: unknown[]) => mockUpdateMany(...args),
      count: (...args: unknown[]) => mockCount(...args),
    },
    message: {
      create: (...args: unknown[]) => mockCreate(...args),
      findMany: (...args: unknown[]) => mockFindMany(...args),
    },
  },
}));

vi.mock('../../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  getOrCreateConversation,
  getContextMessages,
  saveUserMessage,
  updateConversationMeta,
  MAX_CONVERSATION_TOKENS,
} from '../../../services/ai/conversation-service.js';

describe('conversation-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getOrCreateConversation', () => {
    it('有 conversationId 且存在时应返回现有会话', async () => {
      mockFindFirst.mockResolvedValueOnce({ id: 'conv-1', tokenUsed: 500 });

      const result = await getOrCreateConversation('conv-1', 'tenant-1', 'user-1');

      expect(result.id).toBe('conv-1');
      expect(result.isNew).toBe(false);
      expect(result.tokenUsed).toBe(500);
    });

    it('conversationId 不存在时应创建新会话', async () => {
      mockFindFirst.mockResolvedValueOnce(null);
      mockCreate.mockResolvedValueOnce({ id: 'conv-new', tokenUsed: 0 });

      const result = await getOrCreateConversation('conv-missing', 'tenant-1', 'user-1');

      expect(result.id).toBe('conv-new');
      expect(result.isNew).toBe(true);
    });

    it('无 conversationId 时应创建新会话', async () => {
      mockCreate.mockResolvedValueOnce({ id: 'conv-new-2', tokenUsed: 0 });

      const result = await getOrCreateConversation(undefined, 'tenant-1', 'user-1', 'operation');

      expect(result.id).toBe('conv-new-2');
      expect(result.isNew).toBe(true);
    });
  });

  describe('getContextMessages', () => {
    it('应该返回最近 N 条消息并正序排列', async () => {
      mockFindMany.mockResolvedValueOnce([
        { role: 'assistant', content: '你好', toolCalls: null, toolResults: null },
        { role: 'user', content: '你好', toolCalls: null, toolResults: null },
      ]);

      const messages = await getContextMessages('conv-1', 'tenant-1');

      // 从 desc 反转后应该是正序
      expect(messages[0]!.role).toBe('user');
      expect(messages[1]!.role).toBe('assistant');
    });

    it('assistant 消息有 toolResults 应该生成 tool 消息', async () => {
      mockFindMany.mockResolvedValueOnce([
        {
          role: 'assistant',
          content: '查询结果',
          toolCalls: [
            { id: 'tc_1', type: 'function', function: { name: 'getSalesStats', arguments: '{}' } },
          ],
          toolResults: [
            { toolCallId: 'tc_1', toolName: 'getSalesStats', result: { totalAmount: 100 } },
          ],
        },
      ]);

      const messages = await getContextMessages('conv-1', 'tenant-1');

      expect(messages).toHaveLength(2); // assistant + tool
      expect(messages[1]!.role).toBe('tool');
      expect(messages[1]!.tool_call_id).toBe('tc_1');
    });
  });

  describe('saveUserMessage', () => {
    it('应该创建 user 角色的消息', async () => {
      mockCreate.mockResolvedValueOnce({ id: 'msg-1' });

      const id = await saveUserMessage('conv-1', 'tenant-1', 'user-1', '你好');

      expect(id).toBe('msg-1');
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            role: 'user',
            content: '你好',
          }),
        }),
      );
    });
  });

  describe('updateConversationMeta', () => {
    it('应该增量更新 tokenUsed 并带 tenantId 隔离', async () => {
      mockUpdateMany.mockResolvedValueOnce({ count: 1 });

      await updateConversationMeta('conv-1', 'tenant-1', 100, '测试标题');

      expect(mockUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'conv-1', tenantId: 'tenant-1' },
          data: expect.objectContaining({
            tokenUsed: { increment: 100 },
            title: '测试标题',
          }),
        }),
      );
    });

    it('无标题时不更新 title', async () => {
      mockUpdateMany.mockResolvedValueOnce({ count: 1 });

      await updateConversationMeta('conv-1', 'tenant-1', 50);

      const updateData = mockUpdateMany.mock.calls[0]![0].data;
      expect(updateData['title']).toBeUndefined();
    });
  });

  describe('MAX_CONVERSATION_TOKENS', () => {
    it('应该为 10000', () => {
      expect(MAX_CONVERSATION_TOKENS).toBe(10_000);
    });
  });
});
