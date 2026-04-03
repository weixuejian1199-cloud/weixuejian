/**
 * PlatformRPA — 电商平台 RPA 基类
 *
 * 继承 BasePlatformRPA，增加平台通用逻辑：
 * - 通用只读保护（拦截发货/改价/退款/投放等写操作 URL）
 * - 输出类型锁定为 UnifiedSettlement
 * - 手机号 + 短信验证码登录模式
 *
 * ⚠️ 绝对只读：只查询结算/财务数据，不做任何订单/运营操作
 */
import { BasePlatformRPA, type RPAConfig } from '../base-platform-rpa.js';
import type { UnifiedSettlement } from '../schemas.js';

/** 平台通用禁止 URL 模式（写操作一律拦截） */
const PLATFORM_FORBIDDEN_PATTERNS = [
  '/order/send',        // 发货
  '/order/ship',        // 发货
  '/price/edit',        // 改价
  '/price/update',      // 改价
  '/refund/agree',      // 同意退款
  '/refund/reject',     // 拒绝退款
  '/promotion/create',  // 创建推广
  '/promotion/update',  // 修改推广
  '/coupon/create',     // 创建优惠券
  '/product/edit',      // 编辑商品
  '/product/create',    // 创建商品
  '/product/delete',    // 删除商品
  '/reply',             // 回复评价
  '/message/send',      // 发消息
];

export interface PlatformRPAConfig {
  /** 平台标识，如 'douyin', 'meituan' */
  platformId: string;
  /** 数据存储根目录 */
  dataDir: string;
  /** 登录手机号 */
  phone: string;
  /** 加密密钥（32字节 hex） */
  encryptionKey: string;
  /** 额外禁止的 URL 模式 */
  extraForbiddenPatterns?: string[];
  /** headless 模式（默认 false） */
  headless?: boolean;
  /** slowMo（调试用） */
  slowMo?: number;
}

export abstract class PlatformRPA extends BasePlatformRPA<UnifiedSettlement> {
  protected readonly phone: string;

  constructor(config: PlatformRPAConfig) {
    const allForbidden = [
      ...PLATFORM_FORBIDDEN_PATTERNS,
      ...(config.extraForbiddenPatterns ?? []),
    ];

    super({
      platformId: config.platformId,
      dataDir: config.dataDir,
      forbiddenUrlPatterns: allForbidden,
      encryptionKey: config.encryptionKey,
      headless: config.headless ?? false,
      slowMo: config.slowMo ?? 0,
    });

    this.phone = config.phone;
  }
}
