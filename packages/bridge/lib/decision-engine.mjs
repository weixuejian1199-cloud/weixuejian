/**
 * 启元决策引擎 — 接收 Agent 汇报，分级决策，执行动作
 *
 * 核心原则：
 * - 启元可以"观察+记录+提醒"，不可以"执行+修改+部署"
 * - info → 静默记录
 * - warning → 自动处理（记录，下次老板来消息时汇报）
 * - error/critical → 立即通知老板
 *
 * 告警去重：同类告警 30 分钟内只发一次
 * 连续升级：warning 连续 3 次自动升级为 notify_boss
 */
import { log } from './logger.mjs';
import { sendCard } from './feishu-card.mjs';
import { eventBus } from './event-bus.mjs';

/** @type {string | null} 老板的 chatId，由 config 注入 */
let bossChatId = null;

/** @type {import('../agents/types.mjs').Decision[]} 待汇报事项队列 */
const pendingItems = [];

/** @type {Map<string, number>} 告警去重：key → lastAlertTime */
const alertDedup = new Map();
const ALERT_DEDUP_MS = 30 * 60 * 1000; // 30分钟

/** @type {Map<string, number>} warning 连续计数：checkName → count */
const warningStreaks = new Map();
const WARNING_ESCALATE_THRESHOLD = 3;

/**
 * 初始化决策引擎
 * @param {Object} opts
 * @param {string} opts.bossChatId
 */
export function initDecisionEngine({ bossChatId: id }) {
  bossChatId = id;

  // 监听 Agent 汇报
  eventBus.on('agent:report', async (report) => {
    try {
      const decision = evaluate(report);
      await execute(decision);
    } catch (err) {
      log.error({ err: err.message, agent: report.agent }, 'Decision engine error');
    }
  });

  log.info({ bossChatId: id ? id.slice(0, 8) : 'not-set' }, 'Decision engine initialized');
}

/**
 * 评估 Agent 汇报，输出决策
 * @param {import('../agents/types.mjs').AgentReport} report
 * @returns {import('../agents/types.mjs').Decision}
 */
export function evaluate(report) {
  switch (report.agent) {
    case 'sentinel': return evaluateSentinel(report);
    case 'reviewer': return evaluateReviewer(report);
    case 'inspector': return evaluateInspector(report);
    default:
      return { action: 'log_only', severity: 'info', summary: '未知Agent汇报', details: JSON.stringify(report), source: report.agent };
  }
}

/**
 * 哨兵决策
 * @param {import('../agents/types.mjs').SentinelReport} report
 */
function evaluateSentinel(report) {
  if (report.ciResult === 'pass') {
    return {
      action: 'log_only',
      severity: 'info',
      summary: `CI通过 ${report.ref}@${report.commitSha.slice(0, 7)}`,
      details: '',
      source: 'sentinel',
    };
  }

  // CI 失败
  const { details, failedTests } = report;

  // session-guard RULE 违规 → 直接通知
  if (details.guardViolations?.length > 0) {
    return {
      action: 'notify_boss',
      severity: 'error',
      summary: `RULE违规 ${report.ref}@${report.commitSha.slice(0, 7)}`,
      details: [
        `**[启元告警] Session Guard 规则违规**`,
        `**分支**: ${report.ref}`,
        `**提交**: ${report.commitSha.slice(0, 7)} ${report.commitMessage}`,
        `**违规项**:`,
        ...details.guardViolations.map(v => `- ${v}`),
      ].join('\n'),
      source: 'sentinel',
    };
  }

  // 测试失败 → 通知
  if (!details.test && failedTests?.length > 0) {
    return {
      action: 'notify_boss',
      severity: 'error',
      summary: `测试失败(${failedTests.length}个) ${report.ref}`,
      details: [
        `**[启元告警] 测试从绿变红**`,
        `**分支**: ${report.ref} | **提交**: ${report.commitSha.slice(0, 7)}`,
        `**提交信息**: ${report.commitMessage}`,
        `**失败测试**:`,
        ...failedTests.slice(0, 10).map(t => `- ${t}`),
        failedTests.length > 10 ? `...及其他${failedTests.length - 10}个` : '',
        '',
        '建议: 优先修复，测试红了不能继续推进。',
      ].filter(Boolean).join('\n'),
      source: 'sentinel',
    };
  }

  // lint/typecheck 失败但测试通过 → 自动处理
  if (!details.lint || !details.typeCheck) {
    return {
      action: 'auto_handle',
      severity: 'warning',
      summary: `${!details.lint ? 'Lint' : 'TypeCheck'}失败 ${report.ref}`,
      details: `CI lint/typecheck 失败 (${report.ref}@${report.commitSha.slice(0, 7)})，测试通过。下次提交时注意。`,
      source: 'sentinel',
    };
  }

  // 构建失败 → 通知
  return {
    action: 'notify_boss',
    severity: 'error',
    summary: `CI失败 ${report.ref}@${report.commitSha.slice(0, 7)}`,
    details: [
      `**[启元告警] CI 构建失败**`,
      `**分支**: ${report.ref} | **提交**: ${report.commitSha.slice(0, 7)}`,
      `**提交信息**: ${report.commitMessage}`,
    ].join('\n'),
    source: 'sentinel',
  };
}

/**
 * 审查官决策
 * @param {import('../agents/types.mjs').ReviewerReport} report
 */
function evaluateReviewer(report) {
  const { verdict, riskLevel, prNumber, prTitle, findings, summary } = report;

  if (verdict === 'approve' && (riskLevel === 'low' || riskLevel === 'medium')) {
    return {
      action: 'log_only',
      severity: 'info',
      summary: `PR #${prNumber} 审查通过`,
      details: '',
      source: 'reviewer',
    };
  }

  if (riskLevel === 'high' || riskLevel === 'critical' || verdict === 'request_changes') {
    const findingsText = findings?.slice(0, 5).map(f =>
      `- [${f.severity.toUpperCase()}] ${f.file}:${f.line} — ${f.message} (${f.rule})`
    ).join('\n') ?? '';

    return {
      action: 'notify_boss',
      severity: riskLevel === 'critical' ? 'critical' : 'error',
      summary: `PR #${prNumber} 有${riskLevel === 'critical' ? '严重' : '高'}风险`,
      details: [
        `**[启元告警] PR审查发现风险**`,
        `**PR**: #${prNumber} ${prTitle}`,
        `**作者**: ${report.author}`,
        `**风险等级**: ${riskLevel.toUpperCase()} | **结论**: ${verdict}`,
        `**发现问题**:`,
        findingsText,
        findings?.length > 5 ? `...及其他${findings.length - 5}个` : '',
        '',
        summary ? `**总结**: ${summary}` : '',
      ].filter(Boolean).join('\n'),
      source: 'reviewer',
    };
  }

  // medium risk + comment → auto_handle
  return {
    action: 'auto_handle',
    severity: 'warning',
    summary: `PR #${prNumber} 有待审阅的建议`,
    details: `PR #${prNumber} "${prTitle}" 有${findings?.length ?? 0}条审查建议，请空了看一下。`,
    source: 'reviewer',
  };
}

/**
 * 巡检员决策
 * @param {import('../agents/types.mjs').InspectorReport} report
 */
function evaluateInspector(report) {
  // 日报 → 固定通知老板
  if (report.type === 'daily_summary') {
    const checksText = report.checks.map(c =>
      `| ${c.name} | ${c.status === 'ok' ? 'OK' : c.status.toUpperCase()} | ${c.value} |`
    ).join('\n');

    return {
      action: 'notify_boss',
      severity: 'info',
      summary: `日报 ${new Date().toISOString().slice(0, 10)}`,
      details: [
        `**[启元日报] ${new Date().toISOString().slice(0, 10)}**`,
        '',
        `**系统状态**: ${report.overallStatus === 'healthy' ? '健康' : report.overallStatus === 'degraded' ? '需关注' : '异常'}`,
        '',
        '| 检查项 | 状态 | 数值 |',
        '|--------|------|------|',
        checksText,
        '',
        report.overallStatus === 'healthy' ? '无需处理的事项。' : '请关注异常项。',
      ].join('\n'),
      source: 'inspector',
    };
  }

  // 常规巡检
  const criticals = report.checks.filter(c => c.status === 'critical');
  const warnings = report.checks.filter(c => c.status === 'warning');

  // critical → 立即通知
  if (criticals.length > 0 || report.overallStatus === 'down') {
    return {
      action: 'notify_boss',
      severity: 'critical',
      summary: `巡检严重异常: ${criticals.map(c => c.name).join(', ')}`,
      details: [
        `**[启元告警] 巡检发现严重问题**`,
        '',
        ...criticals.map(c => `- **${c.name}**: ${c.message ?? c.value} (阈值: ${c.threshold})`),
        '',
        `时间: ${report.timestamp}`,
      ].join('\n'),
      source: 'inspector',
    };
  }

  // warning → 检查连续计数，连续3次升级
  if (warnings.length > 0) {
    let shouldEscalate = false;
    for (const w of warnings) {
      const key = `inspector:${w.name}`;
      const count = (warningStreaks.get(key) ?? 0) + 1;
      warningStreaks.set(key, count);
      if (count >= WARNING_ESCALATE_THRESHOLD) {
        shouldEscalate = true;
      }
    }

    if (shouldEscalate) {
      // 重置计数
      for (const w of warnings) warningStreaks.delete(`inspector:${w.name}`);
      return {
        action: 'notify_boss',
        severity: 'warning',
        summary: `巡检连续警告: ${warnings.map(c => c.name).join(', ')}`,
        details: [
          `**[启元告警] 巡检连续${WARNING_ESCALATE_THRESHOLD}次警告，升级通知**`,
          '',
          ...warnings.map(c => `- **${c.name}**: ${c.message ?? c.value} (阈值: ${c.threshold})`),
        ].join('\n'),
        source: 'inspector',
      };
    }

    return {
      action: 'auto_handle',
      severity: 'warning',
      summary: `巡检警告: ${warnings.map(c => c.name).join(', ')}`,
      details: warnings.map(c => `${c.name}: ${c.message ?? c.value}`).join('; '),
      source: 'inspector',
    };
  }

  // 全正常 → 静默
  // 清除所有 warning 连续计数
  for (const key of warningStreaks.keys()) {
    if (key.startsWith('inspector:')) warningStreaks.delete(key);
  }

  return {
    action: 'log_only',
    severity: 'info',
    summary: '巡检正常',
    details: '',
    source: 'inspector',
  };
}

/**
 * 执行决策
 * @param {import('../agents/types.mjs').Decision} decision
 */
async function execute(decision) {
  const { action, severity, summary, details, source } = decision;

  // 所有决策都记录日志
  log.info({ action, severity, source, summary }, 'Decision made');

  switch (action) {
    case 'log_only':
      // 静默，只写日志
      break;

    case 'auto_handle':
      // 存入待汇报队列，等老板下次发消息时主动提醒
      pendingItems.push(decision);
      // 控制队列大小
      if (pendingItems.length > 50) pendingItems.splice(0, pendingItems.length - 50);
      eventBus.addPending(decision);
      break;

    case 'notify_boss':
      if (!bossChatId) {
        log.warn({ summary }, 'notify_boss: bossChatId not configured, skipping');
        break;
      }
      // 告警去重
      const dedupKey = `${source}:${summary}`;
      const lastAlert = alertDedup.get(dedupKey);
      if (lastAlert && Date.now() - lastAlert < ALERT_DEDUP_MS) {
        log.info({ dedupKey }, 'Alert deduplicated, skipping');
        break;
      }
      alertDedup.set(dedupKey, Date.now());

      // 发送飞书卡片
      await sendCard(bossChatId, {
        title: `[启元${severity === 'critical' ? '紧急' : '告警'}] ${summary}`,
        severity,
        content: details,
      });
      break;
  }
}

/**
 * 获取并清空待汇报事项（老板发消息时调用）
 * @returns {import('../agents/types.mjs').Decision[]}
 */
export function drainPendingItems() {
  const items = [...pendingItems];
  pendingItems.length = 0;
  return items;
}

/**
 * 手动触发日报（供定时器调用）
 * @param {import('../agents/types.mjs').InspectorReport} report
 */
export async function sendDailyReport(report) {
  const decision = evaluateInspector({ ...report, type: 'daily_summary' });
  await execute(decision);
}

// 定期清理告警去重 Map（每小时）
setInterval(() => {
  const now = Date.now();
  for (const [key, time] of alertDedup) {
    if (now - time > ALERT_DEDUP_MS * 2) alertDedup.delete(key);
  }
}, 60 * 60 * 1000);
