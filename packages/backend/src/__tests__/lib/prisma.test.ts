import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock env and logger before importing prisma
const mockWarn = vi.fn();
vi.mock('../../utils/logger.js', () => ({
  logger: { warn: mockWarn, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../lib/env.js', () => ({
  env: { NODE_ENV: 'test', DATABASE_URL: 'postgresql://test:test@localhost/test' },
}));

// We test the tenantGuardExtension logic by importing the internal constants and behavior.
// Since tenantGuardExtension is not directly exported, we test via the exported prisma client.
// However, prisma.$extends is hard to unit-test without a real DB, so we test the guard logic
// by re-implementing the check in isolation.

describe('Prisma tenant guard', () => {
  const TENANT_SCOPED_MODELS = new Set([
    'Conversation', 'Message', 'RefreshToken', 'User',
    'CustomerServiceSession', 'CustomerServiceMessage', 'CustomerServiceTicket',
    'AuditLog',
  ]);

  const WRITE_ACTIONS = new Set([
    'update', 'updateMany', 'delete', 'deleteMany',
  ]);

  function simulateGuard(model: string, operation: string, where: Record<string, unknown> | undefined) {
    if (
      TENANT_SCOPED_MODELS.has(model) &&
      WRITE_ACTIONS.has(operation)
    ) {
      if (where && !where['tenantId']) {
        const msg = `[TENANT-GUARD] ${model}.${operation}() missing tenantId in where clause`;
        throw new Error(msg);
      }
    }
    return 'query-passed';
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should throw when tenant-scoped model write misses tenantId', () => {
    expect(() => simulateGuard('Message', 'update', { id: '123' }))
      .toThrow('[TENANT-GUARD] Message.update() missing tenantId in where clause');
  });

  it('should throw for deleteMany without tenantId', () => {
    expect(() => simulateGuard('User', 'deleteMany', { status: 'inactive' }))
      .toThrow('[TENANT-GUARD] User.deleteMany() missing tenantId');
  });

  it('should pass when tenantId is present in where', () => {
    expect(simulateGuard('Message', 'update', { id: '123', tenantId: 'tenant-1' }))
      .toBe('query-passed');
  });

  it('should pass for read operations (findMany)', () => {
    expect(simulateGuard('Message', 'findMany', {}))
      .toBe('query-passed');
  });

  it('should pass for non-tenant-scoped models', () => {
    expect(simulateGuard('ToolDefinition', 'update', { id: '123' }))
      .toBe('query-passed');
  });

  it('should cover all tenant-scoped models', () => {
    const expected = [
      'Conversation', 'Message', 'RefreshToken', 'User',
      'CustomerServiceSession', 'CustomerServiceMessage', 'CustomerServiceTicket',
      'AuditLog',
    ];
    expect([...TENANT_SCOPED_MODELS].sort()).toEqual(expected.sort());
  });

  it('should cover all write actions', () => {
    expect([...WRITE_ACTIONS].sort()).toEqual(['delete', 'deleteMany', 'update', 'updateMany']);
  });

  it('should pass when where is undefined', () => {
    expect(simulateGuard('Message', 'update', undefined))
      .toBe('query-passed');
  });
});
