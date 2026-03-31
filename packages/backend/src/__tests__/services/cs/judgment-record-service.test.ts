import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────

const { mockCreate, mockCount } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockCount: vi.fn(),
}));

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    aiJudgmentRecord: {
      create: mockCreate,
      count: mockCount,
    },
  },
}));

import {
  createJudgmentRecord,
  countRecentReturns,
} from '../../../services/cs/judgment-record-service.js';
import type { JudgmentOutput } from '../../../services/cs/types.js';

// ─── Constants ──────────────────────────────────────────

const TENANT_A = 'tenant-aaa';
const TENANT_B = 'tenant-bbb';
const USER_ID = 'user-001';

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

describe('judgment-record-service', () => {
  describe('createJudgmentRecord', () => {
    it('should create record and return id', async () => {
      mockCreate.mockResolvedValue({ id: 'jr-001' });

      const id = await createJudgmentRecord(TENANT_A, USER_ID, makeJudgment());

      expect(id).toBe('jr-001');
      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: TENANT_A,
          userId: USER_ID,
          judgmentType: 'return_request',
          decision: 'APPROVE',
          riskLevel: 'LOW',
          executionAllowed: false,
        }),
        select: { id: true },
      });
    });

    it('should pass sessionId and orderId when provided', async () => {
      mockCreate.mockResolvedValue({ id: 'jr-002' });

      await createJudgmentRecord(TENANT_A, USER_ID, makeJudgment(), 'sess-1', 'order-1');

      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          sessionId: 'sess-1',
          orderId: 'order-1',
        }),
        select: { id: true },
      });
    });

    it('should set sessionId/orderId to null when not provided', async () => {
      mockCreate.mockResolvedValue({ id: 'jr-003' });

      await createJudgmentRecord(TENANT_A, USER_ID, makeJudgment());

      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          sessionId: null,
          orderId: null,
        }),
        select: { id: true },
      });
    });

    it('should store ESCALATE decision correctly', async () => {
      mockCreate.mockResolvedValue({ id: 'jr-004' });
      const judgment = makeJudgment({ decision: 'ESCALATE', riskLevel: 'CRITICAL', confidence: 0.45 });

      await createJudgmentRecord(TENANT_A, USER_ID, judgment);

      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          decision: 'ESCALATE',
          riskLevel: 'CRITICAL',
        }),
        select: { id: true },
      });
    });

    it('should enforce tenantId in record creation', async () => {
      mockCreate.mockResolvedValue({ id: 'jr-005' });

      await createJudgmentRecord(TENANT_B, USER_ID, makeJudgment());

      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ tenantId: TENANT_B }),
        select: { id: true },
      });
    });
  });

  describe('countRecentReturns', () => {
    it('should count recent returns within 30 days by default', async () => {
      mockCount.mockResolvedValue(2);

      const count = await countRecentReturns(TENANT_A, USER_ID);

      expect(count).toBe(2);
      expect(mockCount).toHaveBeenCalledWith({
        where: expect.objectContaining({
          tenantId: TENANT_A,
          userId: USER_ID,
          judgmentType: 'return_request',
          createdAt: { gte: expect.any(Date) },
        }),
      });
    });

    it('should use custom days parameter', async () => {
      mockCount.mockResolvedValue(5);

      const count = await countRecentReturns(TENANT_A, USER_ID, 7);

      expect(count).toBe(5);
      // Verify the date is approximately 7 days ago
      const callArgs = mockCount.mock.calls[0]![0] as { where: { createdAt: { gte: Date } } };
      const since = callArgs.where.createdAt.gte;
      const daysDiff = (Date.now() - since.getTime()) / (1000 * 60 * 60 * 24);
      expect(daysDiff).toBeCloseTo(7, 0);
    });

    it('should enforce tenantId isolation (cross-tenant)', async () => {
      mockCount.mockResolvedValue(0);

      await countRecentReturns(TENANT_B, USER_ID);

      expect(mockCount).toHaveBeenCalledWith({
        where: expect.objectContaining({ tenantId: TENANT_B }),
      });
    });

    it('should return 0 when no records found', async () => {
      mockCount.mockResolvedValue(0);

      const count = await countRecentReturns(TENANT_A, 'user-nonexistent');

      expect(count).toBe(0);
    });
  });
});
