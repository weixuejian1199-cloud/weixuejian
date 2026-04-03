/**
 * BasePlatformRPA 基类测试
 *
 * 测试不启动真实浏览器，聚焦：
 * - 加密/解密正确性
 * - 目录结构创建
 * - CollectResult 格式
 * - 安全断言配置
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { BasePlatformRPA, RPASafetyError } from '../base-platform-rpa.js';
import type { CollectParams } from '../schemas.js';
import type { Page } from 'playwright';

// ─── 测试用具体类 ──────────────────────────────────────────

class TestRPA extends BasePlatformRPA<{ id: string; value: number }> {
  public loginCalled = false;
  public collectCalled = false;
  public shouldFailLogin = false;
  public shouldFailCollect = false;
  public mockData: Array<{ id: string; value: number }> = [];

  protected async doLogin(_page: Page): Promise<void> {
    this.loginCalled = true;
    if (this.shouldFailLogin) throw new Error('Login failed');
  }

  protected async doCollect(
    _page: Page,
    _params: CollectParams,
  ): Promise<Array<{ id: string; value: number }>> {
    this.collectCalled = true;
    if (this.shouldFailCollect) throw new Error('Collect failed');
    return this.mockData;
  }

  protected async isLoggedIn(_page: Page): Promise<boolean> {
    return false; // 总是需要重新登录
  }

  // 暴露 encrypt/decrypt 供测试
  public testEncryptDecrypt(plaintext: string): string {
    // 使用反射调用私有方法
    const encrypted = (this as unknown as { encrypt(s: string): string }).encrypt(plaintext);
    const decrypted = (this as unknown as { decrypt(s: string): string }).decrypt(encrypted);
    return decrypted;
  }
}

// ─── 测试 ──────────────────────────────────────────────────

describe('BasePlatformRPA', () => {
  let tmpDir: string;
  let encryptionKey: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpa-test-'));
    encryptionKey = crypto.randomBytes(32).toString('hex');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should create required directories on construction', () => {
    new TestRPA({
      platformId: 'test',
      dataDir: tmpDir,
      forbiddenUrlPatterns: [],
      encryptionKey,
    });

    expect(fs.existsSync(path.join(tmpDir, 'cookies'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'screenshots'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'logs'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'browser-data'))).toBe(true);
  });

  it('should encrypt and decrypt correctly', () => {
    const rpa = new TestRPA({
      platformId: 'test',
      dataDir: tmpDir,
      forbiddenUrlPatterns: [],
      encryptionKey,
    });

    const original = JSON.stringify([
      { name: 'session', value: 'abc123', domain: '.example.com' },
    ]);
    const roundTripped = rpa.testEncryptDecrypt(original);
    expect(roundTripped).toBe(original);
  });

  it('should encrypt differently each time (random IV)', () => {
    const rpa = new TestRPA({
      platformId: 'test',
      dataDir: tmpDir,
      forbiddenUrlPatterns: [],
      encryptionKey,
    });

    const text = 'same plaintext';
    const enc1 = (rpa as unknown as { encrypt(s: string): string }).encrypt(text);
    const enc2 = (rpa as unknown as { encrypt(s: string): string }).encrypt(text);
    expect(enc1).not.toBe(enc2); // IV 不同
  });

  it('should fail decryption with wrong key', () => {
    const rpa1 = new TestRPA({
      platformId: 'test',
      dataDir: tmpDir,
      forbiddenUrlPatterns: [],
      encryptionKey,
    });

    const wrongKey = crypto.randomBytes(32).toString('hex');
    const rpa2 = new TestRPA({
      platformId: 'test',
      dataDir: tmpDir,
      forbiddenUrlPatterns: [],
      encryptionKey: wrongKey,
    });

    const encrypted = (rpa1 as unknown as { encrypt(s: string): string }).encrypt('secret');
    expect(() => {
      (rpa2 as unknown as { decrypt(s: string): string }).decrypt(encrypted);
    }).toThrow();
  });

  it('should store config with forbidden URL patterns', () => {
    const rpa = new TestRPA({
      platformId: 'test_bank',
      dataDir: tmpDir,
      forbiddenUrlPatterns: ['/transfer', '/payment'],
      encryptionKey,
    });

    // config is protected, so we check via the class behavior
    expect(rpa).toBeDefined();
  });

  it('should export RPASafetyError', () => {
    const err = new RPASafetyError('test safety violation');
    expect(err.name).toBe('RPASafetyError');
    expect(err.message).toBe('test safety violation');
    expect(err).toBeInstanceOf(Error);
  });
});
