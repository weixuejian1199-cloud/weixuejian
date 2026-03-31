import { describe, it, expect, vi } from 'vitest';

// Mock env before importing crypto
vi.mock('../../lib/env.js', () => ({
  env: {
    JWT_SECRET: 'test-secret-key-that-is-at-least-32-chars-long-for-testing',
  },
}));

import { encrypt, decrypt, encryptJson, decryptJson, isEncrypted } from '../../lib/crypto.js';

describe('crypto', () => {
  describe('encrypt/decrypt', () => {
    it('should encrypt and decrypt a simple string', () => {
      const plaintext = 'hello world';
      const ciphertext = encrypt(plaintext);
      expect(ciphertext).not.toBe(plaintext);
      expect(decrypt(ciphertext)).toBe(plaintext);
    });

    it('should encrypt and decrypt Chinese characters', () => {
      const plaintext = '时皙科技有限公司';
      const ciphertext = encrypt(plaintext);
      expect(decrypt(ciphertext)).toBe(plaintext);
    });

    it('should encrypt and decrypt phone numbers', () => {
      const phone = '13812345678';
      const ciphertext = encrypt(phone);
      expect(decrypt(ciphertext)).toBe(phone);
    });

    it('should produce different ciphertext for same plaintext (random IV)', () => {
      const plaintext = 'same input';
      const c1 = encrypt(plaintext);
      const c2 = encrypt(plaintext);
      expect(c1).not.toBe(c2);
      expect(decrypt(c1)).toBe(plaintext);
      expect(decrypt(c2)).toBe(plaintext);
    });

    it('should handle empty string', () => {
      const ciphertext = encrypt('');
      expect(decrypt(ciphertext)).toBe('');
    });

    it('should handle long strings', () => {
      const plaintext = 'a'.repeat(10000);
      const ciphertext = encrypt(plaintext);
      expect(decrypt(ciphertext)).toBe(plaintext);
    });

    it('should throw on tampered ciphertext', () => {
      const ciphertext = encrypt('secret');
      const tampered = ciphertext.slice(0, -4) + 'XXXX';
      expect(() => decrypt(tampered)).toThrow();
    });
  });

  describe('encryptJson/decryptJson', () => {
    it('should encrypt and decrypt JSON objects', () => {
      const data = { appKey: 'ak123', appSecret: 'sk456' };
      const ciphertext = encryptJson(data);
      expect(decryptJson(ciphertext)).toEqual(data);
    });

    it('should handle nested objects', () => {
      const data = { credentials: { key: 'value' }, list: [1, 2, 3] };
      const ciphertext = encryptJson(data);
      expect(decryptJson(ciphertext)).toEqual(data);
    });

    it('should handle null and boolean values', () => {
      const data = { active: true, extra: null };
      const ciphertext = encryptJson(data);
      expect(decryptJson(ciphertext)).toEqual(data);
    });
  });

  describe('isEncrypted', () => {
    it('should return true for encrypted strings', () => {
      const ciphertext = encrypt('test');
      expect(isEncrypted(ciphertext)).toBe(true);
    });

    it('should return false for plain strings', () => {
      expect(isEncrypted('hello')).toBe(false);
      expect(isEncrypted('13812345678')).toBe(false);
      expect(isEncrypted('')).toBe(false);
    });

    it('should return false for short base64 strings', () => {
      expect(isEncrypted('aGVsbG8=')).toBe(false); // "hello" in base64
    });
  });
});
