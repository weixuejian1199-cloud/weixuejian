/**
 * MeituanRPA 美团结算单采集测试
 *
 * 测试不启动真实浏览器，聚焦：
 * - PlatformRPA 继承链正确性
 * - 禁止 URL 模式（只读保护）
 * - Excel / CSV 解析（导出策略核心）
 * - 列映射逻辑
 * - 结算单数据转换（MeituanRawSettlement → UnifiedSettlement）
 * - 支付状态映射 / 金额解析 / 日期解析
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as XLSX from 'xlsx';
import { MeituanRPA } from '../platform/meituan-rpa.js';
import { PlatformRPA } from '../platform/platform-rpa.js';
import { BasePlatformRPA } from '../base-platform-rpa.js';
import { unifiedSettlementSchema } from '../schemas.js';

describe('MeituanRPA', () => {
  let tmpDir: string;
  let encryptionKey: string;
  let rpa: MeituanRPA;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpa-meituan-test-'));
    encryptionKey = crypto.randomBytes(32).toString('hex');
    rpa = new MeituanRPA({
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

  // ─── 只读保护 ────────────────────────────────────────────

  it('should have platform + meituan forbidden patterns', () => {
    const config = (rpa as unknown as { config: { forbiddenUrlPatterns: string[] } }).config;

    expect(config.forbiddenUrlPatterns).toContain('/order/send');
    expect(config.forbiddenUrlPatterns).toContain('/price/edit');
    expect(config.forbiddenUrlPatterns).toContain('/refund/agree');

    expect(config.forbiddenUrlPatterns).toContain('/order/operate');
    expect(config.forbiddenUrlPatterns).toContain('/order/confirm');
    expect(config.forbiddenUrlPatterns).toContain('/order/cancel');
    expect(config.forbiddenUrlPatterns).toContain('/product/online');
    expect(config.forbiddenUrlPatterns).toContain('/product/offline');
    expect(config.forbiddenUrlPatterns).toContain('/marketing/create');
    expect(config.forbiddenUrlPatterns).toContain('/withdraw');
    expect(config.forbiddenUrlPatterns).toContain('/waimai/act');
  });

  it('should have platformId set to meituan', () => {
    const config = (rpa as unknown as { config: { platformId: string } }).config;
    expect(config.platformId).toBe('meituan');
  });

  // ─── Excel 解析 ──────────────────────────────────────────

  describe('parseExcel', () => {
    it('should parse Excel with standard settlement headers', () => {
      const wb = XLSX.utils.book_new();
      const data = [
        ['美团商家结算单'],
        ['结算单号', '结算周期', '结算状态', '订单金额', '平台服务费', '技术服务费', '配送费', '平台补贴', '商家活动', '退款', '其他扣款', '结算金额'],
        ['MT-001', '2026-03-01至2026-03-15', '已打款', '30000', '1800', '300', '4500', '500', '1200', '800', '0', '22200'],
        ['MT-002', '2026-03-16至2026-03-31', '已打款', '25000', '1500', '250', '3750', '300', '800', '500', '100', '18700'],
      ];
      const ws = XLSX.utils.aoa_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');

      const filepath = path.join(tmpDir, 'test.xlsx');
      XLSX.writeFile(wb, filepath);

      const results = rpa.parseExcel(filepath);
      expect(results).toHaveLength(2);
      expect(results[0]!.settlementId).toBe('MT-001');
      expect(results[0]!.orderAmount).toBe('30000');
      expect(results[0]!.serviceFee).toBe('1800');
      expect(results[0]!.techFee).toBe('300');
      expect(results[0]!.deliveryFee).toBe('4500');
      expect(results[0]!.activitySubsidy).toBe('500');
      expect(results[0]!.merchantActivity).toBe('1200');
      expect(results[0]!.netAmount).toBe('22200');
      expect(results[0]!.status).toBe('已打款');
    });

    it('should handle Excel with no data rows', () => {
      const wb = XLSX.utils.book_new();
      const data = [
        ['结算单号', '结算周期', '订单金额', '服务费'],
      ];
      const ws = XLSX.utils.aoa_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');

      const filepath = path.join(tmpDir, 'empty.xlsx');
      XLSX.writeFile(wb, filepath);

      const results = rpa.parseExcel(filepath);
      expect(results).toHaveLength(0);
    });

    it('should find header row with metadata rows before it', () => {
      const wb = XLSX.utils.book_new();
      const data = [
        ['门店名称: 时皙美团店'],
        ['导出日期: 2026-04-01'],
        [''],
        ['账单号', '账单周期', '配送费', '退款金额', '结算金额'],
        ['MT-003', '2026.03.01-2026.03.15', '2000', '500', '15000'],
      ];
      const ws = XLSX.utils.aoa_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');

      const filepath = path.join(tmpDir, 'meta.xlsx');
      XLSX.writeFile(wb, filepath);

      const results = rpa.parseExcel(filepath);
      expect(results).toHaveLength(1);
      expect(results[0]!.settlementId).toBe('MT-003');
    });
  });

  // ─── CSV 解析 ────────────────────────────────────────────

  describe('parseCsv', () => {
    it('should parse CSV with standard headers', () => {
      const csv = [
        '结算单号,结算周期,订单金额,平台服务费,配送费,退款,结算金额',
        'MT-CSV-001,2026-03-01至2026-03-15,20000,1200,3000,500,15300',
        'MT-CSV-002,2026-03-16至2026-03-31,18000,1080,2700,300,13920',
      ].join('\n');

      const filepath = path.join(tmpDir, 'test.csv');
      fs.writeFileSync(filepath, csv, 'utf-8');

      const results = rpa.parseCsv(filepath);
      expect(results).toHaveLength(2);
      expect(results[0]!.settlementId).toBe('MT-CSV-001');
      expect(results[0]!.orderAmount).toBe('20000');
    });

    it('should handle quoted CSV fields', () => {
      const csv = [
        '账单号,结算周期,金额,配送费',
        '"MT-Q-001","2026.03.01-2026.03.15","30,000.00","4,500.00"',
      ].join('\n');

      const filepath = path.join(tmpDir, 'quoted.csv');
      fs.writeFileSync(filepath, csv, 'utf-8');

      const results = rpa.parseCsv(filepath);
      expect(results).toHaveLength(1);
      expect(results[0]!.settlementId).toBe('MT-Q-001');
    });
  });

  // ─── 列映射 ──────────────────────────────────────────────

  describe('mapColumnsToSettlement', () => {
    it('should map all column types correctly', () => {
      const headers = ['结算单号', '结算周期', '结算状态', '订单金额', '平台服务费', '技术服务费', '配送费', '平台补贴', '商家活动', '退款', '其他扣款', '结算金额'];
      const cells = ['MT-MAP-001', '2026-03-01至2026-03-15', '已打款', '30000', '1800', '300', '4500', '500', '1200', '800', '0', '22200'];

      const result = rpa.mapColumnsToSettlement(headers, cells);
      expect(result.settlementId).toBe('MT-MAP-001');
      expect(result.orderAmount).toBe('30000');
      expect(result.serviceFee).toBe('1800');
      expect(result.techFee).toBe('300');
      expect(result.deliveryFee).toBe('4500');
      expect(result.activitySubsidy).toBe('500');
      expect(result.merchantActivity).toBe('1200');
      expect(result.refundAmount).toBe('800');
      expect(result.netAmount).toBe('22200');
      expect(result.status).toBe('已打款');
    });
  });

  // ─── 数据转换 ────────────────────────────────────────────

  describe('transformToUnified (via reflection)', () => {
    const callTransform = (rpaInstance: MeituanRPA, raw: Record<string, string>) => {
      return (rpaInstance as unknown as {
        transformToUnified(raw: Record<string, string>): unknown;
      }).transformToUnified(raw);
    };

    it('should transform valid settlement data', () => {
      const raw = {
        settlementId: 'MT-2026-03-001',
        period: '2026-03-01至2026-03-15',
        settlementDate: '2026-03-22',
        orderAmount: '30,000.00',
        serviceFee: '1,800.00',
        techFee: '300.00',
        deliveryFee: '4,500.00',
        activitySubsidy: '500.00',
        merchantActivity: '1,200.00',
        refundAmount: '800.00',
        otherDeduction: '0',
        netAmount: '22,200.00',
        status: '已打款',
      };

      const result = callTransform(rpa, raw);
      expect(result).not.toBeNull();

      const parsed = unifiedSettlementSchema.safeParse(result);
      expect(parsed.success).toBe(true);

      if (parsed.success) {
        expect(parsed.data.platform).toBe('meituan');
        expect(parsed.data.settlementId).toBe('MT-2026-03-001');
        expect(parsed.data.grossAmount).toBe(30000);
        expect(parsed.data.commission).toBe(2100); // 1800 + 300
        expect(parsed.data.serviceFee).toBe(1800);
        expect(parsed.data.deliveryFee).toBe(4500);
        expect(parsed.data.promotionDeduction).toBe(700); // 1200 - 500
        expect(parsed.data.refundDeduction).toBe(800);
        expect(parsed.data.netAmount).toBe(22200);
        expect(parsed.data.paymentStatus).toBe('paid');
      }
    });

    it('should handle compact date format (20260301)', () => {
      const raw = {
        settlementId: 'MT-002',
        period: '20260301~20260315',
        settlementDate: '20260322',
        orderAmount: '10000', serviceFee: '600', techFee: '0',
        deliveryFee: '1500', activitySubsidy: '0', merchantActivity: '0',
        refundAmount: '100', otherDeduction: '0', netAmount: '7800', status: '待结算',
      };

      const result = callTransform(rpa, raw);
      const parsed = unifiedSettlementSchema.safeParse(result);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.paymentStatus).toBe('pending');
        expect(parsed.data.settlementDate.getFullYear()).toBe(2026);
      }
    });

    it('should cap promotionDeduction at 0 when subsidy > activity', () => {
      const raw = {
        settlementId: 'MT-005',
        period: '2026-03-01~2026-03-15',
        settlementDate: '2026-03-22',
        orderAmount: '10000', serviceFee: '600', techFee: '0',
        deliveryFee: '0', activitySubsidy: '500', merchantActivity: '200',
        refundAmount: '0', otherDeduction: '0', netAmount: '9700', status: '已结算',
      };

      const result = callTransform(rpa, raw);
      const parsed = unifiedSettlementSchema.safeParse(result);
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.promotionDeduction).toBe(0);
    });

    it('should handle currency symbols and dashes', () => {
      const raw = {
        settlementId: 'MT-003',
        period: '2026.03.16-2026.03.31',
        settlementDate: '2026.04.05',
        orderAmount: '¥5,000.00', serviceFee: '￥300.00', techFee: '-',
        deliveryFee: '¥750.00', activitySubsidy: '0', merchantActivity: '0',
        refundAmount: '--', otherDeduction: '', netAmount: '¥3,950.00', status: '已出账',
      };

      const result = callTransform(rpa, raw);
      const parsed = unifiedSettlementSchema.safeParse(result);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.grossAmount).toBe(5000);
        expect(parsed.data.serviceFee).toBe(300);
        expect(parsed.data.refundDeduction).toBe(0);
        expect(parsed.data.paymentStatus).toBe('paid');
      }
    });
  });

  // ─── 支付状态映射 ────────────────────────────────────────

  describe('mapPaymentStatus', () => {
    it('should map "已打款" to "paid"', () => expect(rpa.mapPaymentStatus('已打款')).toBe('paid'));
    it('should map "已结算" to "paid"', () => expect(rpa.mapPaymentStatus('已结算')).toBe('paid'));
    it('should map "已到账" to "paid"', () => expect(rpa.mapPaymentStatus('已到账')).toBe('paid'));
    it('should map "已出账" to "paid"', () => expect(rpa.mapPaymentStatus('已出账')).toBe('paid'));
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
    it('should parse with commas', () => expect(rpa.parseAmount('1,234,567.89')).toBe(1234567.89));
    it('should parse with currency', () => {
      expect(rpa.parseAmount('¥1000')).toBe(1000);
      expect(rpa.parseAmount('100元')).toBe(100);
    });
    it('should return 0 for empty/dash', () => {
      expect(rpa.parseAmount('')).toBe(0);
      expect(rpa.parseAmount('-')).toBe(0);
      expect(rpa.parseAmount('--')).toBe(0);
    });
  });

  // ─── 日期解析 ────────────────────────────────────────────

  describe('parseMeituanDate', () => {
    it('should parse dash-separated', () => {
      const d = rpa.parseMeituanDate('2026-03-15');
      expect(d.getFullYear()).toBe(2026);
      expect(d.getMonth()).toBe(2);
      expect(d.getDate()).toBe(15);
    });
    it('should parse dot-separated', () => expect(rpa.parseMeituanDate('2026.03.15').getFullYear()).toBe(2026));
    it('should parse slash-separated', () => expect(rpa.parseMeituanDate('2026/03/15').getFullYear()).toBe(2026));
    it('should parse compact (20260315)', () => {
      const d = rpa.parseMeituanDate('20260315');
      expect(d.getFullYear()).toBe(2026);
      expect(d.getMonth()).toBe(2);
      expect(d.getDate()).toBe(15);
    });
    it('should return now for invalid', () => {
      const before = Date.now();
      const d = rpa.parseMeituanDate('invalid');
      expect(d.getTime()).toBeGreaterThanOrEqual(before);
    });
  });
});
