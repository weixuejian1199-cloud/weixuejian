import type { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

/**
 * 为每个请求生成 UUID v4 作为 requestId，
 * 注入到 req.requestId 并设置 X-Request-ID 响应头。
 */
export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const id = uuidv4();
  req.requestId = id;
  res.setHeader('X-Request-ID', id);
  next();
}
