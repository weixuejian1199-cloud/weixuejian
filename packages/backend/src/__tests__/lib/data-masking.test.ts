import { describe, it, expect } from 'vitest';
import {
  maskPhone,
  maskName,
  maskId,
  maskIp,
  maskTransactionId,
  maskSensitiveFields,
} from '../../lib/data-masking.js';

describe('data-masking', () => {
  describe('maskPhone', () => {
    it('should mask middle digits of phone number', () => {
      expect(maskPhone('13812345678')).toBe('138****5678');
    });

    it('should handle short phone numbers', () => {
      expect(maskPhone('12345')).toBe('****');
    });

    it('should handle empty string', () => {
      expect(maskPhone('')).toBe('****');
    });

    it('should handle 7-digit numbers', () => {
      expect(maskPhone('1234567')).toBe('123****4567');
    });
  });

  describe('maskName', () => {
    it('should mask all but first character for Chinese names', () => {
      expect(maskName('张三丰')).toBe('张**');
    });

    it('should handle single character names', () => {
      expect(maskName('张')).toBe('张*');
    });

    it('should handle two character names', () => {
      expect(maskName('张三')).toBe('张*');
    });

    it('should handle empty string', () => {
      expect(maskName('')).toBe('**');
    });
  });

  describe('maskId', () => {
    it('should mask middle of long IDs', () => {
      expect(maskId('wx_openid_12345678')).toBe('wx_o****5678');
    });

    it('should handle short IDs', () => {
      expect(maskId('short')).toBe('****');
    });

    it('should handle empty string', () => {
      expect(maskId('')).toBe('****');
    });
  });

  describe('maskIp', () => {
    it('should mask last two octets of IPv4', () => {
      expect(maskIp('192.168.1.100')).toBe('192.168.*.*');
    });

    it('should handle empty string', () => {
      expect(maskIp('')).toBe('*.*.*.*');
    });
  });

  describe('maskTransactionId', () => {
    it('should mask middle of transaction ID', () => {
      expect(maskTransactionId('4200001234567890')).toBe('420000****7890');
    });

    it('should handle short transaction IDs', () => {
      expect(maskTransactionId('short')).toBe('****');
    });
  });

  describe('maskSensitiveFields', () => {
    it('should mask sensitive fields in flat object', () => {
      const data = {
        id: 'user-123',
        phone: '13812345678',
        name: '不脱敏的字段',
        wechatOpenid: 'wx_openid_12345678',
      };
      const masked = maskSensitiveFields(data);
      expect(masked.id).toBe('user-123');
      expect(masked.phone).toBe('138****5678');
      expect(masked.name).toBe('不脱敏的字段'); // name is not in SENSITIVE_FIELD_MASKS
      expect(masked.wechatOpenid).toBe('wx_o****5678');
    });

    it('should mask sensitive fields in nested objects', () => {
      const data = {
        user: { phone: '13812345678', buyerName: '张三' },
        meta: { count: 10 },
      };
      const masked = maskSensitiveFields(data);
      expect(masked.user.phone).toBe('138****5678');
      expect(masked.user.buyerName).toBe('张*');
      expect(masked.meta.count).toBe(10);
    });

    it('should mask sensitive fields in arrays', () => {
      const data = [
        { phone: '13812345678' },
        { phone: '13987654321' },
      ];
      const masked = maskSensitiveFields(data);
      expect(masked[0].phone).toBe('138****5678');
      expect(masked[1].phone).toBe('139****4321');
    });

    it('should handle null and undefined', () => {
      expect(maskSensitiveFields(null)).toBeNull();
      expect(maskSensitiveFields(undefined)).toBeUndefined();
    });

    it('should handle primitive values', () => {
      expect(maskSensitiveFields('string')).toBe('string');
      expect(maskSensitiveFields(42)).toBe(42);
    });

    it('should not modify non-sensitive string fields', () => {
      const data = { title: 'Hello', description: 'World' };
      const masked = maskSensitiveFields(data);
      expect(masked.title).toBe('Hello');
      expect(masked.description).toBe('World');
    });

    it('should handle ipAddress field', () => {
      const data = { ipAddress: '10.0.0.1', action: 'login' };
      const masked = maskSensitiveFields(data);
      expect(masked.ipAddress).toBe('10.0.*.*');
      expect(masked.action).toBe('login');
    });
  });
});
