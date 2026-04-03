/**
 * 光大个人网银 RPA 运行入口
 *
 * 用法：
 *   npx tsx src/adapters/rpa/run-ceb.ts                    # 采集最近 30 天
 *   npx tsx src/adapters/rpa/run-ceb.ts 2026-03-01 2026-03-31  # 指定日期范围
 *   npx tsx src/adapters/rpa/run-ceb.ts --slow              # slowMo 调试模式
 *
 * 凭证从 .env.rpa 读取：
 *   CEB_LOGIN_ID=xxx
 *   CEB_PASSWORD=xxx
 */
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { config } from 'dotenv';
import { CebPersonalRPA } from './bank/ceb-personal-rpa.js';
import { RPAStorage } from './storage.js';

// 加载 .env.rpa
config({ path: path.join(process.cwd(), '.env.rpa') });

const loginId = process.env['CEB_LOGIN_ID'];
const password = process.env['CEB_PASSWORD'];

if (!loginId || !password) {
  process.stderr.write(
    '❌ 缺少凭证。请确保 .env.rpa 包含 CEB_LOGIN_ID 和 CEB_PASSWORD\n',
  );
  process.exit(1);
}

// 解析命令行参数
const args = process.argv.slice(2);
const slowMode = args.includes('--slow');
const dateArgs = args.filter((a) => !a.startsWith('--'));

let dateFrom: Date;
let dateTo: Date;

if (dateArgs.length >= 2 && dateArgs[0] && dateArgs[1]) {
  dateFrom = new Date(dateArgs[0]);
  dateTo = new Date(dateArgs[1]);
} else {
  // 默认最近 30 天
  dateTo = new Date();
  dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - 30);
}

// 生成或读取加密密钥
const ENCRYPTION_KEY =
  process.env['RPA_ENCRYPTION_KEY'] ??
  crypto.randomBytes(32).toString('hex');

const dataDir = path.join(process.cwd(), 'rpa-data');

async function main(): Promise<void> {
  process.stdout.write(`\n🏦 光大个人网银 RPA\n`);
  process.stdout.write(`📅 日期范围: ${dateFrom.toISOString().slice(0, 10)} ~ ${dateTo.toISOString().slice(0, 10)}\n`);
  process.stdout.write(`🔧 模式: ${slowMode ? 'slowMo 调试' : '正常'}\n\n`);

  const rpa = new CebPersonalRPA({
    dataDir,
    loginId: loginId!,
    password: password!,
    encryptionKey: ENCRYPTION_KEY,
    headless: false,  // 银行检测 headless 模式，必须用有头浏览器；部署到 ECS 后用 Xvfb 虚拟显示实现用户无感
    slowMo: slowMode ? 1000 : 0,
  });

  const result = await rpa.collect({ dateFrom, dateTo });

  if (result.success) {
    process.stdout.write(`\n✅ 采集成功！\n`);
    process.stdout.write(`   记录数: ${result.metadata.recordCount}\n`);
    process.stdout.write(`   耗时: ${((result.metadata.collectEndAt.getTime() - result.metadata.collectStartAt.getTime()) / 1000).toFixed(1)}s\n`);

    // 保存数据
    if (result.data.length > 0) {
      const storage = new RPAStorage(dataDir);
      const filepath = storage.saveTransactions('ceb_personal', result.data);
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
