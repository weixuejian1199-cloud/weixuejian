/**
 * 客服工单 CRUD 服务
 */

import { prisma } from '../../lib/prisma.js';
import { CSTicketStatus } from '@prisma/client';
import type { Prisma, CSTicketType } from '@prisma/client';
import type { JudgmentOutput } from './types.js';

export async function createTicket(
  tenantId: string,
  sessionId: string,
  type: CSTicketType,
  aiDecision: JudgmentOutput,
  orderId?: string,
  aiJudgmentId?: string,
): Promise<string> {
  const ticket = await prisma.customerServiceTicket.create({
    data: {
      tenantId,
      sessionId,
      type,
      orderId: orderId ?? null,
      aiJudgmentId: aiJudgmentId ?? null,
      aiDecision: JSON.parse(JSON.stringify(aiDecision)) as Prisma.InputJsonValue,
      status: CSTicketStatus.awaiting_human_confirmation,
    },
    select: { id: true },
  });
  return ticket.id;
}

export async function getTicketById(
  ticketId: string,
  tenantId: string,
): Promise<{
  id: string;
  sessionId: string;
  type: CSTicketType;
  status: CSTicketStatus;
  aiDecision: unknown;
  humanDecision: unknown;
  orderId: string | null;
  createdAt: Date;
} | null> {
  return prisma.customerServiceTicket.findFirst({
    where: { id: ticketId, tenantId },
    select: {
      id: true,
      sessionId: true,
      type: true,
      status: true,
      aiDecision: true,
      humanDecision: true,
      orderId: true,
      createdAt: true,
    },
  });
}

export async function listTickets(
  tenantId: string,
  page: number,
  pageSize: number,
  status?: CSTicketStatus,
): Promise<{
  items: Array<{
    id: string;
    sessionId: string;
    type: CSTicketType;
    status: CSTicketStatus;
    orderId: string | null;
    aiDecision: unknown;
    createdAt: Date;
  }>;
  total: number;
}> {
  const where = {
    tenantId,
    ...(status ? { status } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.customerServiceTicket.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        sessionId: true,
        type: true,
        status: true,
        orderId: true,
        aiDecision: true,
        createdAt: true,
      },
    }),
    prisma.customerServiceTicket.count({ where }),
  ]);

  return { items, total };
}
