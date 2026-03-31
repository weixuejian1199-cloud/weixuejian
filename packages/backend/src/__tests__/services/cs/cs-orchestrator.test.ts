import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all external dependencies before imports
vi.mock('../../../lib/prisma.js', () => ({ prisma: {} }));
vi.mock('../../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../../adapters/erp/mall-adapter.js', () => ({
  MallAdapter: vi.fn(),
}));

// Mock service modules
vi.mock('../../../services/cs/cs-session-service.js', () => ({
  getOrCreateSession: vi.fn(),
  updateSessionStatus: vi.fn(),
}));
vi.mock('../../../services/cs/cs-message-service.js', () => ({
  createMessage: vi.fn(),
}));
vi.mock('../../../services/cs/cs-ticket-service.js', () => ({
  createTicket: vi.fn(),
}));
vi.mock('../../../services/cs/judgment-record-service.js', () => ({
  createJudgmentRecord: vi.fn(),
  countRecentReturns: vi.fn(),
}));

import { handleIncomingMessage } from '../../../services/cs/cs-orchestrator.js';
import * as sessionService from '../../../services/cs/cs-session-service.js';
import * as messageService from '../../../services/cs/cs-message-service.js';
import * as ticketService from '../../../services/cs/cs-ticket-service.js';
import * as judgmentRecordService from '../../../services/cs/judgment-record-service.js';
import { MallAdapter } from '../../../adapters/erp/mall-adapter.js';

const TENANT_ID = 'tenant-001';
const USER_ID = 'user-001';

function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    channelType: 'feishu',
    channelId: 'msg-001',
    externalUserId: 'ext-001',
    buyerName: '测试用户',
    content: '你好',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  // Default mock returns
  vi.mocked(sessionService.getOrCreateSession).mockResolvedValue({ id: 'session-001', isNew: true });
  vi.mocked(sessionService.updateSessionStatus).mockResolvedValue();
  vi.mocked(messageService.createMessage).mockResolvedValue('msg-001');
  vi.mocked(ticketService.createTicket).mockResolvedValue('ticket-001');
  vi.mocked(judgmentRecordService.createJudgmentRecord).mockResolvedValue('record-001');
  vi.mocked(judgmentRecordService.countRecentReturns).mockResolvedValue(0);
});

describe('handleIncomingMessage', () => {
  it('should create session and message for any incoming message', async () => {
    const result = await handleIncomingMessage(TENANT_ID, USER_ID, makePayload());

    expect(sessionService.getOrCreateSession).toHaveBeenCalledWith(
      TENANT_ID, 'feishu', 'msg-001', 'ext-001', '测试用户', undefined,
    );
    expect(messageService.createMessage).toHaveBeenCalledWith(
      TENANT_ID, 'session-001', 'buyer', '你好', 'text',
    );
    expect(result.sessionId).toBe('session-001');
    expect(result.messageId).toBe('msg-001');
  });

  it('should not trigger judgment for non-return message', async () => {
    const result = await handleIncomingMessage(TENANT_ID, USER_ID, makePayload({ content: '你好' }));

    expect(result.processing.judgmentTriggered).toBe(false);
    expect(result.processing.faqMatched).toBe(false);
    expect(result.draftReply).toBeUndefined();
    expect(result.judgment).toBeUndefined();
  });

  it('should match FAQ and generate draft for shipping question', async () => {
    // createMessage returns different IDs on successive calls
    vi.mocked(messageService.createMessage)
      .mockResolvedValueOnce('buyer-msg-001')
      .mockResolvedValueOnce('draft-msg-001');

    const result = await handleIncomingMessage(TENANT_ID, USER_ID, makePayload({ content: '什么时候发货' }));

    expect(result.processing.faqMatched).toBe(true);
    expect(result.processing.isReturnRelated).toBe(false);
    expect(result.processing.judgmentTriggered).toBe(false);
    expect(result.draftReply).toBeDefined();
    expect(result.draftReply!.source).toBe('faq');
  });

  it('should trigger judgment for return-related message', async () => {
    vi.mocked(messageService.createMessage)
      .mockResolvedValueOnce('buyer-msg-001')
      .mockResolvedValueOnce('draft-msg-001');

    const result = await handleIncomingMessage(TENANT_ID, USER_ID, makePayload({
      content: '我想退货',
      orderId: 'ORD-123',
    }));

    expect(result.processing.judgmentTriggered).toBe(true);
    expect(result.processing.isReturnRelated).toBe(true);
    expect(result.judgment).toBeDefined();
    expect(result.judgment!.executionAllowed).toBe(false);
    expect(result.ticketId).toBe('ticket-001');
    expect(result.draftReply!.source).toBe('judgment');
  });

  it('should trigger judgment for high emotion message', async () => {
    vi.mocked(messageService.createMessage)
      .mockResolvedValueOnce('buyer-msg-001')
      .mockResolvedValueOnce('draft-msg-001');

    const result = await handleIncomingMessage(TENANT_ID, USER_ID, makePayload({
      content: '垃圾服务，我要投诉你们',
    }));

    expect(result.processing.judgmentTriggered).toBe(true);
    expect(result.judgment).toBeDefined();
    expect(result.judgment!.decision).toBe('ESCALATE');
  });

  it('should trigger judgment for refund intent (no orderId → GATE_DATA_MISSING)', async () => {
    vi.mocked(messageService.createMessage)
      .mockResolvedValueOnce('buyer-msg-001')
      .mockResolvedValueOnce('draft-msg-001');

    const result = await handleIncomingMessage(TENANT_ID, USER_ID, makePayload({
      content: '我要退款',
    }));

    expect(result.processing.judgmentTriggered).toBe(true);
    expect(result.judgment!.decision).toBe('ESCALATE');
    // 没有orderId → order=null → GATE_DATA_MISSING（fail-secure优先于GATE_REFUND_REQUEST）
    expect(result.judgment!.triggeredRules[0].code).toBe('GATE_DATA_MISSING');
  });

  it('should ESCALATE when order lookup fails (fail-secure)', async () => {
    vi.mocked(messageService.createMessage)
      .mockResolvedValueOnce('buyer-msg-001')
      .mockResolvedValueOnce('draft-msg-001');

    // MallAdapter throws
    vi.mocked(MallAdapter).mockImplementation(() => ({
      getOrders: vi.fn().mockRejectedValue(new Error('API timeout')),
    }) as unknown as MallAdapter);

    const result = await handleIncomingMessage(TENANT_ID, USER_ID, makePayload({
      content: '我想退货',
      orderId: 'ORD-123',
    }));

    expect(result.judgment).toBeDefined();
    expect(result.judgment!.decision).toBe('ESCALATE');
    expect(result.judgment!.triggeredRules[0].code).toBe('GATE_DATA_MISSING');
  });

  it('should update session status to escalated for ESCALATE decision', async () => {
    vi.mocked(messageService.createMessage)
      .mockResolvedValueOnce('buyer-msg-001')
      .mockResolvedValueOnce('draft-msg-001');

    await handleIncomingMessage(TENANT_ID, USER_ID, makePayload({
      content: '我要投诉你们！找律师！',
    }));

    expect(sessionService.updateSessionStatus).toHaveBeenCalledWith(
      'session-001', TENANT_ID, 'escalated',
    );
  });
});
