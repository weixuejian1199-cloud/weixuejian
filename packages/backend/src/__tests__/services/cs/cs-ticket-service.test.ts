import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────

const {
  mockCreate,
  mockFindFirst,
  mockFindMany,
  mockCount,
} = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockFindFirst: vi.fn(),
  mockFindMany: vi.fn(),
  mockCount: vi.fn(),
}));

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    customerServiceTicket: {
      create: mockCreate,
      findFirst: mockFindFirst,
      findMany: mockFindMany,
      count: mockCount,
    },
  },
}));

import {
  createTicket,
  getTicketById,
  listTickets,
} from '../../../services/cs/cs-ticket-service.js';

import type { JudgmentOutput } from '../../../services/cs/types.js';

// ─── Constants ──────────────────────────────────────────

const TENANT_A = 'tenant-aaa';
const TENANT_B = 'tenant-bbb';
const SESSION_ID = 'session-001';

function makeJudgment(overrides: Partial<JudgmentOutput> = {}): JudgmentOutput {
  return {
    decision: 'APPROVE',
    reason: '符合退货条件',
    reasonForCustomer: '您的退货申请已通过',
    riskLevel: 'LOW',
    confidence: 0.92,
    triggeredRules: [{ code: 'P2-DEFAULT', priority: 'P2', description: '默认允许', evidence: '无异常' }],
    context: { orderId: 'order-1', processNode: 3, totalAmount: 99, payDate: null, shipmentsDate: null, receivedDate: null, itemCategory: null, buyerName: null },
    executionAllowed: false,
    disclaimer: '建议仅供参考',
    processingTimeMs: 50,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ──────────────────────────────────────────────

describe('cs-ticket-service', () => {
  describe('createTicket', () => {
    it('should create ticket and return id', async () => {
      mockCreate.mockResolvedValue({ id: 'ticket-001' });

      const id = await createTicket(TENANT_A, SESSION_ID, 'return_request', makeJudgment());

      expect(id).toBe('ticket-001');
      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: TENANT_A,
          sessionId: SESSION_ID,
          type: 'return_request',
          status: 'awaiting_human_confirmation',
        }),
        select: { id: true },
      });
    });

    it('should include orderId and aiJudgmentId when provided', async () => {
      mockCreate.mockResolvedValue({ id: 'ticket-002' });

      await createTicket(TENANT_A, SESSION_ID, 'return_request', makeJudgment(), 'order-1', 'judgment-1');

      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          orderId: 'order-1',
          aiJudgmentId: 'judgment-1',
        }),
        select: { id: true },
      });
    });

    it('should serialize aiDecision as JSON', async () => {
      const judgment = makeJudgment({ decision: 'ESCALATE', riskLevel: 'HIGH' });
      mockCreate.mockResolvedValue({ id: 'ticket-003' });

      await createTicket(TENANT_A, SESSION_ID, 'return_request', judgment);

      const callData = mockCreate.mock.calls[0]![0] as { data: { aiDecision: unknown } };
      expect(callData.data.aiDecision).toEqual(expect.objectContaining({ decision: 'ESCALATE', riskLevel: 'HIGH' }));
    });
  });

  describe('getTicketById', () => {
    it('should return ticket when found with matching tenantId', async () => {
      const ticket = {
        id: 'ticket-001',
        sessionId: SESSION_ID,
        type: 'return_request',
        status: 'awaiting_human_confirmation',
        aiDecision: makeJudgment(),
        humanDecision: null,
        orderId: 'order-1',
        createdAt: new Date(),
      };
      mockFindFirst.mockResolvedValue(ticket);

      const result = await getTicketById('ticket-001', TENANT_A);

      expect(result).toEqual(ticket);
    });

    it('should return null for non-matching tenantId (cross-tenant isolation)', async () => {
      mockFindFirst.mockResolvedValue(null);

      const result = await getTicketById('ticket-001', TENANT_B);

      expect(result).toBeNull();
      expect(mockFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ticket-001', tenantId: TENANT_B },
        }),
      );
    });
  });

  describe('listTickets', () => {
    it('should return paginated tickets', async () => {
      const items = [
        { id: 'ticket-1', sessionId: 's1', type: 'return_request', status: 'awaiting_human_confirmation', orderId: null, aiDecision: {}, createdAt: new Date() },
      ];
      mockFindMany.mockResolvedValue(items);
      mockCount.mockResolvedValue(3);

      const result = await listTickets(TENANT_A, 1, 20);

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(3);
    });

    it('should filter by status when provided', async () => {
      mockFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);

      await listTickets(TENANT_A, 1, 10, 'awaiting_human_confirmation');

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT_A, status: 'awaiting_human_confirmation' },
        }),
      );
    });

    it('should enforce tenantId in all queries (cross-tenant isolation)', async () => {
      mockFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);

      await listTickets(TENANT_B, 1, 10);

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: TENANT_B }),
        }),
      );
      expect(mockCount).toHaveBeenCalledWith({
        where: expect.objectContaining({ tenantId: TENANT_B }),
      });
    });

    it('should calculate correct skip for pagination', async () => {
      mockFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);

      await listTickets(TENANT_A, 3, 15);

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 30, take: 15 }),
      );
    });
  });
});
