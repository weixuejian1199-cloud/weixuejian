/**
 * RPA 统一数据 Schema
 *
 * 所有 RPA 采集的数据最终转换为这些统一格式。
 * 跨平台校准映射表（docs/18 第5节）是格式统一的依据。
 *
 * Wave 1: UnifiedTransaction（银行流水）
 * Wave 2+: UnifiedSettlement / UnifiedAdSpend / UnifiedDailyMetrics
 * Wave 2b: UnifiedInventorySignal（牵牛花等多店库存/补货信号）
 */
import { z } from 'zod';

// ─── 采集结果包装 ──────────────────────────────────────────

export interface CollectParams {
  /** 采集日期范围起始（含） */
  dateFrom: Date;
  /** 采集日期范围结束（含） */
  dateTo: Date;
}

export interface CollectError {
  stage: 'login' | 'navigate' | 'extract' | 'transform';
  message: string;
  screenshot?: string;
  timestamp: Date;
}

export interface CollectResult<T> {
  success: boolean;
  data: T[];
  metadata: {
    source: string;
    collectStartAt: Date;
    collectEndAt: Date;
    recordCount: number;
    dateRange: { from: Date; to: Date };
  };
  errors: CollectError[];
}

// ─── 统一银行流水 ──────────────────────────────────────────

export const unifiedTransactionSchema = z.object({
  sourceType: z.enum(['bank_direct', 'bank_rpa', 'payment_api', 'manual_import']),
  sourceAccountId: z.string().min(1),
  transactionDate: z.coerce.date(),
  amount: z.number(),
  direction: z.enum(['inflow', 'outflow']),
  balance: z.number(),
  counterparty: z.string(),
  description: z.string(),
  bankReference: z.string(),
  category: z.string().optional(),
  matchedSettlementId: z.string().optional(),
  matchedPurchaseId: z.string().optional(),
  rawData: z.record(z.unknown()),
  syncedAt: z.coerce.date(),
});

export type UnifiedTransaction = z.infer<typeof unifiedTransactionSchema>;

// ─── 统一平台结算单 ────────────────────────────────────────

export const unifiedSettlementSchema = z.object({
  platform: z.enum(['douyin', 'weixin_video', 'meituan', 'eleme', 'jddj', 'miniapp']),
  settlementId: z.string().min(1),
  settlementPeriod: z.object({ from: z.coerce.date(), to: z.coerce.date() }),
  settlementDate: z.coerce.date(),
  grossAmount: z.number(),
  commission: z.number(),
  serviceFee: z.number(),
  deliveryFee: z.number(),
  promotionDeduction: z.number(),
  refundDeduction: z.number(),
  otherDeduction: z.number(),
  netAmount: z.number(),
  paymentStatus: z.enum(['pending', 'paid', 'matched']),
  matchedTransactionId: z.string().optional(),
  rawData: z.record(z.unknown()),
  syncedAt: z.coerce.date(),
});

export type UnifiedSettlement = z.infer<typeof unifiedSettlementSchema>;

// ─── 统一广告花费 ──────────────────────────────────────────

export const unifiedAdSpendSchema = z.object({
  platform: z.enum(['qianchuan', 'zhitongche', 'wanxiangtai', 'tencent_ads', 'meituan_ads']),
  date: z.coerce.date(),
  campaignId: z.string(),
  campaignName: z.string(),
  spend: z.number().min(0),
  impressions: z.number().int().min(0),
  clicks: z.number().int().min(0),
  conversions: z.number().int().min(0),
  gmv: z.number().min(0),
  roas: z.number().min(0),
  rawData: z.record(z.unknown()),
  syncedAt: z.coerce.date(),
});

export type UnifiedAdSpend = z.infer<typeof unifiedAdSpendSchema>;

// ─── 统一每日运营指标 ──────────────────────────────────────

export const unifiedDailyMetricsSchema = z.object({
  platform: z.string().min(1),
  date: z.coerce.date(),
  gmv: z.number().min(0),
  orderCount: z.number().int().min(0),
  visitors: z.number().int().min(0),
  conversionRate: z.number().min(0).max(1),
  refundAmount: z.number().min(0),
  refundRate: z.number().min(0).max(1),
  avgOrderValue: z.number().min(0),
  rawData: z.record(z.unknown()),
  syncedAt: z.coerce.date(),
});

export type UnifiedDailyMetrics = z.infer<typeof unifiedDailyMetricsSchema>;

// ─── 统一库存/补货信号（牵牛花等）──────────────────────────

export const unifiedInventorySignalSchema = z.object({
  source: z.enum(['qianniuhua', 'manual_import', 'erp']),
  /** 门店/仓在源系统中的标识 */
  shopId: z.string().optional(),
  shopName: z.string().optional(),
  skuId: z.string().optional(),
  skuName: z.string().optional(),
  /** 可用库存 */
  onHandQty: z.number().optional(),
  /** 在途/锁定等（按源系统语义放入 rawData） */
  reservedQty: z.number().optional(),
  /** 建议补货量或系统提示 */
  suggestedReorderQty: z.number().optional(),
  rawData: z.record(z.unknown()),
  syncedAt: z.coerce.date(),
});

export type UnifiedInventorySignal = z.infer<typeof unifiedInventorySignalSchema>;

// ─── Mock 工厂函数（测试用）────────────────────────────────

export function mockUnifiedTransaction(
  overrides: Partial<UnifiedTransaction> = {},
): UnifiedTransaction {
  return {
    sourceType: 'bank_rpa',
    sourceAccountId: 'ceb-personal-001',
    transactionDate: new Date('2026-04-01'),
    amount: 1500.0,
    direction: 'inflow',
    balance: 25000.0,
    counterparty: '抖音电商结算',
    description: '抖音3月结算款',
    bankReference: 'CEB20260401001',
    rawData: {},
    syncedAt: new Date(),
    ...overrides,
  };
}

export function mockUnifiedSettlement(
  overrides: Partial<UnifiedSettlement> = {},
): UnifiedSettlement {
  return {
    platform: 'douyin',
    settlementId: 'DY-2026-03-001',
    settlementPeriod: { from: new Date('2026-03-01'), to: new Date('2026-03-15') },
    settlementDate: new Date('2026-03-22'),
    grossAmount: 50000,
    commission: 2500,
    serviceFee: 500,
    deliveryFee: 3000,
    promotionDeduction: 1000,
    refundDeduction: 2000,
    otherDeduction: 0,
    netAmount: 41000,
    paymentStatus: 'pending',
    rawData: {},
    syncedAt: new Date(),
    ...overrides,
  };
}

export function mockUnifiedAdSpend(
  overrides: Partial<UnifiedAdSpend> = {},
): UnifiedAdSpend {
  return {
    platform: 'qianchuan',
    date: new Date('2026-04-01'),
    campaignId: 'QC-001',
    campaignName: '春季促销',
    spend: 500,
    impressions: 50000,
    clicks: 2500,
    conversions: 125,
    gmv: 12500,
    roas: 25,
    rawData: {},
    syncedAt: new Date(),
    ...overrides,
  };
}

export function mockUnifiedDailyMetrics(
  overrides: Partial<UnifiedDailyMetrics> = {},
): UnifiedDailyMetrics {
  return {
    platform: 'douyin',
    date: new Date('2026-04-01'),
    gmv: 8500,
    orderCount: 42,
    visitors: 3200,
    conversionRate: 0.013,
    refundAmount: 500,
    refundRate: 0.059,
    avgOrderValue: 202.38,
    rawData: {},
    syncedAt: new Date(),
    ...overrides,
  };
}
