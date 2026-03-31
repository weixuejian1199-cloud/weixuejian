/**
 * 进程内事件总线 — Agent 与决策引擎之间的通信管道
 *
 * 轻量封装 EventEmitter，Bridge 是单进程，不需要跨进程通信。
 */
import { EventEmitter } from 'node:events';
import { log } from './logger.mjs';

class AgentEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(20);
  }

  /**
   * Agent 提交汇报
   * @param {import('../agents/types.mjs').AgentReport} report
   */
  report(report) {
    log.info({ agent: report.agent, type: report.type ?? report.ciResult ?? report.verdict }, 'Agent report received');
    this.emit('agent:report', report);
  }

  /**
   * 待处理事项累积（auto_handle 的事项存起来，等老板下次消息时汇报）
   * @param {import('../agents/types.mjs').Decision} decision
   */
  addPending(decision) {
    this.emit('agent:pending', decision);
  }
}

export const eventBus = new AgentEventBus();
