/**
 * BasePlatformRPA — RPA 采集基类
 *
 * 所有平台/银行 RPA 脚本继承此类。提供：
 * - Playwright 浏览器管理（persistent context + 反指纹）
 * - Cookie 加密本地存储 / 恢复
 * - 安全断言（只读保护，禁止导航到危险页面）
 * - 采集日志（JSONL 文件）
 * - 失败截图
 *
 * Wave 1: 本地文件存储，Mac 本地运行
 * Wave 2: 迁移到数据库存储，ECS 部署
 */
import { chromium, type BrowserContext, type Page } from 'playwright';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CollectParams, CollectResult, CollectError } from './schemas.js';

// ─── 配置类型 ──────────────────────────────────────────────

/** dry-run 诊断结果 */
export interface DryRunResult {
  /** 是否成功到达结算页 */
  reachedSettlement: boolean;
  /** 是否找到导出按钮 */
  exportButtonFound: boolean;
  /** 截图路径 */
  screenshotPath: string | undefined;
  /** 导出按钮匹配的选择器 */
  matchedSelector: string | undefined;
  /** 当前页面 URL */
  currentUrl: string;
  /** 诊断日志 */
  logs: string[];
}

export interface RPAConfig {
  /** 平台标识，如 'ceb_personal', 'douyin' */
  platformId: string;
  /** 数据存储根目录 */
  dataDir: string;
  /** 禁止导航的 URL 片段（只读保护） */
  forbiddenUrlPatterns: string[];
  /** 浏览器 headless 模式（默认 false，银行网站检测 headless） */
  headless: boolean;
  /** Cookie 加密密钥（32字节 hex） */
  encryptionKey: string;
  /** 浏览器 User-Agent */
  userAgent: string;
  /** slowMo 毫秒数（调试用，默认 0） */
  slowMo: number;
}

const DEFAULT_CONFIG: Partial<RPAConfig> = {
  headless: false,
  slowMo: 0,
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};

// ─── 安全错误 ──────────────────────────────────────────────

export class RPASafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RPASafetyError';
  }
}

export class RPACollectError extends Error {
  constructor(
    message: string,
    public readonly stage: CollectError['stage'],
  ) {
    super(message);
    this.name = 'RPACollectError';
  }
}

// ─── 日志条目 ──────────────────────────────────────────────

interface SyncLogEntry {
  timestamp: string;
  platformId: string;
  status: 'success' | 'failed';
  durationMs: number;
  recordCount: number;
  error?: string;
  screenshotPath?: string;
}

// ─── 基类 ──────────────────────────────────────────────────

export abstract class BasePlatformRPA<T> {
  protected config: RPAConfig;
  protected context: BrowserContext | null = null;
  protected page: Page | null = null;
  private collectErrors: CollectError[] = [];

  constructor(config: Partial<RPAConfig> & Pick<RPAConfig, 'platformId' | 'dataDir' | 'forbiddenUrlPatterns' | 'encryptionKey'>) {
    this.config = { ...DEFAULT_CONFIG, ...config } as RPAConfig;
    this.ensureDirs();
  }

  // ─── 子类必须实现 ────────────────────────────────────────

  /** 执行登录流程 */
  protected abstract doLogin(page: Page): Promise<void>;

  /** 执行数据采集 */
  protected abstract doCollect(page: Page, params: CollectParams): Promise<T[]>;

  /** 检查是否已登录（Cookie 恢复后验证） */
  protected abstract isLoggedIn(page: Page): Promise<boolean>;

  /** dry-run 诊断：登录 → 导航到结算页 → 截图 → 检查导出按钮 */
  protected abstract doDryRun(page: Page): Promise<DryRunResult>;

  // ─── 公开接口 ────────────────────────────────────────────

  /** 执行完整采集流程：初始化 → Cookie恢复 → 登录 → 采集 → 关闭 */
  async collect(params: CollectParams): Promise<CollectResult<T>> {
    const startAt = new Date();
    this.collectErrors = [];

    try {
      await this.initBrowser();
      const page = this.page!;

      // 注册安全断言
      this.registerSafetyGuard(page);

      // 尝试 Cookie 恢复
      const cookieRestored = await this.restoreCookies();

      if (cookieRestored) {
        const loggedIn = await this.isLoggedIn(page);
        if (!loggedIn) {
          this.log('info', 'Cookie 已过期，重新登录');
          await this.doLogin(page);
          await this.saveCookies();
        } else {
          this.log('info', 'Cookie 恢复成功，跳过登录');
        }
      } else {
        this.log('info', '无有效 Cookie，执行登录');
        await this.doLogin(page);
        await this.saveCookies();
      }

      // 执行采集
      const data = await this.doCollect(page, params);

      const result: CollectResult<T> = {
        success: true,
        data,
        metadata: {
          source: this.config.platformId,
          collectStartAt: startAt,
          collectEndAt: new Date(),
          recordCount: data.length,
          dateRange: { from: params.dateFrom, to: params.dateTo },
        },
        errors: this.collectErrors,
      };

      await this.writeSyncLog('success', Date.now() - startAt.getTime(), data.length);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      // 失败截图
      let screenshotPath: string | undefined;
      if (this.page) {
        screenshotPath = await this.takeErrorScreenshot();
      }

      this.addError(
        err instanceof RPACollectError ? err.stage : 'extract',
        message,
        screenshotPath,
      );

      await this.writeSyncLog(
        'failed',
        Date.now() - startAt.getTime(),
        0,
        message,
        screenshotPath,
      );

      return {
        success: false,
        data: [],
        metadata: {
          source: this.config.platformId,
          collectStartAt: startAt,
          collectEndAt: new Date(),
          recordCount: 0,
          dateRange: { from: params.dateFrom, to: params.dateTo },
        },
        errors: this.collectErrors,
      };
    } finally {
      await this.closeBrowser();
    }
  }

  /** dry-run 模式：登录 → 导航 → 截图 → 检查导出按钮，不下载 */
  async dryRun(): Promise<DryRunResult> {
    try {
      await this.initBrowser();
      const page = this.page!;
      this.registerSafetyGuard(page);

      const cookieRestored = await this.restoreCookies();
      if (cookieRestored) {
        const loggedIn = await this.isLoggedIn(page);
        if (!loggedIn) {
          this.log('info', 'Cookie 已过期，重新登录');
          await this.doLogin(page);
          await this.saveCookies();
        } else {
          this.log('info', 'Cookie 恢复成功，跳过登录');
        }
      } else {
        this.log('info', '无有效 Cookie，执行登录');
        await this.doLogin(page);
        await this.saveCookies();
      }

      return await this.doDryRun(page);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const screenshotPath = this.page ? await this.takeErrorScreenshot() : undefined;
      return {
        reachedSettlement: false,
        exportButtonFound: false,
        screenshotPath,
        matchedSelector: undefined,
        currentUrl: this.page?.url() ?? 'unknown',
        logs: [`错误: ${message}`],
      };
    } finally {
      await this.closeBrowser();
    }
  }

  // ─── 浏览器管理 ──────────────────────────────────────────

  protected async initBrowser(): Promise<void> {
    const userDataDir = path.join(this.config.dataDir, 'browser-data', this.config.platformId);
    fs.mkdirSync(userDataDir, { recursive: true });

    this.context = await chromium.launchPersistentContext(userDataDir, {
      headless: this.config.headless,
      viewport: { width: 1920, height: 1080 },
      userAgent: this.config.userAgent,
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      slowMo: this.config.slowMo,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
      ],
    });

    this.page = this.context.pages()[0] ?? (await this.context.newPage());

    // 注入反检测脚本
    await this.page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    this.log('info', '浏览器已启动');
  }

  protected async closeBrowser(): Promise<void> {
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
      this.page = null;
      this.log('info', '浏览器已关闭');
    }
  }

  // ─── Cookie 加密存储 ─────────────────────────────────────

  private getCookiePath(): string {
    return path.join(this.config.dataDir, 'cookies', `${this.config.platformId}.enc`);
  }

  protected async saveCookies(): Promise<void> {
    if (!this.context) return;

    const cookies = await this.context.cookies();
    const plaintext = JSON.stringify(cookies);
    const encrypted = this.encrypt(plaintext);

    const cookiePath = this.getCookiePath();
    fs.mkdirSync(path.dirname(cookiePath), { recursive: true });
    fs.writeFileSync(cookiePath, encrypted, 'utf-8');

    this.log('info', `Cookie 已保存 (${cookies.length} 条)`);
  }

  protected async restoreCookies(): Promise<boolean> {
    if (!this.context) return false;

    const cookiePath = this.getCookiePath();
    if (!fs.existsSync(cookiePath)) return false;

    try {
      const encrypted = fs.readFileSync(cookiePath, 'utf-8');
      const plaintext = this.decrypt(encrypted);
      const cookies = JSON.parse(plaintext);

      await this.context.addCookies(cookies);
      this.log('info', `Cookie 已恢复 (${cookies.length} 条)`);
      return true;
    } catch {
      this.log('warn', 'Cookie 解密/恢复失败，将重新登录');
      fs.unlinkSync(cookiePath);
      return false;
    }
  }

  // ─── 加密工具 ────────────────────────────────────────────

  private encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(16);
    const key = Buffer.from(this.config.encryptionKey, 'hex');
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    let encrypted = cipher.update(plaintext, 'utf-8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  private decrypt(ciphertext: string): string {
    const parts = ciphertext.split(':');
    const ivHex = parts[0] ?? '';
    const authTagHex = parts[1] ?? '';
    const encryptedHex = parts[2] ?? '';
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const key = Buffer.from(this.config.encryptionKey, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    const chunks: string[] = [];
    chunks.push(decipher.update(encryptedHex, 'hex', 'utf-8'));
    chunks.push(decipher.final('utf-8'));
    return chunks.join('');
  }

  // ─── 安全断言 ────────────────────────────────────────────

  private registerSafetyGuard(page: Page): void {
    page.on('framenavigated', (frame) => {
      const url = frame.url();
      for (const pattern of this.config.forbiddenUrlPatterns) {
        if (url.includes(pattern)) {
          this.log('error', `安全断言触发：导航到禁止页面 ${url}`);
          this.closeBrowser().catch(() => {});
          throw new RPASafetyError(`导航到禁止页面，脚本终止: ${url}`);
        }
      }
    });
  }

  // ─── 截图 ────────────────────────────────────────────────

  protected async takeErrorScreenshot(): Promise<string | undefined> {
    if (!this.page) return undefined;

    try {
      const screenshotDir = path.join(this.config.dataDir, 'screenshots');
      fs.mkdirSync(screenshotDir, { recursive: true });

      const filename = `${Date.now()}-${this.config.platformId}-error.png`;
      const filepath = path.join(screenshotDir, filename);

      await this.page.screenshot({ path: filepath, fullPage: true });
      this.log('info', `错误截图已保存: ${filename}`);
      return filepath;
    } catch {
      return undefined;
    }
  }

  // ─── 日志 ────────────────────────────────────────────────

  protected log(level: 'info' | 'warn' | 'error', message: string): void {
    const prefix = `[${this.config.platformId}]`;
    const timestamp = new Date().toISOString();

    if (level === 'error') {
      process.stderr.write(`${timestamp} ERROR ${prefix} ${message}\n`);
    } else {
      process.stdout.write(`${timestamp} ${level.toUpperCase()} ${prefix} ${message}\n`);
    }
  }

  protected addError(
    stage: CollectError['stage'],
    message: string,
    screenshot?: string,
  ): void {
    this.collectErrors.push({ stage, message, screenshot, timestamp: new Date() });
  }

  private async writeSyncLog(
    status: SyncLogEntry['status'],
    durationMs: number,
    recordCount: number,
    error?: string,
    screenshotPath?: string,
  ): Promise<void> {
    const logDir = path.join(this.config.dataDir, 'logs');
    fs.mkdirSync(logDir, { recursive: true });

    const entry: SyncLogEntry = {
      timestamp: new Date().toISOString(),
      platformId: this.config.platformId,
      status,
      durationMs,
      recordCount,
      error,
      screenshotPath,
    };

    const logPath = path.join(logDir, 'rpa-sync.jsonl');
    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf-8');
  }

  // ─── 工具方法 ────────────────────────────────────────────

  /** 人类行为模拟：随机延迟 */
  protected async humanDelay(minMs = 500, maxMs = 2000): Promise<void> {
    const delay = Math.floor(Math.random() * (maxMs - minMs)) + minMs;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  /** 确保目录存在 */
  private ensureDirs(): void {
    const dirs = ['cookies', 'screenshots', 'logs', 'browser-data'];
    for (const dir of dirs) {
      fs.mkdirSync(path.join(this.config.dataDir, dir), { recursive: true });
    }
  }
}
