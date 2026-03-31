/**
 * 飞书交互卡片构造器 + sendCard()
 *
 * 飞书卡片消息用于 Agent 告警、日报等结构化信息展示。
 * 颜色约定：green=正常 blue=信息 orange=警告 red=严重
 */
import { log } from './logger.mjs';

/** @type {import('@larksuiteoapi/node-sdk').Client | null} */
let feishuClient = null;

/**
 * 注入飞书客户端实例（由 index.mjs 启动时调用）
 * @param {import('@larksuiteoapi/node-sdk').Client} client
 */
export function initFeishuCard(client) {
  feishuClient = client;
}

/**
 * 根据严重性返回卡片 header 颜色
 * @param {'info' | 'warning' | 'error' | 'critical'} severity
 */
function headerColor(severity) {
  switch (severity) {
    case 'info': return 'blue';
    case 'warning': return 'orange';
    case 'error': return 'red';
    case 'critical': return 'red';
    default: return 'blue';
  }
}

/**
 * 构造飞书交互卡片 JSON
 * @param {Object} opts
 * @param {string} opts.title - 卡片标题
 * @param {'info' | 'warning' | 'error' | 'critical'} opts.severity
 * @param {string} opts.content - Markdown 正文
 * @returns {string} JSON string for msg_type: interactive
 */
export function buildCard({ title, severity, content }) {
  return JSON.stringify({
    config: { wide_screen_mode: true },
    header: {
      title: { content: title, tag: 'plain_text' },
      template: headerColor(severity),
    },
    elements: [
      {
        tag: 'div',
        text: { tag: 'lark_md', content },
      },
    ],
  });
}

/**
 * 发送飞书卡片消息（带重试）
 * @param {string} chatId
 * @param {Object} opts
 * @param {string} opts.title
 * @param {'info' | 'warning' | 'error' | 'critical'} opts.severity
 * @param {string} opts.content - lark_md 格式
 * @param {number} [retries=2]
 */
export async function sendCard(chatId, { title, severity, content }, retries = 2) {
  if (!feishuClient) {
    log.error('sendCard called before feishuClient initialized');
    return false;
  }

  const cardJson = buildCard({ title, severity, content });

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await feishuClient.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          msg_type: 'interactive',
          content: cardJson,
        },
      });
      return true;
    } catch (err) {
      if (attempt === retries) {
        log.error({ chatId, err: err.message, attempts: attempt + 1 }, 'sendCard failed (all retries exhausted)');
        return false;
      }
      log.warn({ chatId, err: err.message, attempt: attempt + 1 }, 'sendCard failed, retrying...');
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  return false;
}
