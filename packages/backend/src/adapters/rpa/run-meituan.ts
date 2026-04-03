/**
 * 美团 RPA 运行入口
 *
 * 用法：
 *   npx tsx src/adapters/rpa/run-meituan.ts                        # 采集最近 30 天
 *   npx tsx src/adapters/rpa/run-meituan.ts 2026-03-01 2026-03-31  # 指定日期范围
 *   npx tsx src/adapters/rpa/run-meituan.ts --slow                  # slowMo 调试模式
 *   npx tsx src/adapters/rpa/run-meituan.ts --dry-run               # 诊断模式：登录→截图→检查导出按钮
 *
 * 凭证从 .env.rpa 读取：
 *   MEITUAN_PHONE=15394461792
 *
 * 登录方式：手机号 + 短信验证码（需手动输入验证码）
 */
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { config } from 'dotenv';
import { MeituanRPA } from './platform/meituan-rpa.js';
import { RPAStorage } from './storage.js';

// 加载 .env.rpa
config({ path: path.join(process.cwd(), '.env.rpa') });

const phone = process.env['MEITUAN_PHONE'];

if (!phone) {
  process.stderr.write(
    '❌ 缺少凭证。请确保 .env.rpa 包含 MEITUAN_PHONE\n',
  );
  process.exit(1);
}

// 解析命令行参数
const args = process.argv.slice(2);
const slowMode = args.includes('--slow');
const dryRunMode = args.includes('--dry-run');
const dateArgs = args.filter((a) => !a.startsWith('--'));

let dateFrom: Date;
let dateTo: Date;

if (dateArgs.length >= 2 && dateArgs[0] && dateArgs[1]) {
  dateFrom = new Date(dateArgs[0]);
  dateTo = new Date(dateArgs[1]);
} else {
  dateTo = new Date();
  dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - 30);
}

const ENCRYPTION_KEY =
  process.env['RPA_ENCRYPTION_KEY'] ??
  crypto.randomBytes(32).toString('hex');

const dataDir = path.join(process.cwd(), 'rpa-data');

async function main(): Promise<void> {
  process.stdout.write(`\n🍜 美团结算单 RPA\n`);
  process.stdout.write(`📅 日期范围: ${dateFrom.toISOString().slice(0, 10)} ~ ${dateTo.toISOString().slice(0, 10)}\n`);
  const account = process.env['MEITUAN_ACCOUNT'] ?? '';
  if (account) {
    process.stdout.write(`👤 账号: ${account}\n`);
  }
  process.stdout.write(`📱 手机号: ${phone!.slice(0, 3)}****${phone!.slice(-4)}\n`);
  process.stdout.write(`🔧 模式: ${dryRunMode ? 'dry-run 诊断' : slowMode ? 'slowMo 调试' : '正常'}\n\n`);

  const rpa = new MeituanRPA({
    dataDir,
    phone: phone!,
    encryptionKey: ENCRYPTION_KEY,
    headless: false,
    slowMo: slowMode ? 1000 : 0,
  });

  if (dryRunMode) {
    const result = await rpa.dryRun();

    process.stdout.write(`\n🔍 dry-run 诊断结果\n`);
    process.stdout.write(`${'─'.repeat(50)}\n`);
    for (const log of result.logs) {
      process.stdout.write(`   ${log}\n`);
    }
    process.stdout.write(`${'─'.repeat(50)}\n`);
    process.stdout.write(`   到达结算页: ${result.reachedSettlement ? '✅' : '❌'}\n`);
    process.stdout.write(`   导出按钮:   ${result.exportButtonFound ? '✅' : '❌'}\n`);
    if (result.matchedSelector) {
      process.stdout.write(`   匹配选择器: ${result.matchedSelector}\n`);
    }
    process.stdout.write(`   当前 URL:   ${result.currentUrl}\n`);
    if (result.screenshotPath) {
      process.stdout.write(`   截图:       ${result.screenshotPath}\n`);
    }

    if (!result.exportButtonFound) {
      process.exit(1);
    }
    return;
  }

  const result = await rpa.collect({ dateFrom, dateTo });

  if (result.success) {
    process.stdout.write(`\n✅ 采集成功！\n`);
    process.stdout.write(`   结算单数: ${result.metadata.recordCount}\n`);
    process.stdout.write(`   耗时: ${((result.metadata.collectEndAt.getTime() - result.metadata.collectStartAt.getTime()) / 1000).toFixed(1)}s\n`);

    if (result.data.length > 0) {
      const storage = new RPAStorage(dataDir);
      const filepath = storage.saveSettlements('meituan', result.data);
      process.stdout.write(`   文件: ${filepath}\n`);
    }
  } else {
    process.stderr.write(`\n❌ 采集失败\n`);
    for (const err of result.errors) {
      process.stderr.write(`   [${err.stage}] ${err.message}\n`);
      if (err.screenshot) {
        process.stderr.write(`   截图: ${err.screenshot}\n`);
      }
    }
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`\n💥 未捕获错误: ${err}\n`);
  process.exit(1);
});
