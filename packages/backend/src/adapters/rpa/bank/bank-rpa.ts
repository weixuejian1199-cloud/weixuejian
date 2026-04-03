/**
 * BankRPA — 银行 RPA 基类
 *
 * 继承 BasePlatformRPA，增加银行专属逻辑：
 * - 更严格的只读保护（转账/支付/汇款页面一律拦截）
 * - 输出类型锁定为 UnifiedTransaction
 * - 凭证加载（从 .env.rpa）
 */
import type { Page } from 'playwright';
import { BasePlatformRPA, type RPAConfig, type DryRunResult } from '../base-platform-rpa.js';
import type { UnifiedTransaction } from '../schemas.js';

/** 银行通用禁止 URL 模式 */
const BANK_FORBIDDEN_PATTERNS = [
  '/transfer',
  '/payment',
  '/remittance',
  '/loan',
  '/invest',
  '/purchase',
  'transConfirm',
  'payConfirm',
  'batchTrans',
];

export interface BankRPAConfig {
  /** 银行标识，如 'ceb_personal' */
  bankId: string;
  /** 数据存储根目录 */
  dataDir: string;
  /** 登录用户名 */
  loginId: string;
  /** 登录密码 */
  password: string;
  /** 加密密钥（32字节 hex） */
  encryptionKey: string;
  /** 额外禁止的 URL 模式 */
  extraForbiddenPatterns?: string[];
  /** headless 模式（默认 false） */
  headless?: boolean;
  /** slowMo（调试用） */
  slowMo?: number;
}

export abstract class BankRPA extends BasePlatformRPA<UnifiedTransaction> {
  protected readonly loginId: string;
  protected readonly password: string;

  constructor(config: BankRPAConfig) {
    const allForbidden = [
      ...BANK_FORBIDDEN_PATTERNS,
      ...(config.extraForbiddenPatterns ?? []),
    ];

    super({
      platformId: config.bankId,
      dataDir: config.dataDir,
      forbiddenUrlPatterns: allForbidden,
      encryptionKey: config.encryptionKey,
      headless: config.headless ?? false,
      slowMo: config.slowMo ?? 0,
    });

    this.loginId = config.loginId;
    this.password = config.password;
  }

  protected async doDryRun(_page: Page): Promise<DryRunResult> {
    return {
      reachedSettlement: false,
      exportButtonFound: false,
      screenshotPath: undefined,
      matchedSelector: undefined,
      currentUrl: 'not-implemented',
      logs: ['银行 RPA dry-run 尚未实现'],
    };
  }
}
