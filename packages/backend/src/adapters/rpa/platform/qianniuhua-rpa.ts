/**
 * QianniuhuaRPA — 牵牛花（美团）多店经营数据入口 RPA
 *
 * 入口：https://qnh.meituan.com/login.html（登录表单）；数据在 home.html + hash 路由
 *
 * Wave 1：
 * - 登录（账号名+密码 或 手机号+短信验证码）
 * - dry-run：进入数据首页并截图，探测「导出/下载」文案
 * - collect：P1 写入一条 page_snapshot 信号（URL/正文摘要/表格行数等），验落盘；明细 SKU 待业务定 DOM 后再扩
 *
 * ⚠️ 只读：禁止导航到下单、改价、投放创建等写操作 URL
 */
import type { Page, Frame, Locator } from 'playwright';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline/promises';
import {
  BasePlatformRPA,
  type DryRunResult,
  RPACollectError,
} from '../base-platform-rpa.js';
import type { CollectParams, UnifiedInventorySignal } from '../schemas.js';

/** 显式登录页，便于稳定找到表单 */
const QNH_LOGIN_PAGE = 'https://qnh.meituan.com/login.html';

/** SPA 壳（勿对带 # 的完整 URL 直接 goto，易 net::ERR_ABORTED） */
const QNH_HOME_SHELL = 'https://qnh.meituan.com/home.html';

/** 数据首页 hash（在 home.html 加载后由脚本设置） */
const QNH_DATA_HASH = '#/data/home/new?fromSource=loginPage';

const QNH_FORBIDDEN = [
  '/order/operate',
  '/order/confirm',
  '/product/online',
  '/product/offline',
  '/marketing/create',
  '/coupon/create',
  '/withdraw',
  '/promotion/create',
];

export interface QianniuhuaRPAConfig {
  dataDir: string;
  encryptionKey: string;
  /** 手机号 + 短信（与美团通行证一致时使用） */
  phone?: string;
  /** 牵牛花「账号名」登录 */
  account?: string;
  password?: string;
  headless?: boolean;
  slowMo?: number;
}

export class QianniuhuaRPA extends BasePlatformRPA<UnifiedInventorySignal> {
  private readonly phone?: string;
  private readonly account?: string;
  private readonly password?: string;

  constructor(config: QianniuhuaRPAConfig) {
    super({
      platformId: 'qianniuhua',
      dataDir: config.dataDir,
      forbiddenUrlPatterns: QNH_FORBIDDEN,
      encryptionKey: config.encryptionKey,
      headless: config.headless ?? false,
      slowMo: config.slowMo ?? 0,
    });
    this.phone = config.phone?.trim() || undefined;
    this.account = config.account?.trim() || undefined;
    this.password = config.password?.trim() || undefined;
  }

  protected async doLogin(page: Page): Promise<void> {
    this.log('info', '开始登录牵牛花');

    if (!this.phone && !(this.account && this.password)) {
      throw new RPACollectError(
        '缺少凭证：.env.rpa 需配置 (QIANNIUHUA_PHONE，可选配 QIANNIUHUA_ACCOUNT) 或 (QIANNIUHUA_ACCOUNT + QIANNIUHUA_PASSWORD)',
        'login',
      );
    }

    if (this.account && !this.password && !this.phone) {
      throw new RPACollectError(
        '已配置 QIANNIUHUA_ACCOUNT 但缺少密码或手机号：请补 QIANNIUHUA_PASSWORD 或 QIANNIUHUA_PHONE',
        'login',
      );
    }

    try {
      await page.goto(QNH_LOGIN_PAGE, {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      });
      await this.humanDelay(2000, 4000);
      await page
        .waitForSelector('input, [role="textbox"]', { timeout: 20_000 })
        .catch(() => {});

      let loginFrame: Page | Frame = page;
      const url0 = page.url();
      const onCredentialHost =
        url0.includes('login.html') ||
        url0.includes('epassport') ||
        url0.includes('bizaccount') ||
        url0.includes('logon');

      if (!onCredentialHost && url0.includes('qnh.meituan.com')) {
        const ok = await this.isLoggedIn(page);
        if (ok) {
          this.log('info', '已在牵牛花登录态，跳过登录表单');
          return;
        }
      }

      try {
        await page.waitForSelector('input', { timeout: 12_000 });
      } catch {
        const frames = page.frames();
        for (const frame of frames) {
          const fu = frame.url();
          if (fu.includes('epassport') || fu.includes('login')) {
            try {
              await frame.waitForSelector('input', { timeout: 5000 });
              loginFrame = frame;
              this.log('info', '在 iframe 中使用登录表单');
              break;
            } catch {
              continue;
            }
          }
        }
      }

      const lf = loginFrame as Page;

      if (this.account && this.password) {
        await this.tryPasswordLogin(lf, page);
      } else if (this.phone) {
        await this.trySmsLogin(lf, page);
      }

      await this.humanDelay(2000, 4000);

      const ok = await this.isLoggedIn(page);
      if (!ok) {
        throw new RPACollectError('登录后未检测到牵牛花已登录状态', 'login');
      }

      this.log('info', '牵牛花登录成功');
    } catch (err) {
      if (err instanceof RPACollectError) throw err;
      throw new RPACollectError(
        `登录失败: ${err instanceof Error ? err.message : String(err)}`,
        'login',
      );
    }
  }

  private async tryPasswordLogin(lf: Page, page: Page): Promise<void> {
    const accIn = await this.findAccountInput(lf);
    if (accIn) {
      await accIn.click();
      await this.humanDelay(200, 400);
      await accIn.fill(this.account!);
      this.log('info', '已填写账号名');
      await this.humanDelay(400, 800);
    }

    const pwdIn = await this.findPasswordInput(lf);
    if (!pwdIn) {
      throw new RPACollectError('找不到密码输入框（页面可能为仅短信登录）', 'login');
    }
    await pwdIn.click();
    await this.humanDelay(200, 400);
    await pwdIn.fill(this.password!);
    this.log('info', '已填写密码');
    await this.humanDelay(400, 800);

    await this.checkPrivacyAgreement(lf, page);
    await this.clickLoginSubmit(lf, page);

    this.log(
      'warn',
      '⏳ 若需短信/扫码二次验证，请同事在 180 秒内于浏览器中完成',
    );

    try {
      await page.waitForURL(
        (u) => {
          const s = u.toString();
          return (
            s.includes('qnh.meituan.com') &&
            !s.includes('epassport') &&
            !s.includes('logon/error')
          );
        },
        { timeout: 180_000 },
      );
    } catch {
      throw new RPACollectError('登录超时（180秒），请检查验证码或风控', 'login');
    }
  }

  private async trySmsLogin(lf: Page, page: Page): Promise<void> {
    await this.switchToSmsLogin(lf, page);

    if (this.account) {
      const accIn = await this.findAccountInput(lf);
      if (accIn) {
        await accIn.click();
        await this.humanDelay(200, 400);
        await accIn.fill(this.account);
        this.log('info', '已填写账号名（短信登录前置）');
        await this.humanDelay(400, 800);
      }
    }

    let phoneLoc = await this.resolvePhoneLocator(lf, page);
    if (!phoneLoc) {
      const deadline = Date.now() + 15_000;
      while (!phoneLoc && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 600));
        phoneLoc = await this.resolvePhoneLocator(lf, page);
      }
    }
    if (!phoneLoc) {
      throw new RPACollectError('找不到手机号输入框', 'login');
    }
    await phoneLoc.click({ timeout: 8000 }).catch(() => {});
    await this.humanDelay(200, 400);
    await phoneLoc.fill(this.phone!);
    this.log(
      'info',
      `手机号已填写: ${this.phone!.slice(0, 3)}****${this.phone!.slice(-4)}`,
    );
    await this.humanDelay(500, 1000);
    await this.checkPrivacyAgreement(lf, page);
    await this.clickGetSmsCode(lf, page);

    const otp = await this.readSmsCodeFromUser();
    if (otp) {
      this.log('info', '已收到验证码输入，写入页面并提交');
      await this.humanDelay(600, 1200);
      let otpLoc = await this.resolveOtpLocator(lf, page);
      if (!otpLoc) {
        const deadline = Date.now() + 10_000;
        while (!otpLoc && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 400));
          otpLoc = await this.resolveOtpLocator(lf, page);
        }
      }
      if (!otpLoc) {
        throw new RPACollectError('找不到短信验证码输入框', 'login');
      }
      await otpLoc.click({ timeout: 8000 }).catch(() => {});
      await this.humanDelay(150, 300);
      await otpLoc.fill(otp);
      await this.humanDelay(400, 800);
      try {
        await this.clickLoginSubmit(lf, page);
      } catch {
        this.log('info', '未匹配到登录按钮，可能已自动提交，等待跳转');
      }
    } else {
      this.log(
        'warn',
        '⏳ 请在浏览器中手动输入验证码并登录（180秒）；或改用终端交互/环境变量 RPA_OTP_CODE',
      );
    }

    try {
      await page.waitForURL(
        (u) => {
          const s = u.toString();
          return (
            s.includes('qnh.meituan.com') &&
            !s.includes('epassport') &&
            !s.includes('logon/error')
          );
        },
        { timeout: 180_000 },
      );
    } catch {
      throw new RPACollectError('登录超时（180秒），请重试', 'login');
    }
  }

  /** 终端粘贴验证码，或环境变量 RPA_OTP_CODE（非 TTY 且无 env 则返回空，走浏览器手输） */
  private async readSmsCodeFromUser(): Promise<string> {
    const fromEnv = process.env['RPA_OTP_CODE']?.trim();
    if (fromEnv) return fromEnv.replace(/\s/g, '');

    if (process.stdin.isTTY && process.stdout.isTTY) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      try {
        const line = await rl.question(
          '短信验证码已发到手机，粘贴后回车（仅数字）: ',
        );
        return line.trim().replace(/\s/g, '');
      } finally {
        rl.close();
      }
    }

    return '';
  }

  /** 主文档 + 全部 iframe，优先在 preferred 所在层查找 */
  private searchRoots(top: Page, preferred: Page | Frame): (Page | Frame)[] {
    const out: (Page | Frame)[] = [];
    const add = (x: Page | Frame) => {
      if (!out.includes(x)) out.push(x);
    };
    add(preferred);
    add(top);
    for (const f of top.frames()) add(f);
    return out;
  }

  private async firstVisibleLocator(
    roots: (Page | Frame)[],
    make: (root: Page | Frame) => Locator,
  ): Promise<Locator | null> {
    for (const root of roots) {
      try {
        const loc = make(root);
        const n = await loc.count();
        for (let i = 0; i < n; i++) {
          const nth = loc.nth(i);
          if (await nth.isVisible().catch(() => false)) return nth;
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  private async resolvePhoneLocator(
    lf: Page | Frame,
    top: Page,
  ): Promise<Locator | null> {
    const roots = this.searchRoots(top, lf);
    const makers: ((root: Page | Frame) => Locator)[] = [
      (r) => r.getByRole('textbox', { name: /手机号|手机号码|联系电话/ }),
      (r) => r.getByLabel(/手机号|手机号码|电话/),
      (r) => r.getByPlaceholder(/手机|电话|请输入|11位|11 位/),
      (r) => r.locator('input[type="tel"]'),
      (r) => r.locator('input[inputmode="numeric"]'),
      (r) => r.locator('input[maxlength="11"]'),
      (r) => r.locator('input[name="mobile"]'),
      (r) => r.locator('input[name="phone"]'),
      (r) => r.locator('input[placeholder*="手机"]'),
    ];
    for (const mk of makers) {
      const hit = await this.firstVisibleLocator(roots, mk);
      if (hit) return hit;
    }
    return null;
  }

  private async resolveOtpLocator(
    lf: Page | Frame,
    top: Page,
  ): Promise<Locator | null> {
    const roots = this.searchRoots(top, lf);
    const makers: ((root: Page | Frame) => Locator)[] = [
      (r) => r.getByRole('textbox', { name: /验证码|动态码/ }),
      (r) => r.getByLabel(/验证码/),
      (r) => r.getByPlaceholder(/验证码|动态码|输入验证码/),
      (r) => r.locator('input[autocomplete="one-time-code"]'),
      (r) => r.locator('input[name="verifyCode"]'),
      (r) => r.locator('input[name="smsCode"]'),
      (r) => r.locator('input[name="code"]'),
      (r) => r.locator('input[maxlength="6"]'),
      (r) => r.locator('input[maxlength="8"]'),
      (r) => r.locator('input[placeholder*="验证码"]'),
    ];
    for (const mk of makers) {
      const hit = await this.firstVisibleLocator(roots, mk);
      if (hit) return hit;
    }
    return null;
  }

  private async findAccountInput(
    page: Page,
  ): Promise<ReturnType<Page['$']> extends Promise<infer T> ? T : never> {
    const selectors = [
      'input[placeholder*="账号"]',
      'input[placeholder*="用户名"]',
      'input[name="account"]',
      'input[name="username"]',
      'input[name="loginName"]',
    ];
    for (const selector of selectors) {
      try {
        const el = await page.$(selector);
        if (el && (await el.isVisible())) return el;
      } catch {
        continue;
      }
    }
    return null;
  }

  private async findPasswordInput(
    page: Page,
  ): Promise<ReturnType<Page['$']> extends Promise<infer T> ? T : never> {
    const selectors = [
      'input[type="password"]',
      'input[placeholder*="密码"]',
      'input[name="password"]',
    ];
    for (const selector of selectors) {
      try {
        const el = await page.$(selector);
        if (el && (await el.isVisible())) return el;
      } catch {
        continue;
      }
    }
    return null;
  }

  private async switchToSmsLogin(lf: Page | Frame, top: Page): Promise<void> {
    const roots = this.searchRoots(top, lf);
    const tabMakers: ((r: Page | Frame) => Locator)[] = [
      (r) => r.getByRole('tab', { name: /验证码|短信|手机/ }),
      (r) => r.getByText('验证码登录', { exact: true }),
      (r) => r.getByText('短信登录', { exact: true }),
      (r) => r.getByText('手机验证码'),
    ];
    for (const mk of tabMakers) {
      const hit = await this.firstVisibleLocator(roots, mk);
      if (hit) {
        await hit.click();
        this.log('info', '已切换到验证码登录');
        await this.humanDelay(500, 1000);
        return;
      }
    }
  }

  private async clickGetSmsCode(lf: Page | Frame, top: Page): Promise<void> {
    const roots = this.searchRoots(top, lf);
    const makers: ((r: Page | Frame) => Locator)[] = [
      (r) => r.getByText('获取验证码', { exact: true }),
      (r) => r.getByText('发送验证码'),
      (r) => r.getByRole('button', { name: /验证码/ }),
      (r) => r.locator('a, button, span').filter({ hasText: /^获取验证码$/ }),
    ];
    for (const mk of makers) {
      const hit = await this.firstVisibleLocator(roots, mk);
      if (hit) {
        await hit.click();
        this.log('info', '已点击获取验证码');
        return;
      }
    }
    this.log('warn', '未找到获取验证码按钮，请手动点击');
  }

  private async clickLoginSubmit(lf: Page | Frame, top: Page): Promise<void> {
    const roots = this.searchRoots(top, lf);
    const makers: ((r: Page | Frame) => Locator)[] = [
      (r) => r.getByRole('button', { name: /^登录$/ }),
      (r) => r.getByRole('button', { name: /登录/ }),
      (r) => r.locator('button[type="submit"]'),
      (r) => r.locator('input[type="submit"]'),
    ];
    for (const mk of makers) {
      const hit = await this.firstVisibleLocator(roots, mk);
      if (hit) {
        await hit.click();
        this.log('info', '已点击登录');
        return;
      }
    }
    throw new RPACollectError('找不到登录按钮', 'login');
  }

  private async checkPrivacyAgreement(lf: Page | Frame, top: Page): Promise<void> {
    try {
      for (const root of this.searchRoots(top, lf)) {
        const boxes = root.locator('input[type="checkbox"]');
        const n = await boxes.count();
        for (let i = 0; i < n; i++) {
          const el = boxes.nth(i);
          if (await el.isVisible().catch(() => false)) {
            const checked = await el.isChecked().catch(() => false);
            if (!checked) {
              await el.click();
              await this.humanDelay(200, 400);
            }
            return;
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  /**
   * 先加载 home.html 再设置 hash，避免对带 fragment 的 URL 整页 goto 触发 ERR_ABORTED。
   */
  private async navigateToDataHome(page: Page): Promise<void> {
    await page
      .goto(QNH_HOME_SHELL, {
        waitUntil: 'load',
        timeout: 60_000,
      })
      .catch(async () => {
        await page.goto(QNH_HOME_SHELL, {
          waitUntil: 'domcontentloaded',
          timeout: 45_000,
        });
      });
    await this.humanDelay(2000, 4000);

    if (page.url().includes('login.html')) return;

    // 若仅判断「不含 data/home」会漏掉已错误落在 #/data/home/new?undefined 的情况，需强制纠正
    await page.evaluate(
      ({ hash }: { hash: string }) => {
        const loc = (globalThis as unknown as { location: { hash: string } })
          .location;
        const h = loc.hash ?? '';
        const badQuery = /\?undefined|=undefined(?:&|$)/.test(h);
        const ok =
          h.includes('data/home') &&
          h.includes('fromSource=loginPage') &&
          !badQuery;
        if (!ok) loc.hash = hash;
      },
      { hash: QNH_DATA_HASH },
    );

    await this.humanDelay(3000, 5000);
  }

  protected async isLoggedIn(page: Page): Promise<boolean> {
    try {
      const u0 = page.url();
      if (
        u0.includes('login.html') ||
        u0.includes('epassport') ||
        u0.includes('logon/error')
      ) {
        return false;
      }

      await this.navigateToDataHome(page);

      const current = page.url();
      if (
        current.includes('login.html') ||
        current.includes('epassport') ||
        current.includes('logon')
      ) {
        return false;
      }

      const body = (await page.textContent('body').catch(() => '')) ?? '';
      if (
        /短信验证码|获取验证码/.test(body) &&
        /登录|登陆/.test(body) &&
        body.length < 15_000
      ) {
        return false;
      }

      return current.includes('qnh.meituan.com') && body.length > 200;
    } catch {
      return false;
    }
  }

  protected async doCollect(
    page: Page,
    params: CollectParams,
  ): Promise<UnifiedInventorySignal[]> {
    await this.navigateToDataHome(page);
    await this.humanDelay(800, 1500);

    const pageUrl = page.url();
    const pageTitle = (await page.title().catch(() => '')) || '';
    const body = (await page.textContent('body').catch(() => '')) ?? '';
    const exportUiDetected = /导出|下载|Excel|xlsx/i.test(body);

    let approxTableRows = 0;
    try {
      approxTableRows = await page.locator('table tbody tr').count();
      if (approxTableRows === 0) {
        approxTableRows = await page.locator('tbody tr').count();
      }
    } catch {
      approxTableRows = 0;
    }

    const syncedAt = new Date();
    this.log(
      'info',
      `collect 快照: url ok, 正文约 ${body.length} 字, 表格行约 ${approxTableRows}, 导出类文案: ${exportUiDetected}`,
    );

    return [
      {
        source: 'qianniuhua',
        rawData: {
          kind: 'page_snapshot',
          pageUrl,
          pageTitle,
          bodyTextSample: body.slice(0, 4000),
          exportUiDetected,
          approxTableRows,
          dateRange: {
            from: params.dateFrom.toISOString(),
            to: params.dateTo.toISOString(),
          },
          collectedAt: syncedAt.toISOString(),
        },
        syncedAt,
      },
    ];
  }

  protected async doDryRun(page: Page): Promise<DryRunResult> {
    const logs: string[] = [];
    try {
      await this.navigateToDataHome(page);
    } catch (e) {
      logs.push(
        `导航数据首页失败: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    await this.humanDelay(500, 1200);

    const currentUrl = page.url();
    logs.push(`牵牛花数据页 URL: ${currentUrl}`);

    let screenshotPath: string | undefined;
    try {
      screenshotPath = await this.takeDryRunScreenshot(page, 'qianniuhua');
      logs.push(`截图: ${screenshotPath}`);
    } catch (e) {
      logs.push(
        `截图失败: ${e instanceof Error ? e.message.slice(0, 80) : String(e)}`,
      );
    }

    const body = (await page.textContent('body').catch(() => '')) ?? '';
    const exportButtonFound = /导出|下载|Excel|xlsx/i.test(body);
    const reachedSettlement =
      currentUrl.includes('qnh.meituan.com') &&
      !currentUrl.includes('epassport') &&
      !currentUrl.includes('login.html');

    return {
      reachedSettlement,
      exportButtonFound,
      screenshotPath,
      matchedSelector: exportButtonFound ? 'text-match:导出|下载' : undefined,
      currentUrl,
      logs,
    };
  }

  private async takeDryRunScreenshot(
    page: Page,
    tag: string,
  ): Promise<string> {
    const dir = path.join(this.config.dataDir, 'screenshots');
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, `${tag}_dry_${Date.now()}.png`);
    await page.screenshot({ path: filepath, fullPage: true });
    return filepath;
  }
}
