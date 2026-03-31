import pino from 'pino';
import { env } from '../lib/env.js';

const isProduction = env.NODE_ENV === 'production';

export const logger = pino({
  level: env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug'),
  ...(isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        },
      }),
});

/** 创建带 requestId 的子 logger */
export function childLogger(requestId: string): pino.Logger {
  return logger.child({ requestId });
}
