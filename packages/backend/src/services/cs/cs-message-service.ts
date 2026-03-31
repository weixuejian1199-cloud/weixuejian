/**
 * 客服消息 CRUD + 草稿确认服务
 */

import { prisma } from '../../lib/prisma.js';
import { Prisma } from '@prisma/client';
import type { CSMessageSender } from '@prisma/client';

interface DraftMetadata {
  isDraft: true;
  source: 'faq' | 'judgment';
  judgmentRecordId?: string;
  [key: string]: unknown;
}

/** 类型守卫：从 Prisma JsonValue 中安全提取 DraftMetadata */
function isDraftMetadata(value: unknown): DraftMetadata | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (obj['isDraft'] === true) {
      return obj as DraftMetadata;
    }
  }
  return null;
}

export async function createMessage(
  tenantId: string,
  sessionId: string,
  sender: CSMessageSender,
  content: string,
  msgType: string = 'text',
  metadata?: DraftMetadata | null,
): Promise<string> {
  const msg = await prisma.customerServiceMessage.create({
    data: {
      tenantId,
      sessionId,
      sender,
      content,
      msgType,
      metadata: metadata ? (metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
    },
    select: { id: true },
  });
  return msg.id;
}

export async function getMessageById(
  messageId: string,
  tenantId: string,
): Promise<{
  id: string;
  sessionId: string;
  sender: CSMessageSender;
  content: string;
  msgType: string;
  metadata: unknown;
  createdAt: Date;
} | null> {
  return prisma.customerServiceMessage.findFirst({
    where: { id: messageId, tenantId },
    select: {
      id: true,
      sessionId: true,
      sender: true,
      content: true,
      msgType: true,
      metadata: true,
      createdAt: true,
    },
  });
}

export async function confirmDraft(
  messageId: string,
  tenantId: string,
  userId: string,
  action: 'send' | 'edit_and_send' | 'discard',
  editedContent?: string,
): Promise<{ status: 'confirmed' | 'discarded' }> {
  const msg = await prisma.customerServiceMessage.findFirst({
    where: { id: messageId, tenantId },
    select: { id: true, metadata: true },
  });

  if (!msg) throw new Error('CS_MESSAGE_NOT_FOUND');

  const meta = isDraftMetadata(msg.metadata);
  if (!meta) throw new Error('CS_MESSAGE_NOT_DRAFT');

  if (action === 'discard') {
    await prisma.customerServiceMessage.delete({
      where: { id: messageId },
    });
    return { status: 'discarded' };
  }

  const confirmedMeta: Prisma.InputJsonObject = {
    isDraft: false,
    confirmedAt: new Date().toISOString(),
    confirmedBy: userId,
    source: meta.source ?? 'faq',
  };

  await prisma.customerServiceMessage.update({
    where: { id: messageId },
    data: {
      content: action === 'edit_and_send' && editedContent ? editedContent : undefined,
      metadata: confirmedMeta,
    },
  });

  return { status: 'confirmed' };
}

export async function listMessagesBySession(
  sessionId: string,
  tenantId: string,
  page: number,
  pageSize: number,
): Promise<{
  items: Array<{
    id: string;
    sender: CSMessageSender;
    content: string;
    msgType: string;
    metadata: unknown;
    createdAt: Date;
  }>;
  total: number;
}> {
  const where = { sessionId, tenantId };

  const [items, total] = await Promise.all([
    prisma.customerServiceMessage.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        sender: true,
        content: true,
        msgType: true,
        metadata: true,
        createdAt: true,
      },
    }),
    prisma.customerServiceMessage.count({ where }),
  ]);

  return { items, total };
}
