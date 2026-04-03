/**
 * MeituanRPA — 美团商家后台 RPA（结算单采集）
 *
 * 采集策略：导出 Excel/CSV → 解析 → 转换为 UnifiedSettlement
 * 导出比 API 拦截 / DOM 抓取稳定 10x：不怕页面改版、不需翻页、数据完整
 *
 * 美团商家后台（shanggou.meituan.com）：
 * - 登录URL: https://epassport.meituan.com/account/unitivelogin
 * - 登录方式: 手机号 + 短信验证码
 * - 结算路径: 财务管理 → 结算明细 / 账单管理
 * - 导出按钮: 页面"导出"/"下载"按钮
 *
 * ⚠️ 绝对只读：只查询结算数据，不做任何订单/商品/营销操作
 */
import type { Page, Frame } from 'playwright';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as XLSX from 'xlsx';
import { PlatformRPA, type PlatformRPAConfig } from './platform-rpa.js';
import type { UnifiedSettlement, CollectParams } from '../schemas.js';
import { unifiedSettlementSchema } from '../schemas.js';
import { RPACollectError, type DryRunResult } from '../base-platform-rpa.js';

/** 美团统一登录 URL */
const MEITUAN_LOGIN_URL = 'https://epassport.meituan.com/account/unitivelogin';

/** 美团闪购/商家后台首页 */
const MEITUAN_HOME_URL = 'https://shangoue.meituan.com';

/** 美团结算管理 URL（登录后确认实际路径） */
const MEITUAN_SETTLEMENT_URL = 'https://shangoue.meituan.com/finance/settlement';

/** 美团专属禁止 URL 模式 */
const MEITUAN_FORBIDDEN = [
  '/order/operate',          // 订单操作
  '/order/confirm',          // 确认订单
  '/order/cancel',           // 取消订单
  '/product/online',         // 商品上架
  '/product/offline',        // 商品下架
  '/product/edit',           // 编辑商品
  '/product/create',         // 创建商品
  '/marketing/create',       // 创建活动
  '/marketing/update',       // 修改活动
  '/coupon/create',          // 创建优惠券
  '/withdraw',               // 提现
  '/transfer',               // 转账
  '/reply',                  // 回复评价
  '/waimai/act',             // 外卖活动操作
];

// ─── 美团原始结算数据 ──────────────────────────────────────

interface MeituanRawSettlement {
  /** 结算单号 */
  settlementId: string;
  /** 结算周期 */
  period: string;
  /** 结算日期 */
  settlementDate: string;
  /** 订单金额（元） */
  orderAmount: string;
  /** 平台服务费/佣金（元） */
  serviceFee: string;
  /** 技术服务费（元） */
  techFee: string;
  /** 配送费（元） */
  deliveryFee: string;
  /** 活动补贴（元） */
  activitySubsidy: string;
  /** 商家活动支出（元） */
  merchantActivity: string;
  /** 退款金额（元） */
  refundAmount: string;
  /** 其他扣款（元） */
  otherDeduction: string;
  /** 实际结算金额（元） */
  netAmount: string;
  /** 结算状态 */
  status: string;
}

export class MeituanRPA extends PlatformRPA {
  constructor(
    config: Omit<PlatformRPAConfig, 'platformId' | 'extraForbiddenPatterns'>,
  ) {
    super({
      ...config,
      platformId: 'meituan',
      extraForbiddenPatterns: MEITUAN_FORBIDDEN,
    });
  }

  // ─── 登录流程（手机号 + 短信验证码）─────────────────────

  protected async doLogin(page: Page): Promise<void> {
    this.log('info', '开始登录美团商家后台');

    try {
      // 访问商家后台首页，触发登录跳转
      await page.goto(MEITUAN_HOME_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await this.humanDelay(3000, 5000);

      const currentUrl = page.url();
      this.log('info', `当前页面: ${currentUrl}`);

      // 检查是否跳转到了登录页（shangoue 可能跳转到多种登录页）
      const needsLogin = currentUrl.includes('login') || currentUrl.includes('epassport')
        || currentUrl.includes('bizaccount') || currentUrl.includes('logon');

      if (!needsLogin) {
        this.log('info', '可能已经登录，跳过登录流程');
        return;
      }

      this.log('info', `登录页面: ${currentUrl}`);

      // 登录表单可能在主页面或 iframe 中
      let loginFrame: Page | Frame = page;
      try {
        await page.waitForSelector('input', { timeout: 10_000 });
      } catch {
        this.log('info', '主页面未找到 input，检查 iframe...');
        const frames = page.frames();
        this.log('info', `页面有 ${frames.length} 个 frame`);
        for (const frame of frames) {
          const frameUrl = frame.url();
          this.log('info', `  frame: ${frameUrl.slice(0, 80)}`);
          if (frameUrl.includes('epassport') || frameUrl.includes('login')) {
            try {
              await frame.waitForSelector('input', { timeout: 5_000 });
              loginFrame = frame;
              this.log('info', '在 iframe 中找到登录表单');
              break;
            } catch { continue; }
          }
        }
        if (loginFrame === page) {
          await page.waitForSelector('input, iframe', { timeout: 10_000 });
        }
      }
      await this.humanDelay(1000, 2000);

      const lf = loginFrame as Page;
      await this.switchToSmsLogin(lf);

      // 填写账号（如果有账号输入框）
      const accountInput = await this.findAccountInput(lf);
      if (accountInput) {
        const account = process.env['MEITUAN_ACCOUNT'] ?? '';
        if (account) {
          await accountInput.click();
          await this.humanDelay(200, 400);
          await accountInput.fill(account);
          this.log('info', `账号已填写: ${account}`);
          await this.humanDelay(300, 600);
        }
      }

      const phoneInput = await this.findPhoneInput(lf);
      if (!phoneInput) {
        throw new RPACollectError('找不到手机号输入框', 'login');
      }
      await phoneInput.click();
      await this.humanDelay(200, 400);
      await phoneInput.fill(this.phone);
      this.log('info', `手机号已填写: ${this.phone.slice(0, 3)}****${this.phone.slice(-4)}`);
      await this.humanDelay(500, 1000);

      // 勾选隐私协议复选框（如果存在）
      await this.checkPrivacyAgreement(lf);

      await this.clickGetSmsCode(lf);

      this.log('warn', '⏳ 请在浏览器中手动输入短信验证码并点击登录（180秒超时）');

      try {
        await page.waitForURL(
          (url) => {
            const urlStr = url.toString();
            return (
              urlStr.includes('waimaie.meituan.com') ||
              urlStr.includes('shangoue.meituan.com') ||
              urlStr.includes('ecom.meituan.com') ||
              urlStr.includes('e.meituan.com')
            ) && !urlStr.includes('login') && !urlStr.includes('epassport') && !urlStr.includes('bizaccount') && !urlStr.includes('logon/error');
          },
          { timeout: 180_000 },
        );
      } catch {
        throw new RPACollectError('登录超时（180秒），请重试', 'login');
      }

      await this.humanDelay(2000, 3000);

      const loggedIn = await this.isLoggedIn(page);
      if (!loggedIn) {
        throw new RPACollectError('登录后未检测到已登录状态', 'login');
      }

      this.log('info', '美团商家后台登录成功');
    } catch (err) {
      if (err instanceof RPACollectError) throw err;
      throw new RPACollectError(
        `登录失败: ${err instanceof Error ? err.message : String(err)}`,
        'login',
      );
    }
  }

  private async switchToSmsLogin(page: Page): Promise<void> {
    const selectors = [
      'text=验证码登录', 'text=短信登录', 'text=手机验证码登录',
      'a:has-text("验证码登录")', 'span:has-text("验证码登录")',
    ];

    for (const selector of selectors) {
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
      } catch { continue; }
    }

    this.log('info', '未找到验证码登录切换标签，可能已是默认模式');
  }

  /** 勾选隐私协议复选框 */
  private async checkPrivacyAgreement(page: Page): Promise<void> {
    const selectors = [
      'input[type="checkbox"]',
      '[class*="checkbox"]',
      '[class*="agree"]',
      'text=我已阅读',
    ];

    for (const selector of selectors) {
      try {
        const el = await page.$(selector);
        if (el) {
          const visible = await el.isVisible();
          if (visible) {
            // 检查是否已勾选
            const checked = await el.isChecked?.().catch(() => false);
            if (!checked) {
              await el.click();
              this.log('info', '已勾选隐私协议');
              await this.humanDelay(200, 400);
            }
            return;
          }
        }
      } catch { continue; }
    }
  }

  private async findAccountInput(page: Page): Promise<ReturnType<Page['$']> extends Promise<infer T> ? T : never> {
    const selectors = [
      'input[placeholder*="账号"]', 'input[placeholder*="用户名"]',
      'input[name="account"]', 'input[name="username"]', 'input[name="loginName"]',
      'input[placeholder*="account"]', 'input[placeholder*="user"]',
    ];

    for (const selector of selectors) {
      try {
        const el = await page.$(selector);
        if (el) {
          const visible = await el.isVisible();
          if (visible) return el;
        }
      } catch { continue; }
    }

    return null;
  }

  private async findPhoneInput(page: Page): Promise<ReturnType<Page['$']> extends Promise<infer T> ? T : never> {
    const selectors = [
      'input[placeholder*="手机"]', 'input[placeholder*="phone"]',
      'input[name="mobile"]', 'input[name="phone"]', 'input[name="account"]',
      'input[type="tel"]', '.login-form input[type="text"]',
    ];

    for (const selector of selectors) {
      try {
        const el = await page.$(selector);
        if (el) {
          const visible = await el.isVisible();
          if (visible) return el;
        }
      } catch { continue; }
    }

    return null;
  }

  private async clickGetSmsCode(page: Page): Promise<void> {
    const selectors = [
      'text=获取验证码', 'text=发送验证码', 'button:has-text("验证码")',
    ];

    for (const selector of selectors) {
      try {
        const el = await page.$(selector);
        if (el) {
          const visible = await el.isVisible();
          if (visible) {
            await el.click();
            this.log('info', '已点击获取验证码');
            return;
          }
        }
      } catch { continue; }
    }

    this.log('warn', '未找到获取验证码按钮，请手动点击');
  }

  // ─── 登录状态检查 ────────────────────────────────────────

  protected async isLoggedIn(page: Page): Promise<boolean> {
    try {
      const url = page.url();
      if (!url.includes('meituan.com') || url.includes('about:blank')) {
        this.log('info', '导航到美团商家后台检测登录状态...');
        await page.goto(MEITUAN_HOME_URL, { waitUntil: 'domcontentloaded', timeout: 15_000 });
        await new Promise((r) => setTimeout(r, 3000));
      }

      const currentUrl = page.url();
      if (currentUrl.includes('epassport') || currentUrl.includes('/login')) return false;

      const bodyText = await page.textContent('body').catch(() => '') ?? '';
      if (bodyText.includes('选择门店') || bodyText.includes('请选择')) {
        this.log('info', '已登录，需要选择门店');
        await this.handleShopSelection(page);
        return true;
      }

      const indicators = [
        'text=首页', 'text=订单管理', 'text=菜品管理', 'text=商品管理',
        'text=财务管理', 'text=经营数据',
        '[class*="sidebar"]', '[class*="nav-menu"]', '[class*="shop-name"]',
      ];

      for (const selector of indicators) {
        try {
          const el = await page.$(selector);
          if (el) {
            const visible = await el.isVisible();
            if (visible) return true;
          }
        } catch { continue; }
      }

      return (currentUrl.includes('waimaie.meituan.com') || currentUrl.includes('shangoue.meituan.com') || currentUrl.includes('ecom.meituan.com')) && !currentUrl.includes('login') && !currentUrl.includes('bizaccount') && !currentUrl.includes('logon/error');
    } catch {
      return false;
    }
  }

  private async handleShopSelection(page: Page): Promise<void> {
    this.log('info', '进入门店选择流程');

    const selectors = [
      'text=进入', 'text=确定', 'text=下一步',
      'button:has-text("进入")', 'button:has-text("确定")',
      '[class*="shop-item"]:first-child',
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
            break;
          }
        }
      } catch { continue; }
    }

    this.log('info', `门店选择完成，当前 URL: ${page.url()}`);
  }

  // ─── dry-run 诊断 ────────────────────────────────────────

  protected async doDryRun(page: Page): Promise<DryRunResult> {
    const logs: string[] = [];
    let reachedSettlement = false;
    let exportButtonFound = false;
    let matchedSelector: string | undefined;
    let screenshotPath: string | undefined;

    try {
      logs.push('正在导航到结算管理页面...');
      await this.navigateToSettlement(page);
      reachedSettlement = true;
      logs.push(`已到达结算页面: ${page.url()}`);

      await this.humanDelay(3000, 5000);

      try {
        screenshotPath = await this.takeDryRunScreenshot(page, 'meituan');
        logs.push(`截图已保存: ${screenshotPath}`);
      } catch (screenshotErr) {
        logs.push(`截图失败（不影响诊断）: ${screenshotErr instanceof Error ? screenshotErr.message.slice(0, 80) : String(screenshotErr)}`);
      }

      const exportSelectors = [
        'button:has-text("导出")',
        'button:has-text("下载")',
        'button:has-text("导出Excel")',
        'button:has-text("导出明细")',
        'button:has-text("导出数据")',
        'button:has-text("下载账单")',
        'a:has-text("导出")',
        'a:has-text("下载")',
        '[class*="export"] button',
        '[class*="download"] button',
        'text=导出',
        'text=下载明细',
        'text=下载账单',
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
    this.log('info', `开始采集美团结算单: ${this.formatDate(params.dateFrom)} ~ ${this.formatDate(params.dateTo)}`);

    try {
      // 1. 导航到结算管理
      await this.navigateToSettlement(page, params.dateFrom, params.dateTo);

      // 2. 确保日期筛选生效
      await this.ensureDateFilter(page, params.dateFrom, params.dateTo);

      // 3. 点击查询
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

  private async exportAndParse(page: Page): Promise<MeituanRawSettlement[]> {
    const exportBtn = await this.findExportButton(page);
    if (!exportBtn) {
      throw new RPACollectError('找不到导出按钮，请确认页面已加载结算管理', 'extract');
    }

    const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });

    await exportBtn.click();
    this.log('info', '已点击导出按钮，等待下载...');

    await this.handleExportConfirm(page);

    const download = await downloadPromise;

    const downloadDir = path.join(this.config.dataDir, 'downloads');
    fs.mkdirSync(downloadDir, { recursive: true });

    const suggestedName = download.suggestedFilename();
    const ext = path.extname(suggestedName) || '.xlsx';
    const filename = `meituan_${Date.now()}${ext}`;
    const filepath = path.join(downloadDir, filename);
    await download.saveAs(filepath);
    this.log('info', `文件已下载: ${filename}（原名: ${suggestedName}）`);

    if (ext === '.csv' || suggestedName.endsWith('.csv')) {
      return this.parseCsv(filepath);
    }
    return this.parseExcel(filepath);
  }

  private async findExportButton(page: Page): Promise<Awaited<ReturnType<Page['$']>>> {
    const selectors = [
      'button:has-text("导出")', 'button:has-text("下载")',
      'button:has-text("导出Excel")', 'button:has-text("导出明细")',
      'button:has-text("导出数据")', 'button:has-text("下载账单")',
      'a:has-text("导出")', 'a:has-text("下载")',
      '[class*="export"] button', '[class*="download"] button',
      'text=导出', 'text=下载明细', 'text=下载账单',
    ];

    for (const selector of selectors) {
      try {
        const el = await page.$(selector);
        if (el) {
          const visible = await el.isVisible();
          if (visible) return el;
        }
      } catch { continue; }
    }
    return null;
  }

  private async handleExportConfirm(page: Page): Promise<void> {
    await this.humanDelay(500, 1000);
    const confirmSelectors = [
      '.ant-modal button:has-text("确定")',
      '.ant-modal button:has-text("确认")',
      '.ant-modal button:has-text("导出")',
      '[class*="modal"] button:has-text("确定")',
      '[class*="dialog"] button:has-text("确定")',
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
      } catch { continue; }
    }
  }

  /** 解析 Excel 文件 */
  parseExcel(filepath: string): MeituanRawSettlement[] {
    const workbook = XLSX.readFile(filepath);
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      this.log('warn', 'Excel 文件无工作表');
      return [];
    }

    const sheet = workbook.Sheets[sheetName]!;
    const allRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });

    const headerIdx = this.findHeaderRow(allRows);
    if (headerIdx === -1) {
      this.log('warn', 'Excel 中未找到表头行');
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
  parseCsv(filepath: string): MeituanRawSettlement[] {
    const content = fs.readFileSync(filepath, 'utf-8');
    const lines = content.split('\n').map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2) return [];

    const headerIdx = lines.findIndex((line) =>
      line.includes('结算') || line.includes('账单') || line.includes('金额') || line.includes('配送'),
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

  private findHeaderRow(rows: unknown[][]): number {
    const keywords = ['结算', '账单', '配送', '订单', '金额', '佣金', '服务费', '退款'];
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
    try {
      let url = MEITUAN_SETTLEMENT_URL;
      if (dateFrom && dateTo) {
        const fromStr = this.formatDate(dateFrom);
        const toStr = this.formatDate(dateTo);
        const sep = url.includes('?') ? '&' : '?';
        url = `${url}${sep}startDate=${fromStr}&endDate=${toStr}&begin=${fromStr}&end=${toStr}`;
        this.log('info', `URL参数注入日期: ${fromStr} ~ ${toStr}`);
      }
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await this.humanDelay(1000, 2000);

      const hasContent = await page.$('table, [class*="table"], [class*="settlement"], [class*="bill"], button:has-text("导出")');
      if (hasContent) {
        this.log('info', '直接导航到结算页面成功');
        return;
      }
    } catch {
      this.log('info', '直接导航失败，尝试通过菜单');
    }

    const financeMenuSelectors = [
      'text=财务管理', 'text=财务', 'text=资金管理', 'a:has-text("财务")',
    ];

    for (const selector of financeMenuSelectors) {
      try {
        const el = await page.$(selector);
        if (el) {
          const visible = await el.isVisible();
          if (visible) {
            await el.click();
            this.log('info', '已点击"财务管理"菜单');
            await this.humanDelay(2000, 3000);
            break;
          }
        }
      } catch { continue; }
    }

    const settlementMenuSelectors = [
      'text=结算明细', 'text=结算管理', 'text=账单管理', 'text=结算单',
      'text=对账单', 'text=账单', 'a:has-text("结算")', 'a:has-text("账单")',
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
            this.log('info', '已点击"结算"子菜单');
            break;
          }
        }
      } catch { continue; }
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

    this.log('info', 'URL日期参数未生效，降级到DatePicker');
    await this.setDateViaDatePicker(page, fromStr, toStr);
  }

  private async isDateFilterApplied(page: Page, fromStr: string, toStr: string): Promise<boolean> {
    try {
      const inputs = await page.$$('input[type="text"], .ant-picker-input input, [class*="date"] input');
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
      '.ant-picker-input input', '[class*="DatePicker"] input', '[class*="date-picker"] input',
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

    const rangeSelectors = ['.ant-picker-range', '[class*="RangePicker"]'];
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

    this.log('warn', '未找到日期筛选器');
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
      'button:has-text("查询")', 'button:has-text("搜索")', 'button:has-text("筛选")', 'text=查询',
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
      } catch { continue; }
    }

    this.log('warn', '未找到查询按钮');
  }

  // ─── 列映射 ──────────────────────────────────────────────

  mapColumnsToSettlement(headers: string[], cells: string[]): MeituanRawSettlement {
    const getCol = (keywords: string[]): string => {
      for (const kw of keywords) {
        const idx = headers.findIndex((h) => h.includes(kw));
        if (idx >= 0 && idx < cells.length) return cells[idx] ?? '';
      }
      return '';
    };

    return {
      settlementId: getCol(['结算单号', '账单号', '单号', '流水号']) || cells[0] || '',
      period: getCol(['结算周期', '账期', '账单周期']) || '',
      settlementDate: getCol(['结算日期', '结算时间', '打款日期', '出账日期']) || '',
      orderAmount: getCol(['订单金额', '营业额', '交易金额', '商品金额']) || '0',
      serviceFee: getCol(['平台服务费', '佣金', '服务费']) || '0',
      techFee: getCol(['技术服务费', '信息服务费']) || '0',
      deliveryFee: getCol(['配送费', '运费', '物流费', '骑手配送费']) || '0',
      activitySubsidy: getCol(['平台补贴', '活动补贴', '美团补贴']) || '0',
      merchantActivity: getCol(['商家活动', '商家优惠', '商户活动支出', '满减']) || '0',
      refundAmount: getCol(['退款', '退款金额', '售后']) || '0',
      otherDeduction: getCol(['其他', '其他扣款', '扣款']) || '0',
      netAmount: getCol(['实结金额', '结算金额', '到账金额', '应结金额', '打款金额']) || '0',
      status: getCol(['状态', '结算状态', '打款状态']) || '',
    };
  }

  // ─── 去重 ────────────────────────────────────────────────

  private dedup(records: MeituanRawSettlement[]): MeituanRawSettlement[] {
    const seen = new Set<string>();
    return records.filter((r) => {
      const key = r.settlementId || JSON.stringify(r);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // ─── 数据转换 ────────────────────────────────────────────

  private transformToUnified(raw: MeituanRawSettlement): UnifiedSettlement | null {
    try {
      const periodParts = raw.period.split(/[-~至到]/);
      const periodFrom = periodParts[0] ? this.parseMeituanDate(periodParts[0].trim()) : new Date();
      const periodTo = periodParts[1] ? this.parseMeituanDate(periodParts[1].trim()) : periodFrom;

      const commission = this.parseAmount(raw.serviceFee) + this.parseAmount(raw.techFee);
      const promotion = Math.max(0, this.parseAmount(raw.merchantActivity) - this.parseAmount(raw.activitySubsidy));

      const settlement = {
        platform: 'meituan' as const,
        settlementId: raw.settlementId || `MT-${Date.now()}`,
        settlementPeriod: { from: periodFrom, to: periodTo },
        settlementDate: raw.settlementDate ? this.parseMeituanDate(raw.settlementDate) : new Date(),
        grossAmount: this.parseAmount(raw.orderAmount),
        commission,
        serviceFee: this.parseAmount(raw.serviceFee),
        deliveryFee: this.parseAmount(raw.deliveryFee),
        promotionDeduction: promotion,
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

  /** 解析美团日期（支持多种格式含紧凑格式 20260301） */
  parseMeituanDate(dateStr: string): Date {
    let cleaned = dateStr.replace(/[.\/]/g, '-').trim();
    if (/^\d{8}$/.test(cleaned)) {
      cleaned = `${cleaned.slice(0, 4)}-${cleaned.slice(4, 6)}-${cleaned.slice(6, 8)}`;
    }
    const date = new Date(cleaned);
    return isNaN(date.getTime()) ? new Date() : date;
  }

  /** 映射支付状态 */
  mapPaymentStatus(status: string): 'pending' | 'paid' | 'matched' {
    const lower = status.toLowerCase();
    if (lower.includes('已打款') || lower.includes('已结算') || lower.includes('已到账') || lower.includes('paid') || lower.includes('已出账')) {
      return 'paid';
    }
    if (lower.includes('已匹配') || lower.includes('matched')) {
      return 'matched';
    }
    return 'pending';
  }

  /** 解析金额 */
  parseAmount(str: string): number {
    if (!str || str === '-' || str === '--') return 0;
    const cleaned = str.replace(/[,，¥￥\s元]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }

  private formatDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
}
