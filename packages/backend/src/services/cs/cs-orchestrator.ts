/**
 * 客服编排器 — ACI 客服中枢入口
 *
 * 串联：消息持久化 → 情绪检测 → FAQ匹配 → 订单查询 → 退货判断 → 草稿生成 → 工单创建
 *
 * 同步函数，非SSE。与 chat-orchestrator（LLM流式）并行独立。
 */

import { MallAdapter } from '../../adapters/erp/mall-adapter.js';
import { CSSessionStatus } from '@prisma/client';
import { logger } from '../../utils/logger.js';
import { detectEmotion, detectRefundIntent } from './emotion-detector.js';
import { matchFaq } from './faq-matcher.js';
import { evaluateReturnRequest, isFoodCategory } from './return-judgment-engine.js';
import * as sessionService from './cs-session-service.js';
import * as messageService from './cs-message-service.js';
import * as ticketService from './cs-ticket-service.js';
import * as judgmentRecordService from './judgment-record-service.js';
import type { IncomingMessagePayload, OrchestratorResult, OrderSnapshot } from './types.js';

export async function handleIncomingMessage(
  tenantId: string,
  userId: string,
  payload: IncomingMessagePayload,
): Promise<OrchestratorResult> {
  const startTime = Date.now();

  // ─── 1. 获取或创建会话 ─────────────────────────────
  const { id: sessionId } = await sessionService.getOrCreateSession(
    tenantId,
    payload.channelType,
    payload.channelId,
    payload.externalUserId,
    payload.buyerName,
    payload.orderId,
  );

  // ─── 2. 保存买家消息 ──────────────────────────────
  const messageId = await messageService.createMessage(
    tenantId,
    sessionId,
    'buyer',
    payload.content,
    payload.msgType ?? 'text',
  );

  // ─── 3. 情绪检测 + 退款意图检测 ──────────────────
  const emotion = detectEmotion(payload.content);
  const refundIntent = detectRefundIntent(payload.content);

  // ─── 4. FAQ 匹配 ──────────────────────────────────
  const faqMatch = matchFaq(payload.content);
  const isReturnRelated = faqMatch?.isReturnRelated ?? false;

  // ─── 5. 分支处理 ──────────────────────────────────
  const result: OrchestratorResult = {
    sessionId,
    messageId,
    processing: {
      faqMatched: faqMatch !== null,
      isReturnRelated,
      judgmentTriggered: false,
    },
  };

  if (isReturnRelated || emotion.level === 'high' || refundIntent.detected) {
    // ─── 退货判断路径 ────────────────────────────
    result.processing.judgmentTriggered = true;

    // 更新会话状态为 AI 判断中
    await sessionService.updateSessionStatus(sessionId, tenantId, CSSessionStatus.ai_judging);

    // 查订单数据 — 通过 MallAdapter 的 userId 过滤
    let orderSnapshot: OrderSnapshot | null = null;
    if (payload.orderId) {
      try {
        const adapter = new MallAdapter(tenantId);
        // ztdy API 支持 userId 过滤，遍历查找匹配的订单号
        const orders = await adapter.getOrders({ pageIndex: 1, pageSize: 50 });
        const matched = orders.items.find((o) => o.orderItemNo === payload.orderId);

        if (matched) {
          orderSnapshot = {
            orderId: matched.orderItemNo,
            processNode: matched.processNode,
            totalAmount: matched.totalAmount,
            payDate: matched.payDate,
            shipmentsDate: matched.createDate,
            receivedDate: null, // ztdy API 无 receivedDate
            itemCategory: matched.itemName,
            buyerName: payload.buyerName ?? null,
          };
        }
      } catch (err) {
        logger.warn({ err, orderId: payload.orderId }, 'Failed to fetch order for CS judgment');
        // fail-secure: 订单获取失败，引擎会 ESCALATE
      }
    }

    // 查30天退货频次
    const recentReturnCount = await judgmentRecordService.countRecentReturns(tenantId, userId);

    // 执行判断引擎
    const judgment = evaluateReturnRequest({
      messageContent: payload.content,
      order: orderSnapshot,
      emotion,
      refundIntent,
      recentReturnCount,
      isOpened: null, // Phase 1 无法从 API 获取拆封信息
      isFoodCategory: isFoodCategory(orderSnapshot?.itemCategory ?? null),
    });

    // 持久化判断记录
    const recordId = await judgmentRecordService.createJudgmentRecord(
      tenantId,
      userId,
      judgment,
      sessionId,
      payload.orderId,
    );

    // 创建工单
    const ticketId = await ticketService.createTicket(
      tenantId,
      sessionId,
      'return_goods',
      judgment,
      payload.orderId,
      recordId,
    );

    // 生成AI草稿回复
    const draftContent = judgment.reasonForCustomer;
    const draftMessageId = await messageService.createMessage(
      tenantId,
      sessionId,
      'ai',
      draftContent,
      'text',
      { isDraft: true, source: 'judgment', judgmentRecordId: recordId },
    );

    // 更新会话状态
    const newStatus = judgment.decision === 'ESCALATE'
      ? CSSessionStatus.escalated
      : CSSessionStatus.pending_human_review;
    await sessionService.updateSessionStatus(sessionId, tenantId, newStatus);

    result.draftReply = { messageId: draftMessageId, content: draftContent, source: 'judgment' };
    result.judgment = { ...judgment, recordId };
    result.ticketId = ticketId;

    logger.info({
      sessionId,
      decision: judgment.decision,
      confidence: judgment.confidence,
      rules: judgment.triggeredRules.map((r) => r.code),
      duration: Date.now() - startTime,
    }, 'CS judgment completed');
  } else if (faqMatch) {
    // ─── FAQ 回复路径 ────────────────────────────
    const draftMessageId = await messageService.createMessage(
      tenantId,
      sessionId,
      'ai',
      faqMatch.answer,
      'text',
      { isDraft: true, source: 'faq' },
    );

    result.draftReply = { messageId: draftMessageId, content: faqMatch.answer, source: 'faq' };

    logger.info({
      sessionId,
      faqId: faqMatch.faqId,
      category: faqMatch.category,
      duration: Date.now() - startTime,
    }, 'FAQ matched');
  }

  return result;
}
