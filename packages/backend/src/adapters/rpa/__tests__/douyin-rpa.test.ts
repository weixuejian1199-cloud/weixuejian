/**
 * DouyinRPA 抖店结算单采集测试
 *
 * 测试不启动真实浏览器，聚焦：
 * - PlatformRPA 继承链正确性
 * - 禁止 URL 模式（只读保护）
 * - Excel / CSV 解析（导出策略核心）
 * - 列映射逻辑
 * - 结算单数据转换（DouyinRawSettlement → UnifiedSettlement）
 * - 支付状态映射
 * - 金额解析
 * - 日期解析（多种格式）
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as XLSX from 'xlsx';
import { DouyinRPA } from '../platform/douyin-rpa.js';
import { PlatformRPA } from '../platform/platform-rpa.js';
import { BasePlatformRPA } from '../base-platform-rpa.js';
import { unifiedSettlementSchema } from '../schemas.js';

// ─── 测试 ──────────────────────────────────────────────────

describe('DouyinRPA', () => {
  let tmpDir: string;
  let encryptionKey: string;
  let rpa: DouyinRPA;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpa-douyin-test-'));
    encryptionKey = crypto.randomBytes(32).toString('hex');
    rpa = new DouyinRPA({
      dataDir: tmpDir,
      phone: '15394461792',
      encryptionKey,
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── 继承链 ──────────────────────────────────────────────

  it('should extend PlatformRPA → BasePlatformRPA', () => {
    expect(rpa).toBeInstanceOf(PlatformRPA);
    expect(rpa).toBeInstanceOf(BasePlatformRPA);
  });

  // ─── 目录结构 ────────────────────────────────────────────

  it('should create required directories on construction', () => {
    expect(fs.existsSync(path.join(tmpDir, 'cookies'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'screenshots'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'logs'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'browser-data'))).toBe(true);
  });

  // ─── 只读保护（禁止URL模式）──────────────────────────────

  it('should have platform + douyin forbidden patterns in config', () => {
    const config = (rpa as unknown as { config: { forbiddenUrlPatterns: string[] } }).config;

    expect(config.forbiddenUrlPatterns).toContain('/order/send');
    expect(config.forbiddenUrlPatterns).toContain('/price/edit');
    expect(config.forbiddenUrlPatterns).toContain('/refund/agree');
    expect(config.forbiddenUrlPatterns).toContain('/promotion/create');
    expect(config.forbiddenUrlPatterns).toContain('/product/edit');

    expect(config.forbiddenUrlPatterns).toContain('/order/batchShip');
    expect(config.forbiddenUrlPatterns).toContain('/order/modifyPrice');
    expect(config.forbiddenUrlPatterns).toContain('/afterSale/agree');
    expect(config.forbiddenUrlPatterns).toContain('/compass/ad');
    expect(config.forbiddenUrlPatterns).toContain('/qianchuan');
    expect(config.forbiddenUrlPatterns).toContain('/withdraw');
  });

  it('should have platformId set to douyin', () => {
    const config = (rpa as unknown as { config: { platformId: string } }).config;
    expect(config.platformId).toBe('douyin');
  });

  // ─── Excel 解析 ──────────────────────────────────────────

  describe('parseExcel', () => {
    it('should parse Excel with standard settlement headers', () => {
      const wb = XLSX.utils.book_new();
      const data = [
        ['抖店结算单导出'],
        ['导出时间: 2026-04-01'],
        ['动账流水号', '动账时间', '动账方向', '订单实付应结', '平台服务费', '佣金', '运费', '站外推广费', '订单退款', '招商服务费', '动账金额'],
        ['DY-001', '2026.03.01-2026.03.15', '收入', '50000', '500', '2500', '3000', '1000', '2000', '0', '41000'],
        ['DY-002', '2026.03.16-2026.03.31', '收入', '30000', '300', '1500', '2000', '500', '1000', '100', '24600'],
      ];
      const ws = XLSX.utils.aoa_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');

      const filepath = path.join(tmpDir, 'test.xlsx');
      XLSX.writeFile(wb, filepath);

      const results = rpa.parseExcel(filepath);
      expect(results).toHaveLength(2);
      expect(results[0]!.settlementId).toBe('DY-001');
      expect(results[0]!.orderAmount).toBe('50000');
      expect(results[0]!.serviceFee).toBe('500');
      expect(results[0]!.commission).toBe('2500');
      expect(results[0]!.netAmount).toBe('41000');
      expect(results[0]!.status).toBe('收入');
      expect(results[1]!.settlementId).toBe('DY-002');
    });

    it('should handle Excel with no data rows', () => {
      const wb = XLSX.utils.book_new();
      const data = [
        ['动账流水号', '动账时间', '动账方向', '订单实付应结', '平台服务费'],
      ];
      const ws = XLSX.utils.aoa_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');

      const filepath = path.join(tmpDir, 'empty.xlsx');
      XLSX.writeFile(wb, filepath);

      const results = rpa.parseExcel(filepath);
      expect(results).toHaveLength(0);
    });

    it('should find header row even with metadata rows before it', () => {
      const wb = XLSX.utils.book_new();
      const data = [
        ['店铺名称: 时皙旗舰店'],
        ['导出时间: 2026-04-01 12:00:00'],
        [''],
        ['日期范围: 2026-03-01 ~ 2026-03-31'],
        ['结算单号', '结算周期', '结算状态', '订单金额', '佣金', '服务费'],
        ['DY-003', '2026.03.01-2026.03.15', '已打款', '10000', '500', '100'],
      ];
      const ws = XLSX.utils.aoa_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');

      const filepath = path.join(tmpDir, 'with-meta.xlsx');
      XLSX.writeFile(wb, filepath);

      const results = rpa.parseExcel(filepath);
      expect(results).toHaveLength(1);
      expect(results[0]!.settlementId).toBe('DY-003');
    });
  });

  // ─── CSV 解析 ────────────────────────────────────────────

  describe('parseCsv', () => {
    it('should parse CSV with standard headers', () => {
      const csv = [
        '动账流水号,动账时间,动账方向,订单实付应结,平台服务费,佣金,运费,订单退款,动账金额',
        'DY-CSV-001,2026.03.01,收入,20000,200,1000,1500,500,16800',
        'DY-CSV-002,2026.03.15,收入,15000,150,750,1000,300,12800',
      ].join('\n');

      const filepath = path.join(tmpDir, 'test.csv');
      fs.writeFileSync(filepath, csv, 'utf-8');

      const results = rpa.parseCsv(filepath);
      expect(results).toHaveLength(2);
      expect(results[0]!.settlementId).toBe('DY-CSV-001');
      expect(results[0]!.orderAmount).toBe('20000');
    });

    it('should handle CSV with quoted fields containing commas', () => {
      const csv = [
        '结算单号,结算周期,金额,佣金',
        '"DY-Q-001","2026.03.01-2026.03.15","50,000.00","2,500.00"',
      ].join('\n');

      const filepath = path.join(tmpDir, 'quoted.csv');
      fs.writeFileSync(filepath, csv, 'utf-8');

      const results = rpa.parseCsv(filepath);
      expect(results).toHaveLength(1);
      expect(results[0]!.settlementId).toBe('DY-Q-001');
    });

    it('should skip metadata rows before header', () => {
      const csv = [
        '抖店导出数据',
        '导出日期: 2026-04-01',
        '',
        '动账流水号,动账时间,金额,佣金,服务费',
        'DY-M-001,2026.03.01,10000,500,100',
      ].join('\n');

      const filepath = path.join(tmpDir, 'meta.csv');
      fs.writeFileSync(filepath, csv, 'utf-8');

      const results = rpa.parseCsv(filepath);
      expect(results).toHaveLength(1);
    });
  });

  // ─── 列映射 ──────────────────────────────────────────────

  describe('mapColumnsToSettlement', () => {
    it('should map columns by header keywords', () => {
      const headers = ['动账流水号', '动账时间', '动账方向', '订单实付应结', '平台服务费', '佣金', '运费', '站外推广费', '订单退款', '招商服务费', '动账金额'];
      const cells = ['DY-MAP-001', '2026.03.01', '收入', '50000', '500', '2500', '3000', '1000', '2000', '0', '41000'];

      const result = rpa.mapColumnsToSettlement(headers, cells);
      expect(result.settlementId).toBe('DY-MAP-001');
      expect(result.orderAmount).toBe('50000');
      expect(result.serviceFee).toBe('500');
      expect(result.commission).toBe('2500');
      expect(result.deliveryFee).toBe('3000');
      expect(result.promotionFee).toBe('1000');
      expect(result.refundAmount).toBe('2000');
      expect(result.otherDeduction).toBe('0');
      expect(result.netAmount).toBe('41000');
      expect(result.status).toBe('收入');
    });
  });

  // ─── 数据转换测试 ────────────────────────────────────────

  describe('transformToUnified (via reflection)', () => {
    const callTransform = (rpaInstance: DouyinRPA, raw: Record<string, string>) => {
      return (rpaInstance as unknown as {
        transformToUnified(raw: Record<string, string>): unknown;
      }).transformToUnified(raw);
    };

    it('should transform valid settlement data', () => {
      const raw = {
        settlementId: 'DY-2026-03-001',
        period: '2026.03.01-2026.03.15',
        settlementDate: '2026.03.22',
        orderAmount: '50,000.00',
        serviceFee: '500.00',
        commission: '2,500.00',
        deliveryFee: '3,000.00',
        promotionFee: '1,000.00',
        refundAmount: '2,000.00',
        otherDeduction: '0',
        netAmount: '41,000.00',
        status: '已打款',
      };

      const result = callTransform(rpa, raw);
      expect(result).not.toBeNull();

      const parsed = unifiedSettlementSchema.safeParse(result);
      expect(parsed.success).toBe(true);

      if (parsed.success) {
        expect(parsed.data.platform).toBe('douyin');
        expect(parsed.data.settlementId).toBe('DY-2026-03-001');
        expect(parsed.data.grossAmount).toBe(50000);
        expect(parsed.data.commission).toBe(2500);
        expect(parsed.data.serviceFee).toBe(500);
        expect(parsed.data.deliveryFee).toBe(3000);
        expect(parsed.data.promotionDeduction).toBe(1000);
        expect(parsed.data.refundDeduction).toBe(2000);
        expect(parsed.data.otherDeduction).toBe(0);
        expect(parsed.data.netAmount).toBe(41000);
        expect(parsed.data.paymentStatus).toBe('paid');
      }
    });

    it('should handle dash-separated date format', () => {
      const raw = {
        settlementId: 'DY-002',
        period: '2026-03-01~2026-03-15',
        settlementDate: '2026-03-22',
        orderAmount: '10000',
        serviceFee: '100',
        commission: '500',
        deliveryFee: '200',
        promotionFee: '0',
        refundAmount: '100',
        otherDeduction: '0',
        netAmount: '9100',
        status: '待结算',
      };

      const result = callTransform(rpa, raw);
      const parsed = unifiedSettlementSchema.safeParse(result);
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.paymentStatus).toBe('pending');
    });

    it('should handle amounts with currency symbols', () => {
      const raw = {
        settlementId: 'DY-003',
        period: '2026.03.16-2026.03.31',
        settlementDate: '2026.04.05',
        orderAmount: '¥8,888.88',
        serviceFee: '￥88.88',
        commission: '¥444.44',
        deliveryFee: '¥266.66',
        promotionFee: '0',
        refundAmount: '¥100.00',
        otherDeduction: '0',
        netAmount: '¥7,988.90',
        status: '已结算',
      };

      const result = callTransform(rpa, raw);
      const parsed = unifiedSettlementSchema.safeParse(result);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.grossAmount).toBe(8888.88);
        expect(parsed.data.netAmount).toBe(7988.90);
      }
    });

    it('should handle empty/dash amounts as zero', () => {
      const raw = {
        settlementId: 'DY-004',
        period: '2026.04.01-2026.04.15',
        settlementDate: '2026.04.20',
        orderAmount: '1000',
        serviceFee: '-',
        commission: '--',
        deliveryFee: '',
        promotionFee: '-',
        refundAmount: '0',
        otherDeduction: '',
        netAmount: '1000',
        status: '已到账',
      };

      const result = callTransform(rpa, raw);
      const parsed = unifiedSettlementSchema.safeParse(result);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.serviceFee).toBe(0);
        expect(parsed.data.commission).toBe(0);
        expect(parsed.data.deliveryFee).toBe(0);
      }
    });
  });

  // ─── 支付状态映射 ────────────────────────────────────────

  describe('mapPaymentStatus', () => {
    it('should map "已打款" to "paid"', () => expect(rpa.mapPaymentStatus('已打款')).toBe('paid'));
    it('should map "已结算" to "paid"', () => expect(rpa.mapPaymentStatus('已结算')).toBe('paid'));
    it('should map "已到账" to "paid"', () => expect(rpa.mapPaymentStatus('已到账')).toBe('paid'));
    it('should map "收入" to "paid"', () => expect(rpa.mapPaymentStatus('收入')).toBe('paid'));
    it('should map "待结算" to "pending"', () => expect(rpa.mapPaymentStatus('待结算')).toBe('pending'));
    it('should map "已匹配" to "matched"', () => expect(rpa.mapPaymentStatus('已匹配')).toBe('matched'));
    it('should map unknown to "pending"', () => {
      expect(rpa.mapPaymentStatus('处理中')).toBe('pending');
      expect(rpa.mapPaymentStatus('')).toBe('pending');
    });
  });

  // ─── 金额解析 ────────────────────────────────────────────

  describe('parseAmount', () => {
    it('should parse plain number', () => {
      expect(rpa.parseAmount('1000')).toBe(1000);
      expect(rpa.parseAmount('99.99')).toBe(99.99);
    });

    it('should parse number with commas', () => {
      expect(rpa.parseAmount('1,234,567.89')).toBe(1234567.89);
      expect(rpa.parseAmount('50，000.00')).toBe(50000);
    });

    it('should parse number with currency symbols', () => {
      expect(rpa.parseAmount('¥1000')).toBe(1000);
      expect(rpa.parseAmount('￥2,500.00')).toBe(2500);
      expect(rpa.parseAmount('100元')).toBe(100);
    });

    it('should return 0 for empty/dash values', () => {
      expect(rpa.parseAmount('')).toBe(0);
      expect(rpa.parseAmount('-')).toBe(0);
      expect(rpa.parseAmount('--')).toBe(0);
    });
  });

  // ─── 日期解析 ────────────────────────────────────────────

  describe('parseDouyinDate', () => {
    it('should parse dot-separated date', () => {
      const date = rpa.parseDouyinDate('2026.03.15');
      expect(date.getFullYear()).toBe(2026);
      expect(date.getMonth()).toBe(2);
      expect(date.getDate()).toBe(15);
    });

    it('should parse dash-separated date', () => {
      const date = rpa.parseDouyinDate('2026-03-15');
      expect(date.getFullYear()).toBe(2026);
    });

    it('should parse slash-separated date', () => {
      const date = rpa.parseDouyinDate('2026/03/15');
      expect(date.getFullYear()).toBe(2026);
    });

    it('should return current date for invalid input', () => {
      const before = Date.now();
      const date = rpa.parseDouyinDate('invalid');
      const after = Date.now();
      expect(date.getTime()).toBeGreaterThanOrEqual(before);
      expect(date.getTime()).toBeLessThanOrEqual(after);
    });
  });
});
