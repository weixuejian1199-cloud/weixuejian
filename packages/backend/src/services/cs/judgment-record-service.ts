/**
 * AiJudgmentRecord 持久化服务
 *
 * AC-10: 结构化存储每次AI判断
 * AC-11: 30天退货频次统计（规则4数据源）
 */

import { prisma } from '../../lib/prisma.js';
import { Prisma } from '@prisma/client';
import type { AciDecision, RiskLevel } from '@prisma/client';
import type { JudgmentOutput } from './types.js';

export async function createJudgmentRecord(
  tenantId: string,
  userId: string,
  judgment: JudgmentOutput,
  sessionId?: string,
  orderId?: string,
): Promise<string> {
  const record = await prisma.aiJudgmentRecord.create({
    data: {
      tenantId,
      sessionId: sessionId ?? null,
      orderId: orderId ?? null,
      userId,
      judgmentType: 'return_request',
      decision: judgment.decision as AciDecision,
      reason: judgment.reason,
      reasonForCustomer: judgment.reasonForCustomer,
      riskLevel: judgment.riskLevel as RiskLevel,
      confidence: new Prisma.Decimal(judgment.confidence.toFixed(2)),
      triggeredRules: JSON.parse(JSON.stringify(judgment.triggeredRules)) as Prisma.InputJsonValue,
      context: JSON.parse(JSON.stringify(judgment.context)) as Prisma.InputJsonValue,
      executionAllowed: false,
      disclaimer: judgment.disclaimer,
      processingTimeMs: judgment.processingTimeMs,
    },
    select: { id: true },
  });
  return record.id;
}

/**
 * 统计用户近N天的退货判断次数（AC-11）
 * 用于规则4：30天退货>=3次 → ESCALATE
 */
export async function countRecentReturns(
  tenantId: string,
  userId: string,
  days: number = 30,
): Promise<number> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  return prisma.aiJudgmentRecord.count({
    where: {
      tenantId,
      userId,
      judgmentType: 'return_request',
      createdAt: { gte: since },
    },
  });
}
