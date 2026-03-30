/**
 * 飞书 ↔ Claude Code Bridge
 *
 * 长连接模式 + 会话记忆：
 * - 每个飞书聊天维护一个 Claude Code session
 * - 多轮对话有上下文
 * - 发「新对话」重置会话
 *
 * 启动: FEISHU_APP_ID=xxx FEISHU_APP_SECRET=xxx node index.mjs
 */
import * as lark from '@larksuiteoapi/node-sdk';
import { spawn } from 'node:child_process';

const APP_ID = process.env.FEISHU_APP_ID ?? '';
const APP_SECRET = process.env.FEISHU_APP_SECRET ?? '';
const PROJECT_DIR = '/Users/weixuejian/claude-workspace/企业ai工作站/enterprise-workstation';

if (!APP_ID || !APP_SECRET) {
  console.error('FEISHU_APP_ID 和 FEISHU_APP_SECRET 未配置');
  process.exit(1);
}

// ─── 飞书客户端 ──────────────────────────────────────────

const client = new lark.Client({
  appId: APP_ID,
  appSecret: APP_SECRET,
  appType: lark.AppType.SelfBuild,
  domain: lark.Domain.Feishu,
});

// ─── 会话管理（每个 chatId 维护一个 session）──────────────

const sessions = new Map(); // chatId → sessionId

function getSessionId(chatId) {
  return sessions.get(chatId) ?? null;
}

function saveSessionId(chatId, sessionId) {
  sessions.set(chatId, sessionId);
  console.log(`📝 会话已保存: ${chatId} → ${sessionId}`);
}

function clearSession(chatId) {
  sessions.delete(chatId);
  console.log(`🔄 会话已重置: ${chatId}`);
}

// ─── 防重复 ──────────────────────────────────────────────

const processedMessages = new Map();

function isDuplicate(messageId) {
  if (processedMessages.has(messageId)) return true;
  processedMessages.set(messageId, Date.now());
  for (const [id, time] of processedMessages) {
    if (Date.now() - time > 60_000) processedMessages.delete(id);
  }
  return false;
}

// ─── 并发锁 ──────────────────────────────────────────────

let isProcessing = false;
const taskQueue = [];

async function enqueueTask(fn) {
  if (!isProcessing) {
    isProcessing = true;
    try {
      await fn();
    } finally {
      isProcessing = false;
      if (taskQueue.length > 0) {
        const next = taskQueue.shift();
        enqueueTask(next);
      }
    }
  } else {
    taskQueue.push(fn);
    console.log(`📋 排队中，队列: ${taskQueue.length}`);
  }
}

// ─── 调用 Claude Code CLI ────────────────────────────────

function callClaude(message, sessionId, timeoutMs = 180_000) {
  return new Promise((resolve, reject) => {
    const args = [
      '-p',
      '--output-format', 'json',
      '--max-turns', '5',
      '--dangerously-skip-permissions',
      '--append-system-prompt',
      '你现在通过飞书接收消息。跟你说话的是创始人魏雪健（雪健）。你是他的CTO和技术合伙人，负责企业AI工作站的一切开发。用中文自然地回答，像朋友对话一样。不要说"准备就绪"或"请告诉我任务"之类的话，直接回应。',
    ];

    // 有 sessionId 则恢复会话（上下文记忆）
    if (sessionId) {
      args.push('--resume', sessionId);
    }

    console.log(`🤖 Claude${sessionId ? '(续)' : '(新)'}: "${message.slice(0, 60)}"`);

    const proc = spawn('claude', args, {
      cwd: PROJECT_DIR,
      env: { ...process.env, LANG: 'en_US.UTF-8' },
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: timeoutMs,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.stdin.write(message);
    proc.stdin.end();

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error('处理超时了，请重试或发「新对话」重置'));
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && !stdout) {
        reject(new Error(stderr.slice(0, 200) || `进程退出 code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve({ type: 'result', result: stdout.slice(0, 2000) || stderr.slice(0, 500) });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ─── 处理飞书消息 ────────────────────────────────────────

async function handleMessage(data) {
  const message = data?.message;
  const sender = data?.sender;

  if (!message?.message_id) return;
  if (isDuplicate(message.message_id)) return;

  if (message.message_type !== 'text') {
    await sendText(message.chat_id, '目前只支持文本消息，图片和语音暂时还看不了。');
    return;
  }

  let text;
  try {
    const content = JSON.parse(message.content);
    text = content.text;
  } catch {
    return;
  }

  if (!text || text.trim() === '') return;

  const chatId = message.chat_id;
  console.log(`\n📨 [${sender?.sender_id?.open_id}]: ${text.slice(0, 100)}`);

  // 「新对话」指令：重置会话
  if (text.trim() === '新对话' || text.trim() === '重置') {
    clearSession(chatId);
    await sendText(chatId, '好的，新对话开始。有什么需要？');
    return;
  }

  enqueueTask(async () => {
    try {
      const startTime = Date.now();
      const sessionId = getSessionId(chatId);

      const result = await callClaude(text, sessionId);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      // 保存 session_id 用于下次 --resume
      if (result.session_id) {
        saveSessionId(chatId, result.session_id);
      }

      const answer = result.result || result.error || '(没有返回内容)';

      const maxLen = 4000;
      const truncated = answer.length > maxLen
        ? answer.slice(0, maxLen) + '\n...(过长已截断，发「继续」看后续)'
        : answer;

      await sendText(chatId, truncated);
      console.log(`✅ 完成 (${elapsed}s, session: ${result.session_id?.slice(0, 8)})`);
    } catch (err) {
      console.error('❌ 失败:', err.message);
      await sendText(chatId, `抱歉出了点问题：${err.message}`);
    }
  });
}

// ─── 发送飞书消息 ────────────────────────────────────────

async function sendText(chatId, text) {
  try {
    await client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      },
    });
  } catch (err) {
    console.error(`发送失败: ${err.message}`);
  }
}

// ─── 启动 ────────────────────────────────────────────────

console.log('🚀 飞书 ↔ Claude Code Bridge');
console.log(`   项目: ${PROJECT_DIR}`);
console.log(`   指令: 发「新对话」重置会话，发「重置」同效`);
console.log('');

const wsClient = new lark.WSClient({
  appId: APP_ID,
  appSecret: APP_SECRET,
  loggerLevel: lark.LoggerLevel.info,
  domain: lark.Domain.Feishu,
});

wsClient.start({
  eventDispatcher: new lark.EventDispatcher({}).register({
    'im.message.receive_v1': async (data) => {
      try { await handleMessage(data); } catch (err) { console.error('异常:', err); }
      return {};
    },
  }),
});

console.log('✅ 等待飞书消息...');

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
