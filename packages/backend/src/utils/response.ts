import type { Response } from 'express';
import { ERROR_CODES, type ErrorCode } from '../lib/error-codes.js';

/** 统一成功响应结构 */
interface SuccessResponse<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
  requestId: string;
}

/** 统一错误响应结构 */
interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId: string;
}

export type ApiResponse<T> = SuccessResponse<T> | ErrorResponse;

/**
 * 发送成功响应
 */
export function sendSuccess<T>(
  res: Response,
  data: T,
  meta?: Record<string, unknown>,
  httpStatus = 200,
): void {
  const requestId = res.req.requestId ?? 'unknown';
  const body: SuccessResponse<T> = {
    success: true,
    data,
    requestId,
  };
  if (meta) {
    body.meta = meta;
  }
  res.status(httpStatus).json(body);
}

/**
 * 发送错误响应
 *
 * 自动从 ERROR_CODES 注册表查找 httpStatus 和 message。
 * 可通过参数覆盖默认值（message 覆盖场景：自定义业务提示）。
 */
export function sendError(
  res: Response,
  code: ErrorCode,
  message?: string,
  httpStatus?: number,
  details?: unknown,
): void {
  const registered = ERROR_CODES[code];
  const finalMessage = message ?? registered.message;
  const finalStatus = httpStatus ?? registered.httpStatus;

  const requestId = res.req.requestId ?? 'unknown';
  const body: ErrorResponse = {
    success: false,
    error: { code, message: finalMessage },
    requestId,
  };
  if (details !== undefined) {
    body.error.details = details;
  }
  res.status(finalStatus).json(body);
}
