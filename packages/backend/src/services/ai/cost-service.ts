/**
 * AI 成本监控服务 (BL-022)
 *
 * 核心能力：
 * 1. 成本计算（token → CNY）
 * 2. 用量记录（每次 API 调用一条）
 * 3. 配额预飞检查 + 自动降级
 * 4. 仪表盘聚合查询
 */
import { prisma } from '../../lib/prisma.js';
import { env } from '../../lib/env.js';
import { logger } from '../../utils/logger.js';
import type { AgentType, Prisma } from '@prisma/client';

// ─── 模型定价（CNY/1K tokens）──────────────────────────────
// 百炼套餐模式：所有模型统一费率。按量付费时可按模型差异化定价。
// SaaS 扩展时可迁移到 DB 表支持按租户定价。

export const MODEL_PRICING: Record<string, { inputPer1K: number; outputPer1K: number }> = {
  'qwen-turbo':  { inputPer1K: 0.0008, outputPer1K: 0.002 },
  'qwen-plus':   { inputPer1K: 0.0008, outputPer1K: 0.002 },
  'qwen-max':    { inputPer1K: 0.0008, outputPer1K: 0.002 },
  'qwen-vl-max': { inputPer1K: 0.0008, outputPer1K: 0.002 },
};

/** 未知模型回退定价 — fail-secure：按套餐统一价计费 */
const FALLBACK_PRICING = { inputPer1K: 0.0008, outputPer1K: 0.002 };

/**
 * 模型降级链 — 百炼套餐费率统一，降级目的是省 token（小模型回复更简短）
 * 而非省钱。接近配额时切到轻量模型延长可用轮次。
 */
export const DOWNGRADE_CHAIN: Record<string, string> = {
  'qwen-max':    'qwen-plus',
  'qwen-vl-max': 'qwen-plus',
  'qwen-plus':   'qwen-turbo',
};

// ─── 类型定义 ────────────────────────────────────────────

export interface QuotaCheckResult {
  allowed: boolean;
  downgradeTo?: string;
  reason?: string;
  currentUsage: {
    tokensToday: number;
    tokensMonth: number;
    costMonthYuan: number;
  };
}

export interface UsageSummary {
  period: 'day' | 'month';
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  totalCostYuan: number;
  requestCount: number;
  quotaTokensLimit: number;
  quotaTokensUsed: number;
  budgetYuanLimit: number;
  budgetYuanUsed: number;
  usagePercent: number;
}

export interface UsageBreakdownItem {
  key: string;
  label: string;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  totalCostYuan: number;
  requestCount: number;
}

export interface DailyTrendItem {
  date: string;
  totalTokens: number;
  totalCostYuan: number;
  requestCount: number;
}

export interface CostAlert {
  type: 'warning' | 'critical';
  message: string;
  usagePercent: number;
}

export interface RecordUsageParams {
  tenantId: string;
  userId: string;
  conversationId?: string;
  agentType: AgentType;
  model: string;
  promptTokens: number;
  completionTokens: number;
  wasDowngraded: boolean;
  originalModel?: string;
}

// ─── 纯计算函数 ──────────────────────────────────────────

/** 计算成本（CNY） */
export function calculateCost(model: string, promptTokens: number, completionTokens: number): number {
  const pricing = MODEL_PRICING[model] ?? FALLBACK_PRICING;
  return (promptTokens / 1000) * pricing.inputPer1K + (completionTokens / 1000) * pricing.outputPer1K;
}

// ─── 数据写入 ────────────────────────────────────────────

/** 记录一次 AI 调用的用量 */
export async function recordUsage(params: RecordUsageParams): Promise<void> {
  const totalTokens = params.promptTokens + params.completionTokens;
  const costYuan = calculateCost(params.model, params.promptTokens, params.completionTokens);

  await prisma.aiUsageRecord.create({
    data: {
      tenantId: params.tenantId,
      userId: params.userId,
      conversationId: params.conversationId,
      agentType: params.agentType,
      model: params.model,
      promptTokens: params.promptTokens,
      completionTokens: params.completionTokens,
      totalTokens,
      costYuan,
      wasDowngraded: params.wasDowngraded,
      originalModel: params.originalModel,
    },
  });
}

// ─── 配额预飞检查 ────────────────────────────────────────

/** 获取日期范围的起始时刻 */
function startOfDay(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfMonth(): Date {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

interface AggResult {
  _sum: { totalTokens: number | null; costYuan: Prisma.Decimal | null };
}

/**
 * 预飞配额检查 — 决定是否允许 AI 调用、是否需要降级
 * fail-secure: DB 异常 = 拒绝请求
 */
export async function checkQuota(tenantId: string, requestedModel: string): Promise<QuotaCheckResult> {
  try {
    // 并行查询：日用量 + 月用量 + 租户配额
    const [dailyAgg, monthlyAgg, tenant] = await Promise.all([
      prisma.aiUsageRecord.aggregate({
        where: { tenantId, createdAt: { gte: startOfDay() } },
        _sum: { totalTokens: true },
      }),
      prisma.aiUsageRecord.aggregate({
        where: { tenantId, createdAt: { gte: startOfMonth() } },
        _sum: { totalTokens: true, costYuan: true },
      }),
      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          aiQuotaDaily: true,
          aiQuotaMonthly: true,
          aiBudgetMonthly: true,
          aiAlertThreshold: true,
          aiDowngradeThreshold: true,
        },
      }),
    ]);

    if (!tenant) {
      return { allowed: false, reason: '租户不存在', currentUsage: { tokensToday: 0, tokensMonth: 0, costMonthYuan: 0 } };
    }

    const tokensToday = (dailyAgg as AggResult)._sum.totalTokens ?? 0;
    const tokensMonth = (monthlyAgg as AggResult)._sum.totalTokens ?? 0;
    const costMonthYuan = Number((monthlyAgg as AggResult)._sum.costYuan ?? 0);

    // 环境变量覆盖（自用阶段简化）
    const dailyLimit = env.AI_DAILY_TOKEN_LIMIT ?? tenant.aiQuotaDaily;
    const monthlyTokenLimit = tenant.aiQuotaMonthly;
    const monthlyBudget = Number(env.AI_MONTHLY_BUDGET_YUAN ?? tenant.aiBudgetMonthly);
    const alertThreshold = Number(tenant.aiAlertThreshold);
    const downgradeThreshold = Number(tenant.aiDowngradeThreshold);

    const currentUsage = { tokensToday, tokensMonth, costMonthYuan };

    // 1. 日 token 上限
    if (tokensToday >= dailyLimit) {
      return { allowed: false, reason: '今日AI调用token已达上限，请明日再试', currentUsage };
    }

    // 2. 月 token 上限
    if (tokensMonth >= monthlyTokenLimit) {
      return { allowed: false, reason: '本月AI token配额已用尽', currentUsage };
    }

    // 3. 月预算硬上限
    if (costMonthYuan >= monthlyBudget) {
      return { allowed: false, reason: '本月AI预算已用尽', currentUsage };
    }

    // 4. 降级阈值
    if (costMonthYuan >= monthlyBudget * downgradeThreshold) {
      const downgradeTarget = env.AI_DOWNGRADE_MODEL ?? DOWNGRADE_CHAIN[requestedModel];
      if (downgradeTarget) {
        logger.info({ tenantId, costMonthYuan, monthlyBudget, from: requestedModel, to: downgradeTarget }, 'AI model downgraded due to budget threshold');
        return { allowed: true, downgradeTo: downgradeTarget, currentUsage };
      }
      // 已是最便宜模型，允许继续
    }

    // 5. 告警阈值（仅记日志，不阻断）
    if (costMonthYuan >= monthlyBudget * alertThreshold) {
      const pct = Math.round((costMonthYuan / monthlyBudget) * 100);
      logger.warn({ tenantId, costMonthYuan, monthlyBudget, percent: pct }, 'AI budget alert threshold reached');
    }

    return { allowed: true, currentUsage };
  } catch (err) {
    // fail-secure: DB 异常时拒绝请求
    logger.error({ err, tenantId }, 'Cost quota check failed — blocking request (fail-secure)');
    return { allowed: false, reason: 'AI成本检查服务暂不可用', currentUsage: { tokensToday: 0, tokensMonth: 0, costMonthYuan: 0 } };
  }
}

// ─── 仪表盘查询 ──────────────────────────────────────────

/** 获取用量概览 */
export async function getUsageSummary(tenantId: string, period: 'day' | 'month'): Promise<UsageSummary> {
  const since = period === 'day' ? startOfDay() : startOfMonth();

  const [agg, count, tenant] = await Promise.all([
    prisma.aiUsageRecord.aggregate({
      where: { tenantId, createdAt: { gte: since } },
      _sum: { totalTokens: true, promptTokens: true, completionTokens: true, costYuan: true },
    }),
    prisma.aiUsageRecord.count({
      where: { tenantId, createdAt: { gte: since } },
    }),
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { aiQuotaMonthly: true, aiBudgetMonthly: true },
    }),
  ]);

  const totalTokens = agg._sum.totalTokens ?? 0;
  const promptTokens = agg._sum.promptTokens ?? 0;
  const completionTokens = agg._sum.completionTokens ?? 0;
  const totalCostYuan = Number(agg._sum.costYuan ?? 0);
  const quotaTokensLimit = tenant?.aiQuotaMonthly ?? 1000;
  const budgetYuanLimit = Number(tenant?.aiBudgetMonthly ?? 100);

  const tokenPercent = quotaTokensLimit > 0 ? (totalTokens / quotaTokensLimit) * 100 : 0;
  const costPercent = budgetYuanLimit > 0 ? (totalCostYuan / budgetYuanLimit) * 100 : 0;

  return {
    period,
    totalTokens,
    promptTokens,
    completionTokens,
    totalCostYuan: Math.round(totalCostYuan * 1000000) / 1000000,
    requestCount: count,
    quotaTokensLimit,
    quotaTokensUsed: totalTokens,
    budgetYuanLimit,
    budgetYuanUsed: Math.round(totalCostYuan * 100) / 100,
    usagePercent: Math.round(Math.max(tokenPercent, costPercent) * 100) / 100,
  };
}

/** 按用户或AgentType的用量明细 */
export async function getUsageBreakdown(
  tenantId: string,
  groupBy: 'user' | 'agent',
  period: 'day' | 'month',
): Promise<UsageBreakdownItem[]> {
  const since = period === 'day' ? startOfDay() : startOfMonth();
  const groupField = groupBy === 'user' ? 'userId' : 'agentType';

  const groups = await prisma.aiUsageRecord.groupBy({
    by: [groupField],
    where: { tenantId, createdAt: { gte: since } },
    _sum: { totalTokens: true, promptTokens: true, completionTokens: true, costYuan: true },
    _count: true,
    orderBy: { _sum: { totalTokens: 'desc' } },
  });

  // 如果按用户分组，批量获取用户名
  let userNames: Record<string, string> = {};
  if (groupBy === 'user') {
    const userIds = groups.map((g) => g.userId);
    const users = await prisma.user.findMany({
      where: { id: { in: userIds }, tenantId },
      select: { id: true, name: true },
    });
    userNames = Object.fromEntries(users.map((u) => [u.id, u.name]));
  }

  return groups.map((g) => {
    const key = groupBy === 'user' ? g.userId : g.agentType;
    return {
      key,
      label: groupBy === 'user' ? (userNames[key] ?? key) : key,
      totalTokens: g._sum.totalTokens ?? 0,
      promptTokens: g._sum.promptTokens ?? 0,
      completionTokens: g._sum.completionTokens ?? 0,
      totalCostYuan: Number(g._sum.costYuan ?? 0),
      requestCount: g._count,
    };
  });
}

/** 日趋势（当月每天） */
export async function getDailyTrend(tenantId: string, month?: string): Promise<DailyTrendItem[]> {
  const targetMonth = month ?? new Date().toISOString().slice(0, 7);
  const parts = targetMonth.split('-').map(Number);
  const year = parts[0]!;
  const mon = parts[1]!;
  const from = new Date(year, mon - 1, 1);
  const to = new Date(year, mon, 1);

  const records = await prisma.aiUsageRecord.findMany({
    where: { tenantId, createdAt: { gte: from, lt: to } },
    select: { createdAt: true, totalTokens: true, costYuan: true },
  });

  // 按日聚合
  const dayMap = new Map<string, { tokens: number; cost: number; count: number }>();
  for (const r of records) {
    const dateKey = r.createdAt.toISOString().slice(0, 10);
    const existing = dayMap.get(dateKey) ?? { tokens: 0, cost: 0, count: 0 };
    existing.tokens += r.totalTokens;
    existing.cost += Number(r.costYuan);
    existing.count += 1;
    dayMap.set(dateKey, existing);
  }

  return Array.from(dayMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, data]) => ({
      date,
      totalTokens: data.tokens,
      totalCostYuan: Math.round(data.cost * 1000000) / 1000000,
      requestCount: data.count,
    }));
}

/** 月度完整报告 */
export async function getMonthlyReport(tenantId: string, month: string): Promise<{
  month: string;
  summary: UsageSummary;
  byUser: UsageBreakdownItem[];
  byAgent: UsageBreakdownItem[];
  dailyTrend: DailyTrendItem[];
  modelBreakdown: UsageBreakdownItem[];
}> {
  const mParts = month.split('-').map(Number);
  const year = mParts[0]!;
  const mon = mParts[1]!;
  const from = new Date(year, mon - 1, 1);
  const to = new Date(year, mon, 1);

  // 聚合查询
  const [agg, count, tenant, byUserGroups, byAgentGroups, byModelGroups, records] = await Promise.all([
    prisma.aiUsageRecord.aggregate({
      where: { tenantId, createdAt: { gte: from, lt: to } },
      _sum: { totalTokens: true, promptTokens: true, completionTokens: true, costYuan: true },
    }),
    prisma.aiUsageRecord.count({
      where: { tenantId, createdAt: { gte: from, lt: to } },
    }),
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { aiQuotaMonthly: true, aiBudgetMonthly: true },
    }),
    prisma.aiUsageRecord.groupBy({
      by: ['userId'],
      where: { tenantId, createdAt: { gte: from, lt: to } },
      _sum: { totalTokens: true, promptTokens: true, completionTokens: true, costYuan: true },
      _count: true,
      orderBy: { _sum: { totalTokens: 'desc' } },
    }),
    prisma.aiUsageRecord.groupBy({
      by: ['agentType'],
      where: { tenantId, createdAt: { gte: from, lt: to } },
      _sum: { totalTokens: true, promptTokens: true, completionTokens: true, costYuan: true },
      _count: true,
      orderBy: { _sum: { totalTokens: 'desc' } },
    }),
    prisma.aiUsageRecord.groupBy({
      by: ['model'],
      where: { tenantId, createdAt: { gte: from, lt: to } },
      _sum: { totalTokens: true, promptTokens: true, completionTokens: true, costYuan: true },
      _count: true,
      orderBy: { _sum: { totalTokens: 'desc' } },
    }),
    prisma.aiUsageRecord.findMany({
      where: { tenantId, createdAt: { gte: from, lt: to } },
      select: { createdAt: true, totalTokens: true, costYuan: true },
    }),
  ]);

  // 用户名映射
  const userIds = byUserGroups.map((g) => g.userId);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds }, tenantId },
    select: { id: true, name: true },
  });
  const userNames = Object.fromEntries(users.map((u) => [u.id, u.name]));

  const totalTokens = agg._sum.totalTokens ?? 0;
  const totalCostYuan = Number(agg._sum.costYuan ?? 0);
  const quotaLimit = tenant?.aiQuotaMonthly ?? 1000;
  const budgetLimit = Number(tenant?.aiBudgetMonthly ?? 100);
  const tokenPct = quotaLimit > 0 ? (totalTokens / quotaLimit) * 100 : 0;
  const costPct = budgetLimit > 0 ? (totalCostYuan / budgetLimit) * 100 : 0;

  const summary: UsageSummary = {
    period: 'month',
    totalTokens,
    promptTokens: agg._sum.promptTokens ?? 0,
    completionTokens: agg._sum.completionTokens ?? 0,
    totalCostYuan: Math.round(totalCostYuan * 1000000) / 1000000,
    requestCount: count,
    quotaTokensLimit: quotaLimit,
    quotaTokensUsed: totalTokens,
    budgetYuanLimit: budgetLimit,
    budgetYuanUsed: Math.round(totalCostYuan * 100) / 100,
    usagePercent: Math.round(Math.max(tokenPct, costPct) * 100) / 100,
  };

  const mapGroup = (g: { _sum: { totalTokens: number | null; promptTokens: number | null; completionTokens: number | null; costYuan: Prisma.Decimal | null }; _count: number }, key: string, label: string): UsageBreakdownItem => ({
    key,
    label,
    totalTokens: g._sum.totalTokens ?? 0,
    promptTokens: g._sum.promptTokens ?? 0,
    completionTokens: g._sum.completionTokens ?? 0,
    totalCostYuan: Number(g._sum.costYuan ?? 0),
    requestCount: g._count,
  });

  const byUser = byUserGroups.map((g) => mapGroup(g, g.userId, userNames[g.userId] ?? g.userId));
  const byAgent = byAgentGroups.map((g) => mapGroup(g, g.agentType, g.agentType));
  const modelBreakdown = byModelGroups.map((g) => mapGroup(g, g.model, g.model));

  // 日趋势
  const dayMap = new Map<string, { tokens: number; cost: number; count: number }>();
  for (const r of records) {
    const dateKey = r.createdAt.toISOString().slice(0, 10);
    const existing = dayMap.get(dateKey) ?? { tokens: 0, cost: 0, count: 0 };
    existing.tokens += r.totalTokens;
    existing.cost += Number(r.costYuan);
    existing.count += 1;
    dayMap.set(dateKey, existing);
  }

  const dailyTrend = Array.from(dayMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, data]) => ({
      date,
      totalTokens: data.tokens,
      totalCostYuan: Math.round(data.cost * 1000000) / 1000000,
      requestCount: data.count,
    }));

  return { month, summary, byUser, byAgent, dailyTrend, modelBreakdown };
}
