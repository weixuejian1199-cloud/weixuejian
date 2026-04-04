/**
 * 查询飞书机器人所在群列表，获取 chat_id
 * 运行：npx tsx src/scripts/get-feishu-chat-id.ts
 */

const APP_ID     = 'cli_a94037c0ec38dbd2';   // 启元
const APP_SECRET = 'mwLiexfwzGVaylW2T5kKJh1bVRE0TYZM';

async function main() {
  // Step 1: 获取 tenant_access_token
  const tokenRes = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
  });
  const tokenData = await tokenRes.json() as { code: number; tenant_access_token?: string; msg?: string };

  if (tokenData.code !== 0 || !tokenData.tenant_access_token) {
    console.error('❌ 获取 Token 失败:', tokenData.msg);
    process.exit(1);
  }
  const token = tokenData.tenant_access_token;
  console.log('✅ Token 获取成功\n');

  // Step 2: 拉取机器人所在群列表
  const chatRes = await fetch('https://open.feishu.cn/open-apis/im/v1/chats?member_id_type=app_id&page_size=20', {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  const chatData = await chatRes.json() as {
    code: number;
    msg?: string;
    data?: { items?: Array<{ chat_id: string; name: string; description: string }> };
  };

  if (chatData.code !== 0) {
    console.error('❌ 获取群列表失败:', chatData.msg);
    console.log('\n💡 可能原因：启元机器人还没加入任何群。请先在飞书中把「启元」机器人添加到目标群。');
    process.exit(1);
  }

  const chats = chatData.data?.items ?? [];
  if (chats.length === 0) {
    console.log('⚠️  启元机器人还没加入任何群。\n');
    console.log('操作步骤：');
    console.log('1. 打开飞书，进入你想接收告警的群');
    console.log('2. 点击群右上角「设置」→「群机器人」→「添加机器人」');
    console.log('3. 搜索「启元」，添加进群');
    console.log('4. 再运行本脚本，就能看到 chat_id 了');
    return;
  }

  console.log(`找到 ${chats.length} 个群：\n`);
  console.log('━'.repeat(60));
  chats.forEach((chat, i) => {
    console.log(`${i + 1}. 群名：${chat.name}`);
    console.log(`   chat_id：${chat.chat_id}`);
    if (chat.description) console.log(`   描述：${chat.description}`);
    console.log('');
  });
  console.log('━'.repeat(60));
  console.log('\n把目标群的 chat_id 填入 .env：');
  console.log('ALERT_FEISHU_APP_ID=cli_a94037c0ec38dbd2');
  console.log('ALERT_FEISHU_APP_SECRET=mwLiexfwzGVaylW2T5kKJh1bVRE0TYZM');
  console.log('ALERT_FEISHU_CHAT_ID=<上面的 chat_id>');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
