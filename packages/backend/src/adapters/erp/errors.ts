/**
 * MallAdapter 自定义错误类
 *
 * 错误码对应 error-codes.ts 中的 MALL_* 系列。
 * adapter 层抛出此错误，路由层捕获后通过 sendError 返回。
 */

export type MallErrorCode =
  | 'MALL_API_UNAUTHORIZED'
  | 'MALL_API_TIMEOUT'
  | 'MALL_API_ERROR'
  | 'MALL_DATA_INVALID';

export class MallApiError extends Error {
  public readonly code: MallErrorCode;

  constructor(code: MallErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'MallApiError';
    this.code = code;
  }
}
