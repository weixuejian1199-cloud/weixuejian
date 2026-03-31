import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────

const {
  mockFindFirst,
  mockCreate,
  mockUpdateMany,
  mockFindMany,
  mockCount,
} = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockCreate: vi.fn(),
  mockUpdateMany: vi.fn(),
  mockFindMany: vi.fn(),
  mockCount: vi.fn(),
}));

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    customerServiceSession: {
      findFirst: mockFindFirst,
      create: mockCreate,
      updateMany: mockUpdateMany,
      findMany: mockFindMany,
      count: mockCount,
    },
  },
}));

import {
  getOrCreateSession,
  updateSessionStatus,
  getSessionById,
  listSessions,
} from '../../../services/cs/cs-session-service.js';

// ─── Constants ──────────────────────────────────────────

const TENANT_A = 'tenant-aaa';
const TENANT_B = 'tenant-bbb';

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ──────────────────────────────────────────────

describe('cs-session-service', () => {
  describe('getOrCreateSession', () => {
    it('should return existing session if active one exists', async () => {
      mockFindFirst.mockResolvedValue({ id: 'sess-exist' });

      const result = await getOrCreateSession(TENANT_A, 'feishu', 'ch-1', 'ext-user-1');

      expect(result).toEqual({ id: 'sess-exist', isNew: false });
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('should create new session if none exists', async () => {
      mockFindFirst.mockResolvedValue(null);
      mockCreate.mockResolvedValue({ id: 'sess-new' });

      const result = await getOrCreateSession(TENANT_A, 'feishu', 'ch-1', 'ext-user-1', '张三', 'order-1');

      expect(result).toEqual({ id: 'sess-new', isNew: true });
      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: TENANT_A,
          channelType: 'feishu',
          channelId: 'ch-1',
          externalUserId: 'ext-user-1',
          buyerName: '张三',
          orderId: 'order-1',
        }),
        select: { id: true },
      });
    });

    it('should exclude resolved/closed sessions when searching', async () => {
      mockFindFirst.mockResolvedValue(null);
      mockCreate.mockResolvedValue({ id: 'sess-new' });

      await getOrCreateSession(TENANT_A, 'feishu', 'ch-1', 'ext-user-1');

      expect(mockFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: TENANT_A,
            status: { notIn: ['resolved', 'closed'] },
          }),
        }),
      );
    });

    it('should enforce tenantId isolation — different tenants get different sessions', async () => {
      mockFindFirst.mockResolvedValue(null);
      mockCreate.mockResolvedValue({ id: 'sess-b' });

      await getOrCreateSession(TENANT_B, 'feishu', 'ch-1', 'ext-user-1');

      expect(mockFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: TENANT_B }),
        }),
      );
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tenantId: TENANT_B }),
        }),
      );
    });
  });

  describe('updateSessionStatus', () => {
    it('should update session status with tenantId isolation', async () => {
      mockUpdateMany.mockResolvedValue({ count: 1 });

      await updateSessionStatus('sess-1', TENANT_A, 'processing');

      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: { id: 'sess-1', tenantId: TENANT_A },
        data: { status: 'processing' },
      });
    });

    it('should set resolvedAt when status is resolved', async () => {
      mockUpdateMany.mockResolvedValue({ count: 1 });

      await updateSessionStatus('sess-1', TENANT_A, 'resolved');

      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: { id: 'sess-1', tenantId: TENANT_A },
        data: expect.objectContaining({
          status: 'resolved',
          resolvedAt: expect.any(Date),
        }),
      });
    });

    it('should set resolvedAt when status is closed', async () => {
      mockUpdateMany.mockResolvedValue({ count: 1 });

      await updateSessionStatus('sess-1', TENANT_A, 'closed');

      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: { id: 'sess-1', tenantId: TENANT_A },
        data: expect.objectContaining({
          status: 'closed',
          resolvedAt: expect.any(Date),
        }),
      });
    });
  });

  describe('getSessionById', () => {
    it('should return session with messages and tickets', async () => {
      const session = {
        id: 'sess-1',
        status: 'processing',
        channelType: 'feishu',
        externalUserId: 'ext-1',
        buyerName: '张三',
        orderId: null,
        createdAt: new Date(),
        messages: [{ id: 'msg-1', sender: 'buyer', content: '你好', msgType: 'text', metadata: null, createdAt: new Date() }],
        tickets: [],
      };
      mockFindFirst.mockResolvedValue(session);

      const result = await getSessionById('sess-1', TENANT_A);

      expect(result).toEqual(session);
      expect(mockFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sess-1', tenantId: TENANT_A },
        }),
      );
    });

    it('should return null for non-matching tenantId (cross-tenant isolation)', async () => {
      mockFindFirst.mockResolvedValue(null);

      const result = await getSessionById('sess-1', TENANT_B);

      expect(result).toBeNull();
      expect(mockFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sess-1', tenantId: TENANT_B },
        }),
      );
    });
  });

  describe('listSessions', () => {
    it('should return paginated sessions', async () => {
      const items = [
        { id: 'sess-1', status: 'processing', channelType: 'feishu', externalUserId: 'ext-1', buyerName: null, createdAt: new Date(), updatedAt: new Date() },
      ];
      mockFindMany.mockResolvedValue(items);
      mockCount.mockResolvedValue(5);

      const result = await listSessions(TENANT_A, 1, 20);

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(5);
    });

    it('should filter by status when provided', async () => {
      mockFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);

      await listSessions(TENANT_A, 1, 10, 'resolved');

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT_A, status: 'resolved' },
        }),
      );
    });

    it('should not include status filter when not provided', async () => {
      mockFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);

      await listSessions(TENANT_A, 1, 10);

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT_A },
        }),
      );
    });

    it('should enforce tenantId in all queries (cross-tenant isolation)', async () => {
      mockFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);

      await listSessions(TENANT_B, 2, 10);

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: TENANT_B }),
          skip: 10,
          take: 10,
        }),
      );
      expect(mockCount).toHaveBeenCalledWith({
        where: expect.objectContaining({ tenantId: TENANT_B }),
      });
    });
  });
});
