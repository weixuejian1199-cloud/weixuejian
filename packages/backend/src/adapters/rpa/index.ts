/**
 * RPA 适配器模块导出
 */
export { BasePlatformRPA, RPASafetyError, RPACollectError } from './base-platform-rpa.js';
export type { RPAConfig, DryRunResult } from './base-platform-rpa.js';
export { BankRPA } from './bank/bank-rpa.js';
export type { BankRPAConfig } from './bank/bank-rpa.js';
export { CebPersonalRPA } from './bank/ceb-personal-rpa.js';
export { PlatformRPA } from './platform/platform-rpa.js';
export type { PlatformRPAConfig } from './platform/platform-rpa.js';
export { DouyinRPA } from './platform/douyin-rpa.js';
export { MeituanRPA } from './platform/meituan-rpa.js';
export { QianniuhuaRPA } from './platform/qianniuhua-rpa.js';
export type { QianniuhuaRPAConfig } from './platform/qianniuhua-rpa.js';
export { RPAStorage } from './storage.js';
export {
  type UnifiedTransaction,
  type UnifiedSettlement,
  type UnifiedAdSpend,
  type UnifiedDailyMetrics,
  type CollectParams,
  type CollectResult,
  type CollectError,
  unifiedTransactionSchema,
  unifiedSettlementSchema,
  unifiedAdSpendSchema,
  unifiedDailyMetricsSchema,
  mockUnifiedTransaction,
  mockUnifiedSettlement,
  mockUnifiedAdSpend,
  mockUnifiedDailyMetrics,
} from './schemas.js';
