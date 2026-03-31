import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// Hoisted mocks for prisma
const mockConversationFindFirst = vi.fn();
const mockMessageFindMany = vi.fn();
const mockMessageCount = vi.fn();

// Mock all dependencies
vi.mock('../../services/ai/chat-orchestrator.js', () => ({
  orchestrateChat: vi.fn(),
}));

vi.mock('../../services/ai/conversation-service.js', () => ({
  listConversations: vi.fn(),
}));

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    user: { findUnique: vi.fn().mockResolvedValue({ name: '测试用户' }) },
    tenant: { findUnique: vi.fn().mockResolvedValue({ name: '测试租户' }) },
    conversation: { findFirst: (...args: unknown[]) => mockConversationFindFirst(...args) },
    message: {
      findMany: (...args: unknown[]) => mockMessageFindMany(...args),
      count: (...args: unknown[]) => mockMessageCount(...args),
    },
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { aiRouter } from '../../routes/ai/index.js';
import { orchestrateChat } from '../../services/ai/chat-orchestrator.js';
import { listConversations } from '../../services/ai/conversation-service.js';

// 创建测试 app，注入认证信息
function createTestApp() {
  const app = express();
  app.use(express.json());

  // 模拟认证中间件
  app.use((req, _res, next) => {
    req.user = { userId: 'user-1', tenantId: 'tenant-1', role: 'admin' };
    req.tenantId = 'tenant-1';
    req.requestId = 'req-test';
    next();
  });

  app.use('/ai', aiRouter);
  return app;
}

describe('AI routes', () => {
  const app = createTestApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /ai/chat', () => {
    it('应该验证请求体 — 空消息返回 400', async () => {
      const res = await request(app).post('/ai/chat').send({ message: '' }).expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('应该验证请求体 — 消息过长返回 400', async () => {
      const res = await request(app)
        .post('/ai/chat')
        .send({ message: 'a'.repeat(2001) })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it('应该验证请求体 — 无效 agentType 返回 400', async () => {
      const res = await request(app)
        .post('/ai/chat')
        .send({ message: '你好', agentType: 'invalid' })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it('应该返回 SSE content-type', async () => {
      const mockGen = async function* () {
        yield { type: 'text_chunk', content: '你好', messageId: 'msg-1', index: 0 };
        yield {
          type: 'stream_end',
          conversationId: 'conv-1',
          messageId: 'msg-1',
          totalDuration: 100,
          totalTokens: 10,
        };
      };
      vi.mocked(orchestrateChat).mockReturnValueOnce(
        mockGen() as ReturnType<typeof orchestrateChat>,
      );

      const res = await request(app).post('/ai/chat').send({ message: '你好' }).expect(200);

      expect(res.headers['content-type']).toContain('text/event-stream');
    });

    it('应该发送 SSE 格式的事件', async () => {
      const mockGen = async function* () {
        yield { type: 'thinking', content: '思考中...', messageId: 'msg-1' };
        yield { type: 'text_chunk', content: '回复', messageId: 'msg-1', index: 0 };
        yield {
          type: 'stream_end',
          conversationId: 'conv-1',
          messageId: 'msg-1',
          totalDuration: 200,
          totalTokens: 20,
        };
      };
      vi.mocked(orchestrateChat).mockReturnValueOnce(
        mockGen() as ReturnType<typeof orchestrateChat>,
      );

      const res = await request(app).post('/ai/chat').send({ message: '你好' });

      // SSE 格式验证
      expect(res.text).toContain('event: message');
      expect(res.text).toContain('"type":"thinking"');
      expect(res.text).toContain('"type":"text_chunk"');
      expect(res.text).toContain('"type":"stream_end"');
    });

    it('orchestrateChat 异常应该发送 error 事件', async () => {
      vi.mocked(orchestrateChat).mockImplementationOnce(async function* () {
        yield { type: 'thinking' as const, content: 'thinking', messageId: 'msg-err' };
        throw new Error('Unexpected error');
      });

      const res = await request(app).post('/ai/chat').send({ message: '你好' });

      expect(res.text).toContain('"type":"error"');
      expect(res.text).toContain('INTERNAL_ERROR');
    });
  });

  describe('GET /ai/conversations', () => {
    it('应该返回会话列表', async () => {
      vi.mocked(listConversations).mockResolvedValueOnce({
        items: [
          {
            id: 'conv-1',
            title: '测试会话',
            agentType: 'master' as const,
            tokenUsed: 100,
            createdAt: new Date('2026-03-30'),
            updatedAt: new Date('2026-03-30'),
          },
        ],
        total: 1,
      });

      const res = await request(app).get('/ai/conversations').expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].title).toBe('测试会话');
      expect(res.body.meta.total).toBe(1);
    });

    it('应该支持分页参数', async () => {
      vi.mocked(listConversations).mockResolvedValueOnce({
        items: [],
        total: 0,
      });

      await request(app).get('/ai/conversations?page=2&pageSize=10').expect(200);

      expect(listConversations).toHaveBeenCalledWith('tenant-1', 'user-1', 2, 10);
    });

    it('无效分页参数应该使用默认值', async () => {
      vi.mocked(listConversations).mockResolvedValueOnce({
        items: [],
        total: 0,
      });

      await request(app).get('/ai/conversations').expect(200);

      expect(listConversations).toHaveBeenCalledWith('tenant-1', 'user-1', 1, 20);
    });
  });

  describe('GET /ai/conversations/:id/messages', () => {
    const validConversationId = '00000000-0000-0000-0000-000000000001';

    it('应该返回消息列表', async () => {
      mockConversationFindFirst.mockResolvedValueOnce({ id: validConversationId });
      const mockMessages = [
        {
          id: 'msg-1',
          role: 'user',
          content: '你好',
          toolCalls: null,
          toolResults: null,
          createdAt: new Date('2026-03-30T10:00:00Z'),
        },
        {
          id: 'msg-2',
          role: 'assistant',
          content: '你好！有什么可以帮你的？',
          toolCalls: null,
          toolResults: null,
          createdAt: new Date('2026-03-30T10:00:01Z'),
        },
      ];
      mockMessageFindMany.mockResolvedValueOnce(mockMessages);
      mockMessageCount.mockResolvedValueOnce(2);

      const res = await request(app)
        .get(`/ai/conversations/${validConversationId}/messages`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.items).toHaveLength(2);
      expect(res.body.data.total).toBe(2);
      expect(res.body.meta.page).toBe(1);
      expect(res.body.meta.pageSize).toBe(50);
    });

    it('会话不存在应该返回 404', async () => {
      mockConversationFindFirst.mockResolvedValueOnce(null);

      const res = await request(app)
        .get(`/ai/conversations/${validConversationId}/messages`)
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('RESOURCE_NOT_FOUND');
    });

    it('无效分页参数应该返回 400', async () => {
      const res = await request(app)
        .get(`/ai/conversations/${validConversationId}/messages?page=-1`)
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('无效UUID应该返回 400', async () => {
      const res = await request(app)
        .get('/ai/conversations/not-a-uuid/messages')
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('别人的会话应该返回 404（findFirst 按 tenantId+userId 查不到）', async () => {
      // findFirst with tenantId + userId filter returns null for other user's conversation
      mockConversationFindFirst.mockResolvedValueOnce(null);

      const res = await request(app)
        .get(`/ai/conversations/${validConversationId}/messages`)
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('RESOURCE_NOT_FOUND');
      // Verify the query included tenantId and userId
      expect(mockConversationFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: 'tenant-1',
            userId: 'user-1',
          }),
        }),
      );
    });
  });

  describe('认证检查', () => {
    it('无认证信息应该返回 401', async () => {
      const noAuthApp = express();
      noAuthApp.use(express.json());
      noAuthApp.use((req, _res, next) => {
        req.requestId = 'req-test';
        next();
      });
      noAuthApp.use('/ai', aiRouter);

      const res = await request(noAuthApp).post('/ai/chat').send({ message: '你好' }).expect(401);

      expect(res.body.error.code).toBe('AUTH_INVALID_TOKEN');
    });
  });
});
