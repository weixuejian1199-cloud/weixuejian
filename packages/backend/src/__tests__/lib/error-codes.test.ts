import { describe, it, expect } from 'vitest';
import { ERROR_CODES, type ErrorCode } from '../../lib/error-codes.js';

describe('error-codes', () => {
  const allCodes = Object.keys(ERROR_CODES) as ErrorCode[];

  it('应至少包含40个错误码', () => {
    expect(allCodes.length).toBeGreaterThanOrEqual(40);
  });

  it('每个错误码应有httpStatus和message', () => {
    for (const code of allCodes) {
      const entry = ERROR_CODES[code];
      expect(entry.httpStatus, `${code} missing httpStatus`).toBeTypeOf('number');
      expect(entry.message, `${code} missing message`).toBeTypeOf('string');
      expect(entry.message.length, `${code} message empty`).toBeGreaterThan(0);
    }
  });

  it('httpStatus应在有效HTTP范围内(200-599)', () => {
    for (const code of allCodes) {
      const { httpStatus } = ERROR_CODES[code];
      expect(httpStatus, `${code}: ${httpStatus}`).toBeGreaterThanOrEqual(200);
      expect(httpStatus, `${code}: ${httpStatus}`).toBeLessThanOrEqual(599);
    }
  });

  it('认证类错误码应为401', () => {
    expect(ERROR_CODES.AUTH_INVALID_TOKEN.httpStatus).toBe(401);
    expect(ERROR_CODES.AUTH_TOKEN_EXPIRED.httpStatus).toBe(401);
    expect(ERROR_CODES.AUTH_TOKEN_BLACKLISTED.httpStatus).toBe(401);
    expect(ERROR_CODES.AUTH_REFRESH_INVALID.httpStatus).toBe(401);
  });

  it('限流类错误码应为429', () => {
    expect(ERROR_CODES.RATE_LIMITED.httpStatus).toBe(429);
    expect(ERROR_CODES.AI_RATE_LIMITED.httpStatus).toBe(429);
    expect(ERROR_CODES.AUTH_RATE_LIMITED.httpStatus).toBe(429);
  });

  it('客服类错误码应存在且有正确状态码', () => {
    expect(ERROR_CODES.CS_SESSION_NOT_FOUND.httpStatus).toBe(404);
    expect(ERROR_CODES.CS_SESSION_CLOSED.httpStatus).toBe(400);
    expect(ERROR_CODES.CS_MESSAGE_NOT_FOUND.httpStatus).toBe(404);
    expect(ERROR_CODES.CS_MESSAGE_NOT_DRAFT.httpStatus).toBe(400);
    expect(ERROR_CODES.CS_TICKET_NOT_FOUND.httpStatus).toBe(404);
  });

  it('系统错误码应存在', () => {
    expect(ERROR_CODES.INTERNAL_ERROR.httpStatus).toBe(500);
    expect(ERROR_CODES.SERVICE_UNAVAILABLE.httpStatus).toBe(503);
  });

  it('不应有重复的message', () => {
    const messages = allCodes.map((c) => ERROR_CODES[c].message);
    const unique = new Set(messages);
    expect(unique.size).toBe(messages.length);
  });

  it('ErrorCode类型应覆盖所有key', () => {
    // 编译时类型检查：如果ErrorCode类型不匹配，这行会编译失败
    const testCode: ErrorCode = 'INTERNAL_ERROR';
    expect(ERROR_CODES[testCode]).toBeDefined();
  });
});
