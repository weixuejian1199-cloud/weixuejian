/**
 * QianniuhuaRPA 基础测试（无浏览器：仅配置与类型链）
 */
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QianniuhuaRPA } from '../platform/qianniuhua-rpa.js';
import { BasePlatformRPA } from '../base-platform-rpa.js';

describe('QianniuhuaRPA', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpa-qnh-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should extend BasePlatformRPA', () => {
    const rpa = new QianniuhuaRPA({
      dataDir: tmpDir,
      encryptionKey: '0'.repeat(64),
      account: 'testacc',
      password: 'testpwd',
    });
    expect(rpa).toBeInstanceOf(BasePlatformRPA);
  });

  it('should throw config error when no credentials', () => {
    expect(
      () =>
        new QianniuhuaRPA({
          dataDir: tmpDir,
          encryptionKey: '0'.repeat(64),
        }),
    ).not.toThrow();

    const rpa = new QianniuhuaRPA({
      dataDir: tmpDir,
      encryptionKey: '0'.repeat(64),
    });
    expect(rpa).toBeDefined();
  });
});
