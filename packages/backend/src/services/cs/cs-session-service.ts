/**
 * 客服会话 CRUD 服务
 */

import { prisma } from '../../lib/prisma.js';
import type { CSSessionStatus } from '@prisma/client';

export async function getOrCreateSession(
  tenantId: string,
  channelType: string,
  channelId: string,
  externalUserId: string,
  buyerName?: string,
  orderId?: string,
): Promise<{ id: string; isNew: boolean }> {
  const existing = await prisma.customerServiceSession.findFirst({
    where: {
      tenantId,
      channelType,
      externalUserId,
      status: { notIn: ['resolved', 'closed'] },
    },
    select: { id: true },
    orderBy: { createdAt: 'desc' },
  });

  if (existing) return { id: existing.id, isNew: false };

  const session = await prisma.customerServiceSession.create({
    data: {
      tenantId,
      channelType,
      channelId,
      externalUserId,
      buyerName: buyerName ?? null,
      orderId: orderId ?? null,
    },
    select: { id: true },
  });

  return { id: session.id, isNew: true };
}

export async function updateSessionStatus(
  sessionId: string,
  tenantId: string,
  status: CSSessionStatus,
): Promise<void> {
  await prisma.customerServiceSession.updateMany({
    where: { id: sessionId, tenantId },
    data: {
      status,
      ...(status === 'resolved' || status === 'closed' ? { resolvedAt: new Date() } : {}),
    },
  });
}

export async function getSessionById(
  sessionId: string,
  tenantId: string,
): Promise<{
  id: string;
  status: CSSessionStatus;
  channelType: string;
  externalUserId: string;
  buyerName: string | null;
  orderId: string | null;
  createdAt: Date;
  messages: Array<{ id: string; sender: string; content: string; msgType: string; metadata: unknown; createdAt: Date }>;
  tickets: Array<{ id: string; type: string; status: string; aiDecision: unknown; createdAt: Date }>;
} | null> {
  return prisma.customerServiceSession.findFirst({
    where: { id: sessionId, tenantId },
    select: {
      id: true,
      status: true,
      channelType: true,
      externalUserId: true,
      buyerName: true,
      orderId: true,
      createdAt: true,
      messages: {
        select: { id: true, sender: true, content: true, msgType: true, metadata: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      },
      tickets: {
        select: { id: true, type: true, status: true, aiDecision: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      },
    },
  });
}

export async function listSessions(
  tenantId: string,
  page: number,
  pageSize: number,
  status?: CSSessionStatus,
): Promise<{
  items: Array<{
    id: string;
    status: CSSessionStatus;
    channelType: string;
    externalUserId: string;
    buyerName: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
  total: number;
}> {
  const where = {
    tenantId,
    ...(status ? { status } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.customerServiceSession.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        status: true,
        channelType: true,
        externalUserId: true,
        buyerName: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.customerServiceSession.count({ where }),
  ]);

  return { items, total };
}
