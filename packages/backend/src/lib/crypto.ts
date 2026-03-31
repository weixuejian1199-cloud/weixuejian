import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { env } from './env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const SALT_LENGTH = 16;
const KEY_LENGTH = 32;

/**
 * 从 JWT_SECRET 派生 AES-256 加密密钥
 * 使用 scrypt KDF + 固定 salt 保证同一环境密钥稳定
 */
function deriveKey(salt: Buffer): Buffer {
  return scryptSync(env.JWT_SECRET, salt, KEY_LENGTH);
}

/**
 * AES-256-GCM 加密
 * 输出格式: base64(salt + iv + tag + ciphertext)
 */
export function encrypt(plaintext: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const key = deriveKey(salt);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  const combined = Buffer.concat([salt, iv, tag, encrypted]);
  return combined.toString('base64');
}

/**
 * AES-256-GCM 解密
 */
export function decrypt(ciphertext: string): string {
  const combined = Buffer.from(ciphertext, 'base64');

  const salt = combined.subarray(0, SALT_LENGTH);
  const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const tag = combined.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  const encrypted = combined.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

  const key = deriveKey(salt);
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);

  return decipher.update(encrypted) + decipher.final('utf8');
}

/**
 * 加密 JSON 对象
 */
export function encryptJson(data: unknown): string {
  return encrypt(JSON.stringify(data));
}

/**
 * 解密为 JSON 对象
 */
export function decryptJson<T = unknown>(ciphertext: string): T {
  return JSON.parse(decrypt(ciphertext)) as T;
}

/**
 * 判断字符串是否已加密（base64格式且长度合理）
 */
export function isEncrypted(value: string): boolean {
  if (value.length < 60) return false; // salt(16) + iv(12) + tag(16) + 至少1字节 = 45 → base64 ≈ 60
  try {
    const buf = Buffer.from(value, 'base64');
    return buf.length >= SALT_LENGTH + IV_LENGTH + TAG_LENGTH + 1;
  } catch {
    return false;
  }
}
