/**
 * AI 成本监控路由 (BL-022)
 *
 * GET /api/v1/ai/cost/summary    — 实时用量概览
 * GET /api/v1/ai/cost/breakdown  — 按用户/Agent明细
 * GET /api/v1/ai/cost/trend      — 日趋势
 * GET /api/v1/ai/cost/report     — 月度完整报告
 */
import { Router } from 'express';
import { z } from 'zod';
import { getUsageSummary, getUsageBreakdown, getDailyTrend, getMonthlyReport } from '../../services/ai/cost-service.js';
import { sendSuccess, sendError } from '../../utils/response.js';
import { logger } from '../../utils/logger.js';

export const costRouter = Router();

// ─── 请求校验 ────────────────────────────────────────────

const summaryQuerySchema = z.object({
  period: z.enum(['day', 'month']).default('month'),
});

const breakdownQuerySchema = z.object({
  groupBy: z.enum(['user', 'agent']).default('agent'),
  period: z.enum(['day', 'month']).default('month'),
});

const trendQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, '月份格式: YYYY-MM').optional(),
});

const reportQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, '月份格式: YYYY-MM'),
});

// ─── GET /cost/summary ───────────────────────────────────

costRouter.get('/summary', async (req, res) => {
  const tenantId = req.tenantId;
  if (!tenantId) {
    sendError(res, 'AUTH_INVALID_TOKEN', '认证信息不完整', 401);
    return;
  }

  const parsed = summaryQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    sendError(res, 'VALIDATION_ERROR', '请求参数校验失败', 400, parsed.error.issues);
    return;
  }

  try {
    const summary = await getUsageSummary(tenantId, parsed.data.period);
    sendSuccess(res, summary);
  } catch (err) {
    logger.error({ err, tenantId }, 'Cost summary query failed');
    sendError(res, 'INTERNAL_ERROR', '获取用量概览失败', 500);
  }
});

// ─── GET /cost/breakdown ─────────────────────────────────

costRouter.get('/breakdown', async (req, res) => {
  const tenantId = req.tenantId;
  if (!tenantId) {
    sendError(res, 'AUTH_INVALID_TOKEN', '认证信息不完整', 401);
    return;
  }

  const parsed = breakdownQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    sendError(res, 'VALIDATION_ERROR', '请求参数校验失败', 400, parsed.error.issues);
    return;
  }

  try {
    const breakdown = await getUsageBreakdown(tenantId, parsed.data.groupBy, parsed.data.period);
    sendSuccess(res, breakdown);
  } catch (err) {
    logger.error({ err, tenantId }, 'Cost breakdown query failed');
    sendError(res, 'INTERNAL_ERROR', '获取用量明细失败', 500);
  }
});

// ─── GET /cost/trend ─────────────────────────────────────

costRouter.get('/trend', async (req, res) => {
  const tenantId = req.tenantId;
  if (!tenantId) {
    sendError(res, 'AUTH_INVALID_TOKEN', '认证信息不完整', 401);
    return;
  }

  const parsed = trendQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    sendError(res, 'VALIDATION_ERROR', '请求参数校验失败', 400, parsed.error.issues);
    return;
  }

  try {
    const trend = await getDailyTrend(tenantId, parsed.data.month);
    sendSuccess(res, trend);
  } catch (err) {
    logger.error({ err, tenantId }, 'Cost trend query failed');
    sendError(res, 'INTERNAL_ERROR', '获取日趋势失败', 500);
  }
});

// ─── GET /cost/report ────────────────────────────────────

costRouter.get('/report', async (req, res) => {
  const tenantId = req.tenantId;
  if (!tenantId) {
    sendError(res, 'AUTH_INVALID_TOKEN', '认证信息不完整', 401);
    return;
  }

  const parsed = reportQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    sendError(res, 'VALIDATION_ERROR', '请求参数校验失败', 400, parsed.error.issues);
    return;
  }

  try {
    const report = await getMonthlyReport(tenantId, parsed.data.month);
    sendSuccess(res, report);
  } catch (err) {
    logger.error({ err, tenantId }, 'Monthly report query failed');
    sendError(res, 'INTERNAL_ERROR', '获取月度报告失败', 500);
  }
});
