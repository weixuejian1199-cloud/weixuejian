/**
 * Agent 汇报数据结构定义 (JSDoc 类型)
 *
 * 三个 Agent 向启元（决策引擎）汇报时使用的统一数据格式。
 */

/**
 * @typedef {'sentinel' | 'reviewer' | 'inspector'} AgentName
 */

/**
 * @typedef {'info' | 'warning' | 'error' | 'critical'} Severity
 */

/**
 * @typedef {'log_only' | 'auto_handle' | 'notify_boss'} ActionType
 */

/**
 * 哨兵 Agent 汇报
 * @typedef {Object} SentinelReport
 * @property {'sentinel'} agent
 * @property {string} timestamp - ISO 8601
 * @property {'push' | 'pull_request'} trigger
 * @property {string} ref - branch name
 * @property {string} commitSha
 * @property {string} commitMessage
 * @property {'pass' | 'fail'} ciResult
 * @property {{ lint: boolean, typeCheck: boolean, test: boolean, build: boolean, guardViolations: string[] }} details
 * @property {string[]} failedTests
 */

/**
 * 审查官 Agent 汇报
 * @typedef {Object} ReviewerReport
 * @property {'reviewer'} agent
 * @property {string} timestamp
 * @property {number} prNumber
 * @property {string} prTitle
 * @property {string} author
 * @property {'approve' | 'request_changes' | 'comment'} verdict
 * @property {'low' | 'medium' | 'high' | 'critical'} riskLevel
 * @property {Array<{ file: string, line: number, rule: string, severity: string, message: string }>} findings
 * @property {string} summary
 */

/**
 * 巡检员 Agent 汇报
 * @typedef {Object} InspectorReport
 * @property {'inspector'} agent
 * @property {string} timestamp
 * @property {'routine' | 'alert' | 'daily_summary'} type
 * @property {Array<{ name: string, status: 'ok' | 'warning' | 'critical', value: string|number, threshold: string, message?: string }>} checks
 * @property {'healthy' | 'degraded' | 'down'} overallStatus
 */

/**
 * @typedef {SentinelReport | ReviewerReport | InspectorReport} AgentReport
 */

/**
 * 决策引擎输出
 * @typedef {Object} Decision
 * @property {ActionType} action
 * @property {Severity} severity
 * @property {string} summary - 一句话总结
 * @property {string} details - 详细内容（飞书消息正文）
 * @property {AgentName} source
 */

export const AGENT_PREFIX = {
  sentinel: '[SENTINEL]',
  reviewer: '[REVIEWER]',
  inspector: '[INSPECTOR]',
};
