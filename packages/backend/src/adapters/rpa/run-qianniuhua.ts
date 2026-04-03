/**
 * 牵牛花 RPA 运行入口
 *
 * 用法（在 packages/backend 目录）：
 *   npx tsx src/adapters/rpa/run-qianniuhua.ts --dry-run     # 首登推荐：登录→数据页→截图
 *   npx tsx src/adapters/rpa/run-qianniuhua.ts               # collect：数据页快照 → 落盘 inventory
 *   npx tsx src/adapters/rpa/run-qianniuhua.ts --slow        # 调试放慢
 *
 * 凭证（.env.rpa，勿提交仓库）任选其一：
 *   A) 账号名 + 密码
 *   B) 手机号 + 短信（可再加 QIANNIUHUA_ACCOUNT，先填账号再收码）
 *   C) 仅手机号短信登录
 *
 * 验证码：点「获取验证码」后，短信发到绑定手机。在终端出现提示时粘贴回车即可自动填入页面；
 * 或一次性：RPA_OTP_CODE=123456 npx tsx ...（勿提交历史记录）
 */
import { RPAStorage } from './storage.js';
import {
  loadQianniuhuaEnv,
  createQianniuhuaRpa,
  runQianniuhuaCollect,
} from '../../services/rpa/qianniuhua-runner.js';

async function main(): Promise<void> {
  const envLoad = loadQianniuhuaEnv();
  if (!envLoad.ok) {
    process.stderr.write(`❌ ${envLoad.message}\n`);
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const slowMode = args.includes('--slow');
  const dryRunMode = args.includes('--dry-run');
  const dataDir = envLoad.dataDir;

  process.stdout.write(`\n🌸 牵牛花 RPA\n`);
  if (envLoad.account) {
    process.stdout.write(`👤 账号名: ${envLoad.account.slice(0, 2)}***\n`);
  }
  if (envLoad.phone) {
    process.stdout.write(
      `📱 手机号: ${envLoad.phone.slice(0, 3)}****${envLoad.phone.slice(-4)}（收验证码用）\n`,
    );
  }
  process.stdout.write(
    `🔧 模式: ${dryRunMode ? 'dry-run 诊断' : slowMode ? 'slowMo 调试' : '正常'}\n\n`,
  );

  if (dryRunMode) {
    const rpa = createQianniuhuaRpa({ slowMo: slowMode ? 1000 : 0 });
    const result = await rpa.dryRun();
    process.stdout.write(`\n🔍 dry-run 结果\n`);
    process.stdout.write(`${'─'.repeat(50)}\n`);
    for (const log of result.logs) {
      process.stdout.write(`   ${log}\n`);
    }
    process.stdout.write(`${'─'.repeat(50)}\n`);
    process.stdout.write(
      `   到达牵牛花数据域: ${result.reachedSettlement ? '✅' : '❌'}\n`,
    );
    process.stdout.write(
      `   页面含导出/下载文案: ${result.exportButtonFound ? '✅' : '❌'}\n`,
    );
    process.stdout.write(`   当前 URL: ${result.currentUrl}\n`);
    if (result.screenshotPath) {
      process.stdout.write(`   截图: ${result.screenshotPath}\n`);
    }
    return;
  }

  const result = await runQianniuhuaCollect({ slowMo: slowMode ? 1000 : 0 });

  if (result.success) {
    process.stdout.write(
      `\n✅ collect 完成（记录条数: ${result.metadata.recordCount}，含页面快照 rawData）\n`,
    );
    const storage = new RPAStorage(dataDir);
    const filepath = storage.saveInventorySignals('qianniuhua', result.data);
    process.stdout.write(`   已写入: ${filepath}\n`);
  } else {
    process.stderr.write(`\n❌ 失败\n`);
    for (const err of result.errors) {
      process.stderr.write(`   [${err.stage}] ${err.message}\n`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`\n💥 ${err}\n`);
  process.exit(1);
});
