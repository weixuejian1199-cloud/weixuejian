/**
 * DouyinRPA — 抖店商家后台 RPA（结算单采集）
 *
 * 采集策略：导出 Excel → 解析 → 转换为 UnifiedSettlement
 * 导出比 API 拦截 / DOM 抓取稳定 10x：不怕页面改版、不需翻页、数据完整
 *
 * 抖店商家后台（fxg.jinritemai.com）实测：
 * - 登录URL: https://fxg.jinritemai.com/login/common
 * - 登录方式: 手机号 + 短信验证码（无密码选项，财务手机）
 * - 结算路径: 左侧导航 → 资金 → 结算管理
 * - 导出按钮: 页面右上角"导出"/"下载"按钮
 * - 多店铺：时皙、爱比爱尼、舒络、千一（同一手机号管理）
 *
 * ⚠️ 绝对只读：只查询结算数据，不做任何订单/商品/推广操作
 */
import type { Page } from 'playwright';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as XLSX from 'xlsx';
import { PlatformRPA, type PlatformRPAConfig } from './platform-rpa.js';
import type { UnifiedSettlement, CollectParams } from '../schemas.js';
import { unifiedSettlementSchema } from '../schemas.js';
import { RPACollectError, type DryRunResult } from '../base-platform-rpa.js';

/** 抖店登录 URL */
const DOUYIN_LOGIN_URL = 'https://fxg.jinritemai.com/login/common';

/** 抖店资金流水/账单管理 URL */
const DOUYIN_SETTLEMENT_URL = 'https://fxg.jinritemai.com/ffa/fxg-bill/fund-detail-bill';

/** 抖店专属禁止 URL 模式 */
const DOUYIN_FORBIDDEN = [
  '/order/batchShip',        // 批量发货
  '/order/modifyPrice',      // 修改价格
  '/afterSale/agree',        // 同意售后
  '/afterSale/reject',       // 拒绝售后
  '/compass/ad',             // 罗盘投放操作（不拦截罗盘登录跳转）
  '/qianchuan',              // 千川投放
  '/product/publish',        // 发布商品
  '/product/batchEdit',      // 批量编辑商品
  '/supply',                 // 供应链操作
  '/withdraw',               // 提现（特别危险）
];

// ─── 抖店原始结算数据 ──────────────────────────────────────

interface DouyinRawSettlement {
  /** 结算单号 */
  settlementId: string;
  /** 结算周期（如 "2026.03.01-2026.03.15"） */
  period: string;
  /** 结算日期 */
  settlementDate: string;
  /** 订单金额（元） */
  orderAmount: string;
  /** 平台服务费（元） */
  serviceFee: string;
  /** 佣金（元） */
  commission: string;
  /** 运费（元） */
  deliveryFee: string;
  /** 推广费用（元） */
  promotionFee: string;
  /** 退款金额（元） */
  refundAmount: string;
  /** 其他扣款（元） */
  otherDeduction: string;
  /** 实际结算金额（元） */
  netAmount: string;
  /** 结算状态（待结算/已结算/已打款） */
  status: string;
}

export class DouyinRPA extends PlatformRPA {
  constructor(
    config: Omit<PlatformRPAConfig, 'platformId' | 'extraForbiddenPatterns'>,
  ) {
    super({
      ...config,
      platformId: 'douyin',
      extraForbiddenPatterns: DOUYIN_FORBIDDEN,
    });
  }

  // ─── 登录流程（手机号 + 短信验证码）─────────────────────

  protected async doLogin(page: Page): Promise<void> {
    this.log('info', '开始登录抖店商家后台');

    try {
      // 1. 打开登录页
      await page.goto(DOUYIN_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForSelector('input', { timeout: 15_000 });
      await this.humanDelay(1000, 2000);

      // 2. 切换到手机验证码登录
      await this.switchToSmsLogin(page);

      // 3. 填写手机号
      const phoneInput = await this.findPhoneInput(page);
      if (!phoneInput) {
        throw new RPACollectError('找不到手机号输入框', 'login');
      }
      await phoneInput.click();
      await this.humanDelay(200, 400);
      await phoneInput.fill(this.phone);
      this.log('info', `手机号已填写: ${this.phone.slice(0, 3)}****${this.phone.slice(-4)}`);
      await this.humanDelay(500, 1000);

      // 4. 点击"获取验证码"
      await this.clickGetSmsCode(page);

      // 5. 等待手动输入验证码并登录
      this.log('warn', '⏳ 请在浏览器中手动输入短信验证码并点击登录（180秒超时）');

      try {
        await page.waitForURL(
          (url) => {
            const urlStr = url.toString();
            return !urlStr.includes('/login') && urlStr.includes('fxg.jinritemai.com');
          },
          { timeout: 180_000 },
        );
      } catch {
        throw new RPACollectError('登录超时（180秒），请重试', 'login');
      }

      await this.humanDelay(2000, 3000);

      // 6. 验证登录成功
      const loggedIn = await this.isLoggedIn(page);
      if (!loggedIn) {
        throw new RPACollectError('登录后未检测到已登录状态', 'login');
      }

      this.log('info', '抖店商家后台登录成功');
    } catch (err) {
      if (err instanceof RPACollectError) throw err;
      throw new RPACollectError(
        `登录失败: ${err instanceof Error ? err.message : String(err)}`,
        'login',
      );
    }
  }

  /** 切换到手机验证码登录标签 */
  private async switchToSmsLogin(page: Page): Promise<void> {
    const smsTabSelectors = [
      'text=验证码登录',
      'text=短信登录',
      'text=手机验证码',
      '[data-e2e="sms-login-tab"]',
      '.login-tab:has-text("验证码")',
    ];

    for (const selector of smsTabSelectors) {
      try {
        const el = await page.$(selector);
        if (el) {
          const visible = await el.isVisible();
          if (visible) {
            await el.click();
            this.log('info', '已切换到验证码登录');
            await this.humanDelay(500, 1000);
            return;
          }
        }
      } catch {
        continue;
      }
    }

    this.log('info', '未找到验证码登录切换标签，可能已是默认模式');
  }

  /** 查找手机号输入框 */
  private async findPhoneInput(page: Page): Promise<ReturnType<Page['$']> extends Promise<infer T> ? T : never> {
    const selectors = [
      'input[placeholder*="手机"]',
      'input[placeholder*="phone"]',
      'input[name="mobile"]',
      'input[name="phone"]',
      'input[type="tel"]',
      '[data-e2e="phone-input"] input',
      '.login-form input[type="text"]',
    ];

    for (const selector of selectors) {
      try {
        const el = await page.$(selector);
        if (el) {
          const visible = await el.isVisible();
          if (visible) return el;
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  /** 点击获取验证码按钮 */
  private async clickGetSmsCode(page: Page): Promise<void> {
    const selectors = [
      'text=获取验证码',
      'text=发送验证码',
      'text=获取短信验证码',
      '[data-e2e="send-sms-btn"]',
      'button:has-text("验证码")',
      '.sms-btn',
    ];

    for (const selector of selectors) {
      try {
        const el = await page.$(selector);
        if (el) {
          const visible = await el.isVisible();
          if (visible) {
            await el.click();
            this.log('info', '已点击获取验证码，请查看手机短信');
            return;
          }
        }
      } catch {
        continue;
      }
    }

    this.log('warn', '未找到获取验证码按钮，请手动点击获取');
  }

  // ─── 登录状态检查 ────────────────────────────────────────

  protected async isLoggedIn(page: Page): Promise<boolean> {
    try {
      const url = page.url();
      if (!url.includes('jinritemai.com')) {
        this.log('info', '导航到抖店首页检测登录状态...');
        await page.goto('https://fxg.jinritemai.com/', {
          waitUntil: 'domcontentloaded',
          timeout: 15_000,
        });
        await new Promise((r) => setTimeout(r, 3000));
      }

      const currentUrl = page.url();
      if (currentUrl.includes('/login')) return false;

      const bodyText = await page.textContent('body').catch(() => '') ?? '';
      if (bodyText.includes('请选择店铺') || bodyText.includes('选择店铺')) {
        this.log('info', '已登录，需要选择店铺');
        await this.handleShopSelection(page);
        return true;
      }

      const indicators = [
        'text=首页', 'text=订单', 'text=商品', 'text=资金',
        '.sidebar-menu', '[class*="sidebar"]', '[class*="ShopName"]', '[class*="shop-name"]',
      ];

      for (const selector of indicators) {
        try {
          const el = await page.$(selector);
          if (el) {
            const visible = await el.isVisible();
            if (visible) return true;
          }
        } catch {
          continue;
        }
      }

      return currentUrl.includes('jinritemai.com') && !currentUrl.includes('/login');
    } catch {
      return false;
    }
  }

  /** 处理店铺选择页面 */
  private async handleShopSelection(page: Page): Promise<void> {
    this.log('info', '进入店铺选择流程');

    const selectors = [
      'text=下一步', 'button:has-text("进入")', 'button:has-text("确定")',
      '[class*="shop-name"]', '[class*="ShopName"]', 'text=专卖店',
    ];

    for (const selector of selectors) {
      try {
        const el = await page.$(selector);
        if (el) {
          const visible = await el.isVisible();
          if (visible) {
            await el.click();
            this.log('info', `已点击: ${selector}`);
            await this.humanDelay(3000, 5000);

            const confirmBtn = await page.$('text=下一步')
              ?? await page.$('button:has-text("进入")')
              ?? await page.$('button:has-text("确定")');
            if (confirmBtn) {
              const confirmVisible = await confirmBtn.isVisible();
              if (confirmVisible) {
                await confirmBtn.click();
                await this.humanDelay(3000, 5000);
              }
            }
            break;
          }
        }
      } catch {
        continue;
      }
    }

    this.log('info', `店铺选择完成，当前 URL: ${page.url()}`);
  }

  // ─── dry-run 诊断 ────────────────────────────────────────

  protected async doDryRun(page: Page): Promise<DryRunResult> {
    const logs: string[] = [];
    let reachedSettlement = false;
    let exportButtonFound = false;
    let matchedSelector: string | undefined;
    let screenshotPath: string | undefined;

    try {
      // 1. 导航到结算管理页面
      logs.push('正在导航到结算管理页面...');
      await this.navigateToSettlement(page);
      reachedSettlement = true;
      logs.push(`已到达结算页面: ${page.url()}`);

      // 等待页面内容加载
      await this.humanDelay(3000, 5000);

      // 2. 截图（非阻塞，失败不影响诊断）
      try {
        screenshotPath = await this.takeDryRunScreenshot(page, 'douyin');
        logs.push(`截图已保存: ${screenshotPath}`);
      } catch (screenshotErr) {
        logs.push(`截图失败（不影响诊断）: ${screenshotErr instanceof Error ? screenshotErr.message.slice(0, 80) : String(screenshotErr)}`);
      }

      // 3. 检查导出按钮
      const exportSelectors = [
        'button:has-text("生成报表")',
        'button:has-text("导出")',
        'button:has-text("下载")',
        'button:has-text("导出Excel")',
        'button:has-text("导出明细")',
        'button:has-text("导出数据")',
        'a:has-text("生成报表")',
        'a:has-text("导出")',
        'a:has-text("下载")',
        '[class*="export"] button',
        '[class*="download"] button',
        '[data-e2e="export-btn"]',
        'text=生成报表',
        'text=导出',
        'text=下载明细',
      ];

      for (const selector of exportSelectors) {
        try {
          const el = await page.$(selector);
          if (el) {
            const visible = await el.isVisible();
            if (visible) {
              exportButtonFound = true;
              matchedSelector = selector;
              logs.push(`✅ 找到导出按钮: ${selector}`);
              break;
            }
          }
        } catch { continue; }
      }

      if (!exportButtonFound) {
        logs.push('❌ 未找到任何导出按钮，需要调整选择器');
        // 输出页面所有按钮文本帮助调试
        const buttons = await page.$$('button, a[class*="btn"], [role="button"]');
        const btnTexts: string[] = [];
        for (const btn of buttons.slice(0, 20)) {
          const text = await btn.textContent().catch(() => '');
          if (text?.trim()) btnTexts.push(text.trim());
        }
        if (btnTexts.length > 0) {
          logs.push(`页面可见按钮: ${btnTexts.join(' | ')}`);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logs.push(`导航失败: ${message}`);
      screenshotPath = await this.takeErrorScreenshot();
    }

    return {
      reachedSettlement,
      exportButtonFound,
      screenshotPath,
      matchedSelector,
      currentUrl: page.url(),
      logs,
    };
  }

  private async takeDryRunScreenshot(page: Page, platform: string): Promise<string> {
    const screenshotDir = path.join(this.config.dataDir, 'screenshots');
    fs.mkdirSync(screenshotDir, { recursive: true });
    const filename = `${Date.now()}-${platform}-dry-run.png`;
    const filepath = path.join(screenshotDir, filename);
    await page.screenshot({ path: filepath, fullPage: false, timeout: 15_000 });
    return filepath;
  }

  // ─── 数据采集（导出 Excel 策略）──────────────────────────

  protected async doCollect(page: Page, params: CollectParams): Promise<UnifiedSettlement[]> {
    this.log('info', `开始采集结算单: ${this.formatDate(params.dateFrom)} ~ ${this.formatDate(params.dateTo)}`);

    try {
      // 1. 导航到结算管理页面（URL参数带日期）
      await this.navigateToSettlement(page, params.dateFrom, params.dateTo);

      // 2. 确保日期筛选生效
      await this.ensureDateFilter(page, params.dateFrom, params.dateTo);

      // 3. 点击查询，让页面加载筛选后的数据
      await this.clickSearch(page);
      await this.humanDelay(2000, 3000);

      // 4. 导出 Excel
      const rawSettlements = await this.exportAndParse(page);
      this.log('info', `导出解析到 ${rawSettlements.length} 条原始结算单`);

      // 5. 去重 + 转换
      const deduped = this.dedup(rawSettlements);
      const settlements = deduped
        .map((raw) => this.transformToUnified(raw))
        .filter((s): s is UnifiedSettlement => s !== null);

      this.log('info', `转换成功 ${settlements.length} 条（去重后 ${deduped.length}，丢弃 ${deduped.length - settlements.length} 条）`);

      return settlements;
    } catch (err) {
      if (err instanceof RPACollectError) throw err;
      throw new RPACollectError(
        `采集失败: ${err instanceof Error ? err.message : String(err)}`,
        'extract',
      );
    }
  }

  // ─── 导出 Excel 并解析 ──────────────────────────────────

  private async exportAndParse(page: Page): Promise<DouyinRawSettlement[]> {
    // 点击导出按钮
    const exportBtn = await this.findExportButton(page);
    if (!exportBtn) {
      throw new RPACollectError('找不到导出按钮，请确认页面已加载结算管理', 'extract');
    }

    // 监听下载事件
    const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });

    await exportBtn.click();
    this.log('info', '已点击导出按钮，等待下载...');

    // 部分平台导出前有二次确认弹窗
    await this.handleExportConfirm(page);

    const download = await downloadPromise;

    // 保存文件
    const downloadDir = path.join(this.config.dataDir, 'downloads');
    fs.mkdirSync(downloadDir, { recursive: true });

    const suggestedName = download.suggestedFilename();
    const ext = path.extname(suggestedName) || '.xlsx';
    const filename = `douyin_${Date.now()}${ext}`;
    const filepath = path.join(downloadDir, filename);
    await download.saveAs(filepath);
    this.log('info', `文件已下载: ${filename}（原名: ${suggestedName}）`);

    // 解析文件
    if (ext === '.csv' || suggestedName.endsWith('.csv')) {
      return this.parseCsv(filepath);
    }
    return this.parseExcel(filepath);
  }

  /** 查找导出按钮（多种选择器） */
  private async findExportButton(page: Page): Promise<Awaited<ReturnType<Page['$']>>> {
    const selectors = [
      'button:has-text("生成报表")',
      'button:has-text("导出")',
      'button:has-text("下载")',
      'button:has-text("导出Excel")',
      'button:has-text("导出明细")',
      'button:has-text("导出数据")',
      'a:has-text("生成报表")',
      'a:has-text("导出")',
      'a:has-text("下载")',
      '[class*="export"] button',
      '[class*="download"] button',
      '[data-e2e="export-btn"]',
      'text=生成报表',
      'text=导出',
      'text=下载明细',
    ];

    for (const selector of selectors) {
      try {
        const el = await page.$(selector);
        if (el) {
          const visible = await el.isVisible();
          if (visible) return el;
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  /** 处理导出确认弹窗 */
  private async handleExportConfirm(page: Page): Promise<void> {
    await this.humanDelay(500, 1000);
    const confirmSelectors = [
      '.ant-modal button:has-text("确定")',
      '.ant-modal button:has-text("确认")',
      '.ant-modal button:has-text("导出")',
      '[class*="modal"] button:has-text("确定")',
      '[class*="modal"] button:has-text("确认")',
      '[class*="dialog"] button:has-text("确定")',
      '[class*="arco-modal"] button:has-text("确定")',
    ];

    for (const selector of confirmSelectors) {
      try {
        const el = await page.$(selector);
        if (el) {
          const visible = await el.isVisible();
          if (visible) {
            await el.click();
            this.log('info', '已确认导出弹窗');
            return;
          }
        }
      } catch {
        continue;
      }
    }
  }

  /** 解析 Excel 文件 */
  parseExcel(filepath: string): DouyinRawSettlement[] {
    const workbook = XLSX.readFile(filepath);
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      this.log('warn', 'Excel 文件无工作表');
      return [];
    }

    const sheet = workbook.Sheets[sheetName]!;
    const allRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });

    // 找到表头行（包含结算相关关键词的行）
    const headerIdx = this.findHeaderRow(allRows);
    if (headerIdx === -1) {
      this.log('warn', 'Excel 中未找到表头行，尝试整行映射');
      return [];
    }

    const headers = (allRows[headerIdx] as unknown[]).map((h) => String(h).trim());
    const dataRows = allRows.slice(headerIdx + 1);
    this.log('info', `Excel 解析: 表头在第 ${headerIdx} 行，${dataRows.length} 数据行`);
    this.log('info', `表头: ${headers.join(' | ')}`);

    return dataRows
      .filter((row) => Array.isArray(row) && row.length >= 3 && String(row[0]).trim() !== '')
      .map((row) => {
        const cells = (row as unknown[]).map((c) => String(c).trim());
        return this.mapColumnsToSettlement(headers, cells);
      });
  }

  /** 解析 CSV 文件 */
  parseCsv(filepath: string): DouyinRawSettlement[] {
    const content = fs.readFileSync(filepath, 'utf-8');
    const lines = content.split('\n').map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2) return [];

    // 找表头行
    const headerIdx = lines.findIndex((line) =>
      line.includes('结算') || line.includes('动账') || line.includes('金额') || line.includes('流水'),
    );
    if (headerIdx === -1) {
      this.log('warn', 'CSV 中未找到表头行');
      return [];
    }

    const headers = this.splitCsvLine(lines[headerIdx]!);
    this.log('info', `CSV 表头: ${headers.join(' | ')}`);

    return lines.slice(headerIdx + 1)
      .map((line) => this.splitCsvLine(line))
      .filter((cells) => cells.length >= 3 && cells[0]!.trim() !== '')
      .map((cells) => this.mapColumnsToSettlement(headers, cells));
  }

  /** 拆分 CSV 行（处理引号内逗号） */
  private splitCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === ',' && !inQuotes) { result.push(current.trim()); current = ''; continue; }
      current += ch;
    }
    result.push(current.trim());
    return result;
  }

  /** 在前20行中查找表头行 */
  private findHeaderRow(rows: unknown[][]): number {
    const keywords = ['结算', '动账', '流水号', '订单', '金额', '佣金', '服务费'];
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      const row = rows[i];
      if (!Array.isArray(row)) continue;
      const rowText = row.map((c) => String(c)).join('');
      const matchCount = keywords.filter((kw) => rowText.includes(kw)).length;
      if (matchCount >= 2) return i;
    }
    return -1;
  }

  // ─── 导航到结算管理 ──────────────────────────────────────

  private async navigateToSettlement(page: Page, dateFrom?: Date, dateTo?: Date): Promise<void> {
    // 方式1：URL直接导航（带日期参数）
    try {
      let url = DOUYIN_SETTLEMENT_URL;
      if (dateFrom && dateTo) {
        const fromStr = this.formatDate(dateFrom);
        const toStr = this.formatDate(dateTo);
        const sep = url.includes('?') ? '&' : '?';
        url = `${url}${sep}start_date=${fromStr}&end_date=${toStr}&begin_date=${fromStr}&finish_date=${toStr}`;
        this.log('info', `URL参数注入日期: ${fromStr} ~ ${toStr}`);
      }
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await this.humanDelay(1000, 2000);

      const hasContent = await page.$('table, [class*="table"], [class*="Table"], [class*="settlement"], [class*="bill"], button:has-text("生成报表"), button:has-text("导出")');
      if (hasContent) {
        this.log('info', '直接导航到结算管理页面成功');
        return;
      }
    } catch {
      this.log('info', '直接导航失败，尝试通过菜单');
    }

    // 方式2：通过左侧菜单
    const financeMenuSelectors = [
      'text=资金', '[class*="menu"] >> text=资金', '.sidebar-menu >> text=资金', 'a:has-text("资金")',
    ];

    for (const selector of financeMenuSelectors) {
      try {
        const el = await page.$(selector);
        if (el) {
          const visible = await el.isVisible();
          if (visible) {
            await el.click();
            this.log('info', '已点击"资金"菜单');
            await this.humanDelay(2000, 3000);
            break;
          }
        }
      } catch {
        continue;
      }
    }

    const settlementMenuSelectors = [
      'text=结算管理', 'text=结算单', 'text=账单管理', 'text=账户流水',
      'text=供应商结算', 'text=资金流水', 'text=账户明细', 'text=对账单',
      'text=账户余额', 'a:has-text("结算")', 'a:has-text("流水")', 'a:has-text("账单")',
    ];

    let clicked = false;
    for (const selector of settlementMenuSelectors) {
      try {
        const el = await page.$(selector);
        if (el) {
          const visible = await el.isVisible();
          if (visible) {
            await el.click();
            clicked = true;
            this.log('info', '已点击结算子菜单');
            break;
          }
        }
      } catch {
        continue;
      }
    }

    if (!clicked) {
      throw new RPACollectError('找不到结算管理菜单入口', 'navigate');
    }

    await this.humanDelay(2000, 3000);
  }

  // ─── 日期筛选 ────────────────────────────────────────────

  private async ensureDateFilter(page: Page, from: Date, to: Date): Promise<void> {
    const fromStr = this.formatDate(from);
    const toStr = this.formatDate(to);

    if (await this.isDateFilterApplied(page, fromStr, toStr)) {
      this.log('info', `日期筛选已通过URL参数生效: ${fromStr} ~ ${toStr}`);
      return;
    }

    this.log('info', 'URL参数日期未生效，降级到DatePicker');
    await this.setDateViaDatePicker(page, fromStr, toStr);
  }

  private async isDateFilterApplied(page: Page, fromStr: string, toStr: string): Promise<boolean> {
    try {
      const inputs = await page.$$('input[type="text"], .ant-picker-input input, [class*="DatePicker"] input, [class*="date"] input, [class*="arco-picker"] input');
      for (const input of inputs) {
        const val = await input.inputValue().catch(() => '');
        if (val.includes(fromStr) || val.includes(toStr)) return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  private async setDateViaDatePicker(page: Page, fromStr: string, toStr: string): Promise<void> {
    const dateInputSelectors = [
      'input[placeholder*="开始"]', 'input[placeholder*="起始"]',
      '.ant-picker-input input', '[class*="DatePicker"] input',
      '[class*="date-picker"] input', '[class*="arco-picker"] input',
    ];

    const dateInputs: Array<Awaited<ReturnType<Page['$']>>> = [];
    for (const selector of dateInputSelectors) {
      const elements = await page.$$(selector);
      for (const el of elements) {
        const visible = await el.isVisible();
        if (visible) dateInputs.push(el);
      }
      if (dateInputs.length >= 2) break;
    }

    if (dateInputs.length >= 2) {
      await this.fillDateInput(page, dateInputs[0]!, fromStr);
      await this.fillDateInput(page, dateInputs[1]!, toStr);
      this.log('info', `DatePicker: ${fromStr} ~ ${toStr}`);
      return;
    }

    // RangePicker
    const rangeSelectors = ['.ant-picker-range', '[class*="RangePicker"]', '[class*="arco-picker-range"]'];
    for (const selector of rangeSelectors) {
      const rangePicker = await page.$(selector);
      if (!rangePicker) continue;
      const visible = await rangePicker.isVisible();
      if (!visible) continue;

      await rangePicker.click();
      await this.humanDelay(300, 600);
      const rangeInputs = await rangePicker.$$('input');
      if (rangeInputs.length >= 2) {
        await this.fillDateInput(page, rangeInputs[0]!, fromStr);
        await this.fillDateInput(page, rangeInputs[1]!, toStr);
        this.log('info', `RangePicker: ${fromStr} ~ ${toStr}`);
        return;
      }
    }

    this.log('warn', '未找到日期筛选器，将采集页面默认范围');
  }

  private async fillDateInput(page: Page, input: Awaited<ReturnType<Page['$']>> & object, dateStr: string): Promise<void> {
    await input.click();
    await this.humanDelay(150, 300);
    await page.keyboard.press('Meta+a');
    await page.keyboard.press('Backspace');
    await this.humanDelay(100, 200);
    await page.keyboard.type(dateStr, { delay: 50 });
    await this.humanDelay(100, 200);
    await page.keyboard.press('Enter');
    await this.humanDelay(200, 400);
  }

  // ─── 点击查询 ────────────────────────────────────────────

  private async clickSearch(page: Page): Promise<void> {
    const selectors = [
      'button:has-text("查询")', 'button:has-text("搜索")', 'text=查询', '[data-e2e="search-btn"]',
    ];

    for (const selector of selectors) {
      try {
        const el = await page.$(selector);
        if (el) {
          const visible = await el.isVisible();
          if (visible) {
            await el.click();
            this.log('info', '已点击查询按钮');
            await this.humanDelay(2000, 3000);
            return;
          }
        }
      } catch {
        continue;
      }
    }

    this.log('warn', '未找到查询按钮，使用页面默认数据');
  }

  // ─── 列映射 ──────────────────────────────────────────────

  /** 根据表头将列数据映射为结算单 */
  mapColumnsToSettlement(headers: string[], cells: string[]): DouyinRawSettlement {
    const getCol = (keywords: string[]): string => {
      for (const kw of keywords) {
        const idx = headers.findIndex((h) => h.includes(kw));
        if (idx >= 0 && idx < cells.length) return cells[idx] ?? '';
      }
      return '';
    };

    return {
      settlementId: getCol(['动账流水号', '结算单号', '结算ID', '单号', '流水号']) || cells[0] || '',
      period: getCol(['动账时间', '结算周期', '账期']) || '',
      settlementDate: getCol(['动账时间', '结算日期', '结算时间', '打款日期']) || '',
      orderAmount: getCol(['订单实付应结', '订单金额', '货款', '动账金额']) || '0',
      serviceFee: getCol(['平台服务费', '服务费', '技术服务费']) || '0',
      commission: getCol(['佣金', '达人佣金']) || '0',
      deliveryFee: getCol(['运费', '物流费', '配送费']) || '0',
      promotionFee: getCol(['站外推广费', '推广', '广告', '营销']) || '0',
      refundAmount: getCol(['订单退款', '退款', '售后']) || '0',
      otherDeduction: getCol(['招商服务费', '渠道分成', '服务商佣金', '其他', '扣款']) || '0',
      netAmount: getCol(['动账金额', '实结', '结算金额', '到账', '打款金额']) || '0',
      status: getCol(['动账方向', '状态', '结算状态', '打款状态']) || '',
    };
  }

  // ─── 去重 ────────────────────────────────────────────────

  private dedup(records: DouyinRawSettlement[]): DouyinRawSettlement[] {
    const seen = new Set<string>();
    return records.filter((r) => {
      const key = r.settlementId || JSON.stringify(r);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // ─── 数据转换 ────────────────────────────────────────────

  private transformToUnified(raw: DouyinRawSettlement): UnifiedSettlement | null {
    try {
      const periodParts = raw.period.split(/[-~至]/);
      const periodFrom = periodParts[0] ? this.parseDouyinDate(periodParts[0].trim()) : new Date();
      const periodTo = periodParts[1] ? this.parseDouyinDate(periodParts[1].trim()) : periodFrom;

      const settlement = {
        platform: 'douyin' as const,
        settlementId: raw.settlementId || `DY-${Date.now()}`,
        settlementPeriod: { from: periodFrom, to: periodTo },
        settlementDate: raw.settlementDate ? this.parseDouyinDate(raw.settlementDate) : new Date(),
        grossAmount: this.parseAmount(raw.orderAmount),
        commission: this.parseAmount(raw.commission),
        serviceFee: this.parseAmount(raw.serviceFee),
        deliveryFee: this.parseAmount(raw.deliveryFee),
        promotionDeduction: this.parseAmount(raw.promotionFee),
        refundDeduction: this.parseAmount(raw.refundAmount),
        otherDeduction: this.parseAmount(raw.otherDeduction),
        netAmount: this.parseAmount(raw.netAmount),
        paymentStatus: this.mapPaymentStatus(raw.status),
        rawData: raw as unknown as Record<string, unknown>,
        syncedAt: new Date(),
      };

      const result = unifiedSettlementSchema.safeParse(settlement);
      if (!result.success) {
        this.log('warn', `结算单校验失败: ${result.error.issues[0]?.message}`);
        return null;
      }

      return result.data;
    } catch {
      this.log('warn', `转换失败: ${JSON.stringify(raw).slice(0, 100)}`);
      return null;
    }
  }

  /** 解析抖店日期格式 */
  parseDouyinDate(dateStr: string): Date {
    const cleaned = dateStr.replace(/[.\/]/g, '-').trim();
    const date = new Date(cleaned);
    return isNaN(date.getTime()) ? new Date() : date;
  }

  /** 映射支付状态 */
  mapPaymentStatus(status: string): 'pending' | 'paid' | 'matched' {
    const lower = status.toLowerCase();
    if (lower.includes('已打款') || lower.includes('已结算') || lower.includes('paid') || lower.includes('已到账')) {
      return 'paid';
    }
    if (lower.includes('已匹配') || lower.includes('matched')) {
      return 'matched';
    }
    if (lower.includes('收入') || lower.includes('支出') || lower.includes('入账') || lower.includes('出账')) {
      return 'paid';
    }
    return 'pending';
  }

  /** 解析金额字符串 */
  parseAmount(str: string): number {
    if (!str || str === '-' || str === '--') return 0;
    const cleaned = str.replace(/[,，¥￥\s元]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }

  /** 格式化日期为 YYYY-MM-DD */
  private formatDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
}
