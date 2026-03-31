/**
 * 操作确认记录服务 — BL-023
 *
 * 核心能力：
 * 1. AI 生成确认请求 → 存储
 * 2. 用户确认/拒绝 → 更新状态
 * 3. 决策回放 → 完整还原：输入→规则→证据→建议→用户决策
 *
 * ADR-019: 高风险操作使用结构化确认卡片
 */
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import type { RiskLevel, AgentType, ConfirmationStatus } from '@prisma/client';

// ─── 输入校验 ────────────────────────────────────────────

export const createConfirmationSchema = z.object({
  conversationId: z.string().uuid().optional(),
  agentType: z
    .enum(['master', 'operation', 'finance', 'settlement', 'customer_service', 'report', 'system', 'tool'])
    .default('master'),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('LOW'),
  operationType: z.string().min(1).max(100),
  resourceType: z.string().max(100).optional(),
  resourceId: z.string().max(200).optional(),
  changeDetails: z.record(z.unknown()),
  expiresInMinutes: z.number().int().min(1).max(1440).optional(),
  aiInput: z.record(z.unknown()),
  aiRecommendation: z.string().min(1).max(2000),
  triggeredRules: z.array(z.object({
    ruleId: z.string(),
    ruleName: z.string(),
    result: z.string(),
    weight: z.number().optional(),
  })),
  evidence: z.array(z.object({
    type: z.string(),
    source: z.string(),
    data: z.unknown(),
    timestamp: z.string().optional(),
  })),
});

export type CreateConfirmationInput = z.infer<typeof createConfirmationSchema>;

export const respondConfirmationSchema = z.object({
  action: z.enum(['confirm', 'reject']),
  reason: z.string().max(1000).optional(),
});

export type RespondConfirmationInput = z.infer<typeof respondConfirmationSchema>;

// ─── 创建确认请求 ────────────────────────────────────────

export async function createConfirmation(
  tenantId: string,
  userId: string,
  input: CreateConfirmationInput,
) {
  const expiresAt = input.expiresInMinutes
    ? new Date(Date.now() + input.expiresInMinutes * 60_000)
    : undefined;

  const record = await prisma.confirmationRecord.create({
    data: {
      tenantId,
      userId,
      conversationId: input.conversationId,
      agentType: input.agentType as AgentType,
      title: input.title,
      description: input.description,
      riskLevel: input.riskLevel as RiskLevel,
      operationType: input.operationType,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      changeDetails: input.changeDetails as Prisma.InputJsonValue,
      expiresAt,
      aiInput: input.aiInput as Prisma.InputJsonValue,
      aiRecommendation: input.aiRecommendation,
      triggeredRules: input.triggeredRules as unknown as Prisma.InputJsonValue,
      evidence: input.evidence as unknown as Prisma.InputJsonValue,
    },
    select: confirmationSelect,
  });

  logger.info(
    { tenantId, confirmationId: record.id, operationType: input.operationType, riskLevel: input.riskLevel },
    '[confirmation] Created',
  );

  return record;
}

// ─── 用户响应（确认/拒绝） ───────────────────────────────

export async function respondToConfirmation(
  tenantId: string,
  userId: string,
  confirmationId: string,
  input: RespondConfirmationInput,
) {
  // 查找并验证
  const existing = await prisma.confirmationRecord.findFirst({
    where: { id: confirmationId, tenantId, deletedAt: null },
    select: { id: true, status: true, expiresAt: true, userId: true },
  });

  if (!existing) {
    return { error: 'CONFIRMATION_NOT_FOUND' as const };
  }

  if (existing.status !== 'pending') {
    return { error: 'CONFIRMATION_ALREADY_RESPONDED' as const };
  }

  if (existing.expiresAt && existing.expiresAt < new Date()) {
    // 自动过期
    await prisma.confirmationRecord.update({
      where: { id: confirmationId },
      data: { status: 'expired' },
    });
    return { error: 'CONFIRMATION_EXPIRED' as const };
  }

  const newStatus: ConfirmationStatus = input.action === 'confirm' ? 'confirmed' : 'rejected';

  const record = await prisma.confirmationRecord.update({
    where: { id: confirmationId },
    data: {
      status: newStatus,
      respondedAt: new Date(),
      responseReason: input.reason,
    },
    select: confirmationSelect,
  });

  // 审计日志
  await prisma.auditLog.create({
    data: {
      tenantId,
      userId,
      action: `CONFIRMATION_${input.action.toUpperCase()}`,
      resourceType: 'confirmation_record',
      resourceId: confirmationId,
      afterData: { status: newStatus, reason: input.reason },
    },
  });

  logger.info(
    { tenantId, confirmationId, action: input.action, userId },
    '[confirmation] User responded',
  );

  return { data: record };
}

// ─── 查询列表 ────────────────────────────────────────────

export async function listConfirmations(
  tenantId: string,
  userId: string,
  options: {
    page: number;
    pageSize: number;
    status?: ConfirmationStatus;
    operationType?: string;
    riskLevel?: RiskLevel;
  },
) {
  const where = {
    tenantId,
    userId,
    deletedAt: null,
    ...(options.status ? { status: options.status } : {}),
    ...(options.operationType ? { operationType: options.operationType } : {}),
    ...(options.riskLevel ? { riskLevel: options.riskLevel } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.confirmationRecord.findMany({
      where,
      select: confirmationListSelect,
      orderBy: { createdAt: 'desc' },
      skip: (options.page - 1) * options.pageSize,
      take: options.pageSize,
    }),
    prisma.confirmationRecord.count({ where }),
  ]);

  return { items, total };
}

// ─── 决策回放（核心：完整还原决策链） ────────────────────

export async function getDecisionReplay(
  tenantId: string,
  confirmationId: string,
) {
  const record = await prisma.confirmationRecord.findFirst({
    where: { id: confirmationId, tenantId, deletedAt: null },
    select: decisionReplaySelect,
  });

  if (!record) return null;

  return {
    ...record,
    decisionChain: {
      input: record.aiInput,
      triggeredRules: record.triggeredRules,
      evidence: record.evidence,
      aiRecommendation: record.aiRecommendation,
      userDecision: record.status,
      userReason: record.responseReason,
      respondedAt: record.respondedAt,
    },
  };
}

// ─── Prisma Select 定义 ─────────────────────────────────

const confirmationSelect = {
  id: true,
  tenantId: true,
  userId: true,
  conversationId: true,
  agentType: true,
  title: true,
  description: true,
  riskLevel: true,
  operationType: true,
  resourceType: true,
  resourceId: true,
  changeDetails: true,
  expiresAt: true,
  status: true,
  respondedAt: true,
  responseReason: true,
  aiRecommendation: true,
  triggeredRules: true,
  evidence: true,
  createdAt: true,
  updatedAt: true,
} as const;

const confirmationListSelect = {
  id: true,
  title: true,
  description: true,
  riskLevel: true,
  operationType: true,
  resourceType: true,
  resourceId: true,
  status: true,
  agentType: true,
  expiresAt: true,
  respondedAt: true,
  createdAt: true,
} as const;

const decisionReplaySelect = {
  id: true,
  tenantId: true,
  userId: true,
  conversationId: true,
  agentType: true,
  title: true,
  description: true,
  riskLevel: true,
  operationType: true,
  resourceType: true,
  resourceId: true,
  changeDetails: true,
  status: true,
  respondedAt: true,
  responseReason: true,
  aiInput: true,
  aiRecommendation: true,
  triggeredRules: true,
  evidence: true,
  createdAt: true,
} as const;
