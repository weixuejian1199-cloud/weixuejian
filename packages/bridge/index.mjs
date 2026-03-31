/**
 * 飞书 <-> Claude Code Bridge (生产版)
 *
 * 企业AI工作站 Phase 1b — US-P1b-006A
 *
 * 长连接模式：
 * - 飞书 WebSocket 长连接接收消息
 * - spawn Claude Code CLI 处理请求
 * - 按 chatId 隔离并发（不同聊天可并行，同聊天串行）
 * - 会话内存 Map + TTL 自动过期
 *
 * 启动: PROJECT_DIR=/app FEISHU_APP_ID=xxx FEISHU_APP_SECRET=xxx node index.mjs
 */
import * as lark from '@larksuiteoapi/node-sdk';
import { spawn } from 'node:child_process';
import { config } from './lib/config.mjs';
import { log } from './lib/logger.mjs';
import { initFeishuCard } from './lib/feishu-card.mjs';
import { initDecisionEngine, drainPendingItems } from './lib/decision-engine.mjs';
import { startInspector, getLatestReport, stopInspector } from './agents/inspector.mjs';

// ─── 飞书客户端 ──────────────────────────────────────────

const client = new lark.Client({
  appId: config.feishu.appId,
  appSecret: config.feishu.appSecret,
  appType: lark.AppType.SelfBuild,
  domain: lark.Domain.Feishu,
});

// ─── 会话管理（按 chatId 维护 session + TTL 过期）────────

const sessions = new Map(); // chatId → { sessionId, updatedAt }

function getSessionId(chatId) {
  const entry = sessions.get(chatId);
  if (!entry) return null;
  if (Date.now() - entry.updatedAt > config.bridge.sessionTtlMs) {
    sessions.delete(chatId);
    log.info({ chatId }, 'Session expired (TTL)');
    return null;
  }
  return entry.sessionId;
}

function saveSessionId(chatId, sessionId) {
  sessions.set(chatId, { sessionId, updatedAt: Date.now() });
  log.debug({ chatId, sessionId: sessionId.slice(0, 8) }, 'Session saved');
}

function clearSession(chatId) {
  sessions.delete(chatId);
  log.info({ chatId }, 'Session cleared');
}

// 定期清理过期 session（每 30 分钟）
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [chatId, entry] of sessions) {
    if (now - entry.updatedAt > config.bridge.sessionTtlMs) {
      sessions.delete(chatId);
      cleaned++;
    }
  }
  if (cleaned > 0) log.info({ cleaned, remaining: sessions.size }, 'Session cleanup');
}, 30 * 60 * 1000);

// ─── 防重复（60秒窗口）─────────────────────────────────

const processedMessages = new Map();

const DEDUP_WINDOW_MS = 300_000; // 5分钟去重窗口（防飞书webhook重试）
const MAX_INPUT_LENGTH = 10_000; // 输入最大10KB，防OOM

// ─── UTF-8 输入有效性检查 ────────────────────────────────

function isValidUtf8Text(str) {
  // 检查是否只包含可打印字符和常见中文/标点
  // 拒绝控制字符（除了换行\n/回车\r/制表\t）
  return typeof str === 'string' && !/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(str);
}

function isDuplicate(messageId) {
  if (processedMessages.has(messageId)) return true;
  processedMessages.set(messageId, Date.now());
  // 清理过期条目
  const now = Date.now();
  for (const [id, time] of processedMessages) {
    if (now - time > DEDUP_WINDOW_MS) processedMessages.delete(id);
  }
  return false;
}

// ─── 按 chatId 隔离的并发控制 ───────────────────────────

const chatLocks = new Map();  // chatId → { processing: boolean, queue: fn[] }

async function enqueueTask(chatId, fn) {
  if (!chatLocks.has(chatId)) {
    chatLocks.set(chatId, { processing: false, queue: [] });
  }
  const lock = chatLocks.get(chatId);

  if (!lock.processing) {
    lock.processing = true;
    try {
      await fn();
    } finally {
      lock.processing = false;
      if (lock.queue.length > 0) {
        const next = lock.queue.shift();
        enqueueTask(chatId, next).catch((err) => {
          log.error({ chatId, err: err.message }, 'Queued task failed');
        });
      } else {
        chatLocks.delete(chatId); // 清理空锁
      }
    }
  } else {
    if (lock.queue.length >= config.bridge.maxQueueSize) {
      log.warn({ chatId, queueSize: lock.queue.length }, 'Queue full, dropping message');
      return;
    }
    lock.queue.push(fn);
    log.debug({ chatId, queueSize: lock.queue.length }, 'Task queued');
  }
}

// ─── 简易限流（按 chatId，每分钟 N 条）─────────────────

const rateCounts = new Map(); // chatId → { count, resetAt }

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
      '--output-format', 'json',
      '--max-turns', String(maxTurns),
      '--dangerously-skip-permissions',
      '--system-prompt',
      `你通过飞书接收创始人魏雪健的消息。你是企业AI工作站项目的CTO和技术合伙人。
项目目录：${config.projectDir}
项目：企业级AI操作系统(SaaS)，核心价值是用AI串联多个系统。技术栈Node.js/TypeScript/Express/Prisma/PostgreSQL/Redis。
当前状态：Phase 1a已完成（91测试全绿），Phase 1b进行中。MallAdapter已接入ztdy-open 6个API。
严格遵守：1.日常回复100字以内，项目报告200字以内 2.禁止表情符号 3.像朋友对话简洁直接 4.不要主动读文档（CLAUDE.md/brain.json等），除非老板明确要求。飞书是日常通道，省token。
注意：你只负责企业AI工作站项目。`,
    ];

    if (sessionId) {
      args.push('--resume', sessionId);
    }

    log.info({ sessionId: sessionId?.slice(0, 8), msgPreview: message.slice(0, 60) }, 'Calling Claude');

    const proc = spawn('claude', args, {
      cwd: config.projectDir,
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
        const parsed = JSON.parse(stdout);
        resolve(parsed);
      } catch (parseErr) {
        // 非零退出码 + JSON解析失败 = 真正的错误，不应静默降级
        if (code !== 0) {
          log.error({ code, stderr: stderr.slice(0, 300), stdout: stdout.slice(0, 300) }, 'Claude exited with error');
          reject(new Error(stderr.slice(0, 200) || stdout.slice(0, 200) || `进程异常退出 code ${code}`));
          return;
        }
        // 零退出码但非JSON = CLI输出了纯文本（兼容旧版本）
        log.warn({ parseErr: parseErr.message, stdoutLen: stdout.length }, 'Non-JSON stdout from Claude, wrapping as result');
        resolve({ type: 'result', result: stdout.slice(0, 2000) || '(无输出内容)' });
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

  const chatId = message.chat_id;
  const senderId = sender?.sender_id?.open_id ?? 'unknown';

  if (message.message_type !== 'text') {
    await sendText(chatId, '目前只支持文本消息。');
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

  // UTF-8 有效性校验（拒绝包含控制字符的恶意输入）
  if (!isValidUtf8Text(text)) {
    log.warn({ senderId, chatId }, 'Invalid message content rejected');
    await sendText(chatId, '消息包含无效字符，请重新输入');
    return;
  }

  // 输入长度校验（防止超大消息打爆内存）
  if (text.length > MAX_INPUT_LENGTH) {
    await sendText(chatId, `消息太长了（${text.length}字），最多支持${MAX_INPUT_LENGTH}字。请精简后重发。`);
    return;
  }

  log.info({ senderId, chatId, text: text.slice(0, 100) }, 'Message received');

  // 限流检查
  if (isRateLimited(chatId)) {
    await sendText(chatId, '消息太频繁了，稍等一下再发。');
    return;
  }

  // 特殊指令
  if (text.trim() === '新对话' || text.trim() === '重置') {
    clearSession(chatId);
    await sendText(chatId, '新对话已开始。');
    return;
  }

  if (text.trim() === '状态') {
    const sessionId = getSessionId(chatId);
    const latest = getLatestReport();
    const inspectorStatus = latest
      ? `Inspector: ${latest.overallStatus} (${latest.timestamp.slice(11, 19)})`
      : 'Inspector: not yet run';
    const info = [
      `Sessions: ${sessions.size}`,
      `Current: ${sessionId ? sessionId.slice(0, 8) : 'none'}`,
      `Uptime: ${(process.uptime() / 3600).toFixed(1)}h`,
      `Memory: ${(process.memoryUsage.rss() / 1024 / 1024).toFixed(0)}MB`,
      inspectorStatus,
    ].join('\n');
    await sendText(chatId, info);
    return;
  }

  // 主动汇报待处理事项（老板发消息时）
  const pendingItems = drainPendingItems();
  if (pendingItems.length > 0) {
    const summary = pendingItems.map(p => `- [${p.source}] ${p.summary}`).join('\n');
    await sendText(chatId, `[启元提醒] 有${pendingItems.length}条待处理:\n${summary}\n\n现在处理你的消息...`);
  }

  // 入队处理
  enqueueTask(chatId, async () => {
    try {
      const startTime = Date.now();
      const sessionId = getSessionId(chatId);
      const result = await callClaude(text, sessionId);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      if (result.session_id) {
        saveSessionId(chatId, result.session_id);
      }

      const answer = result.result || result.error || '(没有返回内容)';
      const maxLen = config.bridge.maxResponseLen;

      if (answer.length > maxLen) {
        // 分段发送
        const part1 = answer.slice(0, maxLen);
        await sendText(chatId, part1 + '\n...(消息过长，已截断)');
      } else {
        await sendText(chatId, answer);
      }

      log.info({ chatId, elapsed: `${elapsed}s`, sessionId: result.session_id?.slice(0, 8) }, 'Response sent');
    } catch (err) {
      log.error({ chatId, err: err.message }, 'Claude call failed');
      await sendText(chatId, `出了点问题：${err.message}`);
    }
  });
}

// ─── 发送飞书消息（带重试）─────────────────────────────

async function sendText(chatId, text, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          msg_type: 'text',
          content: JSON.stringify({ text }),
        },
      });
      return true;
    } catch (err) {
      if (attempt === retries) {
        log.error({ chatId, err: err.message, attempts: attempt + 1 }, 'Send failed (all retries exhausted)');
        return false;
      }
      log.warn({ chatId, err: err.message, attempt: attempt + 1 }, 'Send failed, retrying...');
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  return false;
}

// ─── 启动 ────────────────────────────────────────────────

sessions.clear();
log.info({
  projectDir: config.projectDir,
  timeoutMs: config.bridge.timeoutMs,
  maxTurns: config.bridge.maxTurns,
  rateLimitPerMin: config.bridge.rateLimitPerMin,
}, 'Bridge starting');

// 初始化 Agent 系统
initFeishuCard(client);
initDecisionEngine({ bossChatId: config.agents.bossChatId });
startInspector();
log.info('Agent system initialized (inspector active)');

const wsClient = new lark.WSClient({
  appId: config.feishu.appId,
  appSecret: config.feishu.appSecret,
  loggerLevel: lark.LoggerLevel.info,
  domain: lark.Domain.Feishu,
});

wsClient.start({
  eventDispatcher: new lark.EventDispatcher({}).register({
    'im.message.receive_v1': async (data) => {
      try {
        await handleMessage(data);
      } catch (err) {
        log.error({ err: err.message }, 'Unhandled error in message handler');
      }
      return {};
    },
  }),
});

log.info('Waiting for Feishu messages...');

// 优雅关闭
function shutdown(signal) {
  log.info({ signal }, 'Shutdown signal received');
  stopInspector();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  log.fatal({ err: err.message, stack: err.stack }, 'Uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  log.error({ reason: String(reason) }, 'Unhandled rejection');
});
