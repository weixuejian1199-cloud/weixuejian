/**
 * MallAdapter 统一输出类型
 *
 * 这些类型是 adapter 层对外暴露的接口，
 * 与 ztdy-open API 的原始字段名解耦。
 */

// ─── 分页结果 ────────────────────────────────────────────

export interface PaginatedResult<T> {
  items: T[];
  pagination: {
    pageIndex: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
  };
  /** 数据来源：api = 实时接口, cache = Redis 缓存 */
  source: 'api' | 'cache';
  /** 缓存时间（仅 source=cache 时有值）*/
  cachedAt?: string;
}

// ─── 实体类型（adapter 输出，驼峰命名）────────────────────

export interface MallUser {
  userId: number;
  loginId: string | null;
  userName: string | null;
  avatar: string | null;
  levelId: number | null;
  createDate: string | null;
  phone: string | null;
}

export interface MallOrder {
  orderItemId: number;
  orderItemNo: string;
  userId: number;
  supplierId: number;
  supplierName: string | null;
  status: number;
  processNode: number;
  payDate: string | null;
  totalAmount: number;
  itemName: string | null;
  quantity: number;
  createDate: string | null;
}

export interface MallItem {
  itemId: number;
  itemName: string;
  keywords: string | null;
  isShelf: boolean;
  createDate: string | null;
  sortId: number | null;
  price: number | null;
}

export interface MallSupplier {
  supplierId: number;
  supplierName: string;
  contactPerson: string | null;
  contactPhone: string | null;
  settleRuleId: number | null;
  createDate: string | null;
}

export interface SupplierWithdraw {
  supplierId: number;
  payNo: string;
  bankAccountNo: string | null;
  tranAmount: number;
  status: number;
  finishDate: string | null;
  createDate: string | null;
}

export interface UserWithdraw {
  userId: number;
  payNo: string;
  award: number;
  status: number;
  tranType: number | null;
  createDate: string | null;
}

// ─── 过滤器类型 ──────────────────────────────────────────

export interface BaseFilter {
  pageIndex?: number;
  pageSize?: number;
}

export interface UserFilter extends BaseFilter {
  keyword?: string;
  levelId?: number;
}

export interface OrderFilter extends BaseFilter {
  startDate?: string;
  endDate?: string;
  status?: number;
  processNode?: number;
  supplierId?: number;
  userId?: number;
}

export interface ItemFilter extends BaseFilter {
  keyword?: string;
  isShelf?: boolean;
}

export interface SupplierFilter extends BaseFilter {
  keyword?: string;
}

export interface WithdrawFilter extends BaseFilter {
  startDate?: string;
  endDate?: string;
  status?: number;
}

// ─── 缓存分组 ────────────────────────────────────────────

export type CacheGroup =
  | 'users'
  | 'orders'
  | 'items'
  | 'suppliers'
  | 'supplierWithdraws'
  | 'userWithdraws';

// ─── 聚合结果 ────────────────────────────────────────────

export interface AggregateResult<T> {
  data: T;
  computedAt: string;
  completeness: number;
  totalRecords: number;
  scannedRecords: number;
}

export interface SalesStats {
  totalAmount: number;
  orderCount: number;
  avgOrderAmount: number;
}

export interface SupplierRank {
  supplierId: number;
  supplierName: string | null;
  value: number;
}

export interface StatusDistribution {
  [status: string]: number;
}
