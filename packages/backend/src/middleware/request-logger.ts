import type { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';

/** 敏感路径前缀 — 不记录请求体 */
const SENSITIVE_PATH_PREFIXES = ['/api/v1/auth'];

/**
 * 请求日志中间件 — 在响应完成时记录请求详情
 * 记录：method, path, status, duration, ip, userId, tenantId, requestId
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const isSensitivePath = SENSITIVE_PATH_PREFIXES.some((prefix) => req.path.startsWith(prefix));

    const logData: Record<string, unknown> = {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration,
      ip: req.ip,
      requestId: req.requestId,
    };

    // 注入用户信息（如果已认证）
    if (req.user) {
      logData['userId'] = req.user.userId;
      logData['tenantId'] = req.user.tenantId;
    }

    if (req.tenantId) {
      logData['tenantId'] = req.tenantId;
    }

    // 非敏感路径且有请求体时记录（仅 debug 级别）
    if (!isSensitivePath && req.body && Object.keys(req.body as object).length > 0) {
      logData['body'] = req.body;
    }

    // 根据状态码选择日志级别
    if (res.statusCode >= 500) {
      logger.error(logData, 'Request completed with server error');
    } else if (res.statusCode >= 400) {
      logger.warn(logData, 'Request completed with client error');
    } else {
      logger.info(logData, 'Request completed');
    }
  });

  next();
}
