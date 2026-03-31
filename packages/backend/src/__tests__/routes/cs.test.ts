import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppError } from '../../lib/error-codes.js';

const {
  mockHandleIncomingMessage,
  mockListSessions,
  mockGetSessionById,
  mockListMessagesBySession,
  mockConfirmDraft,
  mockListTickets,
} = vi.hoisted(() => ({
  mockHandleIncomingMessage: vi.fn(),
  mockListSessions: vi.fn(),
  mockGetSessionById: vi.fn(),
  mockListMessagesBySession: vi.fn(),
  mockConfirmDraft: vi.fn(),
  mockListTickets: vi.fn(),
}));

vi.mock('../../services/cs/cs-orchestrator.js', () => ({
  handleIncomingMessage: mockHandleIncomingMessage,
}));
vi.mock('../../services/cs/cs-session-service.js', () => ({
  listSessions: mockListSessions,
  getSessionById: mockGetSessionById,
}));
vi.mock('../../services/cs/cs-message-service.js', () => ({
  confirmDraft: mockConfirmDraft,
  listMessagesBySession: mockListMessagesBySession,
}));
vi.mock('../../services/cs/cs-ticket-service.js', () => ({
  listTickets: mockListTickets,
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import express from 'express';
import request from 'supertest';
import { csRouter } from '../../routes/cs/index.js';

// 创建测试app，模拟认证中间件
function createApp() {
  const app = express();
  app.use(express.json());
  // 模拟认证中间件注入tenantId和userId
  app.use((req, _res, next) => {
    req.tenantId = 'tenant-001';
    req.user = { userId: 'user-001', tenantId: 'tenant-001', role: 'admin' };
    next();
  });
  app.use('/cs', csRouter);
  return app;
}

const FAKE_UUID = '00000000-0000-4000-8000-000000000001';
const FAKE_UUID_2 = '00000000-0000-4000-8000-000000000002';

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── POST /cs/message/incoming ──────────────────────

describe('POST /cs/message/incoming', () => {
  it('should accept valid incoming message', async () => {
    mockHandleIncomingMessage.mockResolvedValue({
      sessionId: FAKE_UUID_2,
      messageId: FAKE_UUID,
      processing: { faqMatched: false, isReturnRelated: false, judgmentTriggered: false },
    });

    const res = await request(createApp())
      .post('/cs/message/incoming')
      .send({
        channelType: 'feishu',
        channelId: 'ch-001',
        externalUserId: 'ext-001',
        content: '你好',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.sessionId).toBe(FAKE_UUID_2);
  });

  it('should reject empty content', async () => {
    const res = await request(createApp())
      .post('/cs/message/incoming')
      .send({
        channelType: 'feishu',
        channelId: 'ch-001',
        externalUserId: 'ext-001',
        content: '',
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('should reject missing required fields', async () => {
    const res = await request(createApp())
      .post('/cs/message/incoming')
      .send({ content: '你好' });

    expect(res.status).toBe(400);
  });

  it('should reject image messages', async () => {
    const res = await request(createApp())
      .post('/cs/message/incoming')
      .send({
        channelType: 'feishu',
        channelId: 'ch-001',
        externalUserId: 'ext-001',
        content: 'image data',
        msgType: 'image',
      });

    expect(res.status).toBe(400);
  });
});

// ─── POST /cs/message/:id/confirm ──────────────────

describe('POST /cs/message/:id/confirm', () => {
  it('should confirm draft with send action', async () => {
    mockConfirmDraft.mockResolvedValue({ status: 'confirmed' });

    const res = await request(createApp())
      .post(`/cs/message/${FAKE_UUID}/confirm`)
      .send({ action: 'send' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('confirmed');
  });

  it('should discard draft', async () => {
    mockConfirmDraft.mockResolvedValue({ status: 'discarded' });

    const res = await request(createApp())
      .post(`/cs/message/${FAKE_UUID}/confirm`)
      .send({ action: 'discard' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('discarded');
  });

  it('should return 404 for non-existent message', async () => {
    mockConfirmDraft.mockRejectedValue(new AppError('CS_MESSAGE_NOT_FOUND'));

    const res = await request(createApp())
      .post(`/cs/message/${FAKE_UUID}/confirm`)
      .send({ action: 'send' });

    expect(res.status).toBe(404);
  });

  it('should return 400 for non-draft message', async () => {
    mockConfirmDraft.mockRejectedValue(new AppError('CS_MESSAGE_NOT_DRAFT'));

    const res = await request(createApp())
      .post(`/cs/message/${FAKE_UUID}/confirm`)
      .send({ action: 'send' });

    expect(res.status).toBe(400);
  });
});

// ─── GET /cs/sessions ──────────────────────────────

describe('GET /cs/sessions', () => {
  it('should list sessions with pagination', async () => {
    mockListSessions.mockResolvedValue({
      items: [{ id: FAKE_UUID_2, status: 'ai_handling', channelType: 'feishu' }],
      total: 1,
    });

    const res = await request(createApp())
      .get('/cs/sessions?page=1&pageSize=10');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.total).toBe(1);
  });
});

// ─── GET /cs/sessions/:id ──────────────────────────

describe('GET /cs/sessions/:id', () => {
  it('should return session detail', async () => {
    mockGetSessionById.mockResolvedValue({
      id: FAKE_UUID_2,
      status: 'ai_handling',
      messages: [],
      tickets: [],
    });

    const res = await request(createApp())
      .get(`/cs/sessions/${FAKE_UUID_2}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(FAKE_UUID_2);
  });

  it('should return 404 for non-existent session', async () => {
    mockGetSessionById.mockResolvedValue(null);

    const res = await request(createApp())
      .get(`/cs/sessions/${FAKE_UUID_2}`);

    expect(res.status).toBe(404);
  });
});

// ─── GET /cs/tickets ──────────────────────────────

describe('GET /cs/tickets', () => {
  it('should list tickets with pagination', async () => {
    mockListTickets.mockResolvedValue({
      items: [{ id: 'ticket-001', type: 'return_goods', status: 'pending' }],
      total: 1,
    });

    const res = await request(createApp())
      .get('/cs/tickets?page=1&pageSize=10');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});
