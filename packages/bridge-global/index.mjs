/**
 * 启序 — 全局 Claude Code Bridge
 *
 * 不绑定任何项目，日常对话、需求讨论、任何问题都能聊。
 * 轻量版：无巡检员、无决策引擎、无项目锁定。
 *
 * 启动: QIYUE_APP_ID=xxx QIYUE_APP_SECRET=xxx node index.mjs
 */
import * as lark from '@larksuiteoapi/node-sdk';
import { spawn } from 'node:child_process';
import { config } from './lib/config.mjs';
import { log } from './lib/logger.mjs';

// ─── 飞书客户端 ──────────────────────────────────────────

const client = new lark.Client({
  appId: config.feishu.appId,
  appSecret: config.feishu.appSecret,
  appType: lark.AppType.SelfBuild,
  domain: lark.Domain.Feishu,
});

// ─── 会话管理 ────────────────────────────────────────────

const sessions = new Map();

function getSessionId(chatId) {
  const entry = sessions.get(chatId);
  if (!entry) return null;
  if (Date.now() - entry.updatedAt > config.bridge.sessionTtlMs) {
    sessions.delete(chatId);
    return null;
  }
  return entry.sessionId;
}

function saveSessionId(chatId, sessionId) {
  sessions.set(chatId, { sessionId, updatedAt: Date.now() });
}

function clearSession(chatId) {
  sessions.delete(chatId);
}

// 定期清理过期 session
setInterval(() => {
  const now = Date.now();
  for (const [chatId, entry] of sessions) {
    if (now - entry.updatedAt > config.bridge.sessionTtlMs) sessions.delete(chatId);
  }
}, 30 * 60 * 1000);

// ─── 防重复 + 校验 ──────────────────────────────────────

const processedMessages = new Map();
const DEDUP_WINDOW_MS = 300_000;
const MAX_INPUT_LENGTH = 10_000;

function isDuplicate(messageId) {
  if (processedMessages.has(messageId)) return true;
  processedMessages.set(messageId, Date.now());
  const now = Date.now();
  for (const [id, time] of processedMessages) {
    if (now - time > DEDUP_WINDOW_MS) processedMessages.delete(id);
  }
  return false;
}

// ─── 并发控制 ────────────────────────────────────────────

const chatLocks = new Map();

async function enqueueTask(chatId, fn) {
  if (!chatLocks.has(chatId)) chatLocks.set(chatId, { processing: false, queue: [] });
  const lock = chatLocks.get(chatId);

  if (!lock.processing) {
    lock.processing = true;
    try { await fn(); }
    finally {
      lock.processing = false;
      if (lock.queue.length > 0) {
        const next = lock.queue.shift();
        enqueueTask(chatId, next).catch(err => log.error({ err: err.message }, 'Queued task failed'));
      } else {
        chatLocks.delete(chatId);
      }
    }
  } else {
    if (lock.queue.length >= config.bridge.maxQueueSize) return;
    lock.queue.push(fn);
  }
}

// ─── 限流 ────────────────────────────────────────────────

const rateCounts = new Map();

function isRateLimited(chatId) {
  const now = Date.now();
  const entry = rateCounts.get(chatId);
  if (!entry || now > entry.resetAt) {
    rateCounts.set(chatId, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  entry.count++;
  return entry.count > config.bridge.rateLimitPerMin;
}

// ─── 调用 Claude Code CLI ────────────────────────────────

function callClaude(message, sessionId) {
  const { timeoutMs, maxTurns } = config.bridge;

  return new Promise((resolve, reject) => {
    const args = [
      '-p',
      '--bare',
      '--output-format', 'json',
      '--max-turns', String(maxTurns),
      '--dangerously-skip-permissions',
      '--system-prompt',
      `你是启序，大魏的全局AI助手，通过飞书聊天。可以聊任何话题。
绝对禁止：markdown格式（**加粗**、- 列表、\`代码\`等一律不准用）、表情符号。
回复方式：纯文本，100字以内，像微信跟朋友聊天一样说人话。不要分点、不要列举、不要用标题。
不要主动读任何文档，除非大魏要求。`,
    ];

    if (sessionId) args.push('--resume', sessionId);

    log.info({ sessionId: sessionId?.slice(0, 8), msgPreview: message.slice(0, 60) }, 'Calling Claude');

    const proc = spawn('claude', args, {
      cwd: process.env.QIXU_WORK_DIR || `${process.env.HOME}/claude-workspace/claude渠道/启序`,
      env: { ...process.env, LANG: 'en_US.UTF-8' },
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: timeoutMs,
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
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
        if (code !== 0) {
          reject(new Error(stderr.slice(0, 200) || stdout.slice(0, 200) || `进程异常退出 code ${code}`));
          return;
        }
        resolve({ type: 'result', result: stdout.slice(0, 2000) || '(无输出内容)' });
      }
    });

    proc.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

// ─── 处理飞书消息 ────────────────────────────────────────

async function handleMessage(data) {
  const message = data?.message;
  if (!message?.message_id) return;
  if (isDuplicate(message.message_id)) return;

  const chatId = message.chat_id;

  if (message.message_type !== 'text') {
    await sendText(chatId, '目前只支持文本消息。');
    return;
  }

  let text;
  try { text = JSON.parse(message.content).text; } catch { return; }
  if (!text || text.trim() === '') return;
  if (text.length > MAX_INPUT_LENGTH) {
    await sendText(chatId, `消息太长了（${text.length}字），最多${MAX_INPUT_LENGTH}字。`);
    return;
  }

  log.info({ chatId, text: text.slice(0, 100) }, 'Message received');

  if (isRateLimited(chatId)) {
    await sendText(chatId, '消息太频繁了，稍等一下再发。');
    return;
  }

  if (text.trim() === '新对话' || text.trim() === '重置') {
    clearSession(chatId);
    await sendText(chatId, '新对话已开始。');
    return;
  }

  if (text.trim() === '状态') {
    const info = [
      `Sessions: ${sessions.size}`,
      `Uptime: ${(process.uptime() / 3600).toFixed(1)}h`,
      `Memory: ${(process.memoryUsage.rss() / 1024 / 1024).toFixed(0)}MB`,
    ].join('\n');
    await sendText(chatId, info);
    return;
  }

  enqueueTask(chatId, async () => {
    try {
      const sessionId = getSessionId(chatId);
      const result = await callClaude(text, sessionId);

      if (result.session_id) saveSessionId(chatId, result.session_id);

      const answer = result.result || result.error || '(没有返回内容)';
      const maxLen = config.bridge.maxResponseLen;

      if (answer.length > maxLen) {
        await sendText(chatId, answer.slice(0, maxLen) + '\n...(已截断)');
      } else {
        await sendText(chatId, answer);
      }
    } catch (err) {
      log.error({ chatId, err: err.message }, 'Claude call failed');
      await sendText(chatId, `出了点问题：${err.message}`);
    }
  });
}

// ─── 发送飞书消息 ────────────────────────────────────────

async function sendText(chatId, text, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: { receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text }) },
      });
      return true;
    } catch (err) {
      if (attempt === retries) {
        log.error({ chatId, err: err.message }, 'Send failed');
        return false;
      }
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  return false;
}

// ─── 启动 ────────────────────────────────────────────────

log.info('启序 (Global Claude Code Bridge) starting');

const wsClient = new lark.WSClient({
  appId: config.feishu.appId,
  appSecret: config.feishu.appSecret,
  loggerLevel: lark.LoggerLevel.info,
  domain: lark.Domain.Feishu,
});

wsClient.start({
  eventDispatcher: new lark.EventDispatcher({}).register({
    'im.message.receive_v1': async (data) => {
      try { await handleMessage(data); }
      catch (err) { log.error({ err: err.message }, 'Unhandled error'); }
      return {};
    },
  }),
});

log.info('Waiting for Feishu messages...');

process.on('SIGTERM', () => { log.info('Shutdown'); process.exit(0); });
process.on('SIGINT', () => { log.info('Shutdown'); process.exit(0); });
process.on('uncaughtException', (err) => { log.fatal({ err: err.message }, 'Uncaught exception'); process.exit(1); });
process.on('unhandledRejection', (reason) => { log.error({ reason: String(reason) }, 'Unhandled rejection'); });
