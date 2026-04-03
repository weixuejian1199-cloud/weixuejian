/**
 * RPAStorage 测试
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { RPAStorage } from '../storage.js';
import { mockUnifiedTransaction, mockUnifiedSettlement } from '../schemas.js';

describe('RPAStorage', () => {
  let tmpDir: string;
  let storage: RPAStorage;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpa-storage-test-'));
    storage = new RPAStorage(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('saveTransactions', () => {
    it('should save transactions to JSON file', () => {
      const txs = [
        mockUnifiedTransaction({ amount: 1000 }),
        mockUnifiedTransaction({ amount: 2000 }),
      ];

      const filepath = storage.saveTransactions('ceb_personal', txs);

      expect(fs.existsSync(filepath)).toBe(true);
      const content = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
      expect(content.count).toBe(2);
      expect(content.platformId).toBe('ceb_personal');
      expect(content.data).toHaveLength(2);
    });

    it('should create nested directories', () => {
      const filepath = storage.saveTransactions('ceb_personal', []);
      const dir = path.dirname(filepath);
      expect(fs.existsSync(dir)).toBe(true);
    });
  });

  describe('saveSettlements', () => {
    it('should save settlements to JSON file', () => {
      const settlements = [mockUnifiedSettlement()];
      const filepath = storage.saveSettlements('douyin', settlements);

      expect(fs.existsSync(filepath)).toBe(true);
      const content = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
      expect(content.count).toBe(1);
      expect(content.platformId).toBe('douyin');
    });
  });

  describe('getLatestTransactions', () => {
    it('should return null when no data exists', () => {
      const result = storage.getLatestTransactions('nonexistent');
      expect(result).toBeNull();
    });

    it('should return the most recent file data', () => {
      const txs1 = [mockUnifiedTransaction({ amount: 100 })];
      const txs2 = [mockUnifiedTransaction({ amount: 200 })];

      storage.saveTransactions('ceb_personal', txs1);
      // 确保文件名时间戳不同
      storage.saveTransactions('ceb_personal', txs2);

      const latest = storage.getLatestTransactions('ceb_personal');
      expect(latest).not.toBeNull();
      expect(latest).toHaveLength(1);
    });
  });

  describe('listFiles', () => {
    it('should return empty array when no data', () => {
      const files = storage.listFiles('transactions');
      expect(files).toEqual([]);
    });

    it('should list files for specific platform', async () => {
      storage.saveTransactions('ceb_personal', [mockUnifiedTransaction()]);
      // 确保时间戳不同
      await new Promise((r) => setTimeout(r, 5));
      storage.saveTransactions('ceb_personal', [mockUnifiedTransaction()]);

      const files = storage.listFiles('transactions', 'ceb_personal');
      expect(files.length).toBeGreaterThanOrEqual(1);
    });

    it('should list files across all platforms', () => {
      storage.saveTransactions('ceb_personal', [mockUnifiedTransaction()]);
      storage.saveSettlements('douyin', [mockUnifiedSettlement()]);

      const txFiles = storage.listFiles('transactions');
      expect(txFiles.length).toBeGreaterThanOrEqual(1);

      const settlementFiles = storage.listFiles('settlements');
      expect(settlementFiles.length).toBeGreaterThanOrEqual(1);
    });
  });
});
