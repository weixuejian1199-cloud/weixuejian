import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock setup ─────────────────────────────────────────────

const mockPrisma = vi.hoisted(() => ({
  confirmationRecord: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
}));

vi.mock('../../../lib/prisma.js', () => ({ prisma: mockPrisma }));
vi.mock('../../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  createConfirmation,
  respondToConfirmation,
  listConfirmations,
  getDecisionReplay,
  createConfirmationSchema,
  respondConfirmationSchema,
} from '../../../services/confirmation/confirmation-service.js';

// ─── Fixtures ───────────────────────────────────────────────

const TENANT_ID = 'tenant-1';
const USER_ID = 'user-1';

const baseInput = {
  title: '退货审批：订单#12345',
  description: '用户申请退货，商品已拆封',
  riskLevel: 'MEDIUM' as const,
  operationType: 'refund',
  resourceType: 'order',
  resourceId: 'order-12345',
  changeDetails: { before: { status: 'active' }, after: { status: 'refunded' } },
  aiInput: { orderId: 'order-12345', amount: 299, reason: '不想要了' },
  aiRecommendation: '建议批准：金额低于500元，符合7天无理由退货',
  triggeredRules: [
    { ruleId: 'R001', ruleName: '7天无理由', result: 'APPROVE', weight: 0.8 },
    { ruleId: 'R003', ruleName: '金额检查', result: 'APPROVE', weight: 0.6 },
  ],
  evidence: [
    { type: 'order_data', source: 'ztdy-open', data: { amount: 299 } },
    { type: 'policy_check', source: 'rule_engine', data: { withinReturnWindow: true } },
  ],
};

const mockRecord = {
  id: 'conf-1',
  tenantId: TENANT_ID,
  userId: USER_ID,
  conversationId: null,
  agentType: 'master',
  title: baseInput.title,
  description: baseInput.description,
  riskLevel: 'MEDIUM',
  operationType: 'refund',
  resourceType: 'order',
  resourceId: 'order-12345',
  changeDetails: baseInput.changeDetails,
  expiresAt: null,
  status: 'pending',
  respondedAt: null,
  responseReason: null,
  aiRecommendation: baseInput.aiRecommendation,
  triggeredRules: baseInput.triggeredRules,
  evidence: baseInput.evidence,
  createdAt: new Date('2026-03-31T12:00:00Z'),
  updatedAt: new Date('2026-03-31T12:00:00Z'),
};

// ─── Schema Validation Tests ────────────────────────────────

describe('createConfirmationSchema', () => {
  it('应接受有效输入', () => {
    const result = createConfirmationSchema.safeParse(baseInput);
    expect(result.success).toBe(true);
  });

  it('应拒绝空标题', () => {
    const result = createConfirmationSchema.safeParse({ ...baseInput, title: '' });
    expect(result.success).toBe(false);
  });

  it('应拒绝无效riskLevel', () => {
    const result = createConfirmationSchema.safeParse({ ...baseInput, riskLevel: 'UNKNOWN' });
    expect(result.success).toBe(false);
  });

  it('应接受可选字段缺失', () => {
    const { resourceType, resourceId, ...minimal } = baseInput;
    const result = createConfirmationSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });

  it('应拒绝过大的expiresInMinutes', () => {
    const result = createConfirmationSchema.safeParse({ ...baseInput, expiresInMinutes: 9999 });
    expect(result.success).toBe(false);
  });
});

describe('respondConfirmationSchema', () => {
  it('应接受 confirm', () => {
    expect(respondConfirmationSchema.safeParse({ action: 'confirm' }).success).toBe(true);
  });

  it('应接受 reject + reason', () => {
    expect(respondConfirmationSchema.safeParse({ action: 'reject', reason: '不合理' }).success).toBe(true);
  });

  it('应拒绝无效 action', () => {
    expect(respondConfirmationSchema.safeParse({ action: 'cancel' }).success).toBe(false);
  });
});

// ─── createConfirmation ─────────────────────────────────────

describe('createConfirmation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('应创建确认记录', async () => {
    mockPrisma.confirmationRecord.create.mockResolvedValue(mockRecord);

    const result = await createConfirmation(TENANT_ID, USER_ID, baseInput);

    expect(result.id).toBe('conf-1');
    expect(result.status).toBe('pending');
    expect(mockPrisma.confirmationRecord.create).toHaveBeenCalledOnce();

    const createArgs = mockPrisma.confirmationRecord.create.mock.calls[0]![0];
    expect(createArgs.data.tenantId).toBe(TENANT_ID);
    expect(createArgs.data.userId).toBe(USER_ID);
    expect(createArgs.data.operationType).toBe('refund');
  });

  it('应计算 expiresAt', async () => {
    mockPrisma.confirmationRecord.create.mockResolvedValue(mockRecord);

    await createConfirmation(TENANT_ID, USER_ID, { ...baseInput, expiresInMinutes: 30 });

    const createArgs = mockPrisma.confirmationRecord.create.mock.calls[0]![0];
    expect(createArgs.data.expiresAt).toBeInstanceOf(Date);
  });
});

// ─── respondToConfirmation ──────────────────────────────────

describe('respondToConfirmation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('确认记录不存在时返回 CONFIRMATION_NOT_FOUND', async () => {
    mockPrisma.confirmationRecord.findFirst.mockResolvedValue(null);

    const result = await respondToConfirmation(TENANT_ID, USER_ID, 'nonexistent', { action: 'confirm' });

    expect(result).toEqual({ error: 'CONFIRMATION_NOT_FOUND' });
  });

  it('已响应的记录返回 CONFIRMATION_ALREADY_RESPONDED', async () => {
    mockPrisma.confirmationRecord.findFirst.mockResolvedValue({
      id: 'conf-1', status: 'confirmed', expiresAt: null, userId: USER_ID,
    });

    const result = await respondToConfirmation(TENANT_ID, USER_ID, 'conf-1', { action: 'confirm' });

    expect(result).toEqual({ error: 'CONFIRMATION_ALREADY_RESPONDED' });
  });

  it('已过期的记录返回 CONFIRMATION_EXPIRED 并自动更新状态', async () => {
    mockPrisma.confirmationRecord.findFirst.mockResolvedValue({
      id: 'conf-1', status: 'pending', expiresAt: new Date('2020-01-01'), userId: USER_ID,
    });
    mockPrisma.confirmationRecord.update.mockResolvedValue({ id: 'conf-1', status: 'expired' });

    const result = await respondToConfirmation(TENANT_ID, USER_ID, 'conf-1', { action: 'confirm' });

    expect(result).toEqual({ error: 'CONFIRMATION_EXPIRED' });
    expect(mockPrisma.confirmationRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'expired' } }),
    );
  });

  it('confirm 应更新状态为 confirmed', async () => {
    mockPrisma.confirmationRecord.findFirst.mockResolvedValue({
      id: 'conf-1', status: 'pending', expiresAt: null, userId: USER_ID,
    });
    mockPrisma.confirmationRecord.update.mockResolvedValue({ ...mockRecord, status: 'confirmed', respondedAt: new Date() });
    mockPrisma.auditLog.create.mockResolvedValue({});

    const result = await respondToConfirmation(TENANT_ID, USER_ID, 'conf-1', { action: 'confirm' });

    expect('data' in result).toBe(true);
    expect(mockPrisma.confirmationRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'confirmed' }),
      }),
    );
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'CONFIRMATION_CONFIRM' }),
      }),
    );
  });

  it('reject + reason 应更新状态为 rejected', async () => {
    mockPrisma.confirmationRecord.findFirst.mockResolvedValue({
      id: 'conf-1', status: 'pending', expiresAt: null, userId: USER_ID,
    });
    mockPrisma.confirmationRecord.update.mockResolvedValue({ ...mockRecord, status: 'rejected', responseReason: '不合理' });
    mockPrisma.auditLog.create.mockResolvedValue({});

    const result = await respondToConfirmation(TENANT_ID, USER_ID, 'conf-1', { action: 'reject', reason: '不合理' });

    expect('data' in result).toBe(true);
    expect(mockPrisma.confirmationRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'rejected', responseReason: '不合理' }),
      }),
    );
  });
});

// ─── listConfirmations ──────────────────────────────────────

describe('listConfirmations', () => {
  beforeEach(() => vi.clearAllMocks());

  it('应返回分页列表', async () => {
    mockPrisma.confirmationRecord.findMany.mockResolvedValue([mockRecord]);
    mockPrisma.confirmationRecord.count.mockResolvedValue(1);

    const result = await listConfirmations(TENANT_ID, USER_ID, { page: 1, pageSize: 20 });

    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it('应支持 status 过滤', async () => {
    mockPrisma.confirmationRecord.findMany.mockResolvedValue([]);
    mockPrisma.confirmationRecord.count.mockResolvedValue(0);

    await listConfirmations(TENANT_ID, USER_ID, { page: 1, pageSize: 20, status: 'pending' });

    const findArgs = mockPrisma.confirmationRecord.findMany.mock.calls[0]![0];
    expect(findArgs.where.status).toBe('pending');
  });

  it('应支持 operationType 过滤', async () => {
    mockPrisma.confirmationRecord.findMany.mockResolvedValue([]);
    mockPrisma.confirmationRecord.count.mockResolvedValue(0);

    await listConfirmations(TENANT_ID, USER_ID, { page: 1, pageSize: 20, operationType: 'refund' });

    const findArgs = mockPrisma.confirmationRecord.findMany.mock.calls[0]![0];
    expect(findArgs.where.operationType).toBe('refund');
  });

  it('应支持 riskLevel 过滤', async () => {
    mockPrisma.confirmationRecord.findMany.mockResolvedValue([]);
    mockPrisma.confirmationRecord.count.mockResolvedValue(0);

    await listConfirmations(TENANT_ID, USER_ID, { page: 1, pageSize: 20, riskLevel: 'HIGH' });

    const findArgs = mockPrisma.confirmationRecord.findMany.mock.calls[0]![0];
    expect(findArgs.where.riskLevel).toBe('HIGH');
  });
});

// ─── getDecisionReplay ──────────────────────────────────────

describe('getDecisionReplay', () => {
  beforeEach(() => vi.clearAllMocks());

  it('应返回完整决策链', async () => {
    const replayRecord = {
      ...mockRecord,
      aiInput: baseInput.aiInput,
      status: 'confirmed',
      respondedAt: new Date('2026-03-31T12:05:00Z'),
      responseReason: null,
    };
    mockPrisma.confirmationRecord.findFirst.mockResolvedValue(replayRecord);

    const result = await getDecisionReplay(TENANT_ID, 'conf-1');

    expect(result).not.toBeNull();
    expect(result!.decisionChain).toBeDefined();
    expect(result!.decisionChain.input).toEqual(baseInput.aiInput);
    expect(result!.decisionChain.triggeredRules).toEqual(baseInput.triggeredRules);
    expect(result!.decisionChain.evidence).toEqual(baseInput.evidence);
    expect(result!.decisionChain.aiRecommendation).toBe(baseInput.aiRecommendation);
    expect(result!.decisionChain.userDecision).toBe('confirmed');
  });

  it('记录不存在时返回null', async () => {
    mockPrisma.confirmationRecord.findFirst.mockResolvedValue(null);

    const result = await getDecisionReplay(TENANT_ID, 'nonexistent');

    expect(result).toBeNull();
  });

  it('rejected记录应包含用户拒绝理由', async () => {
    mockPrisma.confirmationRecord.findFirst.mockResolvedValue({
      ...mockRecord,
      aiInput: baseInput.aiInput,
      status: 'rejected',
      respondedAt: new Date(),
      responseReason: '金额不对',
    });

    const result = await getDecisionReplay(TENANT_ID, 'conf-1');

    expect(result!.decisionChain.userDecision).toBe('rejected');
    expect(result!.decisionChain.userReason).toBe('金额不对');
  });
});
