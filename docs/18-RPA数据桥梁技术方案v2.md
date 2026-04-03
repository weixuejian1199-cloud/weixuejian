# 18 - RPA 数据桥梁技术方案 v2

> v2.0 · 2026-04-02
> 基于：数据通路设计组12人全员诊断 + 创始人实地验证
> 前序：docs/14-RPA数据桥梁方案.md（ADR-031 概念版）
> 本文档：可执行的技术方案，含银行RPA + 平台RPA + 统一架构

---

## 一、v1→v2 升级点

| 维度 | v1（概念版） | v2（本文档） |
|------|------------|------------|
| 银行数据 | 建议银企直联，RPA不可行 | **个人卡RPA可行**（光大个人网银无需U盾） |
| 对公银行卡 | 未详细设计 | 银企直联（创始人已启动申请） |
| 微信/支付宝 | 未涉及 | 商户API对接（财务申请中） |
| 个人卡采购 | 未涉及 | **采购付款留痕方案**（飞书审批+截图OCR） |
| 银行账户模型 | 未设计 | **多租户灵活配置**（SaaS售卖导向） |
| 团队 | 无执行团队 | 数据通路设计组扩编为诊断+执行双模 |
| 平台口径 | 未涉及 | **6渠道口径映射表**（跨平台数据标准化） |

---

## 二、数据通路全景架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         数据采集层（4种采集方式）                          │
│                                                                         │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐  │
│  │  银企直联API   │ │  商户支付API  │ │  RPA引擎      │ │  手工导入     │  │
│  │              │ │              │ │  (Playwright) │ │              │  │
│  │ 光大对公卡    │ │ 微信商户号    │ │              │ │ 个人卡流水    │  │
│  │ (其他对公卡)  │ │ 支付宝商户号  │ │ 平台数据采集   │ │ Excel/CSV    │  │
│  │              │ │              │ │ 银行个人卡     │ │              │  │
│  └──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └──────┬───────┘  │
│         │                │                │                │          │
└─────────┼────────────────┼────────────────┼────────────────┼──────────┘
          │                │                │                │
          └────────────────┴───────┬────────┴────────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │    DataSourceAdapter         │
                    │    统一数据适配层              │
                    │                              │
                    │  ┌────────────────────────┐  │
                    │  │ BankDirectAdapter       │  │  ← 银企直联
                    │  │ PaymentAPIAdapter       │  │  ← 微信/支付宝API
                    │  │ RPAAdapter              │  │  ← Playwright采集
                    │  │   ├── PlatformRPA       │  │  ← 电商平台
                    │  │   └── BankRPA           │  │  ← 银行个人网银 ★新增
                    │  │ ManualImportAdapter     │  │  ← 手工上传
                    │  └────────────────────────┘  │
                    │                              │
                    │  统一输出Schema：             │
                    │  ├── UnifiedTransaction     │  │  ← 银行流水
                    │  ├── UnifiedSettlement      │  │  ← 平台结算单
                    │  ├── UnifiedCommission      │  │  ← 佣金/扣费
                    │  ├── UnifiedAdSpend         │  │  ← 投放花费
                    │  └── UnifiedDailyMetrics    │  │  ← 经营数据
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │       业务消费层              │
                    │                              │
                    │  财务模块 → 自动对账/生成凭证  │
                    │  运营模块 → 数据看板/AI分析    │
                    │  AI Agent → 问答/决策建议     │
                    │  指挥中心 → 老板全局视图       │
                    └──────────────────────────────┘
```

---

## 三、银行数据通路方案

### 3.1 多租户银行账户数据模型

```typescript
// 银行账户配置（SaaS多租户）
interface BankAccount {
  id: string;
  tenantId: string;              // 租户隔离
  bankName: string;              // 银行名称（光大/建设/招商...）
  bankCode: string;              // 银行编码（CEB/CCB/CMB...）
  accountType: 'corporate' | 'personal';  // 对公/个人
  accountNumber: string;         // 账号（加密存储）
  accountName: string;           // 户名
  
  // 采集方式（自动匹配或手动指定）
  collectionMethod: 
    | 'bank_direct'              // 银企直联API
    | 'rpa'                      // RPA自动采集
    | 'payment_api'              // 支付平台API（微信/支付宝）
    | 'manual_import';           // 手工导入
  
  // RPA专用配置（collectionMethod='rpa'时）
  rpaConfig?: {
    loginUrl: string;            // 网银登录地址
    credentials: string;         // 加密存储的登录凭证
    loginType: 'password' | 'qrcode' | 'sms';
    scheduleFrequency: 'daily' | 'weekly' | 'monthly';
    scheduleCron: string;        // cron表达式
  };
  
  // 银企直联配置（collectionMethod='bank_direct'时）
  directConfig?: {
    merchantId: string;
    apiKey: string;              // 加密存储
    apiEndpoint: string;
  };
  
  // 状态
  status: 'active' | 'credential_expired' | 'disabled';
  lastSyncAt: Date | null;
  lastSyncStatus: 'success' | 'failed' | null;
  
  createdAt: Date;
  updatedAt: Date;
}
```

```sql
-- PostgreSQL Schema
CREATE TABLE bank_accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  bank_name       VARCHAR(50) NOT NULL,
  bank_code       VARCHAR(10) NOT NULL,
  account_type    VARCHAR(20) NOT NULL CHECK (account_type IN ('corporate', 'personal')),
  account_number  TEXT NOT NULL,           -- AES-256加密
  account_name    VARCHAR(100) NOT NULL,
  
  collection_method VARCHAR(20) NOT NULL 
    CHECK (collection_method IN ('bank_direct', 'rpa', 'payment_api', 'manual_import')),
  
  rpa_config      JSONB,                   -- RPA配置（加密凭证）
  direct_config   JSONB,                   -- 银企直联配置
  
  status          VARCHAR(20) NOT NULL DEFAULT 'active',
  last_sync_at    TIMESTAMPTZ,
  last_sync_status VARCHAR(20),
  
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,             -- 软删除
  
  UNIQUE(tenant_id, bank_code, account_number)
);

CREATE INDEX idx_bank_accounts_tenant ON bank_accounts(tenant_id) WHERE deleted_at IS NULL;
```

### 3.2 光大个人网银 RPA 脚本设计

**实地验证信息：**
- 登录地址：`https://www.cebbank.com/per/prePerlogin.do?locale=zh_CN`
- 登录方式：账号/用户名/手机号 + 密码（无U盾）
- 品牌：「点阳光」个人网银
- 创始人确认：登录下载账单不需要U盾

```typescript
// src/adapters/rpa/bank/ceb-personal.ts

import { chromium, Browser, Page } from 'playwright';

interface CEBPersonalConfig {
  username: string;       // 解密后的用户名
  password: string;       // 解密后的密码
  accountId: string;      // bank_accounts.id
}

class CEBPersonalRPA {
  
  private browser: Browser | null = null;
  private page: Page | null = null;
  
  /**
   * 光大银行个人网银 — 账单下载
   * 
   * 流程：
   * 1. 打开登录页
   * 2. 切换到「其他方式登录」（账号密码）
   * 3. 填入账号+密码
   * 4. 点击登录
   * 5. 处理可能的短信验证（首次/异地）
   * 6. 导航到账单/流水页面
   * 7. 选择日期范围
   * 8. 下载/抓取流水数据
   * 9. 关闭浏览器
   */
  async fetchTransactions(
    config: CEBPersonalConfig, 
    dateRange: { from: Date; to: Date }
  ): Promise<UnifiedTransaction[]> {
    
    try {
      // 1. 启动浏览器（反检测配置）
      this.browser = await chromium.launch({
        headless: true,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-sandbox',
        ]
      });
      
      const context = await this.browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...',
        viewport: { width: 1366, height: 768 },
        locale: 'zh-CN',
      });
      
      this.page = await context.newPage();
      
      // 2. 打开登录页
      await this.page.goto(
        'https://www.cebbank.com/per/prePerlogin.do?locale=zh_CN',
        { waitUntil: 'networkidle' }
      );
      
      // 3. 切换到账号密码登录（右侧tab「其他方式登录」）
      await this.clickWithDelay('text=其他方式登录');
      
      // 4. 填入凭证
      await this.typeWithDelay('input[placeholder*="账号"]', config.username);
      await this.typeWithDelay('input[type="password"]', config.password);
      
      // 5. 处理图形验证码（如果有）
      await this.handleCaptchaIfPresent();
      
      // 6. 点击登录
      await this.clickWithDelay('button:has-text("登录")');
      
      // 7. 等待登录成功（检测页面跳转）
      await this.page.waitForNavigation({ timeout: 15000 });
      
      // 8. 检查是否需要短信验证
      await this.handleSMSVerificationIfPresent();
      
      // 9. 导航到账单/交易记录页面
      await this.navigateToTransactionPage();
      
      // 10. 设置日期范围并查询
      await this.setDateRangeAndQuery(dateRange);
      
      // 11. 抓取交易数据
      const rawData = await this.scrapeTransactionTable();
      
      // 12. 转换为统一格式
      return this.normalizeTransactions(rawData, config.accountId);
      
    } catch (error) {
      // 记录错误日志
      await this.logSyncError(config.accountId, error);
      throw error;
    } finally {
      await this.browser?.close();
    }
  }
  
  /**
   * 人类行为模拟 — 随机延迟点击
   */
  private async clickWithDelay(selector: string): Promise<void> {
    await this.randomDelay(800, 2000);
    await this.page!.click(selector);
  }
  
  /**
   * 人类行为模拟 — 逐字输入
   */
  private async typeWithDelay(selector: string, text: string): Promise<void> {
    await this.page!.click(selector);
    for (const char of text) {
      await this.page!.keyboard.type(char);
      await this.randomDelay(50, 200);  // 每个字符间随机延迟
    }
  }
  
  /**
   * 图形验证码处理
   * 策略：检测是否存在 → OCR识别 → 填入 → 重试
   */
  private async handleCaptchaIfPresent(): Promise<void> {
    const captcha = await this.page!.$('img[class*="captcha"], img[id*="captcha"]');
    if (!captcha) return;
    
    // 截图验证码图片
    const captchaImage = await captcha.screenshot();
    
    // OCR识别（调用内部OCR服务或第三方）
    const captchaText = await this.ocrRecognize(captchaImage);
    
    // 填入验证码
    await this.typeWithDelay('input[class*="captcha"], input[id*="captcha"]', captchaText);
  }
  
  /**
   * 短信验证处理
   * 策略：检测到短信验证页 → 通知管理员 → 等待手动输入 → 继续
   */
  private async handleSMSVerificationIfPresent(): Promise<void> {
    const smsInput = await this.page!.$('input[placeholder*="短信"], input[placeholder*="验证码"]');
    if (!smsInput) return;
    
    // 发送飞书通知给管理员
    await this.notifyAdmin(
      '光大银行登录需要短信验证码',
      '请查看手机短信，在工作站中输入验证码'
    );
    
    // 等待管理员通过工作站UI输入验证码（最长5分钟）
    const code = await this.waitForAdminInput('sms_code', 300000);
    
    if (code) {
      await this.typeWithDelay('input[placeholder*="验证码"]', code);
      await this.clickWithDelay('button:has-text("确认")');
    } else {
      throw new Error('SMS verification timeout - admin did not respond');
    }
  }
  
  /**
   * 原始数据 → UnifiedTransaction 标准化
   */
  private normalizeTransactions(
    rawData: RawBankTransaction[], 
    accountId: string
  ): UnifiedTransaction[] {
    return rawData.map(row => ({
      sourceType: 'bank_rpa',
      sourceAccountId: accountId,
      transactionDate: this.parseDate(row.date),
      amount: this.parseAmount(row.amount),
      direction: row.amount.startsWith('-') ? 'outflow' : 'inflow',
      balance: this.parseAmount(row.balance),
      counterparty: row.counterparty || '',
      description: row.description || '',
      bankReference: row.reference || '',
      rawData: row,                // 保留原始数据
      syncedAt: new Date(),
    }));
  }
  
  private async randomDelay(min: number, max: number): Promise<void> {
    const delay = Math.floor(Math.random() * (max - min) + min);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}
```

### 3.3 短信验证码处理方案

银行个人卡RPA的最大不确定性是**短信验证码**。三种应对策略：

| 策略 | 说明 | 适用场景 |
|------|------|---------|
| A. 固定设备+IP | 同一台机器、同一IP登录，银行不触发短信 | 日常采集（ECS固定IP） |
| B. 管理员协助 | 触发短信时飞书通知管理员，管理员在工作站输入 | 首次绑定/异地登录 |
| C. 降级为手工 | 短信验证频繁触发时，降级为手工导出上传 | 异常情况 |

**推荐流程**：
```
首次绑定银行卡：
  管理员在工作站操作 → 输入账号密码 → 手动完成短信验证 → 保存session

日常自动采集（ECS固定IP + 保存session）：
  大部分情况不触发短信 → 自动完成
  
session过期/异常触发短信：
  飞书通知管理员 → 管理员输入验证码 → 继续采集
  超时未响应 → 本次采集跳过 → 下次重试
```

### 3.4 银行通路完整方案总览

| 银行/支付 | 账户类型 | 采集方式 | 状态 | 可获取数据 |
|-----------|---------|---------|------|-----------|
| 光大银行 | 对公 | 银企直联API | 创始人申请中 | 余额/流水/回单 |
| 光大银行 | 个人 | **RPA自动采集** | 待开发 | 流水/余额 |
| 建设银行 | 对公 | 银企直联/手工 | 待评估 | 流水 |
| 民生银行 | 对公 | 银企直联/手工 | 待评估 | 流水 |
| 中国银行 | 对公 | 银企直联/手工 | 待评估 | 流水 |
| 国际银行 | 对公 | 待确认 | 待评估 | 流水 |
| 网商银行 | 对公 | API（网商有开放API） | 待评估 | 流水/余额 |
| 招商银行 | 个人 | RPA/手工 | 待评估招商网银 | 流水 |
| 微信支付 | 商户号 | **商户API** | 财务申请中 | 交易明细/对账单/余额 |
| 支付宝 | 商户号 | **商户API** | 财务申请中 | 交易明细/对账单/余额 |

---

## 四、平台数据 RPA 方案

### 4.1 平台采集目标清单

| 平台 | 采集内容 | 频率 | RPA难度 | 替代方案 |
|------|---------|------|---------|---------|
| **抖店** | 结算单/佣金/经营数据/退款 | 每日 | 低 | 抖店开放API（订单已有） |
| **视频号** | 结算单/经营数据 | 每日 | 中高 | 微信商户API覆盖财务 |
| **美团** | 结算单/佣金/经营数据 | 每日 | 中 | API（大商家才有） |
| **闪购(饿了么)** | 结算单/佣金/经营数据 | 每日 | 中 | API有限 |
| **京东到家** | 结算单/经营数据 | 每日 | 低 | 达达开放平台 |
| **千川** | 投放计划/消耗/ROI | 每日 | 中 | 巨量引擎API |
| **小程序商城** | 不需要RPA | — | — | 直连数据库(ztdy API) |

### 4.2 统一平台 RPA 基类

```typescript
// src/adapters/rpa/platform/base-platform-rpa.ts

import { Browser, BrowserContext, Page } from 'playwright';

/**
 * 所有平台RPA脚本的基类
 * 提供：浏览器管理、反检测、Cookie管理、人类行为模拟、错误处理、日志
 */
abstract class BasePlatformRPA {
  
  protected browser: Browser | null = null;
  protected context: BrowserContext | null = null;
  protected page: Page | null = null;
  protected platformName: string;
  protected tenantId: string;
  
  constructor(platformName: string, tenantId: string) {
    this.platformName = platformName;
    this.tenantId = tenantId;
  }
  
  // ===== 子类必须实现 =====
  
  /** 平台登录（Cookie恢复或重新登录） */
  abstract login(credentials: EncryptedCredentials): Promise<void>;
  
  /** 采集结算单 */
  abstract fetchSettlements(dateRange: DateRange): Promise<UnifiedSettlement[]>;
  
  /** 采集佣金/扣费明细 */
  abstract fetchCommissions(dateRange: DateRange): Promise<UnifiedCommission[]>;
  
  /** 采集经营数据 */
  abstract fetchDailyMetrics(date: Date): Promise<UnifiedDailyMetrics>;
  
  /** 检测登录态是否有效 */
  abstract checkSessionValid(): Promise<boolean>;
  
  // ===== 基类提供的公共能力 =====
  
  /**
   * 启动浏览器（统一反检测配置）
   */
  async initBrowser(): Promise<void> {
    this.browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-dev-shm-usage',
      ]
    });
    
    this.context = await this.browser.newContext({
      userAgent: this.getRandomUserAgent(),
      viewport: { width: 1920, height: 1080 },
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
    });
    
    // 注入反检测脚本
    await this.context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });
    
    this.page = await this.context.newPage();
  }
  
  /**
   * Cookie 管理
   */
  async saveCookies(): Promise<string> {
    const cookies = await this.context!.cookies();
    return encrypt(JSON.stringify(cookies));  // AES-256加密后存储
  }
  
  async restoreCookies(encryptedCookies: string): Promise<void> {
    const cookies = JSON.parse(decrypt(encryptedCookies));
    await this.context!.addCookies(cookies);
  }
  
  /**
   * 带重试的采集主流程
   */
  async collect(credentials: EncryptedCredentials, dateRange: DateRange): Promise<CollectionResult> {
    const maxRetries = 3;
    let attempt = 0;
    
    while (attempt < maxRetries) {
      try {
        await this.initBrowser();
        
        // 先尝试Cookie恢复
        const savedCookies = await this.loadSavedCookies();
        if (savedCookies) {
          await this.restoreCookies(savedCookies);
          if (await this.checkSessionValid()) {
            // Cookie有效，直接采集
            return await this.doCollect(dateRange);
          }
        }
        
        // Cookie无效，重新登录
        await this.login(credentials);
        await this.saveCookies();  // 保存新Cookie
        
        return await this.doCollect(dateRange);
        
      } catch (error) {
        attempt++;
        await this.logError(error, attempt);
        
        if (attempt >= maxRetries) {
          // 通知管理员
          await this.notifyAdmin(`${this.platformName} 采集失败（重试${maxRetries}次）`, error);
          throw error;
        }
        
        // 重试前等待
        await this.delay(attempt * 5000);
      } finally {
        await this.browser?.close();
      }
    }
    
    throw new Error('Unreachable');
  }
  
  private async doCollect(dateRange: DateRange): Promise<CollectionResult> {
    const settlements = await this.fetchSettlements(dateRange);
    const commissions = await this.fetchCommissions(dateRange);
    const metrics = await this.fetchDailyMetrics(dateRange.to);
    
    // 写入采集日志
    await this.logSync('success', {
      settlements: settlements.length,
      commissions: commissions.length,
      metricsCollected: !!metrics,
    });
    
    return { settlements, commissions, metrics };
  }
  
  // ===== 人类行为模拟工具方法 =====
  
  protected async delay(ms: number): Promise<void> {
    await new Promise(r => setTimeout(r, ms));
  }
  
  protected async randomDelay(min = 1000, max = 3000): Promise<void> {
    await this.delay(Math.random() * (max - min) + min);
  }
  
  protected async humanClick(selector: string): Promise<void> {
    await this.randomDelay(500, 1500);
    const element = await this.page!.$(selector);
    if (!element) throw new Error(`Element not found: ${selector}`);
    
    const box = await element.boundingBox();
    if (!box) throw new Error(`Element not visible: ${selector}`);
    
    // 随机点击元素内的位置（不总是正中间）
    const x = box.x + box.width * (0.3 + Math.random() * 0.4);
    const y = box.y + box.height * (0.3 + Math.random() * 0.4);
    await this.page!.mouse.click(x, y);
  }
  
  protected async humanType(selector: string, text: string): Promise<void> {
    await this.page!.click(selector);
    await this.randomDelay(300, 800);
    for (const char of text) {
      await this.page!.keyboard.type(char);
      await this.delay(50 + Math.random() * 150);
    }
  }
  
  protected async humanScroll(distance = 300): Promise<void> {
    const steps = Math.floor(distance / 30);
    for (let i = 0; i < steps; i++) {
      await this.page!.mouse.wheel(0, 30);
      await this.delay(20 + Math.random() * 40);
    }
  }
  
  private getRandomUserAgent(): string {
    const agents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/119.0.0.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0',
    ];
    return agents[Math.floor(Math.random() * agents.length)];
  }
}
```

### 4.3 抖店采集脚本（第一个落地的平台）

```typescript
// src/adapters/rpa/platform/douyin-store.ts

class DouyinStoreRPA extends BasePlatformRPA {
  
  constructor(tenantId: string) {
    super('抖店', tenantId);
  }
  
  async login(credentials: EncryptedCredentials): Promise<void> {
    await this.page!.goto('https://fxg.jinritemai.com/login/common');
    
    // 抖店支持手机号+验证码 或 扫码登录
    // RPA策略：优先Cookie恢复，其次通知管理员扫码
    const needManualLogin = true; // 抖店登录通常需要扫码
    
    if (needManualLogin) {
      await this.notifyAdmin('抖店需要扫码登录', '请在5分钟内扫码');
      await this.page!.waitForURL('**/fxg.jinritemai.com/**', { timeout: 300000 });
      await this.saveCookies(); // 扫码成功后保存Cookie
    }
  }
  
  async fetchSettlements(dateRange: DateRange): Promise<UnifiedSettlement[]> {
    // 导航到结算管理页面
    await this.page!.goto('https://fxg.jinritemai.com/ffa/settlement/list');
    await this.randomDelay();
    
    // 设置日期范围
    // ... 具体DOM操作根据实际页面结构
    
    // 抓取结算单列表
    const rows = await this.page!.$$('table tbody tr');
    const settlements: UnifiedSettlement[] = [];
    
    for (const row of rows) {
      const cells = await row.$$('td');
      settlements.push({
        sourceType: 'rpa',
        platform: 'douyin',
        settlementId: await cells[0]?.innerText(),
        settlementDate: this.parseDate(await cells[1]?.innerText()),
        grossAmount: this.parseAmount(await cells[2]?.innerText()),
        commission: this.parseAmount(await cells[3]?.innerText()),
        serviceFee: this.parseAmount(await cells[4]?.innerText()),
        netAmount: this.parseAmount(await cells[5]?.innerText()),
        status: await cells[6]?.innerText(),
        rawData: await row.innerHTML(),
        syncedAt: new Date(),
      });
    }
    
    return settlements;
  }
  
  async fetchCommissions(dateRange: DateRange): Promise<UnifiedCommission[]> {
    // 导航到佣金明细页面
    // ... 类似结算单的采集逻辑
    return [];
  }
  
  async fetchDailyMetrics(date: Date): Promise<UnifiedDailyMetrics> {
    // 导航到抖店罗盘
    await this.page!.goto('https://compass.jinritemai.com/shop/overview');
    await this.randomDelay(2000, 4000);
    
    // 抓取核心指标
    return {
      platform: 'douyin',
      date,
      gmv: await this.extractMetric('.gmv-value'),
      orderCount: await this.extractMetric('.order-count'),
      visitors: await this.extractMetric('.uv-value'),
      conversionRate: await this.extractMetric('.conversion-rate'),
      refundRate: await this.extractMetric('.refund-rate'),
      avgOrderValue: await this.extractMetric('.aov-value'),
    };
  }
  
  async checkSessionValid(): Promise<boolean> {
    try {
      await this.page!.goto('https://fxg.jinritemai.com/ffa/settlement/list');
      return !this.page!.url().includes('login');
    } catch {
      return false;
    }
  }
}
```

### 4.4 采集调度系统

```typescript
// src/services/rpa/scheduler.ts

import cron from 'node-cron';

/**
 * RPA 采集调度器
 * 按租户配置的频率自动执行采集任务
 */
class RPAScheduler {
  
  private jobs: Map<string, cron.ScheduledTask> = new Map();
  
  /**
   * 启动所有租户的采集任务
   */
  async startAll(): Promise<void> {
    const accounts = await this.getAllActiveAccounts();
    
    for (const account of accounts) {
      this.scheduleAccount(account);
    }
    
    logger.info(`RPA Scheduler started: ${accounts.length} accounts scheduled`);
  }
  
  /**
   * 调度单个账户的采集
   */
  private scheduleAccount(account: BankAccountOrPlatform): void {
    const cronExpr = account.scheduleCron || '0 3 * * *'; // 默认每天凌晨3点
    
    const job = cron.schedule(cronExpr, async () => {
      try {
        // 检查是否在安全时段（凌晨2-6点）
        const hour = new Date().getHours();
        if (hour < 2 || hour > 6) {
          logger.warn(`Skipping ${account.name}: outside safe hours`);
          return;
        }
        
        // 随机延迟0-30分钟（避免所有任务同时启动）
        await this.randomDelay(0, 30 * 60 * 1000);
        
        // 执行采集
        const adapter = AdapterFactory.create(account);
        const result = await adapter.collect(account.credentials, {
          from: this.yesterday(),
          to: this.today(),
        });
        
        // 数据入库
        await this.saveResults(account, result);
        
        // 更新同步状态
        await this.updateSyncStatus(account.id, 'success');
        
      } catch (error) {
        await this.updateSyncStatus(account.id, 'failed');
        // 飞书告警（连续3次失败才告警，避免偶发噪音）
        await this.alertIfConsecutiveFailures(account, error);
      }
    });
    
    this.jobs.set(account.id, job);
  }
  
  /**
   * 手动触发采集（管理员从UI触发）
   */
  async triggerManual(accountId: string, dateRange: DateRange): Promise<CollectionResult> {
    const account = await this.getAccount(accountId);
    const adapter = AdapterFactory.create(account);
    return adapter.collect(account.credentials, dateRange);
  }
}
```

---

## 五、跨平台数据标准化

### 5.1 渠道口径映射表

**这张表是数据准确性的基石（专家3 张维强调）。**

| 指标 | 统一定义 | 抖店 | 视频号 | 美团 | 闪购 | 京东到家 | 小程序 |
|------|---------|------|-------|------|------|---------|--------|
| **GMV** | 已支付订单金额（含运费，扣退款前） | 支付GMV | 确认收货金额 | 含配送费 | 含配送费 | 含达达配送 | 支付金额 |
| **净营收** | 实际结算到账金额 | 结算单净额 | 结算单净额 | 结算金额 | 结算金额 | 结算金额 | GMV×100% |
| **平台佣金** | 平台抽取的佣金 | 技术服务费1-5% | 1-5% | 4-8% | 4-6% | 3-8% | 0 |
| **配送费** | 配送相关费用 | 商家承担运费 | 商家承担运费 | 配送抽成 | 配送抽成 | 达达配送费 | 快递费 |
| **推广费** | 付费推广花费 | 千川消耗 | 腾讯广告消耗 | 美团推广 | 饿了么推广 | 京东快车 | 无 |
| **结算周期** | 平台打款到银行的延迟 | T+7~15 | T+7 | T+1 | T+1 | T+3 | 实时 |
| **退货率** | 退货订单/总订单 | 含退货退款 | 含退货退款 | 含取消+退款 | 含取消+退款 | 含取消+退款 | 含退货 |

### 5.2 统一数据 Schema

```typescript
// src/types/unified-data.ts

/** 统一银行/支付流水 */
interface UnifiedTransaction {
  id: string;
  tenantId: string;
  sourceType: 'bank_direct' | 'bank_rpa' | 'payment_api' | 'manual_import';
  sourceAccountId: string;        // 关联 bank_accounts.id
  transactionDate: Date;
  amount: number;                 // 正=收入，负=支出
  direction: 'inflow' | 'outflow';
  balance: number;                // 交易后余额
  counterparty: string;           // 对方户名
  counterpartyAccount?: string;   // 对方账号（脱敏）
  description: string;            // 摘要/备注
  bankReference: string;          // 银行流水号
  category?: string;              // AI自动分类（回款/采购/工资/...）
  matchedSettlementId?: string;   // 自动匹配的结算单ID
  matchedPurchaseId?: string;     // 自动匹配的采购单ID
  rawData: Record<string, any>;   // 原始数据
  syncedAt: Date;
}

/** 统一平台结算单 */
interface UnifiedSettlement {
  id: string;
  tenantId: string;
  sourceType: 'rpa' | 'api';
  platform: 'douyin' | 'weixin_video' | 'meituan' | 'eleme' | 'jddj' | 'miniapp';
  settlementId: string;           // 平台结算单号
  settlementPeriod: {             // 结算周期
    from: Date;
    to: Date;
  };
  settlementDate: Date;           // 结算日期
  grossAmount: number;            // 结算前总额
  commission: number;             // 平台佣金
  serviceFee: number;             // 技术服务费
  deliveryFee: number;            // 配送费扣除
  promotionDeduction: number;     // 推广费扣除
  refundDeduction: number;        // 退款扣除
  otherDeduction: number;         // 其他扣除
  netAmount: number;              // 净结算金额（实际到账）
  paymentStatus: 'pending' | 'paid' | 'matched';  // 是否已匹配到银行到账
  matchedTransactionId?: string;  // 匹配的银行流水ID
  rawData: Record<string, any>;
  syncedAt: Date;
}

/** 统一投放数据 */
interface UnifiedAdSpend {
  id: string;
  tenantId: string;
  sourceType: 'rpa' | 'api';
  platform: 'qianchuan' | 'zhitongche' | 'wanxiangtai' | 'tencent_ads' | 'meituan_ads';
  date: Date;
  campaignId: string;
  campaignName: string;
  spend: number;                  // 消耗金额
  impressions: number;            // 展示次数
  clicks: number;                 // 点击次数
  conversions: number;            // 转化次数
  gmv: number;                    // 带来的GMV
  roas: number;                   // 平台ROAS（GMV/消耗）
  rawData: Record<string, any>;
  syncedAt: Date;
}

/** 统一每日经营数据 */
interface UnifiedDailyMetrics {
  id: string;
  tenantId: string;
  platform: string;
  date: Date;
  gmv: number;
  orderCount: number;
  visitors: number;
  conversionRate: number;
  refundAmount: number;
  refundRate: number;
  avgOrderValue: number;
  rawData: Record<string, any>;
  syncedAt: Date;
}
```

### 5.3 数据库Schema

```sql
-- 统一银行流水
CREATE TABLE unified_transactions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  source_type       VARCHAR(20) NOT NULL,
  source_account_id UUID NOT NULL REFERENCES bank_accounts(id),
  transaction_date  DATE NOT NULL,
  amount            DECIMAL(15,2) NOT NULL,
  direction         VARCHAR(10) NOT NULL CHECK (direction IN ('inflow', 'outflow')),
  balance           DECIMAL(15,2),
  counterparty      VARCHAR(200),
  description       TEXT,
  bank_reference    VARCHAR(100),
  category          VARCHAR(50),
  matched_settlement_id UUID REFERENCES unified_settlements(id),
  raw_data          JSONB NOT NULL,
  synced_at         TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ
);

CREATE INDEX idx_transactions_tenant_date 
  ON unified_transactions(tenant_id, transaction_date) WHERE deleted_at IS NULL;
CREATE INDEX idx_transactions_matching 
  ON unified_transactions(tenant_id, amount, transaction_date) WHERE deleted_at IS NULL;

-- 统一平台结算单
CREATE TABLE unified_settlements (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  source_type       VARCHAR(10) NOT NULL,
  platform          VARCHAR(30) NOT NULL,
  settlement_id     VARCHAR(100) NOT NULL,
  settlement_period_from DATE,
  settlement_period_to   DATE,
  settlement_date   DATE NOT NULL,
  gross_amount      DECIMAL(15,2) NOT NULL,
  commission        DECIMAL(15,2) NOT NULL DEFAULT 0,
  service_fee       DECIMAL(15,2) NOT NULL DEFAULT 0,
  delivery_fee      DECIMAL(15,2) NOT NULL DEFAULT 0,
  promotion_deduction DECIMAL(15,2) NOT NULL DEFAULT 0,
  refund_deduction  DECIMAL(15,2) NOT NULL DEFAULT 0,
  other_deduction   DECIMAL(15,2) NOT NULL DEFAULT 0,
  net_amount        DECIMAL(15,2) NOT NULL,
  payment_status    VARCHAR(20) NOT NULL DEFAULT 'pending',
  matched_transaction_id UUID,
  raw_data          JSONB NOT NULL,
  synced_at         TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ,
  
  UNIQUE(tenant_id, platform, settlement_id)
);

CREATE INDEX idx_settlements_tenant_date 
  ON unified_settlements(tenant_id, settlement_date) WHERE deleted_at IS NULL;
CREATE INDEX idx_settlements_matching 
  ON unified_settlements(tenant_id, net_amount, settlement_date) WHERE deleted_at IS NULL;

-- 统一投放数据
CREATE TABLE unified_ad_spends (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  source_type       VARCHAR(10) NOT NULL,
  platform          VARCHAR(30) NOT NULL,
  date              DATE NOT NULL,
  campaign_id       VARCHAR(100),
  campaign_name     VARCHAR(200),
  spend             DECIMAL(15,2) NOT NULL,
  impressions       BIGINT DEFAULT 0,
  clicks            BIGINT DEFAULT 0,
  conversions       BIGINT DEFAULT 0,
  gmv               DECIMAL(15,2) DEFAULT 0,
  roas              DECIMAL(8,4) DEFAULT 0,
  raw_data          JSONB NOT NULL,
  synced_at         TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ,
  
  UNIQUE(tenant_id, platform, date, campaign_id)
);

-- 统一每日经营数据
CREATE TABLE unified_daily_metrics (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  platform          VARCHAR(30) NOT NULL,
  date              DATE NOT NULL,
  gmv               DECIMAL(15,2) NOT NULL DEFAULT 0,
  order_count       INT NOT NULL DEFAULT 0,
  visitors          INT DEFAULT 0,
  conversion_rate   DECIMAL(6,4) DEFAULT 0,
  refund_amount     DECIMAL(15,2) DEFAULT 0,
  refund_rate       DECIMAL(6,4) DEFAULT 0,
  avg_order_value   DECIMAL(10,2) DEFAULT 0,
  raw_data          JSONB NOT NULL,
  synced_at         TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ,
  
  UNIQUE(tenant_id, platform, date)
);

-- RPA采集日志
CREATE TABLE rpa_sync_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  source_type       VARCHAR(30) NOT NULL,    -- 'bank_rpa' | 'platform_rpa' | 'bank_direct' | 'payment_api'
  source_id         VARCHAR(100) NOT NULL,   -- 账户ID或平台名
  started_at        TIMESTAMPTZ NOT NULL,
  finished_at       TIMESTAMPTZ,
  status            VARCHAR(20) NOT NULL,    -- 'running' | 'success' | 'failed' | 'timeout'
  records_collected INT DEFAULT 0,
  error_message     TEXT,
  error_screenshot  TEXT,                    -- 失败截图URL（诊断用）
  metadata          JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sync_logs_tenant ON rpa_sync_logs(tenant_id, started_at DESC);
```

---

## 六、自动对账引擎

### 6.1 三单匹配逻辑

打通数据后最核心的业务逻辑：**平台结算单 × 银行到账 × 订单数据 自动匹配**。

```typescript
// src/services/reconciliation/auto-match.ts

/**
 * 自动对账引擎
 * 
 * 匹配策略（按优先级）：
 * 1. 精确匹配：金额完全一致 + 日期在结算周期内
 * 2. 模糊匹配：金额误差<0.01 + 日期±3天
 * 3. 拆单匹配：多笔银行到账合计 = 一笔结算单
 * 4. 人工兜底：匹配不上的标记待人工确认
 */
class AutoReconciliation {
  
  async matchSettlementsToTransactions(
    tenantId: string, 
    dateRange: DateRange
  ): Promise<MatchResult> {
    
    // 获取待匹配的结算单
    const settlements = await this.getUnmatchedSettlements(tenantId, dateRange);
    
    // 获取待匹配的银行流水（收入方向）
    const transactions = await this.getUnmatchedTransactions(tenantId, dateRange, 'inflow');
    
    const matched: MatchPair[] = [];
    const unmatched: UnifiedSettlement[] = [];
    
    for (const settlement of settlements) {
      // 策略1：精确匹配
      const exactMatch = transactions.find(t => 
        Math.abs(t.amount - settlement.netAmount) < 0.01 &&
        this.isWithinSettlementWindow(t.transactionDate, settlement)
      );
      
      if (exactMatch) {
        matched.push({ settlement, transaction: exactMatch, confidence: 'high' });
        transactions.splice(transactions.indexOf(exactMatch), 1);
        continue;
      }
      
      // 策略2：模糊匹配（金额近似+日期±3天）
      const fuzzyMatch = transactions.find(t =>
        Math.abs(t.amount - settlement.netAmount) < settlement.netAmount * 0.001 &&
        Math.abs(daysBetween(t.transactionDate, settlement.settlementDate)) <= 3
      );
      
      if (fuzzyMatch) {
        matched.push({ settlement, transaction: fuzzyMatch, confidence: 'medium' });
        transactions.splice(transactions.indexOf(fuzzyMatch), 1);
        continue;
      }
      
      // 未匹配
      unmatched.push(settlement);
    }
    
    return {
      matched,
      unmatchedSettlements: unmatched,
      unmatchedTransactions: transactions,
      matchRate: matched.length / settlements.length,
    };
  }
}
```

---

## 七、监控与告警

### 7.1 监控面板（指挥中心集成）

```
┌─────────────────────────────────────────────────────┐
│  数据采集监控（指挥中心 → 系统设置 → 数据源状态）      │
│                                                     │
│  ┌─────────────┬──────┬──────────┬────────────────┐ │
│  │ 数据源       │ 状态  │ 最后采集  │ 下次采集        │ │
│  ├─────────────┼──────┼──────────┼────────────────┤ │
│  │ 光大个人卡×N │ ✅ 正常│ 今天03:12│ 明天03:00      │ │
│  │ 光大对公卡×N │ ✅ 正常│ 今天03:15│ 明天03:00      │ │
│  │ 微信商户号   │ ✅ 正常│ 今天04:00│ 明天04:00      │ │
│  │ 支付宝商户号 │ ✅ 正常│ 今天04:05│ 明天04:00      │ │
│  │ 抖店结算单   │ ✅ 正常│ 今天03:30│ 明天03:00      │ │
│  │ 美团结算单   │ ⚠️ 过期│ 3天前   │ Cookie已过期   │ │
│  │ 闪购结算单   │ ✅ 正常│ 今天03:45│ 明天03:00      │ │
│  │ 千川投放     │ ✅ 正常│ 今天04:10│ 明天04:00      │ │
│  └─────────────┴──────┴──────────┴────────────────┘ │
│                                                     │
│  今日对账：匹配率 94%（32/34笔） 2笔待人工确认        │
└─────────────────────────────────────────────────────┘
```

### 7.2 告警规则

| 告警 | 条件 | 通知方式 | 接收人 |
|------|------|---------|--------|
| Cookie过期 | 连续2次采集失败 | 飞书消息 | 管理员 |
| 采集异常 | 连续3次失败 | 飞书消息+电话 | 管理员+CTO |
| 对账异常 | 匹配率<80% | 飞书消息 | 财务主管 |
| 金额异常 | 单笔>5万且未匹配 | 飞书消息 | 财务主管+老板 |
| 银行余额预警 | 任一账户余额<阈值 | 飞书消息 | 老板 |
| RPA脚本失效 | 平台改版导致采集失败 | 飞书消息 | CTO |

---

## 八、安全设计

### 8.1 凭证安全（专家2 林雪菲要求）

```
凭证存储：
  银行账号密码 → AES-256-GCM 加密 → PostgreSQL JSONB
  平台Cookie  → AES-256-GCM 加密 → PostgreSQL JSONB  
  加密密钥     → 环境变量注入（不存数据库）
  
权限隔离：
  super_admin  → 可绑定/解绑银行卡和平台账号
  admin        → 可绑定/解绑平台账号（不能操作银行卡）
  finance      → 只看数据，看不到账号/密码/Cookie
  operation    → 只看运营数据，完全不知道RPA存在
  
审计日志：
  所有凭证操作 → 写入 audit_logs（谁/什么时间/做了什么）
  RPA每次登录 → 写入 rpa_sync_logs（含截图）
  凭证查看    → 写入审计（即使是super_admin看自己的也要记录）
```

### 8.2 反检测策略

```
1. 固定IP — ECS公网IP固定，避免IP变动触发风控
2. 固定设备指纹 — 每个平台一个固定的浏览器指纹
3. 人类行为模拟 — 随机延迟/鼠标轨迹/滚动
4. 合理频率 — 凌晨2-5点采集，每天1次，不高频
5. 只读操作 — 绝不做写操作，降低平台关注度
6. Session复用 — Cookie有效时不重复登录
7. 失败退避 — 失败后指数退避重试（5s/30s/5min）
```

---

## 九、实施计划（修订版）

```
Wave 1（第1-2周） — 基础框架 + 第一条通路
├── Day 1-3: Playwright环境 + BasePlatformRPA基类 + BankRPA基类
├── Day 4-5: 多租户银行账户数据模型 + 管理员绑定UI
├── Day 6-8: 光大个人网银RPA脚本（登录→下载流水→解析→入库）
├── Day 9-10: 抖店RPA脚本（Cookie管理→结算单采集→数据标准化）
└── 产出: 光大个人卡流水 + 抖店结算单 自动入库

Wave 2（第3-4周） — 支付API + 更多平台
├── Day 11-13: 微信支付商户API对接（交易明细/对账单/余额）
├── Day 14-16: 支付宝商户API对接
├── Day 17-19: 美团/闪购RPA脚本
├── Day 20: 京东到家RPA脚本
└── 产出: 支付回款自动追踪 + 4个渠道结算数据

Wave 3（第5-6周） — 对账引擎 + 投放数据
├── Day 21-23: 自动对账引擎（三单匹配）
├── Day 24-26: 千川/投放数据采集
├── Day 27-28: 视频号数据采集（微信商户API覆盖财务，RPA补运营）
├── Day 29-30: 渠道口径映射表落地 + 跨渠道利润计算
└── 产出: 全渠道自动对账 + 渠道真实利润

Wave 4（第7-8周） — 银企直联 + 全线打通
├── 光大银企直联上线（取决于银行侧进度）
├── 招商个人卡RPA（如需要）
├── 采集调度系统 + 监控告警
├── 财务工作台集成（结算数据→自动凭证）
├── 指挥中心数据源监控面板
└── 产出: 全部数据通路打通，财务80%工作自动化

持续运维
├── 平台改版 → 更新RPA脚本
├── Cookie过期 → 告警+管理员刷新
├── 新租户接入 → 灵活配置银行/平台账户
└── API替换 → 平台开放API后逐步替换RPA
```

---

## 十、与现有架构的关系

```
docs/03 ERP统一接口规范
  └── RPAAdapter（已定义接口） → 本文档是其技术实现方案

docs/14 RPA数据桥梁方案（v1）
  └── 概念设计 → 本文档升级为可执行方案（含银行RPA+数据模型+口径映射）

docs/09 财务板块专业升级
  └── 会计/出纳工作台 → 消费本文档采集的数据（结算单→凭证，银行流水→对账）

docs/13 运营板块专业升级
  └── 运营看板 → 消费本文档采集的经营数据和投放数据

docs/15 超管指挥中心
  └── 指挥中心 → 消费本文档汇聚的全渠道数据 + 数据源监控面板
```

---

## 附录A：关键风险与应对

| 风险 | 概率 | 影响 | 应对 | 负责人 |
|------|------|------|------|--------|
| 光大个人网银改版 | 中 | 中 | 模块化脚本，改版只改一个文件 | RPA工程师 |
| 银行触发短信验证 | 中 | 低 | 固定IP+飞书通知管理员 | RPA工程师 |
| 抖店Cookie频繁过期 | 中 | 低 | Cookie监控+管理员扫码 | RPA工程师 |
| 美团检测RPA | 低 | 中 | 低频+反检测+只读 | RPA工程师 |
| 银企直联申请延迟 | 中 | 低 | 对公卡临时走手工导入 | 创始人 |
| 平台口径理解错误 | 中 | 高 | 口径映射表+交叉验证 | 数据架构师 |
