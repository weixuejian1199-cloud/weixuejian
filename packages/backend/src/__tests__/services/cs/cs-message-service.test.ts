import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────

const {
  mockCreate,
  mockFindFirst,
  mockFindMany,
  mockCount,
  mockUpdateMany,
  mockDeleteMany,
} = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockFindFirst: vi.fn(),
  mockFindMany: vi.fn(),
  mockCount: vi.fn(),
  mockUpdateMany: vi.fn(),
  mockDeleteMany: vi.fn(),
}));

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    customerServiceMessage: {
      create: mockCreate,
      findFirst: mockFindFirst,
      findMany: mockFindMany,
      count: mockCount,
      updateMany: mockUpdateMany,
      deleteMany: mockDeleteMany,
    },
  },
}));

import {
  createMessage,
  getMessageById,
  confirmDraft,
  listMessagesBySession,
} from '../../../services/cs/cs-message-service.js';

// ─── Constants ──────────────────────────────────────────

const TENANT_A = 'tenant-aaa';
const TENANT_B = 'tenant-bbb';
const SESSION_ID = 'session-001';

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ──────────────────────────────────────────────

describe('cs-message-service', () => {
  describe('createMessage', () => {
    it('should create a message and return its id', async () => {
      mockCreate.mockResolvedValue({ id: 'msg-001' });

      const id = await createMessage(TENANT_A, SESSION_ID, 'buyer', '你好');

      expect(id).toBe('msg-001');
      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: TENANT_A,
          sessionId: SESSION_ID,
          sender: 'buyer',
          content: '你好',
          msgType: 'text',
        }),
        select: { id: true },
      });
    });

    it('should pass metadata when provided', async () => {
      mockCreate.mockResolvedValue({ id: 'msg-002' });

      await createMessage(TENANT_A, SESSION_ID, 'bot', '推荐回复', 'text', {
        isDraft: true,
        source: 'faq',
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            metadata: expect.objectContaining({ isDraft: true, source: 'faq' }),
          }),
        }),
      );
    });
  });

  describe('getMessageById', () => {
    it('should return message when found with matching tenantId', async () => {
      const msg = {
        id: 'msg-001',
        sessionId: SESSION_ID,
        sender: 'buyer',
        content: '你好',
        msgType: 'text',
        metadata: null,
        createdAt: new Date(),
      };
      mockFindFirst.mockResolvedValue(msg);

      const result = await getMessageById('msg-001', TENANT_A);

      expect(result).toEqual(msg);
      expect(mockFindFirst).toHaveBeenCalledWith({
        where: { id: 'msg-001', tenantId: TENANT_A },
        select: expect.any(Object),
      });
    });

    it('should return null when tenantId does not match (cross-tenant isolation)', async () => {
      mockFindFirst.mockResolvedValue(null);

      const result = await getMessageById('msg-001', TENANT_B);

      expect(result).toBeNull();
      expect(mockFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'msg-001', tenantId: TENANT_B },
        }),
      );
    });
  });

  describe('confirmDraft', () => {
    it('should discard draft message with tenantId isolation', async () => {
      mockFindFirst.mockResolvedValue({
        id: 'msg-draft',
        metadata: { isDraft: true, source: 'faq' },
      });
      mockDeleteMany.mockResolvedValue({ count: 1 });

      const result = await confirmDraft('msg-draft', TENANT_A, 'user-1', 'discard');

      expect(result).toEqual({ status: 'discarded' });
      expect(mockDeleteMany).toHaveBeenCalledWith({ where: { id: 'msg-draft', tenantId: TENANT_A } });
    });

    it('should confirm draft with send action and tenantId isolation', async () => {
      mockFindFirst.mockResolvedValue({
        id: 'msg-draft',
        metadata: { isDraft: true, source: 'judgment' },
      });
      mockUpdateMany.mockResolvedValue({ count: 1 });

      const result = await confirmDraft('msg-draft', TENANT_A, 'user-1', 'send');

      expect(result).toEqual({ status: 'confirmed' });
      expect(mockUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'msg-draft', tenantId: TENANT_A },
          data: expect.objectContaining({
            metadata: expect.objectContaining({ isDraft: false, confirmedBy: 'user-1' }),
          }),
        }),
      );
    });

    it('should confirm draft with edited content and tenantId isolation', async () => {
      mockFindFirst.mockResolvedValue({
        id: 'msg-draft',
        metadata: { isDraft: true, source: 'faq' },
      });
      mockUpdateMany.mockResolvedValue({ count: 1 });

      await confirmDraft('msg-draft', TENANT_A, 'user-1', 'edit_and_send', '修改后内容');

      expect(mockUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'msg-draft', tenantId: TENANT_A },
          data: expect.objectContaining({ content: '修改后内容' }),
        }),
      );
    });

    it('should not allow cross-tenant discard', async () => {
      mockFindFirst.mockResolvedValue(null);

      await expect(confirmDraft('msg-draft', TENANT_B, 'user-1', 'discard')).rejects.toThrow(
        'CS_MESSAGE_NOT_FOUND',
      );
      expect(mockDeleteMany).not.toHaveBeenCalled();
    });

    it('should throw when message not found', async () => {
      mockFindFirst.mockResolvedValue(null);

      await expect(confirmDraft('msg-999', TENANT_A, 'user-1', 'send')).rejects.toThrow(
        'CS_MESSAGE_NOT_FOUND',
      );
    });

    it('should throw when message is not a draft', async () => {
      mockFindFirst.mockResolvedValue({
        id: 'msg-normal',
        metadata: { isDraft: false },
      });

      await expect(confirmDraft('msg-normal', TENANT_A, 'user-1', 'send')).rejects.toThrow(
        'CS_MESSAGE_NOT_DRAFT',
      );
    });

    it('should enforce tenantId in query (cross-tenant isolation)', async () => {
      mockFindFirst.mockResolvedValue(null);

      await expect(confirmDraft('msg-draft', TENANT_B, 'user-1', 'send')).rejects.toThrow(
        'CS_MESSAGE_NOT_FOUND',
      );
      expect(mockFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'msg-draft', tenantId: TENANT_B },
        }),
      );
    });
  });

  describe('listMessagesBySession', () => {
    it('should return paginated messages with total count', async () => {
      const items = [
        { id: 'msg-1', sender: 'buyer', content: '你好', msgType: 'text', metadata: null, createdAt: new Date() },
        { id: 'msg-2', sender: 'bot', content: '您好', msgType: 'text', metadata: null, createdAt: new Date() },
      ];
      mockFindMany.mockResolvedValue(items);
      mockCount.mockResolvedValue(10);

      const result = await listMessagesBySession(SESSION_ID, TENANT_A, 1, 20);

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(10);
    });

    it('should pass correct pagination params', async () => {
      mockFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);

      await listMessagesBySession(SESSION_ID, TENANT_A, 3, 10);

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { sessionId: SESSION_ID, tenantId: TENANT_A },
          skip: 20,
          take: 10,
          orderBy: { createdAt: 'asc' },
        }),
      );
    });

    it('should enforce tenantId in query (cross-tenant isolation)', async () => {
      mockFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);

      await listMessagesBySession(SESSION_ID, TENANT_B, 1, 10);

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { sessionId: SESSION_ID, tenantId: TENANT_B },
        }),
      );
      expect(mockCount).toHaveBeenCalledWith({
        where: { sessionId: SESSION_ID, tenantId: TENANT_B },
      });
    });
  });
});
