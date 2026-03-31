/**
 * 共享类型定义
 * 跨包使用的通用接口和类型
 */

/** 统一API响应格式 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: Record<string, unknown>;
  requestId: string;
}

/** 分页请求参数 */
export interface PaginationParams {
  page: number;
  pageSize: number;
}

/** 分页响应 */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** 租户上下文 */
export interface TenantContext {
  tenantId: string;
  userId: string;
  role: string;
}
