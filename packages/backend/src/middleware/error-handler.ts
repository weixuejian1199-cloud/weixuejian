import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { sendError } from '../utils/response.js';
import { childLogger } from '../utils/logger.js';
import { env } from '../lib/env.js';

const isProduction = env.NODE_ENV === 'production';

/**
 * 404 路由兜底中间件 — 放在所有路由之后、全局错误处理之前
 */
export function notFoundHandler(req: Request, res: Response, _next: NextFunction): void {
  sendError(res, 'RESOURCE_NOT_FOUND', `Route ${req.method} ${req.path} not found`, 404);
}

/**
 * 全局错误处理中间件 — 必须放在所有路由和中间件之后
 * Express 需要 4 个参数来识别为错误处理中间件
 */
export function globalErrorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const log = childLogger(req.requestId ?? 'unknown');

  // Zod 校验失败 → 400
  if (err instanceof ZodError) {
    const details = err.errors.map((e) => ({
      path: e.path.join('.'),
      message: e.message,
      code: e.code,
    }));
    log.warn({ details }, 'Validation error');
    sendError(res, 'VALIDATION_ERROR', 'Request validation failed', 400, details);
    return;
  }

  // 生成错误追踪 ID
  const errorId = req.requestId ?? 'unknown';
  const message = err instanceof Error ? err.message : 'An unexpected error occurred';

  if (isProduction) {
    // 生产环境：只记录 errorId + message，不记录完整 stack
    log.error({ errorId, err: message }, 'Unhandled error');
  } else {
    // 开发环境：debug 级别记录完整 stack
    const stack = err instanceof Error ? err.stack : undefined;
    log.error({ errorId, err: message }, 'Unhandled error');
    log.debug({ errorId, stack }, 'Error stack trace');
  }

  sendError(res, 'INTERNAL_ERROR', 'An internal server error occurred', 500);
}
