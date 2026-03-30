import type { Response } from 'express';
import type { ErrorCode } from '../lib/error-codes.js';

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
 * code 参数使用 ErrorCode 类型，编译时校验错误码合法性。
 */
export function sendError(
  res: Response,
  code: ErrorCode,
  message: string,
  httpStatus = 500,
  details?: unknown,
): void {
  const requestId = res.req.requestId ?? 'unknown';
  const body: ErrorResponse = {
    success: false,
    error: { code, message },
    requestId,
  };
  if (details !== undefined) {
    body.error.details = details;
  }
  res.status(httpStatus).json(body);
}
