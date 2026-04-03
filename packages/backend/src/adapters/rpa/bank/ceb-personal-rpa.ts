/**
 * CebPersonalRPA — 光大银行个人网银 RPA
 *
 * 目标：登录光大个人网银 → 查询流水 → 提取 → 转换为 UnifiedTransaction
 *
 * 光大"点阳光"个人网银（Day 4 实测确认）：
 * - 登录URL: https://e.cebbank.com/per/prePerlogin.do?_locale=zh_CN
 * - 表单提交: POST → perlogin1.do
 * - 用户名: input#skey (name=LoginName)
 * - 密码: input#powerpassForLogin (父元素 FAKESECEDITBOX1 安全控件)
 * - 登录按钮: p.loginbtn (onclick="judgePriPolicy()")
 * - 无图形验证码（首次登录可能触发短信验证）
 * - 右侧直接是密码登录，无需切换标签页
 *
 * ⚠️ 绝对只读：只查询流水，不做任何交易操作
 */
import type { Page, Frame } from 'playwright';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as XLSX from 'xlsx';
import { BankRPA, type BankRPAConfig } from './bank-rpa.js';
import type { UnifiedTransaction, CollectParams } from '../schemas.js';
import { unifiedTransactionSchema } from '../schemas.js';
import { RPACollectError } from '../base-platform-rpa.js';

/** 光大网银登录 URL（2026-04 实测有效） */
const CEB_LOGIN_URL = 'https://e.cebbank.com/per/prePerlogin.do?_locale=zh_CN';

/** 光大专属禁止 URL 模式 */
const CEB_FORBIDDEN = [
  'transferAcc',      // 转账
  'quickPay',         // 快捷支付
  'fundTrade',        // 基金交易
  'wealthManage',     // 理财购买
  'creditApply',      // 信用卡申请
  'loanApply',        // 贷款
  'batchTrans',       // 批量转账
];

// ─── 光大网银原始字段 ──────────────────────────────────────

interface CebRawTransaction {
  /** 交易日期 */
  date: string;
  /** 摘要/备注 */
  summary: string;
  /** 支出金额 */
  expense: string;
  /** 收入金额 */
  income: string;
  /** 余额 */
  balance: string;
  /** 对方户名 */
  counterparty: string;
  /** 交易流水号 */
  reference: string;
}

export class CebPersonalRPA extends BankRPA {
  constructor(
    config: Omit<BankRPAConfig, 'bankId' | 'extraForbiddenPatterns'>,
  ) {
    super({
      ...config,
      bankId: 'ceb_personal',
      extraForbiddenPatterns: CEB_FORBIDDEN,
    });
  }

  // ─── 登录流程（Day 4 实测校准）──────────────────────────

  protected async doLogin(page: Page): Promise<void> {
    this.log('info', '开始登录光大个人网银');

    try {
      // 1. 打开登录页
      await page.goto(CEB_LOGIN_URL, { waitUntil: 'networkidle', timeout: 30_000 });
      await this.humanDelay(1000, 2000);

      // 2. 填写用户名（#skey, name=LoginName）
      const usernameSelector = '#skey';
      const usernameEl = await page.$(usernameSelector);
      if (!usernameEl) {
        throw new RPACollectError('找不到用户名输入框 #skey', 'login');
      }
      await page.fill(usernameSelector, this.loginId);
      this.log('info', '用户名已填写');
      await this.humanDelay(300, 800);

      // 3. 填写密码（#powerpassForLogin, FAKESECEDITBOX1 安全控件内）
      //    安全控件拦截了 fill()，必须用逐键输入模拟真实键盘
      const passwordSelector = '#powerpassForLogin';
      const passwordEl = await page.$(passwordSelector);
      if (!passwordEl) {
        throw new RPACollectError('找不到密码输入框 #powerpassForLogin', 'login');
      }
      await passwordEl.click();
      await this.humanDelay(200, 400);
      // 逐个字符输入，模拟人类打字节奏
      for (const char of this.password) {
        await page.keyboard.press(char);
        await this.humanDelay(50, 150);
      }
      this.log('info', '密码已逐键输入');
      await this.humanDelay(300, 800);

      // 4. 点击登录按钮（p.loginbtn, onclick=judgePriPolicy()）
      const loginBtnSelector = 'p.loginbtn';
      const loginBtn = await page.$(loginBtnSelector);
      if (!loginBtn) {
        throw new RPACollectError('找不到登录按钮 p.loginbtn', 'login');
      }
      await page.click(loginBtnSelector);
      this.log('info', '登录按钮已点击，等待响应...');

      // 5. 等待页面跳转或错误提示
      await this.humanDelay(3000, 5000);

      // 6. 检查登录错误
      const errorDiv = await page.$('#exceptionDiv4priPolicy');
      if (errorDiv) {
        const isVisible = await errorDiv.isVisible();
        if (isVisible) {
          const errorText = await errorDiv.textContent();
          throw new RPACollectError(`登录失败: ${(errorText ?? '').trim()}`, 'login');
        }
      }

      // 7. 检查是否需要短信验证
      await this.handleSmsVerification(page);

      // 8. 验证登录成功
      const loggedIn = await this.isLoggedIn(page);
      if (!loggedIn) {
        // 可能页面还在加载，再等一下
        await this.humanDelay(3000, 5000);
        const retryLoggedIn = await this.isLoggedIn(page);
        if (!retryLoggedIn) {
          throw new RPACollectError('登录后未检测到已登录状态，可能密码错误或需要短信验证', 'login');
        }
      }

      this.log('info', '光大网银登录成功');
    } catch (err) {
      if (err instanceof RPACollectError) throw err;
      throw new RPACollectError(
        `登录失败: ${err instanceof Error ? err.message : String(err)}`,
        'login',
      );
    }
  }

  // ─── 登录状态检查 ────────────────────────────────────────

  protected async isLoggedIn(page: Page): Promise<boolean> {
    try {
      // 如果当前在空白页，先导航到网银主页测试 Cookie 是否有效
      const currentUrl = page.url();
      if (currentUrl === 'about:blank' || currentUrl === '') {
        await page.goto('https://e.cebbank.com/per/perwelcome.do', {
          waitUntil: 'networkidle',
          timeout: 15_000,
        });
        await new Promise(r => setTimeout(r, 2000));
      }

      // 如果被重定向回登录页，说明 Cookie 无效
      const url = page.url();
      if (url.includes('prePerlogin') || url.includes('login.do')) return false;

      // 检查已登录页面元素
      const indicators = [
        'text=我的账户',
        'text=账户查询',
        'text=交易明细',
        'text=安全退出',
        'text=转账汇款',
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

      return false;
    } catch {
      return false;
    }
  }

  // ─── 数据采集 ────────────────────────────────────────────

  protected async doCollect(page: Page, params: CollectParams): Promise<UnifiedTransaction[]> {
    this.log('info', `开始采集流水: ${this.formatDate(params.dateFrom)} ~ ${this.formatDate(params.dateTo)}`);

    try {
      // 1. 导航到流水查询页面（点击"我的账户"→"交易明细查询"）
      await this.navigateToTransactionPage(page);

      // 2. 获取 mainFrame（光大网银数据都在 mainFrame 中）
      const mainFrame = page.frames().find(f => f.name() === 'mainFrame');
      if (!mainFrame) {
        throw new RPACollectError('找不到 mainFrame', 'navigate');
      }
      this.log('info', `mainFrame URL: ${mainFrame.url()}`);

      // 3. 设置查询日期范围（在 mainFrame 中操作）
      await this.setDateRange(mainFrame, params.dateFrom, params.dateTo);

      // 4. 点击查询，等待结果加载
      await this.clickQuery(mainFrame);

      // 5. 优先使用 Excel 导出（比逐页抓取快 10x，数据更准确）
      let rawTransactions: CebRawTransaction[];
      const excelData = await this.tryExportExcel(page, mainFrame);
      if (excelData) {
        rawTransactions = excelData;
        this.log('info', `Excel 导出成功: ${rawTransactions.length} 条`);
      } else {
        // 降级：逐页抓取
        this.log('warn', 'Excel 导出失败，降级为逐页抓取');
        rawTransactions = await this.extractAllPages(mainFrame);
      }

      this.log('info', `提取到 ${rawTransactions.length} 条原始流水`);

      // 6. 转换为 UnifiedTransaction
      const transactions = rawTransactions
        .map((raw) => this.transformToUnified(raw))
        .filter((t): t is UnifiedTransaction => t !== null);

      this.log('info', `转换成功 ${transactions.length} 条（丢弃 ${rawTransactions.length - transactions.length} 条）`);

      return transactions;
    } catch (err) {
      if (err instanceof RPACollectError) throw err;
      throw new RPACollectError(
        `采集失败: ${err instanceof Error ? err.message : String(err)}`,
        'extract',
      );
    }
  }

  // ─── 导航到流水页 ────────────────────────────────────────

  private async navigateToTransactionPage(page: Page): Promise<void> {
    // 光大网银是多 frame 结构（30+ iframe）
    // Step 1: 点击顶部导航 "我的账户"
    const myAccountLink = await page.$('text=我的账户');
    if (myAccountLink) {
      await myAccountLink.click();
      this.log('info', '已点击"我的账户"');
      await this.humanDelay(2000, 3000);
    }

    // Step 2: 在左侧菜单或子菜单中找"交易明细/账户明细"
    // 光大网银用 frame，需要在所有 frame 中搜索
    const allFrames = page.frames();
    let clicked = false;

    // 明细查询的可能入口
    const navTexts = ['交易明细', '账户明细', '明细查询', '交易查询', '活期明细'];

    for (const frame of allFrames) {
      for (const text of navTexts) {
        try {
          const el = await frame.$(`text=${text}`);
          if (el) {
            const visible = await el.isVisible();
            if (visible) {
              await el.click();
              clicked = true;
              this.log('info', `在 frame "${frame.name()}" 中找到并点击了"${text}"`);
              break;
            }
          }
        } catch {
          continue;
        }
      }
      if (clicked) break;
    }

    // Step 3: 如果没直接找到，尝试先在 mainFrame 中找
    if (!clicked) {
      const mainFrame = allFrames.find(f => f.name() === 'mainFrame');
      if (mainFrame) {
        // 在主框架中查找链接
        const links = await mainFrame.$$eval('a', (elements) => {
          return elements
            .filter(el => el.offsetParent !== null)
            .map(el => ({
              text: (el.textContent ?? '').trim(),
              href: el.href || '',
            }));
        });

        for (const link of links) {
          if (link.text.includes('明细') || link.text.includes('交易')) {
            const el = await mainFrame.$(`text=${link.text}`);
            if (el) {
              await el.click();
              clicked = true;
              this.log('info', `在 mainFrame 中点击了"${link.text}"`);
              break;
            }
          }
        }
      }
    }

    if (!clicked) {
      throw new RPACollectError('找不到流水查询入口，可能需要先选择账户', 'navigate');
    }

    await this.humanDelay(2000, 3000);
    this.log('info', '已导航到流水查询页面');
  }

  // ─── 设置日期范围 ────────────────────────────────────────

  private async setDateRange(frame: Frame, from: Date, to: Date): Promise<void> {
    const fromStr = this.formatDate(from);
    const toStr = this.formatDate(to);

    // 光大网银实测：#Bdate1 = 起始日期，#Edate1 = 结束日期
    const startSelectors = ['#Bdate1', 'input[name="Bdate1"]', 'input[name="startDate"]'];
    const endSelectors = ['#Edate1', 'input[name="Edate1"]', 'input[name="endDate"]'];

    for (const selector of startSelectors) {
      const el = await frame.$(selector);
      if (el) {
        await frame.fill(selector, '');
        await frame.fill(selector, fromStr);
        break;
      }
    }

    await this.humanDelay(200, 500);

    for (const selector of endSelectors) {
      const el = await frame.$(selector);
      if (el) {
        await frame.fill(selector, '');
        await frame.fill(selector, toStr);
        break;
      }
    }

    this.log('info', `日期范围: ${fromStr} ~ ${toStr}`);
  }

  // ─── 点击查询 ────────────────────────────────────────────

  private async clickQuery(frame: Frame): Promise<void> {
    const selectors = [
      'input[value="查询"]',
      'text=查询',
      '#queryBtn',
      'a:has-text("查询")',
    ];

    for (const selector of selectors) {
      try {
        const el = await frame.$(selector);
        if (el) {
          const visible = await el.isVisible();
          if (visible) {
            await el.click();
            this.log('info', '已点击查询按钮');
            break;
          }
        }
      } catch {
        continue;
      }
    }

    await this.humanDelay(2000, 4000);
  }

  // ─── 提取表格数据（含分页）──────────────────────────────

  // ─── Excel 导出（优先方式）─────────────────────────────

  private async tryExportExcel(page: Page, frame: Frame): Promise<CebRawTransaction[] | null> {
    try {
      // 监听下载事件
      const downloadPromise = page.waitForEvent('download', { timeout: 15_000 });

      // 点击 Excel 导出按钮
      const excelBtn = await frame.$('a:has-text("Excel清单")');
      if (!excelBtn) {
        this.log('warn', '未找到 Excel 导出按钮');
        return null;
      }

      await excelBtn.click();
      this.log('info', '已点击 Excel 导出，等待下载...');

      const download = await downloadPromise;
      const downloadDir = path.join(this.config.dataDir, 'downloads');
      fs.mkdirSync(downloadDir, { recursive: true });

      const filename = `ceb_${Date.now()}.xls`;
      const filepath = path.join(downloadDir, filename);
      await download.saveAs(filepath);
      this.log('info', `Excel 已下载: ${filename}`);

      // 解析 Excel（光大格式：前 9 行是标题头，第 10 行是列名）
      const workbook = XLSX.readFile(filepath);
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) {
        this.log('warn', 'Excel 文件无工作表');
        return null;
      }

      const sheet = workbook.Sheets[sheetName]!;
      const allRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });

      // 找到表头行（包含"交易日期"的行）
      let headerIdx = -1;
      for (let i = 0; i < Math.min(allRows.length, 20); i++) {
        const row = allRows[i];
        if (Array.isArray(row) && row.some(cell => String(cell) === '交易日期')) {
          headerIdx = i;
          break;
        }
      }

      if (headerIdx === -1) {
        this.log('warn', 'Excel 中未找到表头行');
        return null;
      }

      // 数据从表头下一行开始
      const dataRows = allRows.slice(headerIdx + 1);
      this.log('info', `Excel 解析: ${dataRows.length} 数据行（表头在第 ${headerIdx} 行）`);

      // 光大 Excel 列顺序（实测确认）：
      // [0]交易日期  [1]交易时间  [2]支出金额  [3]存入金额  [4]账户余额  [5]对方账号  [6]对方户名  [7]摘要
      return dataRows
        .filter((row) => Array.isArray(row) && row.length >= 5 && String(row[0]).match(/^\d{4}-/))
        .map((row) => {
          const cells = row as unknown[];
          return {
            date: String(cells[0] ?? ''),
            summary: String(cells[7] ?? ''),
            expense: String(cells[2] ?? ''),
            income: String(cells[3] ?? ''),
            balance: String(cells[4] ?? ''),
            counterparty: String(cells[6] ?? ''),
            reference: String(cells[5] ?? ''),
          };
        });
    } catch (err) {
      this.log('warn', `Excel 导出失败: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  // ─── 逐页抓取（降级方式）────────────────────────────────

  private async extractAllPages(frame: Frame): Promise<CebRawTransaction[]> {
    const allRecords: CebRawTransaction[] = [];
    const seenKeys = new Set<string>();
    let pageNum = 1;
    let consecutiveDuplicatePages = 0;

    while (true) {
      this.log('info', `提取第 ${pageNum} 页数据`);

      const records = await this.extractCurrentPage(frame);

      // 去重：用 日期+金额+对手+摘要 组合做唯一键
      let newRecordsCount = 0;
      for (const record of records) {
        const key = `${record.date}|${record.expense}|${record.income}|${record.counterparty}|${record.summary}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          allRecords.push(record);
          newRecordsCount++;
        }
      }

      this.log('info', `新增 ${newRecordsCount} 条（去重后），累计 ${allRecords.length} 条`);

      // 如果整页都是重复数据，说明已翻到头了
      if (newRecordsCount === 0) {
        consecutiveDuplicatePages++;
        if (consecutiveDuplicatePages >= 2) {
          this.log('info', '连续2页无新数据，停止翻页');
          break;
        }
      } else {
        consecutiveDuplicatePages = 0;
      }

      const hasNext = await this.goToNextPage(frame);
      if (!hasNext) break;

      pageNum++;
      await this.humanDelay(1000, 2000);

      if (pageNum > 50) {
        this.log('warn', '已达 50 页上限，停止翻页');
        break;
      }
    }

    return allRecords;
  }

  private async extractCurrentPage(frame: Frame): Promise<CebRawTransaction[]> {
    // 光大网银实测：table.table1.txt02.txt_zt
    // 表头：交易日期, 交易时间, 支出金额, 存入金额, 账户余额, 对方账号, 对方户名, 摘要
    const tableSelectors = [
      'table.table1',
      'table.txt_zt',
      'table.shouzhi',
    ];

    let tableSelector: string | null = null;
    for (const sel of tableSelectors) {
      const el = await frame.$(sel);
      if (el) {
        tableSelector = sel;
        break;
      }
    }

    if (!tableSelector) {
      this.log('warn', '未找到流水表格');
      return [];
    }

    // 提取所有行（跳过表头）
    const rows = await frame.$$eval(`${tableSelector} tr`, (trs) => {
      // 跳过第一行（表头）
      return trs.slice(1).map((tr) => {
        const cells = tr.querySelectorAll('td');
        const result: string[] = [];
        cells.forEach((cell: { textContent: string | null }) => result.push((cell.textContent ?? '').trim()));
        return result;
      });
    });

    this.log('info', `表格行数: ${rows.length}`);

    // 光大网银列顺序（实测确认）：
    // [0]交易日期  [1]交易时间  [2]支出金额  [3]存入金额  [4]账户余额  [5]对方账号  [6]对方户名  [7]摘要
    return rows
      .filter((cells) => cells.length >= 5 && cells[0] !== '')
      .map((cells) => ({
        date: cells[0] ?? '',
        summary: cells[7] ?? '',       // 摘要在第8列
        expense: cells[2] ?? '',        // 支出金额
        income: cells[3] ?? '',         // 存入金额
        balance: cells[4] ?? '',        // 账户余额
        counterparty: cells[6] ?? '',   // 对方户名
        reference: cells[5] ?? '',      // 对方账号（当流水号用）
      }));
  }

  private async goToNextPage(frame: Frame): Promise<boolean> {
    const nextSelectors = [
      'a:has-text("下一页")',
      'text=下一页',
      'a:has-text(">")',
      '.next-page',
      'a.next',
    ];

    for (const selector of nextSelectors) {
      try {
        const el = await frame.$(selector);
        if (el) {
          const isDisabled = await el.getAttribute('disabled');
          const className = await el.getAttribute('class');
          if (isDisabled || className?.includes('disabled')) return false;

          await el.click();
          await this.humanDelay(1500, 2500);
          return true;
        }
      } catch {
        continue;
      }
    }

    return false;
  }

  // ─── 数据转换 ────────────────────────────────────────────

  private transformToUnified(raw: CebRawTransaction): UnifiedTransaction | null {
    try {
      const incomeAmount = this.parseAmount(raw.income);
      const expenseAmount = this.parseAmount(raw.expense);

      const amount = incomeAmount > 0 ? incomeAmount : -expenseAmount;
      const direction: 'inflow' | 'outflow' = amount >= 0 ? 'inflow' : 'outflow';

      const transaction = {
        sourceType: 'bank_rpa' as const,
        sourceAccountId: `ceb-personal-${this.loginId.slice(-4)}`,
        transactionDate: new Date(raw.date.replace(/\//g, '-')),
        amount,
        direction,
        balance: this.parseAmount(raw.balance),
        counterparty: raw.counterparty || '未知',
        description: raw.summary || '',
        bankReference: raw.reference || `CEB-${raw.date}-${amount}-${raw.counterparty.slice(0, 6)}`,
        rawData: raw as unknown as Record<string, unknown>,
        syncedAt: new Date(),
      };

      const result = unifiedTransactionSchema.safeParse(transaction);
      if (!result.success) {
        this.log('warn', `数据校验失败: ${result.error.issues[0]?.message}`);
        return null;
      }

      return result.data;
    } catch {
      this.log('warn', `转换失败: ${JSON.stringify(raw).slice(0, 100)}`);
      return null;
    }
  }

  // ─── 短信验证处理 ────────────────────────────────────────

  private async handleSmsVerification(page: Page): Promise<void> {
    const smsIndicators = [
      'text=短信验证',
      'text=验证码已发送',
      'text=请输入短信验证码',
      'text=动态密码',
      '#smsCode',
      '#otpCode',
    ];

    let smsRequired = false;
    for (const selector of smsIndicators) {
      try {
        const el = await page.$(selector);
        if (el) {
          const visible = await el.isVisible();
          if (visible) {
            smsRequired = true;
            break;
          }
        }
      } catch {
        continue;
      }
    }

    if (!smsRequired) return;

    this.log('warn', '触发短信验证！请在浏览器中手动输入验证码（60秒超时）');

    // 等待页面跳转（用户手动完成验证后页面会变化）
    try {
      await page.waitForURL((url) => !url.toString().includes('prePerlogin'), {
        timeout: 60_000,
      });
    } catch {
      throw new RPACollectError('短信验证超时（60秒），请重试', 'login');
    }
  }

  // ─── 工具方法 ────────────────────────────────────────────

  private parseAmount(str: string): number {
    if (!str || str === '-' || str === '--') return 0;
    const cleaned = str.replace(/[,，\s]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }

  private formatDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
}
