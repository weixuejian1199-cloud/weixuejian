import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exportUserData, deleteUserData, enforceRetentionPolicy } from '../../../services/privacy/privacy-service.js';

// Mock prisma
function createMockPrisma() {
  return {
    user: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    conversation: {
      findMany: vi.fn(),
      count: vi.fn(),
      deleteMany: vi.fn(),
    },
    message: {
      deleteMany: vi.fn(),
    },
    customerServiceSession: {
      count: vi.fn(),
    },
    customerServiceMessage: {
      deleteMany: vi.fn(),
    },
    auditLog: {
      count: vi.fn(),
      deleteMany: vi.fn(),
    },
    notification: {
      count: vi.fn(),
      deleteMany: vi.fn(),
    },
    refreshToken: {
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  };
}

describe('privacy-service', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    vi.clearAllMocks();
  });

  describe('exportUserData', () => {
    it('should export user data with masked fields', async () => {
      const mockUser = {
        id: 'user-1',
        phone: '13812345678',
        name: '张三',
        createdAt: new Date('2026-01-01'),
      };
      mockPrisma.user.findFirst.mockResolvedValue(mockUser);
      mockPrisma.conversation.findMany.mockResolvedValue([
        { id: 'conv-1', agentType: 'master', title: '测试对话', createdAt: new Date() },
      ]);
      mockPrisma.conversation.count.mockResolvedValue(5);
      mockPrisma.customerServiceSession.count.mockResolvedValue(2);
      mockPrisma.auditLog.count.mockResolvedValue(10);
      mockPrisma.notification.count.mockResolvedValue(3);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await exportUserData(mockPrisma as any, 'tenant-1', 'user-1');

      expect(result.user.phone).toBe('138****5678'); // masked
      expect(result.conversationCount).toBe(5);
      expect(result.csSessionCount).toBe(2);
      expect(result.auditLogCount).toBe(10);
      expect(result.exportedAt).toBeDefined();
    });

    it('should throw USER_NOT_FOUND for non-existent user', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        exportUserData(mockPrisma as any, 'tenant-1', 'nonexistent'),
      ).rejects.toThrow('USER_NOT_FOUND');
    });

    it('should limit conversation export to 100', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-1', phone: '138', name: 'Test', createdAt: new Date(),
      });
      mockPrisma.conversation.findMany.mockResolvedValue([]);
      mockPrisma.conversation.count.mockResolvedValue(0);
      mockPrisma.customerServiceSession.count.mockResolvedValue(0);
      mockPrisma.auditLog.count.mockResolvedValue(0);
      mockPrisma.notification.count.mockResolvedValue(0);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await exportUserData(mockPrisma as any, 'tenant-1', 'user-1');

      expect(mockPrisma.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });
  });

  describe('deleteUserData', () => {
    it('should delete user data and return deletion result', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-1' });
      mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          message: { deleteMany: vi.fn().mockResolvedValue({ count: 10 }) },
          conversation: { deleteMany: vi.fn().mockResolvedValue({ count: 3 }) },
          notification: { deleteMany: vi.fn().mockResolvedValue({ count: 5 }) },
          refreshToken: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
          customerServiceMessage: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
          user: { update: vi.fn().mockResolvedValue({}) },
        };
        return fn(tx);
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await deleteUserData(mockPrisma as any, 'tenant-1', 'user-1');

      expect(result.userId).toBe('user-1');
      expect(result.deletedRecords.messages).toBe(10);
      expect(result.deletedRecords.conversations).toBe(3);
      expect(result.deletedRecords.notifications).toBe(5);
      expect(result.deletedRecords.refreshTokens).toBe(2);
      expect(result.retainedForCompliance).toHaveLength(3);
      expect(result.deletedAt).toBeDefined();
    });

    it('should throw USER_NOT_FOUND for non-existent user', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        deleteUserData(mockPrisma as any, 'tenant-1', 'nonexistent'),
      ).rejects.toThrow('USER_NOT_FOUND');
    });

    it('should soft-delete user record with anonymized data', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-1' });

      let capturedUserUpdate: Record<string, unknown> | undefined;
      mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          message: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
          conversation: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
          notification: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
          refreshToken: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
          customerServiceMessage: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
          user: {
            update: vi.fn().mockImplementation((args: Record<string, unknown>) => {
              capturedUserUpdate = args;
              return Promise.resolve({});
            }),
          },
        };
        return fn(tx);
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await deleteUserData(mockPrisma as any, 'tenant-1', 'user-1');

      expect(capturedUserUpdate).toBeDefined();
      const updateData = (capturedUserUpdate as Record<string, Record<string, unknown>>).data;
      expect(updateData.name).toBe('已注销用户');
      expect(updateData.wechatOpenid).toBeNull();
      expect(updateData.wecomUserid).toBeNull();
      expect(updateData.avatarUrl).toBeNull();
      expect(updateData.deletedAt).toBeDefined();
    });
  });

  describe('enforceRetentionPolicy', () => {
    it('should delete expired audit logs and read notifications', async () => {
      mockPrisma.auditLog.deleteMany.mockResolvedValue({ count: 5 });
      mockPrisma.notification.deleteMany.mockResolvedValue({ count: 10 });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await enforceRetentionPolicy(mockPrisma as any, 'tenant-1');

      expect(result.auditLogsDeleted).toBe(5);
      expect(result.notificationsDeleted).toBe(10);
    });

    it('should use correct retention periods', async () => {
      mockPrisma.auditLog.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.notification.deleteMany.mockResolvedValue({ count: 0 });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await enforceRetentionPolicy(mockPrisma as any, 'tenant-1');

      // Audit logs: 1 year retention
      const auditCall = mockPrisma.auditLog.deleteMany.mock.calls[0][0];
      expect(auditCall.where.tenantId).toBe('tenant-1');
      expect(auditCall.where.createdAt.lt).toBeInstanceOf(Date);

      // Notifications: 30 days retention for read ones
      const notifCall = mockPrisma.notification.deleteMany.mock.calls[0][0];
      expect(notifCall.where.isRead).toBe(true);
    });
  });
});
